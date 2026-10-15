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
  assert.equal(packageJson.version, "0.1.3");
  assert.equal(packageJson.version, staticManifest.version);
  assert.equal(staticManifest.id, ANDROID_GRADLE_PLUGIN_ID);
  assert.equal(ANDROID_GRADLE_PLUGIN.id, staticManifest.id);
  assert.equal(ANDROID_GRADLE_PLUGIN.version, staticManifest.version);
  assert.equal(ANDROID_GRADLE_PLUGIN.manifest, ANDROID_GRADLE_PLUGIN_MANIFEST);
  assert.equal(ANDROID_GRADLE_PLUGIN.manifest.version, staticManifest.version);
  assert.equal(ANDROID_GRADLE_PLUGIN.sdkMajor, staticManifest.sdkMajor);
  assert.equal(sdkPackageJson.version, "1.1.0");
  assert.equal(packageJson.devDependencies["@asterlyn/plugin-sdk"], "file:vendor/asterlyn-plugin-sdk-1.1.0.tgz");
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
  const defaultKeys = Object.keys(localization.locales[localization.defaultLocale]).sort();
  assert.deepEqual([...references].sort(), defaultKeys);
  assert.deepEqual(Object.keys(localization.locales["zh-CN"]).sort(), defaultKeys);
});
