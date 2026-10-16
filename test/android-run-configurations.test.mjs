import assert from "node:assert/strict";
import test from "node:test";

import {
  androidRunConfigurationSnapshot,
  buildAndroidStagedRunPlan,
  deriveAndroidRunConfigurations,
  isUpdateIncompatibleDeployment,
  parseAgpOutputMetadata,
  parseAndroidLaunchComponent,
  resolveAgpSingleApkArtifact,
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

test("derives selectable application variants only from install evidence with an assemble peer", () => {
  const configurations = deriveAndroidRunConfigurations(ready([
    task(":app:assembleDemoDebug"),
    task(":app:installDemoDebug"),
    task(":app:installDemoDebugAndroidTest"),
    task(":feature:assembleDebug"),
    task(":demo:installRelease", false),
    task(":assembleDebug"),
    task(":installDebug"),
  ]));
  assert.deepEqual(configurations.map(({ id, taskId, installTaskId, module, variant, descriptor }) => ({
    id, taskId, installTaskId, module, variant, label: descriptor.label, targetProviderId: descriptor.targetProviderId,
  })), [
    {
      id: "android-run::app:installDemoDebug",
      taskId: ":app:assembleDemoDebug",
      installTaskId: ":app:installDemoDebug",
      module: ":app",
      variant: "DemoDebug",
      label: "app · DemoDebug",
      targetProviderId: "android-devices",
    },
    {
      id: "android-run::installDebug",
      taskId: ":assembleDebug",
      installTaskId: ":installDebug",
      module: ":",
      variant: "Debug",
      label: "root · Debug",
      targetProviderId: "android-devices",
    },
  ]);
});

test("restores a valid selected configuration and falls back deterministically", () => {
  const snapshot = ready([task(":app:assembleDebug"), task(":app:installDebug"), task(":demo:assembleRelease"), task(":demo:installRelease")]);
  assert.equal(androidRunConfigurationSnapshot(snapshot, "android-run::demo:installRelease").selectedConfigurationId, "android-run::demo:installRelease");
  assert.equal(androidRunConfigurationSnapshot(snapshot, "missing").selectedConfigurationId, "android-run::app:installDebug");
  assert.deepEqual(androidRunConfigurationSnapshot({ status: "loading", tasks: [] }, null), {
    status: "loading", configurations: [], selectedConfigurationId: null,
  });
});

test("staged Run resolves AGP output metadata and installs on the selected device", () => {
  const applied = [];
  const buildResults = [];
  const build = {
    request: { pluginId: "dev.asterlyn.android-gradle", providerId: "gradle-tasks", taskId: ":app:assembleDemoDebug", label: "assemble", executablePath: "gradlew", args: [] },
    artifactSearch: { hints: ["app/build/outputs/apk"] },
    apply: (value) => buildResults.push(value),
  };
  const plan = buildAndroidStagedRunPlan(build, "emulator-5554", "DemoDebug", (value) => applied.push(value));
  const buildResult = result("BUILD SUCCESSFUL\n");
  plan.build.apply(buildResult);
  assert.deepEqual(buildResults, [buildResult]);
  assert.deepEqual(plan.build.artifactSearch, { hints: ["app/build/outputs/apk"], sidecarNames: ["output-metadata.json"] });
  const sidecars = [{
    workspacePath: "app/build/outputs/apk/demo/debug/output-metadata.json",
    byteLength: 160,
    dataBase64: btoa(JSON.stringify({ artifactType: { type: "APK" }, variantName: "DemoDebug", elements: [{ type: "SINGLE", outputFile: "app-demo-debug.apk" }] })),
  }];
  assert.deepEqual(plan.inspect([
    { workspacePath: "app/build/outputs/apk/demo/debug/app-demo-debug.apk", kind: "apk", byteLength: 1 },
    { workspacePath: "app/build/outputs/apk/release/app-release.apk", kind: "apk", byteLength: 1 },
  ], sidecars, false), {
    operationId: "android.apk.inspect",
    parameters: { artifact: "app/build/outputs/apk/demo/debug/app-demo-debug.apk" },
  });
  const inspection = {
    status: "succeeded",
    stdout: "package: name='com.example.demo' versionCode='1'\nlaunchable-activity: name='.MainActivity' label=''\n",
    stderr: "",
    truncated: false,
    exitCode: 0,
    error: null,
  };
  assert.deepEqual(plan.deploy(inspection), {
    operationId: "android.adb.install",
    parameters: { target: "emulator-5554", artifact: "app/build/outputs/apk/demo/debug/app-demo-debug.apk" },
  });
  const incompatible = {
    status: "failed",
    stdout: "",
    stderr: "adb: failed to install: Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: signatures do not match]",
    truncated: false,
    exitCode: 1,
    error: null,
  };
  assert.deepEqual(plan.recoverDeployment(inspection, incompatible), {
    confirmation: {
      titleKey: "run.recovery.uninstall.title",
      messageKey: "run.recovery.uninstall.message",
      confirmLabelKey: "run.recovery.uninstall.confirm",
      cancelLabelKey: "run.recovery.uninstall.cancel",
      destructive: true,
    },
    operation: {
      operationId: "android.adb.uninstall",
      parameters: { target: "emulator-5554", applicationId: "com.example.demo" },
    },
  });
  assert.deepEqual(plan.launch(inspection), {
    operationId: "android.adb.launch",
    parameters: { target: "emulator-5554", component: "com.example.demo/com.example.demo.MainActivity" },
  });
  plan.apply({ status: "succeeded", phase: "launching", error: null });
  assert.equal(applied[0].status, "succeeded");
});

test("deployment recovery accepts only exact, complete signature-conflict results", () => {
  const failed = (stderr, overrides = {}) => ({ status: "failed", stdout: "", stderr, truncated: false, exitCode: 1, error: null, ...overrides });
  assert.equal(isUpdateIncompatibleDeployment(failed("Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]")), true);
  assert.equal(isUpdateIncompatibleDeployment(failed("INSTALL_FAILED_VERSION_DOWNGRADE")), false);
  assert.equal(isUpdateIncompatibleDeployment(failed("prefixINSTALL_FAILED_UPDATE_INCOMPATIBLEsuffix")), false);
  assert.equal(isUpdateIncompatibleDeployment(failed("INSTALL_FAILED_UPDATE_INCOMPATIBLE", { truncated: true })), false);
  assert.equal(isUpdateIncompatibleDeployment({ ...failed("INSTALL_FAILED_UPDATE_INCOMPATIBLE"), status: "succeeded" }), false);
});

test("AGP artifact resolution fails closed for mismatched, ambiguous, split, or malformed metadata", () => {
  const artifacts = [
    { workspacePath: "app/build/outputs/apk/demo/debug/app.apk", kind: "apk", byteLength: 1 },
  ];
  const sidecar = (metadata, path = "app/build/outputs/apk/demo/debug/output-metadata.json") => ({ workspacePath: path, byteLength: 1, dataBase64: btoa(JSON.stringify(metadata)) });
  const single = sidecar({ artifactType: { type: "APK" }, variantName: "DemoDebug", elements: [{ type: "SINGLE", outputFile: "app.apk" }] });
  assert.equal(resolveAgpSingleApkArtifact(artifacts, [single], "DemoDebug"), artifacts[0]);
  assert.equal(resolveAgpSingleApkArtifact(artifacts, [single], "Release"), null);
  assert.equal(resolveAgpSingleApkArtifact(artifacts, [single, single], "DemoDebug"), null);
  assert.equal(parseAgpOutputMetadata(JSON.stringify({ variantName: "DemoDebug", elements: [{ type: "SPLIT", outputFile: "app.apk" }] })), null);
  assert.equal(parseAgpOutputMetadata("{"), null);
});

test("AAPT badging parsing supports aliases and rejects missing launch metadata", () => {
  assert.deepEqual(parseAndroidLaunchComponent("package: name='com.example'\nlaunchable-activity: name='LauncherAlias'\n"), {
    applicationId: "com.example",
    activityName: "com.example.LauncherAlias",
    component: "com.example/com.example.LauncherAlias",
  });
  assert.deepEqual(parseAndroidLaunchComponent("package: name='com.example.tv'\nleanback-launchable-activity: name='.TvActivity'\n"), {
    applicationId: "com.example.tv",
    activityName: "com.example.tv.TvActivity",
    component: "com.example.tv/com.example.tv.TvActivity",
  });
  assert.equal(parseAndroidLaunchComponent("package: name='com.example'\nlaunchable-activity: name='.One'\nlaunchable-activity: name='.Two'\n"), null);
  assert.equal(parseAndroidLaunchComponent("package: name='com.example'\n"), null);
  assert.equal(parseAndroidLaunchComponent("launchable-activity: name='.MainActivity'\n"), null);
});
