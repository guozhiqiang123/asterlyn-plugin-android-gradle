import type {
  SdkRunArtifact,
  SdkRunArtifactSidecar,
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
  /** Exact assemble task executed by Run. */
  readonly taskId: string;
  /** Install-task evidence proving this is an application variant. */
  readonly installTaskId: string;
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
 * Install tasks identify application variants, while a matching assemble task is required for
 * host-controlled exact-device deployment. Instrumentation-test install tasks are excluded.
 */
export function deriveAndroidRunConfigurations(snapshot: GradleTaskDiscoveryResult): readonly AndroidRunConfiguration[] {
  const actions = deriveGradleQuickActions(snapshot).actions;
  const builds = new Map(actions.filter((action) => action.kind === "assemble").map((action) => [`${action.module}\0${action.variant}`, action]));
  return actions
    .filter((action) => action.kind === "install" && !action.variant.endsWith("AndroidTest"))
    .flatMap((install) => {
      const build = builds.get(`${install.module}\0${install.variant}`);
      if (!build) return [];
      const moduleLabel = install.module === ":" ? "root" : install.module.slice(1);
      const id = `android-run:${install.taskId}`;
      return Object.freeze({
        id,
        taskId: build.taskId,
        installTaskId: install.taskId,
        module: install.module,
        variant: install.variant,
        descriptor: Object.freeze({
          id,
          label: `${moduleLabel} · ${install.variant}`,
          detail: build.taskId,
          status: "ready" as const,
          targetProviderId: ANDROID_RUN_TARGET_PROVIDER_ID,
          metadata: Object.freeze({ module: install.module, variant: install.variant, taskId: build.taskId, installTaskId: install.taskId }),
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
  build: SdkTaskRunPlan,
  targetId: string,
  variant: string,
  apply: (result: SdkRunSessionResult) => void,
): SdkStagedRunPlan {
  let selectedArtifact: SdkRunArtifact | null = null;
  let buildOutputUsable = false;
  const buildApply = build.apply;
  const supervisedBuild: SdkTaskRunPlan = {
    ...build,
    artifactSearch: {
      hints: build.artifactSearch?.hints ?? [],
      sidecarNames: ["output-metadata.json"],
    },
    apply: (result: SdkTaskExecutionResult) => {
      buildOutputUsable = result.status === "succeeded" && !result.truncated;
      buildApply(result);
    },
  };
  return Object.freeze({
    kind: "staged" as const,
    build: supervisedBuild,
    inspect: (artifacts: readonly SdkRunArtifact[], sidecars: readonly SdkRunArtifactSidecar[], truncated: boolean) => {
      if (!buildOutputUsable || truncated) return null;
      selectedArtifact = resolveAgpSingleApkArtifact(artifacts, sidecars, variant);
      return selectedArtifact ? { operationId: "android.apk.inspect", parameters: { artifact: selectedArtifact.workspacePath } } : null;
    },
    deploy: (inspection: SdkToolOperationResult) => {
      if (!selectedArtifact || inspection.status !== "succeeded" || inspection.truncated) return null;
      return {
        operationId: "android.adb.install",
        parameters: { target: targetId, artifact: selectedArtifact.workspacePath },
      };
    },
    recoverDeployment: async (inspection: SdkToolOperationResult, deployment: SdkToolOperationResult) => {
      const launch = parseAndroidLaunchComponent(inspection.stdout);
      if (!launch) return null;
      const { buildUpdateIncompatibleRecovery } = await import("./deployment-recovery.ts");
      return buildUpdateIncompatibleRecovery(deployment, targetId, launch.applicationId);
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

export function resolveAgpSingleApkArtifact(
  artifacts: readonly SdkRunArtifact[],
  sidecars: readonly SdkRunArtifactSidecar[],
  variant: string,
): SdkRunArtifact | null {
  if (!variant || variant.length > 256 || !/^[A-Za-z0-9_.-]+$/u.test(variant)) return null;
  const agpVariantName = `${variant[0]!.toLowerCase()}${variant.slice(1)}`;
  const artifactByPath = new Map(
    artifacts.filter((artifact) => artifact.kind === "apk" && artifact.workspacePath.endsWith(".apk"))
      .map((artifact) => [artifact.workspacePath, artifact]),
  );
  const matches: SdkRunArtifact[] = [];
  for (const sidecar of sidecars) {
    if (!sidecar.workspacePath.endsWith("/output-metadata.json")) continue;
    const metadata = parseAgpOutputMetadata(decodeBase64Utf8(sidecar.dataBase64));
    if (!metadata || metadata.variantName !== agpVariantName || metadata.outputFile.includes("/") || metadata.outputFile.includes("\\")) continue;
    const directory = sidecar.workspacePath.slice(0, sidecar.workspacePath.lastIndexOf("/") + 1);
    const artifact = artifactByPath.get(`${directory}${metadata.outputFile}`);
    if (artifact) matches.push(artifact);
  }
  return matches.length === 1 ? matches[0] ?? null : null;
}

export function parseAgpOutputMetadata(text: string | null): { readonly variantName: string; readonly outputFile: string } | null {
  if (!text || text.length > 65_536) return null;
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    if (value.artifactType && (typeof value.artifactType !== "object" || (value.artifactType as Record<string, unknown>).type !== "APK")) return null;
    if (typeof value.variantName !== "string" || !Array.isArray(value.elements) || value.elements.length !== 1) return null;
    const element = value.elements[0];
    if (!element || typeof element !== "object") return null;
    const record = element as Record<string, unknown>;
    if (record.type !== "SINGLE" || typeof record.outputFile !== "string" || !record.outputFile.endsWith(".apk") || record.outputFile.length > 512) return null;
    return Object.freeze({ variantName: value.variantName, outputFile: record.outputFile });
  } catch {
    return null;
  }
}

/** Parse only AAPT's stable badging records; source manifests and Gradle files are not guessed. */
export function parseAndroidLaunchComponent(output: string): AndroidLaunchComponent | null {
  const applicationId = output.match(/^package:\s+name='([^']+)'/mu)?.[1] ?? null;
  const activities = new Set(
    [...output.matchAll(/^(?:launchable-activity|leanback-launchable-activity):\s+name='([^']+)'/gmu)]
      .map((match) => match[1])
      .filter((value): value is string => Boolean(value)),
  );
  const declaredActivity = activities.size === 1 ? [...activities][0] ?? null : null;
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
