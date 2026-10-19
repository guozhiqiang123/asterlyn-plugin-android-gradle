import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import packageJson from "../package.json" with { type: "json" };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const host = path.resolve(process.env.ASTERLYN_HOST_CHECKOUT ?? path.join(root, "..", "asterlyn"));
const asset = path.join(root, "release", `asterlyn-plugin-android-gradle-${packageJson.version}.asterlyn-plugin.tgz`);
if (!existsSync(path.join(host, "Cargo.toml"))) throw new Error(`Asterlyn host checkout not found: ${host}`);
if (!existsSync(asset)) throw new Error(`Release package not found: ${asset}`);
const result = spawnSync("cargo", ["run", "--quiet", "--manifest-path", path.join(host, "Cargo.toml"), "-p", "asterlyn-plugin-package", "--bin", "asterlyn-plugin-inspect", "--", asset, "guozhiqiang123/asterlyn-plugin-android-gradle", packageJson.version, "0.1.12"], { cwd: root, stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
