/**
 * A deliberately small, transport-agnostic representation of an Android
 * target.  The host owns the adb process; the plugin only parses its bounded
 * output and decides whether a target is safe to select.
 */
export type AndroidDeviceStatus = "online" | "offline" | "unauthorized" | "unknown";

export interface AndroidDeviceDescriptor {
  readonly serial: string;
  readonly label: string;
  readonly detail: string;
  readonly status: AndroidDeviceStatus;
  readonly selectable: boolean;
  readonly metadata: Readonly<Record<string, string>>;
  readonly emulator: boolean;
}

export type AndroidDeviceDiscoveryResult =
  | { readonly status: "ready"; readonly devices: readonly AndroidDeviceDescriptor[] }
  | { readonly status: "error"; readonly devices: readonly []; readonly error: string };

export const ANDROID_DEVICE_DISCOVERY_LIMITS = Object.freeze({
  maxOutputBytes: 512 * 1024,
  maxLineLength: 8 * 1024,
  maxDevices: 256,
});

const STATUS_RANK: Readonly<Record<AndroidDeviceStatus, number>> = {
  online: 0,
  unknown: 1,
  offline: 2,
  unauthorized: 3,
};

/** Parse the bounded stdout of `adb devices -l` (including daemon preamble). */
export function parseAndroidDevicesOutput(output: Uint8Array | string): AndroidDeviceDiscoveryResult {
  const bytes = typeof output === "string" ? new TextEncoder().encode(output) : output;
  if (bytes.byteLength > ANDROID_DEVICE_DISCOVERY_LIMITS.maxOutputBytes) {
    return errorResult("Android device discovery output exceeded the size limit.");
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const lines = text.split(/\r?\n/u);
  const records = new Map<string, AndroidDeviceDescriptor>();
  let headerFound = false;

  for (const rawLine of lines) {
    if (rawLine.length > ANDROID_DEVICE_DISCOVERY_LIMITS.maxLineLength) {
      return errorResult("Android device discovery output contained an overlong line.");
    }
    const line = rawLine.trim();
    if (!line) continue;
    if (!headerFound) {
      if (line === "List of devices attached") {
        headerFound = true;
        continue;
      }
      if (isDaemonPreamble(line)) continue;
      return errorResult("Android device discovery output was malformed before its header.");
    }
    const parsed = parseDeviceLine(line);
    if (!parsed) return errorResult("Android device discovery output contained a malformed device record.");
    const previous = records.get(parsed.serial);
    if (!previous) {
      if (records.size >= ANDROID_DEVICE_DISCOVERY_LIMITS.maxDevices) {
        return errorResult("Android device discovery returned too many devices.");
      }
      records.set(parsed.serial, parsed);
    } else if (STATUS_RANK[parsed.status] > STATUS_RANK[previous.status]) {
      // Duplicate records are possible while adb refreshes. Keep the least
      // safe state so an ambiguous target can never be selected accidentally.
      records.set(parsed.serial, parsed);
    }
  }

  if (!headerFound) return errorResult("Android device discovery output did not contain its header.");
  return { status: "ready", devices: [...records.values()].sort((a, b) => a.serial.localeCompare(b.serial)) };
}

function parseDeviceLine(line: string): AndroidDeviceDescriptor | null {
  const fields = line.split(/\s+/u);
  const serial = fields.shift();
  const statusToken = fields.shift();
  if (!serial || !statusToken || /\s/u.test(serial)) return null;
  const status = toStatus(statusToken);
  const metadata: Record<string, string> = {};
  for (const field of fields) {
    const separator = field.indexOf(":");
    if (separator <= 0 || separator === field.length - 1) return null;
    const key = field.slice(0, separator);
    const value = field.slice(separator + 1);
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/u.test(key) || !value || value.includes(":") && key === "transport_id") return null;
    metadata[key] = value;
  }
  const emulator = /^emulator-\d+$/u.test(serial) || metadata.type === "emulator";
  const label = metadata.model ?? metadata.device ?? serial;
  const details = Object.entries(metadata).map(([key, value]) => `${key}=${value}`).join(", ");
  return {
    serial,
    label,
    detail: details || statusToken,
    status,
    selectable: status === "online",
    metadata: Object.freeze(metadata),
    emulator,
  };
}

function toStatus(value: string): AndroidDeviceStatus {
  if (value === "device") return "online";
  if (value === "offline") return "offline";
  if (value === "unauthorized") return "unauthorized";
  return "unknown";
}

function isDaemonPreamble(line: string): boolean {
  return /^\* daemon (?:not running; starting now at tcp:\d+|started successfully|already running) \*$/u.test(line);
}

function errorResult(error: string): AndroidDeviceDiscoveryResult {
  return { status: "error", devices: [], error };
}
