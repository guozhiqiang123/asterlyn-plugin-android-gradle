import type { TaskDescriptor, TaskProviderSnapshot, AndroidGradleQuickActionKind } from "./sdk-compat.ts";
import { readQuickAction, withQuickAction } from "./sdk-compat.ts";



/** The small set of Gradle actions that can safely be inferred from task names. */
export const ANDROID_GRADLE_QUICK_ACTION_LIMITS = Object.freeze({
  maxActions: 512,
  maxActionsPerKind: 128,
  maxCandidatesPerSelection: 32,
});

export interface AndroidGradleQuickAction {
  readonly id: string;
  readonly taskId: string;
  readonly module: string;
  readonly variant: string;
  readonly kind: AndroidGradleQuickActionKind;
  readonly label: string;
}

export interface AndroidGradleQuickActionSelection {
  readonly id: string;
  readonly kind: AndroidGradleQuickActionKind;
  readonly variant: string;
  readonly candidates: readonly AndroidGradleQuickAction[];
}

export interface AndroidGradleQuickActions {
  readonly status: "ready";
  readonly actions: readonly AndroidGradleQuickAction[];
  /** Same-name actions are exposed as candidates; no candidate is selected implicitly. */
  readonly selections: readonly AndroidGradleQuickActionSelection[];
}

export type AndroidGradleQuickActionResolution =
  | { readonly status: "resolved"; readonly action: AndroidGradleQuickAction }
  | { readonly status: "ambiguous"; readonly candidates: readonly AndroidGradleQuickAction[] }
  | { readonly status: "not-found" };

const QUICK_ACTION_KINDS: readonly AndroidGradleQuickActionKind[] = ["assemble", "bundle", "install", "uninstall"];
const QUICK_ACTION_VARIANT_PATTERN = /^[A-Z][A-Za-z0-9_.-]*$/u;

/**
 * Derive only from the current ready projection. This function never invents a task or
 * makes a module/variant choice on the caller's behalf.
 */
export function deriveGradleQuickActions(snapshot: TaskProviderSnapshot): AndroidGradleQuickActions {
  if (snapshot.status !== "ready") return { status: "ready", actions: [], selections: [] };

  const actions = new Map<string, AndroidGradleQuickAction>();
  const kindCounts = new Map<AndroidGradleQuickActionKind, number>();
  for (const task of snapshot.tasks) {
    if (!task.runnable || !task.id || task.id.includes("\0")) continue;
    const parsed = readQuickAction(task) ?? parseTaskId(task.id);
    if (!parsed || !QUICK_ACTION_KINDS.includes(parsed.kind)) continue;
    const id = `${parsed.kind}:${task.id}`;
    if (actions.has(id) || actions.size >= ANDROID_GRADLE_QUICK_ACTION_LIMITS.maxActions ||
      (kindCounts.get(parsed.kind) ?? 0) >= ANDROID_GRADLE_QUICK_ACTION_LIMITS.maxActionsPerKind) continue;
    actions.set(id, { id, taskId: task.id, module: parsed.module, variant: parsed.variant, kind: parsed.kind, label: `${parsed.kind} ${parsed.variant}` });
    kindCounts.set(parsed.kind, (kindCounts.get(parsed.kind) ?? 0) + 1);
  }

  const groupCounts = new Map<string, number>();
  const sorted = [...actions.values()].sort(compareActions).filter((action) => {
    const key = `${action.kind}:${action.variant}`;
    const count = groupCounts.get(key) ?? 0;
    if (count >= ANDROID_GRADLE_QUICK_ACTION_LIMITS.maxCandidatesPerSelection) return false;
    groupCounts.set(key, count + 1);
    return true;
  });
  const grouped = new Map<string, AndroidGradleQuickAction[]>();
  for (const action of sorted) {
    const key = `${action.kind}:${action.variant}`;
    const group = grouped.get(key) ?? [];
    group.push(action);
    grouped.set(key, group);
  }
  const selections = [...grouped.entries()]
    .filter(([, candidates]) => candidates.length > 1)
    .map(([id, candidates]) => {
      const [kind, ...variantParts] = id.split(":");
      return { id, kind: kind as AndroidGradleQuickActionKind, variant: variantParts.join(":"), candidates };
    })
    .sort((a, b) => compareText(a.id, b.id));
  return { status: "ready", actions: sorted, selections };
}

/** Resolve only an exact module request, or return all candidates when it is ambiguous. */
export function resolveGradleQuickAction(
  quickActions: AndroidGradleQuickActions | readonly AndroidGradleQuickAction[],
  kind: AndroidGradleQuickActionKind,
  variant: string,
  module?: string,
): AndroidGradleQuickActionResolution {
  const actions: readonly AndroidGradleQuickAction[] = "actions" in quickActions ? quickActions.actions : quickActions;
  const candidates = actions.filter((action) => action.kind === kind && action.variant === variant && (module === undefined || action.module === module));
  if (candidates.length === 1) return { status: "resolved", action: candidates[0] as AndroidGradleQuickAction };
  if (candidates.length > 1) return { status: "ambiguous", candidates };
  return { status: "not-found" };
}

/** Return the only host-approved output directory implied by an exact build task identity. */
export function gradleTaskArtifactHints(taskId: string): readonly string[] {
  const parsed = parseTaskId(taskId);
  if (!parsed || (parsed.kind !== "assemble" && parsed.kind !== "bundle" && parsed.kind !== "install")) return [];
  const modulePath = parsed.module === ":" ? "" : `${parsed.module.slice(1).replaceAll(":", "/")}/`;
  return [`${modulePath}build/outputs/${parsed.kind === "bundle" ? "bundle" : "apk"}`];
}

export function gradleQuickActionForTaskId(taskId: string): Readonly<{
  kind: AndroidGradleQuickActionKind;
  module: string;
  variant: string;
}> | null {
  return parseTaskId(taskId);
}

/** Rebuild the bounded, deterministic quick-action projection from task identities. */
export function withGradleQuickActions(tasks: readonly TaskDescriptor[]): readonly TaskDescriptor[] {
  const projected = [...tasks];
  const kindCounts = new Map<string, number>();
  let actions = 0;
  for (let index = 0; index < projected.length; index += 1) {
    if (actions >= ANDROID_GRADLE_QUICK_ACTION_LIMITS.maxActions) break;
    const task = projected[index];
    if (!task) continue;
    const quick = gradleQuickActionForTaskId(task.id);
    if (!quick) continue;
    const count = kindCounts.get(quick.kind) ?? 0;
    if (count >= ANDROID_GRADLE_QUICK_ACTION_LIMITS.maxActionsPerKind) continue;
    projected[index] = withQuickAction(task, quick);
    kindCounts.set(quick.kind, count + 1);
    actions += 1;
  }
  return projected;
}

function parseTaskId(taskId: string): { readonly module: string; readonly kind: AndroidGradleQuickActionKind; readonly variant: string } | null {
  if (!taskId.startsWith(":")) return null;
  const lastColon = taskId.lastIndexOf(":");
  const module = lastColon <= 0 ? ":" : taskId.slice(0, lastColon);
  const taskName = taskId.slice(lastColon + 1);
  let kind: AndroidGradleQuickActionKind;
  let prefixLength: number;
  switch (taskName[0]) {
    case "a": if (!taskName.startsWith("assemble")) return null; kind = "assemble"; prefixLength = 8; break;
    case "b": if (!taskName.startsWith("bundle")) return null; kind = "bundle"; prefixLength = 6; break;
    case "i": if (!taskName.startsWith("install")) return null; kind = "install"; prefixLength = 7; break;
    case "u": if (!taskName.startsWith("uninstall")) return null; kind = "uninstall"; prefixLength = 9; break;
    default: return null;
  }
  const variant = taskName.slice(prefixLength);
  if (!QUICK_ACTION_VARIANT_PATTERN.test(variant) ||
    module !== ":" && !/^:(?:[A-Za-z0-9_.-]+(?::[A-Za-z0-9_.-]+)*)$/u.test(module)) return null;
  return { module, kind, variant };
}

function compareActions(left: AndroidGradleQuickAction, right: AndroidGradleQuickAction): number {
  return compareText(left.taskId, right.taskId) || compareText(left.kind, right.kind) || compareText(left.id, right.id);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
export type { AndroidGradleQuickActionKind } from "./sdk-compat.ts";
