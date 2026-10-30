import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
const run = (input) => new Promise((resolve) => {
  const child = spawn(process.execPath, ["server-programs/model.mjs"], { cwd: new URL("..", import.meta.url), stdio: ["pipe", "pipe", "pipe"] }); let stdout = ""; let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; }); child.once("close", (code) => resolve({ code, stdout, stderr })); child.stdin.end(input);
});

test("manifest admits the fixed Android Gradle model provider", () => {
  const provider = manifest.modelProviders.find((value) => value.id === "android-gradle-model");
  assert.equal(provider.schema, 1);
  assert.equal(provider.program.entry, "server-programs/model.mjs");
  assert.deepEqual(provider.stateBindings, [{ key: "runConfiguration", contributionId: "android-run-configurations", pointer: "/selectedConfigurationId" }]);
  assert.ok(provider.inputGlobs.includes("**/*.gradle"));
  assert.equal(provider.program.tools[0].minimumMajor, 17);
  assert.equal(provider.program.tools[0].maximumMajorExclusive, 25);
});

test("provider rejects malformed input without writing model data", async () => {
  const result = await run("{\"schemaVersion\":1}");
  assert.equal(result.code, 1); assert.equal(result.stdout, ""); const event=JSON.parse(result.stderr);assert.deepEqual(Object.keys(event).sort(),["count","durationMs","errorCode","stage"]);assert.equal(event.stage,"error");assert.equal(event.errorCode,"request-schema");assert.equal(event.count,0);assert.ok(Number.isSafeInteger(event.durationMs));
});
