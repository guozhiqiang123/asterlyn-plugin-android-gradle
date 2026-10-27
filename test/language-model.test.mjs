import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAgpV2LanguageModel, ANDROID_LANGUAGE_MODEL_LIMITS } from "../src/language-model.ts";
const metadata = { buildRoot: "/repo", gradleVersion: "8.13", agpVersion: "8.13.2", selection: {module: ":common", variant: "cleanx100Debug"} };
const module = () => ({directory: "/repo/common", variant: "cleanx100Debug", sources: ["/repo/common/src/main/java", "/repo/common/src/main/java"], bootClasspath: ["/sdk/android.jar"], compileClasspath: ["/cache/a.jar"], projectDependencies: [], unresolvedCount: 0});

test("normalizes exact AGP variant results without inventing build tasks or file authority", () => {
  const model = normalizeAgpV2LanguageModel({":common": module()}, metadata);
  assert.equal(model.origin, "agp-v2"); assert.equal(model.schemaVersion, 1);
  assert.deepEqual(model.modules[0].sources, ["/repo/common/src/main/java"]);
  assert.ok(Object.isFrozen(model)); assert.ok(Object.isFrozen(model.modules[0].compileClasspath));
  assert.throws(() => normalizeAgpV2LanguageModel({":common": module()}, {...metadata, selection: {...metadata.selection, variant: "release"}}), /selected module and variant/);
});

test("dependency modules retain their actual resolved variant and must be present", () => {
  const app = {...module(), directory: "/repo/app", variant: "cleanx100Release", projectDependencies: [":common"]};
  const selected = {...metadata, selection: {module: ":app", variant: "cleanx100Release"}};
  assert.throws(() => normalizeAgpV2LanguageModel({":app": app}, selected), /dependency module model is missing/);
  const result = normalizeAgpV2LanguageModel({":app": app, ":common": module()}, selected);
  assert.equal(result.modules[1].variant, "cleanx100Debug", "module variant is returned by AGP rather than copied from the application variant");
});

test("partial, out-of-scope and oversized models cannot pass as usable", () => {
  for (const patch of [{unresolvedCount: 1}, {bootClasspath: []}, {directory: "/repository/common"}, {sources: ["/repo/../secret"]}, {sources: ["relative"]}, {unexpected: true}]) {
    assert.throws(() => normalizeAgpV2LanguageModel({":common": {...module(), ...patch}}, metadata));
  }
  assert.throws(() => normalizeAgpV2LanguageModel({":common": {...module(), sources: Array(ANDROID_LANGUAGE_MODEL_LIMITS.paths + 1).fill("/repo/source")}}, metadata), /path bound/);
  assert.throws(() => normalizeAgpV2LanguageModel(Object.fromEntries(Array.from({length: 257}, (_,i)=>[`:module${i}`, module()])), metadata), /module bound/);
});

test("Windows paths and filesystem roots keep absolute identities", () => {
  const value = {...module(), directory: "C:\\repo\\common", sources: ["C:\\repo\\common\\src"], bootClasspath: ["C:\\sdk\\android.jar"], compileClasspath: []};
  assert.equal(normalizeAgpV2LanguageModel({":common": value}, {...metadata, buildRoot: "C:\\repo\\"}).buildRoot, "C:\\repo");
  assert.equal(normalizeAgpV2LanguageModel({":common": module()}, {...metadata, buildRoot: "/"}).buildRoot, "/");
});
