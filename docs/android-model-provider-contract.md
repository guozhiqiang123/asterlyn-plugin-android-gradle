# Android Gradle model provider contract

The shipped provider is `server-programs/model.mjs`. It accepts one JSON request on stdin and
emits one JSON model on stdout. The request is capped at 64 KiB and has no executable or
arbitrary-argument field:

```json
{
  "protocolVersion": 1,
  "workspaceRoot": "/absolute/workspace",
  "tools": {
    "gradleJava": {"home": "/absolute/jdk-17", "java": "/absolute/jdk-17/bin/java", "javac": "/absolute/jdk-17/bin/javac", "major": 17, "digest": "sha256:..."}
  },
  "components": [{"id":"gradle-tooling-api", "root":"/verified/component/root", "digest":"sha256:..."}, {"id":"builder-model", "root":"/verified/component/root", "digest":"sha256:..."}],
  "state": {
    "runConfiguration": "android-run::app:installCleanx100Debug"
  },
  "inputDigest": "sha256:..."
}
```

`workspaceRoot`, Java home/executables, and admitted component roots are absolute paths. The
host supplies component roots only after fixed manifest identity/digest validation; callers do not
choose an arbitrary Gradle distribution or Builder JAR. The run configuration is parsed as an application module and install variant;
the provider resolves the exact AGP variant and never derives a dependency variant by copying
the application suffix. `android-run-configurations` is the only accepted contribution ID.

The success response is schema 1:

```json
{
  "schemaVersion": 1,
  "origin": "agp-v2",
  "buildRoot": "/absolute/workspace",
  "gradleVersion": "8.13",
  "agpVersion": "8.13.2",
  "selection": {"module": ":app", "variant": "cleanx100Debug"},
  "modules": [{
    "module": ":app",
    "variant": "cleanx100Debug",
    "directory": "/absolute/workspace/app",
    "sources": ["/absolute/workspace/app/src/main/java"],
    "generatedSources": [],
    "bootClasspath": ["/absolute/sdk/platforms/android-35/android.jar"],
    "compileClasspath": ["/absolute/cache/library.jar"],
    "sourceAttachments": [{"binary": "/absolute/cache/library.jar", "sources": ["/absolute/cache/library-sources.jar"]}],
    "projectDependencies": [{"module": ":common", "variant": "Cleanx100Debug"}],
    "javaSourceTarget": null
  }]
}
```

`compileClasspath` contains existing external JARs only. Project output JARs are represented by
`projectDependencies` and are never duplicated as external entries. Source and generated roots,
boot entries, binaries, and attachments must exist before they are emitted. Attachment sources may
be source JAR files or existing Android SDK source directories matching the `android-XX` platform
of an `android.jar` boot entry; the provider never downloads or embeds source contents. Unsupported composite
build dependencies and pure JVM project dependencies fail closed; the provider does not guess a
variant or run generation/build tasks.

The provider writes no model diagnostics to stdout. stderr contains only bounded stage records of
the form `{"stage":"model","count":3,"durationMs":1200}`. Java/Gradle output is suppressed.
The provider uses a private Gradle user home, may read the user's Gradle cache, has a five-minute
model deadline, and on SIGTERM cancels/terminates only the Gradle process it started.

Model sync must also pass the published AGP `PROPERTY_BUILD_MODEL_V2_ONLY`
(`android.injected.build.model.v2=true`), in addition to `PROPERTY_INVOKED_FROM_IDE`. Without it,
unrelated missing test dependencies can abort the entire main-source import and trigger irrelevant
online repository/TLS failures. The model remains offline and rejects nonzero main-artifact
unresolved counts; selecting IDE model mode does not grant incomplete main graphs authority.

The implementation uses Gradle 8.13 Tooling API (Apache-2.0), AGP builder-model 8.13.2
(Apache-2.0), Gson 2.10 (Apache-2.0), and SLF4J API 1.7.36 (MIT). Exact local artifact receipts
and SHA-256 values remain in `tools/agp-model/README.md`; no dependency is vendored by this
provider release.

## Refresh-stable model selection — 2026-10-29

A task-list refresh must not clear the selected module/variant while its retained
task entries still identify the same known run configuration. The model provider
binds to `selectedConfigurationId`, so a temporary null during loading used to
revoke the live LSP model and trigger another full import. Preserve configuration
identity and metadata from the retained runnable task projection during loading.
Keep the snapshot's loading status and mark descriptors incomplete;
Run derivation/execution continues to require a ready task projection. Failed or
unavailable discovery and a fresh empty scan still have no selected configuration.
A completed scan that removes or
changes the selected variant publishes the new authoritative selection normally.
Source/build input fingerprints and native authority continue to invalidate models
independently; this is not permission to reuse a model after a build-input change.

The 0.6.2 correction is validated with retained-selection loading and failure-revocation cases,
fresh-empty and completed-selection-change cases, package/host snapshot validation,
and real-project refresh after language readiness. No task is fabricated or launched
to keep an old selection alive. Cold language preparation and cache recovery remain
separate limits recorded by the host's real-project acceptance document.

Native acceptance of the exact 0.6.2 package completed with installed host
`8bad30c` and LSP 0.3.6 on boostCleaner. After language readiness, Refresh tasks
retains 13,676 entries during loading and returns to ready. The same session's
113.8-second observation records no new model acquisition, reindex, language
state change, helper termination or quarantine. Actual Command+left-click still
opens `AppAds.kt:26`'s caller at `CleanApplication.kt:69` and resolves its line 27
call to `AppAdsRuntime.kt:43`. Business sources remain unchanged and Git-clean.
The host's `docs/engineering/2026-10-27-boostcleaner-lsp-recovery.md` records exact
package/install identities, native event sequences, resource samples and limits;
local `refresh-stability.json` contains the bounded observation receipt. This
does not extend valid-model reuse to failed scans or changed build inputs.
