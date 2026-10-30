import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, realpath, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeAgpV2LanguageModel } from "./normalize-model.mjs";
import { createModelDiagnosticReader, modelFailureRecord } from "./model-diagnostics.mjs";
import { availableRepositoryEnvironment } from "./model-environment.mjs";
import { requestedModelSelection } from "./model-selection.mjs";

const MAX_INPUT = 64 * 1024;
const MODEL_SOURCE = fileURLToPath(new URL("../tools/agp-model/AgpModelProgram.java", import.meta.url));
const absolute = (value) => typeof value === "string" && path.isAbsolute(value) && !value.includes("\0");
let debugTrace=false;
const fail = (started,error) => {process.stderr.write(`${JSON.stringify(modelFailureRecord(error,started,debugTrace))}\n`);process.exitCode=1;};
let activeRun = null; let cancellationRequested = false;
// The host starts this worker in its own process group.  Keep model children in
// that group so host shutdown's TERM/KILL reaches Java/Gradle descendants too.
// Local timeout handling only targets the direct child; host-owned group cleanup
// remains the authoritative tree kill path.
const ownedDescendants = (rootPid) => {
  if (process.platform === "win32") return [rootPid];
  const result = spawnSync("/bin/ps", ["-axo", "pid=,ppid="], {
    encoding: "utf8", timeout: 500, maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.error || result.status !== 0) return [rootPid];
  const children = new Map();
  for (const line of result.stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/u.exec(line);
    if (!match) continue;
    const pid = Number(match[1]); const ppid = Number(match[2]);
    if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(ppid)) continue;
    const list = children.get(ppid) ?? [];
    if (list.length < 128) list.push(pid);
    children.set(ppid, list);
  }
  const owned = [rootPid]; const queue = [[rootPid, 0]];
  while (queue.length && owned.length < 128) {
    const [parent, depth] = queue.shift();
    if (depth >= 16) continue;
    for (const child of children.get(parent) ?? []) {
      if (owned.includes(child)) continue;
      owned.push(child); queue.push([child, depth + 1]);
      if (owned.length >= 128) break;
    }
  }
  return owned;
};
const signalPids = (pids, signal) => {
  for (const pid of pids) { try { process.kill(pid, signal); } catch {} }
};
const signalChildTree = (child, signal) => {
  if (!child?.pid) return;
  try {
    if (process.platform === "win32") {
      const root = process.env.SystemRoot ?? "C:\\Windows";
      spawnSync(`${root}\\System32\\taskkill.exe`, ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true, timeout: 500 });
    } else {
      signalPids(ownedDescendants(child.pid), signal);
    }
  } catch { try { child.kill(signal); } catch {} }
};
const stopActiveChild = () => { activeRun?.terminate("cancelled"); };
process.on("SIGTERM", () => { cancellationRequested = true; stopActiveChild(); });
const run = (program, args, { cwd, timeoutMs }) => new Promise((resolve, reject) => {
  const child = spawn(program, args, { cwd, detached: false, stdio: ["ignore", "pipe", "pipe"] });
  let forceTimer = null; let terminated = false; let ownedPids = null;
  const terminate = (reason) => { if (terminated) return; terminated = true; if (reason) abortReason = new Error(reason); ownedPids = ownedDescendants(child.pid); if (process.platform === "win32") signalChildTree(child, "SIGTERM"); else signalPids(ownedPids, "SIGTERM"); forceTimer = setTimeout(() => { if (process.platform === "win32") signalChildTree(child, "SIGKILL"); else signalPids(ownedPids ?? [child.pid], "SIGKILL"); }, 5000); forceTimer.unref?.(); };
  activeRun = { child, terminate };
  let output = ""; let settled = false; let timer;
  let abortReason = null;
  child.stdout.on("data", (chunk) => { output += chunk.toString("utf8"); if (Buffer.byteLength(output) > 16 * 1024 * 1024 && !abortReason) terminate("output-bound"); });
  const diagnostic = createModelDiagnosticReader();
  child.stderr.on("data",chunk=>diagnostic.feed(chunk));
  const finish = (error, code) => { if (settled) return; settled = true; if (activeRun?.child === child) activeRun = null; clearTimeout(timer); clearTimeout(forceTimer); forceTimer = null; const failure=error??abortReason??(cancellationRequested?new Error("cancelled"):code!==0?new Error("program-failed"):null); if(failure){Object.assign(failure,diagnostic.snapshot());reject(failure);}else resolve(output); };
  child.once("error", (error) => finish(error)); child.once("close", (code) => finish(null, code));
  timer = setTimeout(() => terminate("program-timeout"), timeoutMs);
});
const readRequest = async () => {
  let input = ""; for await (const chunk of process.stdin) { input += chunk; if (Buffer.byteLength(input) > MAX_INPUT) throw new Error("request-bound"); }
  const value = JSON.parse(input); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("request-object");
  if (value.protocolVersion !== 1 || !absolute(value.workspaceRoot) || typeof value.inputDigest !== "string" || value.inputDigest.length > 256) throw new Error("request-schema");
  const tools = value.tools, components = value.components, state = value.state;
  if (!tools?.gradleJava || !absolute(tools.gradleJava.home) || !absolute(tools.gradleJava.java) || !absolute(tools.gradleJava.javac) || !Number.isSafeInteger(tools.gradleJava.major) || tools.gradleJava.major < 17 || tools.gradleJava.major > 24 || typeof tools.gradleJava.digest !== "string" || !state || typeof state!=="object" || Array.isArray(state)) throw new Error("request-fields");
  if (!components || typeof components !== "object" || Array.isArray(components) || Object.keys(components).length > 16 || Object.entries(components).some(([id, component]) => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(id) || !component || typeof component !== "object" || typeof component.digest !== "string")) throw new Error("component-fields");
  return {...value,...requestedModelSelection(state.runConfiguration)};
};
const versionFrom = (names, pattern) => { const name = names.find((entry) => pattern.test(entry)); const match = name && pattern.exec(name); if (!match) throw new Error("tool-version-missing"); return match[1]; };
const wrapperVersion = async (workspace) => { const text = await readFile(path.join(workspace, "gradle/wrapper/gradle-wrapper.properties"), "utf8").catch(() => ""); const match = /gradle-([0-9]+\.[0-9]+(?:\.[0-9]+)?)(?:-[^/]+)?\.(?:zip|tar)/u.exec(text); if (!match) throw new Error("gradle-wrapper-version-missing"); return match[1]; };
const existing = async (file, directory = false) => { const value = await stat(file).catch(() => null); if (!value || (directory ? !value.isDirectory() : !value.isFile())) throw new Error("model-path-missing"); };
const stablePath = async (file) => { const resolved = await realpath(file).catch(() => null); if (!resolved) throw new Error("model-path-missing"); return resolved; };
const stabilizeModelPaths = async (model) => { for (const module of model.modules) { module.directory = await stablePath(module.directory); module.sources = await Promise.all(module.sources.map(stablePath)); module.generatedSources = await Promise.all(module.generatedSources.map(stablePath)); module.bootClasspath = await Promise.all(module.bootClasspath.map(stablePath)); module.compileClasspath = await Promise.all(module.compileClasspath.map(stablePath)); module.sourceAttachments = await Promise.all(module.sourceAttachments.map(async (attachment) => ({ binary: await stablePath(attachment.binary), sources: await Promise.all(attachment.sources.map(stablePath)) }))); } return model; };
const componentJars = async () => { const root = fileURLToPath(new URL("./components", import.meta.url)); const entries = await readdir(root, { withFileTypes: true }); return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".jar")).map((entry) => path.join(root, entry.name)); };
const prepareGradleHome = async (workspace) => { const home = await mkdtemp(path.join(tmpdir(), "asterlyn-android-gradle-home-")); const user = process.env.HOME ? path.join(process.env.HOME, ".gradle") : null; for (const relative of ["caches", "wrapper/dists"]) { if (!user) continue; const source = path.join(user, relative); const target = path.join(home, relative); if (await stat(source).catch(() => null)) { await mkdir(path.dirname(target), { recursive: true }); await symlink(source, target, process.platform === "win32" ? "junction" : "dir").catch(() => {}); } } const credentials = []; for (const file of [path.join(workspace, "local.properties"), ...(user ? [path.join(user, "gradle.properties")] : [])]) { const text = await readFile(file, "utf8").catch(() => ""); for (const line of text.split(/\r?\n/u)) { const match = /^\s*(nexusUsername|nexusPassword|mavenUsername|mavenPassword)\s*=\s*(.*?)\s*$/u.exec(line); if (match) credentials.push([match[1], match[2]]); } } for (const [key, value] of credentials) process.env[key.toLowerCase().includes("user") ? "ASTERLYN_NEXUS_USERNAME" : "ASTERLYN_NEXUS_PASSWORD"] = value; Object.assign(process.env, availableRepositoryEnvironment(process.env)); return home; };

const started = performance.now(); let scratch; let ownedGradleHome;
try {
  const request = await readRequest();
  debugTrace=request.debugTrace===true;
  request.workspaceRoot = await realpath(request.workspaceRoot); request.tools.gradleJava.home = await realpath(request.tools.gradleJava.home); request.tools.gradleJava.java = await realpath(request.tools.gradleJava.java); request.tools.gradleJava.javac = await realpath(request.tools.gradleJava.javac);
  const jars = await componentJars(); const builderModelJar = jars.find((file) => /(?:^|\/)builder-model-[^/]+\.jar$/u.test(file)); if (!builderModelJar) throw new Error("builder-model-component-missing");
  const gradleVersion = await wrapperVersion(request.workspaceRoot); const agpVersion = versionFrom([path.basename(builderModelJar)], /^builder-model-(.+)\.jar$/u);
  scratch = await mkdtemp(path.join(tmpdir(), "asterlyn-android-model-"));
  const javaHome = request.tools.gradleJava.home; const java = request.tools.gradleJava.java; const javac = request.tools.gradleJava.javac;
  await existing(java); await existing(javac); await existing(javaHome, true); await existing(builderModelJar); await existing(request.workspaceRoot, true);
  const componentClasspath = jars.join(path.delimiter); if (cancellationRequested) throw new Error("cancelled"); log("compile", 1, started); await run(javac, ["-d", scratch, "-cp", componentClasspath, MODEL_SOURCE], { cwd: request.workspaceRoot, timeoutMs: 30_000 });
  if (cancellationRequested) throw new Error("cancelled");
  log("model", 1, started);
  const gradleHome = ownedGradleHome = await prepareGradleHome(request.workspaceRoot);
  const raw = await run(java, ["-cp", `${scratch}${path.delimiter}${componentClasspath}`, "AgpModelProgram", request.workspaceRoot, gradleHome, javaHome, componentClasspath, request.module, request.variant], { cwd: request.workspaceRoot, timeoutMs: 5 * 60_000 });
  const extracted=JSON.parse(raw);
  if(!extracted.selection||typeof extracted.selection.module!=="string"||typeof extracted.selection.variant!=="string"||(request.module&&extracted.selection.module!==request.module)||(request.variant&&extracted.selection.variant!==request.variant))throw Error("model-selection-unavailable");
  const model = await stabilizeModelPaths(normalizeAgpV2LanguageModel(extracted.projects, { buildRoot: request.workspaceRoot, gradleVersion, agpVersion, selection: extracted.selection }));
  for (const module of model.modules) {
    await existing(module.directory, true); for (const source of module.sources) await existing(source, true); for (const source of module.generatedSources) await existing(source, true); for (const file of [...module.bootClasspath, ...module.compileClasspath]) await existing(file); for (const attachment of module.sourceAttachments) { await existing(attachment.binary); for (const source of attachment.sources) await existing(source, true); }
    if (module.compileClasspath.some((file) => file.startsWith(`${module.directory}${path.sep}`) && file.includes(`${path.sep}build${path.sep}`))) throw new Error("project-output-on-external-classpath");
  }
  log("serialize", model.modules.length, started); process.stdout.write(`${JSON.stringify(model)}\n`);
} catch (error) { fail(started,error); }
finally { if (scratch) await rm(scratch, { recursive: true, force: true }).catch(() => {}); if (ownedGradleHome) await rm(ownedGradleHome, { recursive: true, force: true }).catch(() => {}); }

function log(stage, count, startedAt) { process.stderr.write(`${JSON.stringify({ stage, count, durationMs: Math.round(performance.now() - startedAt) })}\n`); }
