import type {
  SdkRunDeploymentRecoveryPlan,
  SdkToolOperationResult,
} from "@asterlyn/plugin-sdk";

export function buildUpdateIncompatibleRecovery(
  deployment: SdkToolOperationResult,
  targetId: string,
  applicationId: string,
): SdkRunDeploymentRecoveryPlan | null {
  if (!isUpdateIncompatibleDeployment(deployment)) return null;
  return {
    confirmation: {
      titleKey: "run.recovery.uninstall.title",
      messageKey: "run.recovery.uninstall.message",
      confirmLabelKey: "run.recovery.uninstall.confirm",
      cancelLabelKey: "run.recovery.uninstall.cancel",
      destructive: true,
    },
    operation: {
      operationId: "android.adb.uninstall",
      parameters: { target: targetId, application: applicationId },
    },
  };
}

export function isUpdateIncompatibleDeployment(result: SdkToolOperationResult): boolean {
  if (result.status === "succeeded" || result.truncated) return false;
  return /(?:^|[^A-Za-z0-9_])INSTALL_FAILED_UPDATE_INCOMPATIBLE(?:$|[^A-Za-z0-9_])/u.test(`${result.stdout}\n${result.stderr}`);
}
