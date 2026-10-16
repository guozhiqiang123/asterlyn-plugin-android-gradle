import type {
  SdkRunArtifact,
  SdkRunConfigurationDescriptor,
  SdkRunConfigurationProviderSnapshot,
  SdkRunSessionResult,
  SdkStagedRunPlan,
  SdkTaskExecutionResult,
  SdkTaskRunPlan,
  SdkToolOperationResult,
} from "@asterlyn/plugin-sdk";
import { deriveGradleQuickActions } from "./quick-actions.ts";
import type { GradleTaskDiscoveryResult } from "./sdk-compat.ts";

export const ANDROID_RUN_CONFIGURATION_PROVIDER_ID = "android-run-configurations";
export const ANDROID_RUN_TARGET_PROVIDER_ID = "android-devices";

export interface AndroidRunConfiguration {
  readonly id: string;
  readonly taskId: string;
  readonly module: string;
  readonly variant: string;
  readonly descriptor: SdkRunConfigurationDescriptor;
}

export interface AndroidLaunchComponent {
  readonly applicationId: string;
  readonly activityName: string;
  readonly component: string;
}

/**
 * An install task is the authoritative Gradle surface for an Android application variant.
 * Instrumentation-test install tasks are intentionally excluded from the application Run list.
 */
export function deriveAndroidRunConfigurations(snapshot: GradleTaskDiscoveryResult): readonly AndroidRunConfiguration[] {
  return deriveGradleQuickActions(snapshot).actions
    .filter((action) => action.kind === "install" && !action.variant.endsWith("AndroidTest"))
    .map((action) => {
      const moduleLabel = action.module === ":" ? "root" : action.module.slice(1);
      const id = `android-run:${action.taskId}`;
      return Object.freeze({
        id,
        taskId: action.taskId,
        module: action.module,
        variant: action.variant,
        descriptor: Object.freeze({
          id,
          label: `${moduleLabel} · ${action.variant}`,
          detail: action.taskId,
          status: "ready" as const,
          targetProviderId: ANDROID_RUN_TARGET_PROVIDER_ID,
          metadata: Object.freeze({ module: action.module, variant: action.variant, taskId: action.taskId }),
        }),
      });
    });
}

export function androidRunConfigurationSnapshot(
  tasks: GradleTaskDiscoveryResult,
  preferredConfigurationId: string | null,
): SdkRunConfigurationProviderSnapshot {
  if (tasks.status === "loading") return { status: "loading", configurations: [], selectedConfigurationId: null };
  if (tasks.status === "error") {
    return { status: "error", configurations: [], selectedConfigurationId: null, error: tasks.error ?? "Gradle task discovery failed." };
  }
  const configurations = deriveAndroidRunConfigurations(tasks);
  const selected = configurations.some((configuration) => configuration.id === preferredConfigurationId)
    ? preferredConfigurationId
    : configurations[0]?.id ?? null;
  return { status: "ready", configurations: configurations.map((configuration) => configuration.descriptor), selectedConfigurationId: selected };
}

/** Build the value-only callbacks used by the host's supervised Run state machine. */
export function buildAndroidStagedRunPlan(
  install: SdkTaskRunPlan,
  targetId: string,
  apply: (result: SdkRunSessionResult) => void,
): SdkStagedRunPlan {
  let installedApkBasename: string | null = null;
  let installOutputUsable = false;
  const installApply = install.apply;
  const supervisedInstall: SdkTaskRunPlan = {
    ...install,
    apply: (result: SdkTaskExecutionResult) => {
      installOutputUsable = result.status === "succeeded" && !result.truncated;
      installedApkBasename = installOutputUsable ? extractInstalledApkBasename(result) : null;
      installApply(result);
    },
  };
  return Object.freeze({
    kind: "staged" as const,
    install: supervisedInstall,
    inspect: (artifacts: readonly SdkRunArtifact[]) => {
      if (!installOutputUsable) return null;
      const artifact = resolveInstalledApkArtifact(artifacts, installedApkBasename);
      return artifact ? { operationId: "android.apk.inspect", parameters: { artifact: artifact.workspacePath } } : null;
    },
    launch: (inspection: SdkToolOperationResult) => {
      if (inspection.status !== "succeeded" || inspection.truncated) return null;
      const launch = parseAndroidLaunchComponent(inspection.stdout);
      return launch ? {
        operationId: "android.adb.launch",
        parameters: { target: targetId, component: launch.component },
      } : null;
    },
    apply,
  });
}

export function extractInstalledApkBasename(result: SdkTaskExecutionResult): string | null {
  if (result.status !== "succeeded" || result.truncated) return null;
  let text = "";
  for (const output of result.outputs) {
    const chunk = decodeBase64Utf8(output.dataBase64);
    if (chunk === null) return null;
    text += chunk;
  }
  let selected: string | null = null;
  const pattern = /Installing APK\s+['"]([^'"\r\n]+\.apk)['"]/giu;
  for (const match of text.matchAll(pattern)) {
    const path = match[1];
    if (!path) continue;
    selected = path.replaceAll("\\", "/").split("/").at(-1) ?? null;
  }
  return selected;
}

export function resolveInstalledApkArtifact(
  artifacts: readonly SdkRunArtifact[],
  installedApkBasename: string | null,
): SdkRunArtifact | null {
  const apks = artifacts.filter((artifact) => artifact.kind === "apk" && artifact.workspacePath.toLowerCase().endsWith(".apk"));
  if (installedApkBasename) {
    const matches = apks.filter((artifact) => artifact.workspacePath.replaceAll("\\", "/").split("/").at(-1) === installedApkBasename);
    return matches.length === 1 ? matches[0] ?? null : null;
  }
  return apks.length === 1 ? apks[0] ?? null : null;
}

/** Parse only AAPT's stable badging records; source manifests and Gradle files are not guessed. */
export function parseAndroidLaunchComponent(output: string): AndroidLaunchComponent | null {
  const applicationId = output.match(/^package:\s+name='([^']+)'/mu)?.[1] ?? null;
  const declaredActivity = output.match(/^launchable-activity:\s+name='([^']+)'/mu)?.[1] ?? null;
  if (!applicationId || !declaredActivity || !validAndroidName(applicationId)) return null;
  const activityName = declaredActivity.startsWith(".")
    ? `${applicationId}${declaredActivity}`
    : declaredActivity.includes(".") ? declaredActivity : `${applicationId}.${declaredActivity}`;
  if (!validAndroidName(activityName)) return null;
  return Object.freeze({ applicationId, activityName, component: `${applicationId}/${activityName}` });
}

function decodeBase64Utf8(value: string): string | null {
  try {
    const binary = globalThis.atob(value);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}

function validAndroidName(value: string): boolean {
  return value.length <= 512 && value.split(".").every((part) =>
    part.length > 0 && [...part].every((character, index) =>
      /[A-Za-z_]/u.test(character) || (index > 0 && /[0-9$]/u.test(character)),
    ),
  );
}
