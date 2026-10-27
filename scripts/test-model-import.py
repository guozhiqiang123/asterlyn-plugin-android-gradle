#!/usr/bin/env python3
"""Development-only real AGP model regression.

Copies an existing Android fixture, injects one deliberately missing test or
main dependency, and invokes the packaged model provider.  The original fixture
and user-wide Gradle settings are unchanged; Gradle may populate its existing cache.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import shutil
import signal
import subprocess
import sys
import tempfile
import time


def run_provider(provider: pathlib.Path, request: dict, timeout: float) -> tuple[int, str, str]:
    env = os.environ.copy()
    proc = subprocess.Popen(
        ["node", str(provider)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=(os.name != "nt"),
        env=env,
    )
    payload = json.dumps(request) + "\n"
    try:
        stdout, stderr = proc.communicate(payload, timeout=timeout)
    except subprocess.TimeoutExpired:
        if os.name == "nt":
            proc.kill()
        else:
            os.killpg(proc.pid, signal.SIGTERM)
            try:
                proc.wait(timeout=0.5)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
        stdout, stderr = proc.communicate()
        raise RuntimeError(f"provider timeout after {timeout:.0f}s; stderr={stderr[-1000:]}")
    return proc.returncode, stdout, stderr


def make_case(source: pathlib.Path, kind: str) -> pathlib.Path:
    destination = pathlib.Path(tempfile.mkdtemp(prefix=f"asterlyn-model-{kind}-"))
    shutil.copytree(source, destination, dirs_exist_ok=True, ignore=shutil.ignore_patterns("build", ".gradle", ".kotlin"))
    build_file = destination / "app" / "build.gradle.kts"
    text = build_file.read_text()
    missing = f'com.example.asterlyn:missing-{kind}:0.0.1-SNAPSHOT'
    configuration = "testImplementation" if kind == "test" else "implementation"
    build_file.write_text(text + f'\ndependencies {{ {configuration}("{missing}") }}\n')
    return destination


def request_for(root: pathlib.Path, input_file: pathlib.Path, run_configuration: str) -> dict:
    request = json.loads(input_file.read_text())
    request["workspaceRoot"] = str(root)
    request["state"] = {"runConfiguration": run_configuration}
    request["inputDigest"] = f"regression-{run_configuration}"
    return request


def assert_model(stdout: str, root: pathlib.Path) -> dict:
    model = json.loads(stdout)
    assert model.get("schemaVersion") == 1, model.get("schemaVersion")
    assert model.get("selection", {}).get("module") == ":app", model.get("selection")
    assert model.get("selection", {}).get("variant") == "demoDebug", model.get("selection")
    modules = model.get("modules")
    assert isinstance(modules, list) and modules, "model has no modules"
    app = next((item for item in modules if item.get("module") == ":app" or str(item.get("directory", "")).endswith("/app")), None)
    assert app is not None, "app module absent"
    assert app.get("sources"), "app main sources absent"
    assert app.get("compileClasspath") is not None, "app compile classpath absent"
    assert all(pathlib.Path(item).exists() for item in app["sources"]), "missing app source root"
    assert all(pathlib.Path(item).exists() for item in app["compileClasspath"]), "missing app compile artifact"
    assert pathlib.Path(app["directory"]).resolve().is_relative_to(root.resolve())
    return {"schemaVersion": model["schemaVersion"], "modules": len(modules), "appCompileArtifacts": len(app["compileClasspath"]), "appSources": len(app["sources"]), "selection": model["selection"]}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", type=pathlib.Path, default=pathlib.Path("/tmp/asterlyn-android-lsp/android-fixture"))
    parser.add_argument("--input", type=pathlib.Path, default=pathlib.Path("/tmp/asterlyn-android-lsp/fixture-demo-input-boot.json"))
    parser.add_argument("--package-root", type=pathlib.Path, default=pathlib.Path(__file__).parents[1])
    parser.add_argument("--timeout", type=float, default=300.0)
    parser.add_argument("--summary", type=pathlib.Path)
    args = parser.parse_args()
    source = args.fixture.resolve()
    input_file = args.input.resolve()
    provider = (args.package_root.resolve() / "server-programs" / "model.mjs")
    if not source.is_dir() or not input_file.is_file() or not provider.is_file():
        raise SystemExit("fixture, input, or packaged model.mjs is missing")
    summary = {"provider": str(provider), "cases": []}
    roots = []
    began = time.monotonic()
    try:
        test_root = make_case(source, "test")
        roots.append(test_root)
        code, stdout, stderr = run_provider(provider, request_for(test_root, input_file, "android-run::app:installDemoDebug"), args.timeout)
        if code != 0:
            raise AssertionError(f"test-only dependency unexpectedly failed: {stderr[-2000:]}")
        summary["cases"].append({"name": "missing-test-dependency", "status": "passed", **assert_model(stdout, test_root), "stderrTail": stderr[-1000:]})
        shutil.rmtree(test_root, ignore_errors=True)

        main_root = make_case(source, "main")
        roots.append(main_root)
        code, stdout, stderr = run_provider(provider, request_for(main_root, input_file, "android-run::app:installDemoDebug"), args.timeout)
        if code == 0 or stdout.strip():
            raise AssertionError("missing main dependency unexpectedly produced a successful model")
        summary["cases"].append({"name": "missing-main-dependency", "status": "passed", "exitCode": code, "stderrTail": stderr[-1000:]})
        shutil.rmtree(main_root, ignore_errors=True)
    finally:
        summary["elapsedMs"] = round((time.monotonic() - began) * 1000)
        for root in roots:
            shutil.rmtree(root, ignore_errors=True)
        if args.summary:
            args.summary.write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"model-import regression failed: {error}", file=sys.stderr)
        raise
