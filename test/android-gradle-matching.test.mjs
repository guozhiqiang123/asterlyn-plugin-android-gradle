import assert from "node:assert/strict";
import test from "node:test";

import { ANDROID_GRADLE_PLUGIN } from "../src/plugin.ts";

const matches = (paths, { platform = "posix", truncated = false } = {}) =>
  ANDROID_GRADLE_PLUGIN.matches({
    identity: { root: "/repo", generation: 1 },
    evidence: {
      kind: "workspace-catalog",
      platform,
      truncated,
      files: paths.map((workspacePath) => ({ workspacePath })),
    },
  });

test("matches complete root-wrapper Gradle workspaces without requiring Android evidence", () => {
  assert.equal(matches(["gradlew"]), true);
  assert.equal(matches(["settings.gradle", "build.gradle", "gradlew"]), true);
  assert.equal(matches(["settings.gradle.kts", "gradlew.bat"], { platform: "windows" }), true);
});

test("rejects incomplete, nested, wrong-platform, and truncated Gradle-like evidence", () => {
  assert.equal(matches(["settings.gradle", "build.gradle"]), false);
  assert.equal(matches(["gradle/wrapper/gradle-wrapper.properties"]), false);
  assert.equal(matches(["app/gradlew", "app/build.gradle"]), false);
  assert.equal(matches(["gradlew.bat"]), false);
  assert.equal(matches(["gradlew"], { platform: "windows" }), false);
  assert.equal(matches(["gradlew"], { truncated: true }), false);
  assert.equal(matches(["app/src/main/AndroidManifest.xml"]), false);
});
