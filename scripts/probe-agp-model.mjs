// Development-only real AGP probe; not a product process capability or package resource.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, readdir, stat, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeAgpV2LanguageModel } from "../src/language-model.ts";

const options = Object.fromEntries(Array.from({length: (process.argv.length - 2) / 2}, (_, index) => [process.argv[2 + index * 2]?.replace(/^--/u, ""), process.argv[3 + index * 2]]));
for (const key of ["root", "gradle", "java", "module", "variant", "gradle-home", "builder-model", "output"]) {
  if (!options[key]) throw new Error(`Missing --${key}`);
}
options.root = await realpath(options.root);
const scratch = await mkdtemp(path.join(tmpdir(), "asterlyn-agp-model-"));
const started = performance.now();
const source = fileURLToPath(new URL("../tools/agp-model/AgpModelProbe.java", import.meta.url));
const library = path.join(options.gradle, "lib");
const libraryNames = await readdir(library);
const gradleVersion = /gradle-tooling-api-(.+)\.jar$/u.exec(libraryNames.find((name) => /^gradle-tooling-api-.+\.jar$/u.test(name)) ?? "")?.[1];
const agpVersion = /builder-model-(.+)\.jar$/u.exec(path.basename(options["builder-model"]))?.[1];
if (!gradleVersion || !agpVersion) throw new Error("Standalone Gradle/AGP artifact versions are required");
const classpath = [scratch, path.join(library, "*"), options["builder-model"]].join(path.delimiter);
let totalLogBytes = 0;
let diagnostic = "";
async function execute(program, args, timeout) {
  const child = spawn(program, args, {stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32"});
  let timedOut = false;
  const collect = (chunk) => { totalLogBytes += chunk.length; if (diagnostic.length < 256 * 1024) diagnostic += chunk.toString("utf8").slice(0, 256 * 1024 - diagnostic.length); };
  child.stdout.on("data", collect); child.stderr.on("data", collect);
  let force;
  const timer = setTimeout(() => {
    timedOut = true; child.kill("SIGTERM");
    force = setTimeout(() => { try { if (process.platform === "win32") child.kill("SIGKILL"); else process.kill(-child.pid, "SIGKILL"); } catch {} }, 5000);
  }, timeout);
  try {
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    if (code !== 0 || timedOut) throw new Error(timedOut ? "AGP model probe timed out" : "AGP model probe failed");
  } finally { clearTimeout(timer); clearTimeout(force); }
}
try {
  await execute(path.join(options.java, "bin", process.platform === "win32" ? "javac.exe" : "javac"), ["-d", scratch, "-cp", classpath, source], 30000);
  const rawOutput = path.join(scratch, "model.json");
  await execute(path.join(options.java, "bin", process.platform === "win32" ? "java.exe" : "java"), ["-cp", classpath, "AgpModelProbe", options.root, options["gradle-home"], options.java, rawOutput, options.gradle, options.module, options.variant], 180000);
  if ((await stat(rawOutput)).size > 8 * 1024 * 1024) throw new Error("AGP model artifact exceeds its bound");
  const model = normalizeAgpV2LanguageModel(JSON.parse(await readFile(rawOutput, "utf8")), {buildRoot: options.root, gradleVersion, agpVersion, selection: {module: options.module, variant: options.variant}});
  let missing = 0;
  for (const module of model.modules) for (const file of [...module.bootClasspath, ...module.compileClasspath]) { if (!(await stat(file).catch(() => null))?.isFile()) missing += 1; }
  if (missing) throw new Error("AGP model references missing compile artifacts");
  const payload = `${JSON.stringify(model)}\n`;
  await writeFile(options.output, payload, {mode: 0o600});
  console.log(JSON.stringify({status: "succeeded", durationMs: Math.round(performance.now() - started), modelBytes: Buffer.byteLength(payload), modules: model.modules.length,
    sourceRoots: model.modules.reduce((count, module) => count + module.sources.length, 0), compileArtifacts: model.modules.reduce((count, module) => count + module.compileClasspath.length, 0),
    phases: [...new Set(diagnostic.match(/MODEL_STAGE [a-z-]+/gu) ?? [])], diagnosticBytes: totalLogBytes}));
} finally {
  await writeFile(`${options.output}.probe.log`, diagnostic, {mode: 0o600});
  await rm(scratch, {recursive: true, force: true});
}
