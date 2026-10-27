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

The implementation uses Gradle 8.13 Tooling API (Apache-2.0), AGP builder-model 8.13.2
(Apache-2.0), Gson 2.10 (Apache-2.0), and SLF4J API 1.7.36 (MIT). Exact local artifact receipts
and SHA-256 values remain in `tools/agp-model/README.md`; no dependency is vendored by this
provider release.
