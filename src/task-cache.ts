import type { TaskDescriptor } from "./sdk-compat.ts";
import { withGradleQuickActions } from "./quick-actions.ts";
import { decodeBase64Bytes, encodeBase64Bytes } from "./runtime-codecs.ts";

export const ANDROID_GRADLE_CACHE_SCHEMA_VERSION = 2;
export const ANDROID_GRADLE_PARSER_VERSION = 1;
export const ANDROID_GRADLE_DISCOVERY_PROTOCOL_VERSION = 1;
export const ANDROID_GRADLE_CACHE_LIMITS = Object.freeze({ maxTasks: 32_768, maxPayloadBytes: 16 * 1024 * 1024 });

export interface AndroidGradleCachePayload {
  readonly schemaVersion: 2;
  readonly pluginId: string;
  readonly pluginVersion: string;
  readonly providerId: string;
  readonly parserVersion: 1;
  readonly discoveryProtocolVersion: 1;
  readonly groups: readonly string[];
  readonly tasks: readonly (readonly [id: string, group: number] | readonly [id: string, group: number, description: string])[];
}

export function encodeAndroidGradleCachePayload(
  tasks: readonly TaskDescriptor[],
  pluginId: string,
  pluginVersion: string,
  providerId: string,
): string {
  if (tasks.length > ANDROID_GRADLE_CACHE_LIMITS.maxTasks) throw new Error("Android Gradle cache task count exceeds the limit.");
  const groups: string[] = [];
  const groupIndexes = new Map<string, number>();
  const compactTasks: AndroidGradleCachePayload["tasks"][number][] = [];
  for (const task of tasks) {
    let group = groupIndexes.get(task.group);
    if (group === undefined) {
      group = groups.length;
      groups.push(task.group);
      groupIndexes.set(task.group, group);
    }
    compactTasks.push(task.description === undefined
      ? [task.id, group]
      : [task.id, group, task.description]);
  }
  const payload: AndroidGradleCachePayload = {
    schemaVersion: ANDROID_GRADLE_CACHE_SCHEMA_VERSION, pluginId, pluginVersion, providerId, parserVersion: 1,
    discoveryProtocolVersion: 1,
    groups,
    tasks: compactTasks,
  };
  const text = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > ANDROID_GRADLE_CACHE_LIMITS.maxPayloadBytes) throw new Error("Android Gradle cache payload exceeds the limit.");
  return encodeBase64Bytes(bytes);
}

export function decodeAndroidGradleCachePayload(
  payloadBase64: unknown,
  pluginId: string,
  pluginVersion: string,
  providerId: string,
): readonly TaskDescriptor[] | null {
  if (typeof payloadBase64 !== "string" || payloadBase64.length === 0 || payloadBase64.length > Math.ceil(ANDROID_GRADLE_CACHE_LIMITS.maxPayloadBytes / 3) * 4) return null;
  try {
    const bytes = decodeBase64Bytes(payloadBase64);
    if (bytes.length > ANDROID_GRADLE_CACHE_LIMITS.maxPayloadBytes) return null;
    const source: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!source || typeof source !== "object" || Array.isArray(source)) return null;
    const record = source as Record<string, unknown>;
    if (record.schemaVersion !== ANDROID_GRADLE_CACHE_SCHEMA_VERSION || record.pluginId !== pluginId || record.pluginVersion !== pluginVersion ||
      record.providerId !== providerId || record.parserVersion !== 1 || record.discoveryProtocolVersion !== 1 ||
      !Array.isArray(record.groups) || record.groups.length > ANDROID_GRADLE_CACHE_LIMITS.maxTasks ||
      !Array.isArray(record.tasks) || record.tasks.length > ANDROID_GRADLE_CACHE_LIMITS.maxTasks) return null;
    const groups: string[] = [];
    const seenGroups = new Set<string>();
    for (const value of record.groups) {
      if (typeof value !== "string" || value.length === 0 || value.length > 256 || value.includes("\0") || seenGroups.has(value)) return null;
      seenGroups.add(value);
      groups.push(value);
    }
    const tasks: TaskDescriptor[] = [];
    const taskIds = new Set<string>();
    for (const value of record.tasks) {
      if (!Array.isArray(value) || (value.length !== 2 && value.length !== 3)) return null;
      const [id, groupIndex, description] = value;
      if (typeof id !== "string" || !id || id.length > 4096 || id.includes("\0") ||
        !/^:[A-Za-z0-9_.-]+(?::[A-Za-z0-9_.-]+)*$/u.test(id) ||
        !Number.isSafeInteger(groupIndex) || groupIndex < 0 || groupIndex >= groups.length ||
        (description !== undefined && (typeof description !== "string" || description.length > 256 || description.includes("\0"))) ||
        taskIds.has(id)) return null;
      taskIds.add(id);
      tasks.push({ id, label: id, group: groups[groupIndex] as string, projectPath: projectPathForTask(id),
        ...(description === undefined ? {} : { description }), runnable: false });
    }
    return withGradleQuickActions(tasks);
  } catch {
    return null;
  }
}

export function fingerprintPaths(files: readonly { readonly workspacePath: string }[], platform: "posix" | "windows"): readonly string[] {
  const paths = files.map((file) => normalizePath(file.workspacePath, platform)).filter((path): path is string => path !== null);
  return [...new Set(paths.filter(isFingerprintCandidate))].sort();
}

export function normalizePath(value: string, platform: "posix" | "windows"): string | null {
  if (!value || value.length > 4096 || value.includes("\0")) return null;
  const path = platform === "windows" ? value.replaceAll("\\", "/").toLowerCase() : value;
  if (path.startsWith("/") || /^[a-z]:\//u.test(path) || path.startsWith("//")) return null;
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return null;
  return parts.join("/");
}

function isFingerprintCandidate(path: string): boolean {
  if (isGeneratedProjectPath(path)) return false;
  const base = path.slice(path.lastIndexOf("/") + 1);
  if (["build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts", "gradle.properties", "gradlew", "gradlew.bat", "AndroidManifest.xml", "androidmanifest.xml", "gradle-wrapper.properties", "libs.versions.toml"].includes(base)) return true;
  if (path.startsWith("gradle/") && base.endsWith(".toml")) return true;
  return path.startsWith("gradle/wrapper/") && base === "gradle-wrapper.properties" ||
    (path.startsWith("buildSrc/") || path.startsWith("buildsrc/") || path.startsWith("build-logic/")) &&
      (/\.(gradle|gradle\.kts|toml|properties|kt|kts|java)$/u.test(base) || /version/i.test(base));
}

function isGeneratedProjectPath(path: string): boolean {
  return path.split("/").some((segment) => segment === "build" || segment === ".gradle" || segment === "out");
}

export function intersectsFingerprintPaths(candidates: readonly string[], changed: readonly string[], platform: "posix" | "windows"): boolean {
  const set = new Set(candidates);
  return changed.some((path) => { const normalized = normalizePath(path, platform); return normalized !== null && (set.has(normalized) || isFingerprintCandidate(normalized)); });
}

function projectPathForTask(taskId: string): string {
  const segments = taskId.slice(1).split(":");
  return segments.length <= 1 ? ":" : `:${segments.slice(0, -1).join(":")}`;
}
