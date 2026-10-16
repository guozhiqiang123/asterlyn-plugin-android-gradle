import assert from "node:assert/strict";
import test from "node:test";

import { createAndroidDeviceProvider } from "../src/index.ts";

test("device provider discovers bounded targets and remembers a selectable device", async () => {
  const state = new Map([["selectedDevice", "phone-1"]]);
  const context = {
    processQueries: {
      execute: async (queryId) => {
        assert.equal(queryId, "adb.devices");
        return {
          status: "succeeded",
          stdout: "List of devices attached\nphone-1 device model:Pixel_8 transport_id:1\nphone-2 unauthorized usb:1\n",
          stderr: "",
          truncated: false,
          error: null,
        };
      },
    },
    workspaceState: {
      read: async (key) => state.get(key) ?? null,
      write: async (key, value) => { state.set(key, value); },
    },
  };
  const runtime = createAndroidDeviceProvider(context);
  runtime.start();
  await waitFor(() => runtime.contribution.snapshot().status === "ready");
  const snapshot = runtime.contribution.snapshot();
  assert.equal(snapshot.selectedTargetId, "phone-1");
  assert.deepEqual(snapshot.targets.map(({ id, status, selectable }) => ({ id, status, selectable })), [
    { id: "phone-1", status: "online", selectable: true },
    { id: "phone-2", status: "unauthorized", selectable: false },
  ]);
  await runtime.contribution.select("phone-1");
  assert.equal(state.get("selectedDevice"), "phone-1");
  await assert.rejects(() => runtime.contribution.select("phone-2"), /not selectable/u);
  runtime.dispose();
});

test("device provider exposes host query failures without stale targets", async () => {
  const runtime = createAndroidDeviceProvider({
    processQueries: {
      execute: async () => ({
        status: "failed",
        stdout: "",
        stderr: "adb unavailable",
        truncated: false,
        error: null,
      }),
    },
  });
  runtime.start();
  await waitFor(() => runtime.contribution.snapshot().status === "error");
  assert.deepEqual(runtime.contribution.snapshot().targets, []);
  assert.match(runtime.contribution.snapshot().error, /adb unavailable/u);
  runtime.dispose();
});

test("device provider coalesces repeated refreshes into one bounded query", async () => {
  let calls = 0;
  let complete = null;
  const runtime = createAndroidDeviceProvider({
    processQueries: {
      execute: () => {
        calls += 1;
        return new Promise((resolve) => { complete = resolve; });
      },
    },
  });
  runtime.start();
  await waitFor(() => calls === 1);
  const first = runtime.contribution.refresh();
  const second = runtime.contribution.refresh();
  assert.equal(first, second);
  assert.equal(calls, 1);
  complete({
    status: "succeeded",
    stdout: "List of devices attached\n",
    stderr: "",
    truncated: false,
    error: null,
  });
  await first;
  assert.equal(runtime.contribution.snapshot().status, "ready");
  runtime.dispose();
});

async function waitFor(predicate) {
  for (let index = 0; index < 50; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for device provider state.");
}
