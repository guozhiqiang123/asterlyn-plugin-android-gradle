import assert from "node:assert/strict";
import test from "node:test";

import { buildAndroidGradleTaskCollection } from "../src/index.ts";

const task = (id, group, projectPath) => ({ id, label: id, group, projectPath, runnable: true });

test("builds deterministic root and nested-module Gradle hierarchy", () => {
  const tasks = [
    task(":app:installDebug", "Install tasks", ":app"),
    task(":help", "Help tasks", ":"),
    task(":feature:assembleRelease", "Build tasks", ":feature"),
    task(":app:assembleDebug", "Build tasks", ":app"),
  ];
  const first = buildAndroidGradleTaskCollection({ status: "ready", tasks });
  const second = buildAndroidGradleTaskCollection({ status: "loading", tasks: [...tasks].reverse() });
  assert.deepEqual(second, first);
  assert.equal(first.providerId, "gradle-tasks");
  assert.equal(first.truncated, false);
  assert.deepEqual(first.nodes.filter((node) => node.parentId === null).map(({ label, metadata }) => [label, metadata["android.gradle.nodeKind"]]), [
    ["Tasks", "tasks"], ["app", "module"], ["feature", "module"],
  ]);
  assert.deepEqual(first.nodes.filter((node) => node.kind === "task").map(({ label, taskId }) => [label, taskId]), [
    ["help", ":help"], ["assembleDebug", ":app:assembleDebug"], ["installDebug", ":app:installDebug"], ["assembleRelease", ":feature:assembleRelease"],
  ]);
});

test("uses exact task IDs and valid bounded stable node IDs", () => {
  const collection = buildAndroidGradleTaskCollection({ status: "ready", tasks: [
    task(":feature:demo:bundleQa", "Build tasks", ":feature:demo"),
    { ...task(":fallback:check", "Verification tasks"), projectPath: "../invalid" },
  ] });
  assert.equal(new Set(collection.nodes.map((node) => node.id)).size, collection.nodes.length);
  assert.equal(collection.nodes.every((node) => /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/u.test(node.id) && node.id.length <= 512), true);
  assert.deepEqual(collection.nodes.filter((node) => node.kind === "task").map((node) => node.taskId).sort(), [":fallback:check", ":feature:demo:bundleQa"]);
});

test("returns an empty valid collection when the retained snapshot has no tasks", () => {
  assert.deepEqual(buildAndroidGradleTaskCollection({ status: "error", tasks: [], error: "failed" }), {
    providerId: "gradle-tasks", nodes: [], truncated: false,
  });
});
