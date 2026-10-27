/** Plugin-owned AGP model contract. Paths describe model data; they grant no host file access. */
export const ANDROID_LANGUAGE_MODEL_LIMITS = Object.freeze({ modules: 256, paths: 20_000, pathLength: 4096, bytes: 8 * 1024 * 1024 });
export interface AndroidModelSelection { readonly module: string; readonly variant: string }
export interface AndroidLanguageModule extends AndroidModelSelection {
  readonly directory: string;
  readonly sources: readonly string[];
  readonly bootClasspath: readonly string[];
  readonly compileClasspath: readonly string[];
  readonly projectDependencies: readonly string[];
}
export interface AndroidLanguageModel {
  readonly schemaVersion: 1;
  readonly origin: "agp-v2";
  readonly buildRoot: string;
  readonly gradleVersion: string;
  readonly agpVersion: string;
  readonly selection: AndroidModelSelection;
  readonly modules: readonly AndroidLanguageModule[];
}
function encodedBytes(value: string): number {
  let bytes = 0;
  for (const char of JSON.stringify(value)) { const code = char.codePointAt(0)!; bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4; }
  return bytes;
}
const MODULE = /^:(?:[A-Za-z0-9_.-]+(?::[A-Za-z0-9_.-]+)*)?$/u;
const VARIANT = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,159}$/u;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid AGP model object");
  return value as Record<string, unknown>;
}
function selection(value: AndroidModelSelection): AndroidModelSelection {
  if (!MODULE.test(value.module) || !VARIANT.test(value.variant)) throw new Error("Invalid Android model selection");
  return Object.freeze({ module: value.module, variant: value.variant });
}
function absolutePath(value: unknown): string {
  if (typeof value !== "string" || value.length > ANDROID_LANGUAGE_MODEL_LIMITS.pathLength || /[\u0000-\u001f]/u.test(value) ||
      !(/^(?:\/|[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/u.test(value)) || value.split(/[\\/]/u).some((part) => part === "." || part === "..")) throw new Error("Invalid AGP model path");
  return value;
}
function version(value: string): string {
  if (!/^\d+\.\d+(?:\.\d+)?(?:[-.][A-Za-z0-9]+)*$/u.test(value) || value.length > 64) throw new Error("Invalid Android model tool version");
  return value;
}

/** Normalizes a completed AGP V2 extraction. Incomplete dependency graphs fail closed. */
export function normalizeAgpV2LanguageModel(raw: unknown, metadata: {
  readonly buildRoot: string; readonly gradleVersion: string; readonly agpVersion: string; readonly selection: AndroidModelSelection;
}): AndroidLanguageModel {
  const path = absolutePath(metadata.buildRoot);
  const root = /^(?:\/|[A-Za-z]:[\\/])$/u.test(path) ? path : path.replace(/[\\/]$/u, "");
  const requested = selection(metadata.selection);
  const record = object(raw);
  const entries = Object.entries(record);
  if (entries.length === 0 || entries.length > ANDROID_LANGUAGE_MODEL_LIMITS.modules) throw new Error("AGP model module bound exceeded");
  let paths = 0;
  let bytes = 0;
  const textBytes = (value: string) => { bytes += encodedBytes(value); if (bytes > ANDROID_LANGUAGE_MODEL_LIMITS.bytes) throw new Error("AGP model byte bound exceeded"); };
  const list = (value: unknown): readonly string[] => {
    if (!Array.isArray(value) || paths + value.length > ANDROID_LANGUAGE_MODEL_LIMITS.paths) throw new Error("AGP model path bound exceeded");
    paths += value.length;
    return Object.freeze([...new Set(value.map((item) => { const path = absolutePath(item); textBytes(path); return path; }))]);
  };
  const modules = entries.map(([id, value]): AndroidLanguageModule => {
    const item = object(value);
    if (Object.keys(item).some((key) => !["directory", "variant", "sources", "bootClasspath", "compileClasspath", "projectDependencies", "unresolvedCount"].includes(key))) throw new Error("Unknown AGP model field");
    if (typeof item.variant !== "string" || item.unresolvedCount !== 0) throw new Error("Incomplete AGP compile dependencies");
    const chosen = selection({ module: id, variant: item.variant });
    const directory = absolutePath(item.directory);
    const normalizedDirectory = directory.replaceAll("\\", "/"); const normalizedRoot = root.replaceAll("\\", "/").replace(/\/$/u, "");
    if (normalizedDirectory !== normalizedRoot && !normalizedDirectory.startsWith(`${normalizedRoot}/`)) throw new Error("AGP module is outside this build root");
    if (!Array.isArray(item.projectDependencies) || item.projectDependencies.length > ANDROID_LANGUAGE_MODEL_LIMITS.modules || item.projectDependencies.some((id) => typeof id !== "string" || !MODULE.test(id))) throw new Error("Invalid AGP project dependency");
    const bootClasspath = list(item.bootClasspath);
    if (bootClasspath.length === 0) throw new Error("Android boot classpath is missing");
    return Object.freeze({ ...chosen, directory, sources: list(item.sources), bootClasspath, compileClasspath: list(item.compileClasspath), projectDependencies: Object.freeze([...new Set(item.projectDependencies as string[])]) });
  });
  if (!modules.some((module) => module.module === requested.module && module.variant === requested.variant)) throw new Error("AGP result does not match the selected module and variant");
  const ids = new Set(modules.map((module) => module.module));
  if (modules.some((module) => module.projectDependencies.some((id) => !ids.has(id)))) throw new Error("AGP dependency module model is missing");
  return Object.freeze({ schemaVersion: 1, origin: "agp-v2", buildRoot: root, gradleVersion: version(metadata.gradleVersion), agpVersion: version(metadata.agpVersion), selection: requested, modules: Object.freeze(modules) });
}
