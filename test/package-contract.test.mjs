import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ANDROID_GRADLE_PLUGIN,
  ANDROID_GRADLE_PLUGIN_ID,
  ANDROID_GRADLE_PLUGIN_MANIFEST,
} from "../src/index.ts";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const staticManifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
const sdkPackageJson = JSON.parse(await readFile(new URL("../node_modules/@asterlyn/plugin-sdk/package.json", import.meta.url), "utf8"));

test("package, static manifest, and executable module share one identity", () => {
  assert.equal(packageJson.version, "0.5.8");
  assert.equal(packageJson.version, staticManifest.version);
  assert.equal(staticManifest.id, ANDROID_GRADLE_PLUGIN_ID);
  assert.equal(ANDROID_GRADLE_PLUGIN.id, staticManifest.id);
  assert.equal(ANDROID_GRADLE_PLUGIN.version, staticManifest.version);
  assert.equal(ANDROID_GRADLE_PLUGIN.manifest, ANDROID_GRADLE_PLUGIN_MANIFEST);
  assert.equal(ANDROID_GRADLE_PLUGIN.manifest.version, staticManifest.version);
  assert.equal(ANDROID_GRADLE_PLUGIN.sdkMajor, staticManifest.sdkMajor);
  assert.equal(sdkPackageJson.version, "1.10.0");
  assert.equal(packageJson.devDependencies["@asterlyn/plugin-sdk"], "file:vendor/asterlyn-plugin-sdk-1.10.0.tgz");
  assert.equal(staticManifest.schemaVersion, 3);
  assert.equal(staticManifest.distribution.repository, "guozhiqiang123/asterlyn-plugin-android-gradle");
  assert.equal(staticManifest.distribution.runtime.entry, "runtime/plugin.js");
  assert.deepEqual(staticManifest.distribution.integrity, {});
  assert.ok(staticManifest.permissions.includes("host.tasks.execute"));
});

test("the static manifest owns complete English and Chinese plugin copy", () => {
  const { localization } = staticManifest;
  assert.equal(localization.defaultLocale, "en-US");
  assert.deepEqual(Object.keys(localization.locales).sort(), ["en-US", "zh-CN"]);
  const references = new Set([staticManifest.nameKey, staticManifest.descriptionKey]);
  for (const setting of staticManifest.settings) {
    references.add(setting.labelKey);
    if (setting.descriptionKey) references.add(setting.descriptionKey);
    for (const option of setting.options ?? []) references.add(option.labelKey);
  }
  references.add(staticManifest.taskAuthorization.workspaceTrust.labelKey);
  references.add(staticManifest.taskAuthorization.workspaceTrust.descriptionKey);
  references.add(staticManifest.taskAuthorization.taskConfirmation.rememberLabelKey);
  references.add(staticManifest.taskAuthorization.taskConfirmation.rememberDescriptionKey);
  references.add(staticManifest.workspaceTool.titleKey);
  for (const view of staticManifest.workspaceTool.views) references.add(view.labelKey);
  for (const key of [
    "panel.run",
    "panel.tasks",
    "device.status.online",
    "device.status.offline",
    "device.status.unauthorized",
    "device.status.unknown",
    "device.error.discovery",
    "device.error.adbUnavailable",
    "device.action.refresh",
    "device.action.retry",
    "device.title",
    "device.loading",
    "device.empty",
    "device.emptyDetail",
    "device.count",
    "run.empty",
    "run.loading",
    "run.error",
    "run.configuration.select",
    "run.target.select",
    "run.action.start",
    "run.action.stop",
    "run.configuration.androidApp",
    "run.configuration.incomplete",
    "run.session.running",
    "run.session.succeeded",
    "run.session.failed",
    "run.session.cancelled",
    "run.session.crashed",
    "run.phase.building",
    "run.phase.resolving-artifact",
    "run.phase.validating-target",
    "run.phase.installing",
    "run.phase.awaiting-deployment-recovery",
    "run.phase.recovering-deployment",
    "run.phase.launching",
    "run.recovery.uninstall.title",
    "run.recovery.uninstall.message",
    "run.recovery.uninstall.confirm",
    "run.recovery.uninstall.cancel",
  ]) references.add(key);
  const defaultKeys = Object.keys(localization.locales[localization.defaultLocale]).sort();
  assert.deepEqual([...references].sort(), defaultKeys);
  assert.deepEqual(Object.keys(localization.locales["zh-CN"]).sort(), defaultKeys);
  assert.ok(staticManifest.capabilities.includes("taskAuthorization"));
  assert.ok(staticManifest.capabilities.includes("toolOperations"));
  assert.equal(staticManifest.workspaceTool.defaultView, "tasks");
  assert.deepEqual(staticManifest.workspaceTool.views.map((view) => view.id), ["run", "tasks"]);
  assert.equal("processQueries" in staticManifest, false);
  assert.equal("toolOperations" in staticManifest, false);
  assert.deepEqual(staticManifest.hostOperations.map((operation) => operation.id), [
    "adb.devices",
    "android.apk.inspect",
    "android.adb.install",
    "android.adb.uninstall",
    "android.adb.launch",
  ]);
});
