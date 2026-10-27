import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { c as createTar } from "tar";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const sourceManifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
if (sourceManifest.schemaVersion !== 3 || sourceManifest.version !== packageJson.version) {
  throw new Error("package.json and schema-3 manifest identity must match");
}
if (Object.keys(sourceManifest.distribution?.integrity ?? {}).length !== 0) {
  throw new Error("source manifest integrity must remain empty; release packaging owns generated hashes");
}

const releaseRoot = path.join(root, "release");
const staging = path.join(releaseRoot, ".staging");
const runtimeDirectory = path.join(staging, "runtime");
const programDirectory = path.join(staging, "server-programs");
const componentDirectory = path.join(programDirectory, "components");
const modelSourceDirectory = path.join(staging, "tools", "agp-model");
await rm(releaseRoot, { recursive: true, force: true });
await mkdir(runtimeDirectory, { recursive: true });
await mkdir(programDirectory, { recursive: true });
await mkdir(componentDirectory, { recursive: true });
await mkdir(modelSourceDirectory, { recursive: true });

await build({
  entryPoints: [path.join(root, "src/index.ts")],
  outfile: path.join(runtimeDirectory, "plugin.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  legalComments: "none",
  sourcemap: false,
});
await build({
  entryPoints: [path.join(root, "server-programs/model.mjs")],
  outfile: path.join(programDirectory, "model.mjs"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  sourcemap: false,
});
await writeFile(path.join(modelSourceDirectory, "AgpModelProgram.java"), await readFile(path.join(root, "tools/agp-model/AgpModelProgram.java")));
for (const name of await readdir(path.join(root, "server-programs/components"))) if (name.endsWith(".jar")) await writeFile(path.join(componentDirectory, name), await readFile(path.join(root, "server-programs/components", name)));
await writeFile(path.join(staging, "LICENSE"), await readFile(path.join(root, "LICENSE")));

const thirdPartyDirectory=path.join(staging,"third-party");await mkdir(thirdPartyDirectory,{recursive:true});
for(const name of await readdir(path.join(root,"third-party")))await writeFile(path.join(thirdPartyDirectory,name),await readFile(path.join(root,"third-party",name)));

const integrity = {};
for (const relative of [...(await readdir(thirdPartyDirectory)).map(name=>`third-party/${name}`),"LICENSE", "runtime/plugin.js", "server-programs/model.mjs", "tools/agp-model/AgpModelProgram.java", ...(await readdir(componentDirectory)).map((name) => `server-programs/components/${name}`)]) {
  integrity[relative] = `sha256:${createHash("sha256").update(await readFile(path.join(staging, relative))).digest("hex")}`;
}
const releaseManifest = structuredClone(sourceManifest);
releaseManifest.distribution.integrity = integrity;
await writeFile(path.join(staging, "manifest.json"), `${JSON.stringify(releaseManifest, null, 2)}\n`);

const assetName = `asterlyn-plugin-android-gradle-${packageJson.version}.asterlyn-plugin.tgz`;
const assetPath = path.join(releaseRoot, assetName);
await createTar({ cwd: staging, file: assetPath, gzip: true, portable: true, noMtime: true }, ["third-party", "manifest.json", "LICENSE", "runtime/plugin.js", "server-programs/model.mjs", "server-programs/components", "tools/agp-model/AgpModelProgram.java"]);
const asset = await readFile(assetPath);
const summary = { asset: assetName, version: packageJson.version, bytes: asset.byteLength, sha256: createHash("sha256").update(asset).digest("hex"), files: integrity };
await writeFile(path.join(releaseRoot, "release-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
await rm(staging, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
