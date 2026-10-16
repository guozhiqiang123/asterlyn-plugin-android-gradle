import type {
  SdkDisposable,
  SdkExecutionTargetDescriptor,
  SdkExecutionTargetProviderContribution,
  SdkExecutionTargetProviderSnapshot,
  SdkPluginActivationContext,
} from "@asterlyn/plugin-sdk";
import { parseAndroidDevicesOutput } from "./devices.ts";

const SELECTED_TARGET_KEY = "selectedDevice";

export interface AndroidDeviceProviderRuntime extends SdkDisposable {
  readonly contribution: SdkExecutionTargetProviderContribution;
  start(): void;
}

export function createAndroidDeviceProvider(context: SdkPluginActivationContext): AndroidDeviceProviderRuntime {
  const listeners = new Set<() => void>();
  let disposed = false;
  let revision = 0;
  let refreshInFlight: Promise<void> | null = null;
  let selectedTargetId: string | null = null;
  let snapshot: SdkExecutionTargetProviderSnapshot = context.processQueries
    ? { status: "loading", targets: [], selectedTargetId: null }
    : { status: "unavailable", targets: [], selectedTargetId: null, error: "ADB discovery is unavailable in this host." };

  const publish = () => {
    if (disposed) return;
    for (const listener of listeners) listener();
  };
  const refreshOnce = async () => {
    if (disposed || !context.processQueries) return;
    const current = ++revision;
    snapshot = { ...snapshot, status: "loading", error: undefined };
    publish();
    try {
      const result = await context.processQueries.execute("adb.devices");
      if (disposed || current !== revision) return;
      if (result.status !== "succeeded") {
        snapshot = {
          status: result.status === "cancelled" ? "unavailable" : "error",
          targets: [],
          selectedTargetId: null,
          error: result.error ?? (result.stderr.trim() || `ADB device discovery ${result.status}.`),
        };
        publish();
        return;
      }
      if (result.truncated) {
        snapshot = { status: "error", targets: [], selectedTargetId: null, error: "ADB device discovery output was truncated." };
        publish();
        return;
      }
      const parsed = parseAndroidDevicesOutput(result.stdout);
      if (parsed.status === "error") {
        snapshot = { status: "error", targets: [], selectedTargetId: null, error: parsed.error };
        publish();
        return;
      }
      const targets: readonly SdkExecutionTargetDescriptor[] = parsed.devices.map((device) => Object.freeze({
        id: device.serial,
        label: device.label,
        detail: device.detail,
        status: device.status,
        selectable: device.selectable,
        metadata: Object.freeze({ ...device.metadata, serial: device.serial, emulator: String(device.emulator) }),
      }));
      if (!targets.some((target) => target.id === selectedTargetId && target.selectable)) selectedTargetId = null;
      snapshot = { status: "ready", targets: Object.freeze(targets), selectedTargetId };
      publish();
    } catch (error) {
      if (disposed || current !== revision) return;
      snapshot = {
        status: "error",
        targets: [],
        selectedTargetId: null,
        error: error instanceof Error ? error.message : String(error),
      };
      publish();
    }
  };
  const refresh = (): Promise<void> => {
    if (refreshInFlight) return refreshInFlight;
    const tracked = refreshOnce().finally(() => {
      if (refreshInFlight === tracked) refreshInFlight = null;
    });
    refreshInFlight = tracked;
    return tracked;
  };

  const contribution: SdkExecutionTargetProviderContribution = Object.freeze({
    kind: "execution-target-provider",
    id: "android-devices",
    snapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return { dispose: () => { listeners.delete(listener); } };
    },
    refresh,
    select: async (targetId: string | null) => {
      if (targetId !== null && !snapshot.targets.some((target) => target.id === targetId && target.selectable)) {
        throw new Error(`Android device is not selectable: ${targetId}`);
      }
      selectedTargetId = targetId;
      snapshot = { ...snapshot, selectedTargetId };
      publish();
      await context.workspaceState?.write(SELECTED_TARGET_KEY, targetId ?? "");
    },
  });

  return {
    contribution,
    start: () => {
      void (async () => {
        try {
          const restored = await context.workspaceState?.read(SELECTED_TARGET_KEY);
          if (!disposed && restored) selectedTargetId = restored;
        } finally {
          if (!disposed) await refresh();
        }
      })();
    },
    dispose: () => {
      disposed = true;
      revision += 1;
      listeners.clear();
    },
  };
}
