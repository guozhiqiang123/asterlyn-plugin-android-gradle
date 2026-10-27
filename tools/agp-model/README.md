# AGP V2 model probe (C3a)

The production fixed-entry provider is `server-programs/model.mjs`; it uses the adjacent
`AgpModelProgram.java` action and the same Tooling API/model contracts. This README retains the
development probe instructions and receipts; the shipped provider accepts the bounded JSON
contract documented in `docs/android-model-provider-contract.md` and emits schema-1 model JSON.

This is a development probe, not a shipped plugin capability. It validates the plugin-owned
model path independently of JDT's bundled Android import script. It never calls `forTasks` or
changes a project's wrapper, AGP or Kotlin version. It requests one exact module/variant and
uses offline dependency resolution. Build scripts still execute with the current user's permissions.

Use a disposable detached worktree. Copy only SDK/flavor selection into its local properties.
Supply any required Maven credentials through the process environment, never a committed file
or command-line argument. Use a dedicated Gradle user home for probes; do not stop user daemons.

```sh
node scripts/probe-agp-model.mjs \
  --root /path/to/test-worktree \
  --gradle /path/to/standalone/gradle-8.13 \
  --java /path/to/jdk17 \
  --gradle-home /path/to/probe-gradle-home \
  --builder-model /path/to/published/builder-model-8.12.2.jar \
  --module :common --variant cleanx100Debug \
  --output /path/to/private-evidence/model.json
```

The selected Gradle installation supplies its own Tooling API/Gson/SLF4J libraries. The model API
comes from the published Google Maven `com.android.tools.build:builder-model:8.12.2` artifact.
No source, libraries or assets are copied from an IDE. The runner compiles our Java source in a
temporary directory, drains bounded diagnostics, limits execution to 180 seconds plus cancellation
grace, normalizes the result, and verifies compile artifacts exist. Evidence files have mode 0600.
It emits phase/count/time metadata; the private diagnostic file may contain project configuration logs.

The model schema and its normalization live in `src/language-model.ts`. Model paths are data, not
file permissions. Unknown fields, invalid paths, unresolved artifacts, mismatched selection and
missing dependency-module models are rejected. The first probe is intentionally limited to one
module without project dependencies. A full extractor must resolve dependency variants through AGP,
include generated-source metadata, handle composite builds, and prove cancellation/process cleanup.

The provider uses Gradle Tooling API 8.13 (Apache-2.0), AGP builder-model 8.12.2 (Apache-2.0), Gson 2.10
(Apache-2.0), and SLF4J API 1.7.36 (MIT), from their published distributions. They are not vendored
or included in the plugin archive. Product adoption requires a separate pinned-resource/license
receipt and host auxiliary-job acceptance. Official references:
[Gradle Tooling API](https://docs.gradle.org/8.13/userguide/tooling_api.html),
[Gradle license](https://github.com/gradle/gradle/blob/v8.13.0/LICENSE),
[AGP source license](https://android.googlesource.com/platform/tools/base/+/refs/heads/mirror-goog-studio-main/LICENSE),
[Gson license](https://github.com/google/gson/blob/gson-parent-2.10/LICENSE),
[SLF4J license](https://www.slf4j.org/license.html).

2026-10-27 real evidence: boostCleaner detached HEAD `baa4e696e`, `:common/cleanx100Debug`,
Gradle 8.13/AGP 8.12.2/JBR 17.0.14: 8 source roots, 1 boot classpath, 56 existing compile
artifacts, no unresolved dependencies; normalized model 9,952 bytes, 5,073 ms.
This proves extraction, not a working Android language server or the host model channel.

Observed local artifact receipts (not product-vendored files):

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| gradle-tooling-api-8.13.jar (distribution internal jar) | 506267 | 965e4aa42c86200bdf525b28fadec0555ae8ec4e3690990f44fb6c84ba1914f7 |
| gson-2.10.jar | 286235 | 0cdd163ce3598a20fc04eee71b140b24f6f2a3b35f0a499dbbdd9852e83fbfaf |
| slf4j-api-1.7.36.jar | 41125 | d3ef575e3e4979678dc01bf1dcce51021493b4d11fb7f1be8ad982877c16a1c0 |
| builder-model-8.12.2.jar | 138198 | 832b19df614bda18059f7c7bdfaa0756059dd2866df2b30db2b00b9c30df6f3 |

The Tooling API jar inside the Gradle distribution is not the self-contained published Maven jar;
the fixed provider ships the required Gradle 8.13 runtime dependency jars under
`server-programs/components/` (Apache-2.0, with Guava 32.1.2-jre and SLF4J API 1.7.36 as
declared dependencies). Their release manifest records each SHA-256. The provider uses the
project wrapper through `GradleConnector` and does not accept a caller-supplied Gradle install.
