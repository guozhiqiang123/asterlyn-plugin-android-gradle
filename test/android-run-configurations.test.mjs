import assert from "node:assert/strict";
import test from "node:test";

import {
  androidRunConfigurationSnapshot,
  buildAndroidStagedRunPlan,
  deriveAndroidRunConfigurations,
  extractInstalledApkBasename,
  parseAndroidLaunchComponent,
  resolveInstalledApkArtifact,
} from "../src/run-configurations.ts";

const task = (id, runnable = true) => ({
  id,
  label: id,
  group: "Install tasks",
  projectPath: id.slice(0, id.lastIndexOf(":")) || ":",
  runnable,
});
const ready = (tasks) => ({ status: "ready", tasks });
const result = (output, overrides = {}) => ({
  status: "succeeded",
  outputs: [{ stream: "stdout", dataBase64: btoa(output) }],
  truncated: false,
  error: null,
  ...overrides,
});

test("derives selectable application variants only from runnable install tasks", () => {
  const configurations = deriveAndroidRunConfigurations(ready([
    task(":app:installDemoDebug"),
    task(":app:installDemoDebugAndroidTest"),
    task(":feature:assembleDebug"),
    task(":demo:installRelease", false),
    task(":installDebug"),
  ]));
  assert.deepEqual(configurations.map(({ id, taskId, module, variant, descriptor }) => ({
    id, taskId, module, variant, label: descriptor.label, targetProviderId: descriptor.targetProviderId,
  })), [
    {
      id: "android-run::app:installDemoDebug",
      taskId: ":app:installDemoDebug",
      module: ":app",
      variant: "DemoDebug",
      label: "app · DemoDebug",
      targetProviderId: "android-devices",
    },
    {
      id: "android-run::installDebug",
      taskId: ":installDebug",
      module: ":",
      variant: "Debug",
      label: "root · Debug",
      targetProviderId: "android-devices",
    },
  ]);
});

test("restores a valid selected configuration and falls back deterministically", () => {
  const snapshot = ready([task(":app:installDebug"), task(":demo:installRelease")]);
  assert.equal(androidRunConfigurationSnapshot(snapshot, "android-run::demo:installRelease").selectedConfigurationId, "android-run::demo:installRelease");
  assert.equal(androidRunConfigurationSnapshot(snapshot, "missing").selectedConfigurationId, "android-run::app:installDebug");
  assert.deepEqual(androidRunConfigurationSnapshot({ status: "loading", tasks: [] }, null), {
    status: "loading", configurations: [], selectedConfigurationId: null,
  });
});

test("staged Run follows the exact APK installed by Gradle and selected device", () => {
  const applied = [];
  const installResults = [];
  const install = {
    request: { pluginId: "dev.asterlyn.android-gradle", providerId: "gradle-tasks", taskId: ":app:installDemoDebug", label: "install", executablePath: "gradlew", args: [] },
    artifactSearch: { hints: ["app/build/outputs/apk"] },
    apply: (value) => installResults.push(value),
  };
  const plan = buildAndroidStagedRunPlan(install, "emulator-5554", (value) => applied.push(value));
  const installResult = result("Installing APK 'app-demo-debug.apk' on 'Pixel'\nInstalled on 1 device.\n");
  plan.install.apply(installResult);
  assert.deepEqual(installResults, [installResult]);
  assert.deepEqual(plan.inspect([
    { workspacePath: "app/build/outputs/apk/demo/debug/app-demo-debug.apk", kind: "apk", byteLength: 1 },
    { workspacePath: "app/build/outputs/apk/release/app-release.apk", kind: "apk", byteLength: 1 },
  ]), {
    operationId: "android.apk.inspect",
    parameters: { artifact: "app/build/outputs/apk/demo/debug/app-demo-debug.apk" },
  });
  assert.deepEqual(plan.launch({
    status: "succeeded",
    stdout: "package: name='com.example.demo' versionCode='1'\nlaunchable-activity: name='.MainActivity' label=''\n",
    stderr: "",
    truncated: false,
    exitCode: 0,
    error: null,
  }), {
    operationId: "android.adb.launch",
    parameters: { target: "emulator-5554", component: "com.example.demo/com.example.demo.MainActivity" },
  });
  plan.apply({ status: "succeeded", phase: "launching", error: null });
  assert.equal(applied[0].status, "succeeded");
});

test("artifact resolution fails closed for ambiguous, mismatched, or truncated install evidence", () => {
  const artifacts = [
    { workspacePath: "a/debug/app.apk", kind: "apk", byteLength: 1 },
    { workspacePath: "b/debug/app.apk", kind: "apk", byteLength: 1 },
  ];
  assert.equal(resolveInstalledApkArtifact(artifacts, "app.apk"), null);
  assert.equal(resolveInstalledApkArtifact(artifacts, "missing.apk"), null);
  assert.equal(resolveInstalledApkArtifact([artifacts[0]], null), artifacts[0]);
  assert.equal(extractInstalledApkBasename(result("Installing APK 'folder/app.apk'\n")), "app.apk");
  assert.equal(extractInstalledApkBasename({
    ...result(""),
    outputs: [
      { stream: "stdout", dataBase64: btoa("Installing A") },
      { stream: "stdout", dataBase64: btoa("PK 'folder/split.apk'\n") },
    ],
  }), "split.apk");
  assert.equal(extractInstalledApkBasename(result("Installing APK 'app.apk'\n", { truncated: true })), null);
});

test("AAPT badging parsing supports aliases and rejects missing launch metadata", () => {
  assert.deepEqual(parseAndroidLaunchComponent("package: name='com.example'\nlaunchable-activity: name='LauncherAlias'\n"), {
    applicationId: "com.example",
    activityName: "com.example.LauncherAlias",
    component: "com.example/com.example.LauncherAlias",
  });
  assert.equal(parseAndroidLaunchComponent("package: name='com.example'\n"), null);
  assert.equal(parseAndroidLaunchComponent("launchable-activity: name='.MainActivity'\n"), null);
});
