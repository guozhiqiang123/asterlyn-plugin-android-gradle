import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

test("plugin source imports only its own modules and the published SDK", async () => {
  const directory = new URL("../src/", import.meta.url);
  for (const file of await readdir(directory)) {
    if (!file.endsWith(".ts")) continue;
    const source = await readFile(new URL(file, directory), "utf8");
    assert.doesNotMatch(source, /(?:application|features|models\.ts|protocol|src\/plugins)/u, file);
    for (const match of source.matchAll(/from\s+["']([^"']+)["']/gu)) {
      const specifier = match[1];
      assert.ok(
        specifier === "@asterlyn/plugin-sdk" || specifier.startsWith("./") || specifier === "../manifest.json",
        `${file}: ${specifier}`,
      );
    }
  }
});
