import type { AndroidGradleEvidenceSnapshot } from "./detector.ts";
import type { TaskExecutionRequest, TaskDescriptor, TaskProviderSnapshot } from "./sdk-compat.ts";
import { decodeNativeGradleTasks, decodeUtf8Lines } from "./runtime-codecs.ts";

export const ANDROID_GRADLE_DISCOVERY_LIMITS = Object.freeze({
  maxOutputBytes: 2 * 1024 * 1024,
  maxLineLength: 16 * 1024,
  maxTasks: 32_768,
});

export const ANDROID_GRADLE_EXECUTION_FLAGS = Object.freeze([
  "--console=plain", "--no-daemon", "--no-scan",
]);
export const ANDROID_GRADLE_TASK_ARGS = Object.freeze([
  "tasks", "--all", ...ANDROID_GRADLE_EXECUTION_FLAGS,
]);

export type GradleTaskDescriptor = TaskDescriptor;

export interface GradleTaskDiscoveryResult extends TaskProviderSnapshot {
  readonly tasks: readonly GradleTaskDescriptor[];
}

export type GradleWrapperRequestResult =
  | { readonly supported: true; readonly request: TaskExecutionRequest }
  | { readonly supported: false; readonly reason: "wrapper-missing" | "platform-mismatch" | "unsupported-evidence" };

export function buildGradleWrapperRequest(
  evidence: AndroidGradleEvidenceSnapshot,
): GradleWrapperRequestResult {
  if (!evidence.gradle) return { supported: false, reason: "unsupported-evidence" };
  if (!evidence.bounded || evidence.catalogTruncated) return { supported: false, reason: "unsupported-evidence" };
  const expected = evidence.platform === "windows" ? "gradlew.bat" : "gradlew";
  if (!evidence.wrapper) return { supported: false, reason: "wrapper-missing" };
  if (evidence.wrapper !== expected) return { supported: false, reason: "platform-mismatch" };
  return {
    supported: true,
    request: {
      pluginId: "dev.asterlyn.android-gradle",
      providerId: "gradle-tasks",
      taskId: "discover",
      label: "Gradle tasks",
      executablePath: expected,
      args: [...ANDROID_GRADLE_TASK_ARGS],
    },
  };
}

export function parseGradleTasksOutput(
  output: Uint8Array | string,
): GradleTaskDiscoveryResult {
  const bytes = typeof output === "string" ? new TextEncoder().encode(output) : output;
  if (bytes.byteLength > ANDROID_GRADLE_DISCOVERY_LIMITS.maxOutputBytes) return errorSnapshot("Gradle output exceeded the discovery limit.");
  const native = normalizeNativeSnapshot(decodeNativeGradleTasks(bytes));
  if (native) return native;
  const lines = decodeUtf8Lines(bytes);
  const records = new Map<string, GradleTaskDescriptor>();
  let recognizedRecords = 0;
  let group = "Other";
  let projectPath = ":";
  let inTaskGroup = false;
  let malformed = false;
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    if (rawLine.length > ANDROID_GRADLE_DISCOVERY_LIMITS.maxLineLength) { malformed = true; break; }
    const trimmed = rawLine;
    if (!trimmed) continue;
    if (isDivider(trimmed)) continue;
    if (inTaskGroup) {
      const parsed = parseTaskLine(trimmed);
      if (parsed) {
        const { taskName, description } = parsed;
        const id = taskName.startsWith(":")
          ? taskName
          : taskName.includes(":")
            ? `:${taskName}`
            : `${projectPath === ":" ? ":" : `${projectPath}:`}${taskName}`;
        const separator = id.lastIndexOf(":");
        const taskProjectPath = separator > 0 ? id.slice(0, separator) : ":";
        recognizedRecords += 1;
        if (recognizedRecords > ANDROID_GRADLE_DISCOVERY_LIMITS.maxTasks * 4) return errorSnapshot("Gradle task list exceeded the discovery limit.");
        const existing = records.get(id);
        if (existing) {
          if (!existing.description && description) records.set(id, { ...existing, description });
        } else {
          if (records.size >= ANDROID_GRADLE_DISCOVERY_LIMITS.maxTasks) return errorSnapshot("Gradle task list exceeded the discovery limit.");
          records.set(id, { id, label: id, group, description, projectPath: taskProjectPath, runnable: false, disabledReason: "Task execution is not enabled yet." });
        }
        continue;
      }
    }
    if (isFailureLine(trimmed)) return errorSnapshot("Gradle task discovery failed.");
    if (trimmed.startsWith("Tasks runnable from root project ")) { projectPath = ":"; inTaskGroup = false; continue; }
    const projectHeader = projectPathFromHeader(trimmed);
    if (projectHeader) { projectPath = projectHeader; inTaskGroup = false; continue; }
    if (isTaskGroupHeading(trimmed) && isDivider(lines[index + 1] ?? "")) {
      inTaskGroup = isTaskGroupHeading(trimmed);
      group = trimmed;
      continue;
    }
  }
  if (malformed) return errorSnapshot("Gradle task output contained an overlong line.");
  if (records.size === 0) return errorSnapshot("Gradle output contained no recognizable tasks.");
  const taskIds = [...records.keys()].sort();
  const tasks = new Array<GradleTaskDescriptor>(taskIds.length);
  for (let index = 0; index < taskIds.length; index += 1) {
    tasks[index] = records.get(taskIds[index] as string) as GradleTaskDescriptor;
  }
  return { status: "ready", tasks };
}

function normalizeNativeSnapshot(value: unknown): GradleTaskDiscoveryResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as GradleTaskDiscoveryResult;
  if ((snapshot.status !== "ready" && snapshot.status !== "error") || !Array.isArray(snapshot.tasks)) return null;
  return snapshot;
}

function errorSnapshot(error: string): GradleTaskDiscoveryResult {
  return { status: "error", tasks: [], error };
}

function isFailureLine(value: string): boolean {
  return value.startsWith("FAILURE:") || value.startsWith("BUILD FAILED") || value.startsWith("Could not determine");
}

function projectPathFromHeader(value: string): string | null {
  const prefix = "Tasks runnable from project ";
  if (!value.startsWith(prefix)) return null;
  const quoted = value.slice(prefix.length);
  const quote = quoted[0];
  if ((quote !== "'" && quote !== '"') || quoted.length < 3) return null;
  const end = quoted.indexOf(quote, 1);
  if (end <= 1) return null;
  const project = quoted.slice(1, end);
  return project.startsWith(":") ? project : `:${project}`;
}

function isDivider(value: string): boolean {
  if (value.length < 3) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 45) return false;
  }
  return true;
}

function isTaskGroupHeading(value: string): boolean {
  if (!value.endsWith(" tasks") || !isAsciiLetter(value.charCodeAt(0))) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (!isAsciiLetter(code) && !isAsciiDigit(code) && code !== 95 && code !== 32 && code !== 45) return false;
  }
  return true;
}

function parseTaskLine(value: string): { readonly taskName: string; readonly description?: string } | null {
  let taskNameEnd = 0;
  while (taskNameEnd < value.length) {
    const code = value.charCodeAt(taskNameEnd);
    if (code === 32 || code === 9) break;
    taskNameEnd += 1;
  }
  const taskName = value.slice(0, taskNameEnd);
  if (!isTaskName(taskName)) return null;
  let cursor = taskNameEnd;
  while (cursor < value.length && (value.charCodeAt(cursor) === 32 || value.charCodeAt(cursor) === 9)) cursor += 1;
  if (cursor === value.length) return { taskName };
  if (value.charCodeAt(cursor) !== 45) return null;
  cursor += 1;
  while (cursor < value.length && (value.charCodeAt(cursor) === 32 || value.charCodeAt(cursor) === 9)) cursor += 1;
  const description = value.slice(cursor).trim();
  return description ? { taskName, description } : { taskName };
}

function isTaskName(value: string): boolean {
  if (!value) return false;
  let index = 0;
  if (value.charCodeAt(0) === 58) {
    index = 1;
    if (index === value.length) return false;
  } else if (!isAsciiLetter(value.charCodeAt(0))) return false;
  let segmentLength = 0;
  for (; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 58) {
      if (segmentLength === 0) return false;
      segmentLength = 0;
    } else if (isAsciiLetter(code) || isAsciiDigit(code) || code === 95 || code === 46 || code === 45) segmentLength += 1;
    else return false;
  }
  return segmentLength > 0;
}

function isAsciiLetter(code: number): boolean {
  return code >= 65 && code <= 90 || code >= 97 && code <= 122;
}

function isAsciiDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}
