import assert from "node:assert/strict";
import test from "node:test";

import {
  ANDROID_DEVICE_DISCOVERY_LIMITS,
  parseAndroidDevicesOutput,
} from "../src/index.ts";

test("parses daemon preamble, CRLF output, metadata, and emulator identity", () => {
  const result = parseAndroidDevicesOutput(
    "* daemon not running; starting now at tcp:5037 *\r\n* daemon started successfully *\r\nList of devices attached\r\nR28M213L7HD\tdevice product:foo model:Pixel_8 device:shiba transport_id:1\r\nemulator-5554\tdevice product:sdk_gphone_x86 model:sdk_gphone_x86 device:generic_x86 transport_id:2\r\n",
  );
  assert.equal(result.status, "ready");
  assert.deepEqual(result.devices.map(({ serial, label, status, selectable, emulator }) => ({ serial, label, status, selectable, emulator })), [
    { serial: "emulator-5554", label: "sdk_gphone_x86", status: "online", selectable: true, emulator: true },
    { serial: "R28M213L7HD", label: "Pixel_8", status: "online", selectable: true, emulator: false },
  ]);
});

test("returns an empty ready snapshot when adb reports no devices", () => {
  assert.deepEqual(parseAndroidDevicesOutput("List of devices attached\n"), { status: "ready", devices: [] });
});

test("exposes non-selectable offline, unauthorized, and unknown states", () => {
  const result = parseAndroidDevicesOutput("List of devices attached\nold offline\nphone unauthorized usb:1\nthing booting product:x\n");
  assert.equal(result.status, "ready");
  assert.deepEqual(result.devices.map(({ serial, status, selectable }) => ({ serial, status, selectable })), [
    { serial: "old", status: "offline", selectable: false },
    { serial: "phone", status: "unauthorized", selectable: false },
    { serial: "thing", status: "unknown", selectable: false },
  ]);
});

test("keeps the least safe state for duplicate serials", () => {
  const result = parseAndroidDevicesOutput("List of devices attached\nphone device\nphone unauthorized\n");
  assert.equal(result.status, "ready");
  assert.equal(result.devices.length, 1);
  assert.equal(result.devices[0].status, "unauthorized");
  assert.equal(result.devices[0].selectable, false);
});

test("fails closed for missing headers, unexpected preamble, malformed records, and bounds", () => {
  assert.equal(parseAndroidDevicesOutput("phone\tdevice\n").status, "error");
  assert.equal(parseAndroidDevicesOutput("List of devices attached\nwarning\n").status, "error");
  assert.equal(parseAndroidDevicesOutput("List of devices attached\nphone device malformed\n").status, "error");
  assert.equal(parseAndroidDevicesOutput(`List of devices attached\n${"x".repeat(ANDROID_DEVICE_DISCOVERY_LIMITS.maxLineLength + 1)}`).status, "error");
  assert.equal(parseAndroidDevicesOutput(new Uint8Array(ANDROID_DEVICE_DISCOVERY_LIMITS.maxOutputBytes + 1)).status, "error");
  const tooMany = Array.from({ length: ANDROID_DEVICE_DISCOVERY_LIMITS.maxDevices + 1 }, (_, index) => `device-${index} device`).join("\n");
  assert.equal(parseAndroidDevicesOutput(`List of devices attached\n${tooMany}`).status, "error");
});
