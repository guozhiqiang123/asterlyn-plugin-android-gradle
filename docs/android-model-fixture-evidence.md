# Android model fixture evidence

The temporary mixed-language fixture at `/tmp/asterlyn-android-lsp/android-fixture` contains an Android application and library, `demo` and `prod` flavors, Java/Kotlin interop, and Android `Context` references. It was built with AGP 8.12.2, Kotlin 2.2.0, compileSdk 36, and an isolated Gradle home.

Verified builds:

- `:app:assembleDemoDebug`
- `:app:assembleProdDebug`

The production model provider was run through `server-programs/model.mjs` with the native protocol and fixed standalone Tooling API resources. The resulting models are retained at:

- `/tmp/asterlyn-android-lsp/fixture-demo-model-boot.json`
- `/tmp/asterlyn-android-lsp/fixture-prod-model-boot.json`

After the provider process exits and removes its private Gradle home, every directory, classpath artifact, and source attachment referenced by both files was rechecked with `existsSync`; all paths remained valid and no `asterlyn-android-gradle-home-*` path was present. Each `android.jar` boot entry has a matching existing `/Users/gzq/Library/Android/sdk/sources/android-36` directory attachment; no source contents are embedded.

Each model contains `:app` and `:common`; the project dependency resolves to the matching `demoDebug` or `prodDebug` variant, and both modules report Java target `17`. The fixture also includes `JavaCaller` → `JavaTarget.stableTarget`, giving a stable Java definition/navigation target for native editor validation.

## C3 packaged provider / cleanup acceptance

The final 0.6.0 tree uses the published standalone Tooling API and only five pinned runtime JARs,
with Apache-2.0/MIT texts and complete integrity inventory. Model paths are canonicalized before
private Gradle-home cleanup, and SDK source directories are associated only with matching boot JARs.
Variant dependency matching requires exactly one full flavor/build-type match; composite/included
builds are rejected until their identity/authorization schema is implemented.

- 69 automated tests pass; typecheck, release packaging and native 0.1.22 admission pass.
- Real two-module AGP 8.12.2 / Kotlin 2.2 / SDK 36 demoDebug and prodDebug models retain valid paths
  after provider exit. Both fixture variants were actually assembled separately during acceptance.
- Real process tests with Java-standin children and grandchildren that ignore SIGTERM prove native
  group shutdown (758 ms), output overflow (6.478 s) and compiler timeout (35.623 s) stop both owned
  descendants. Native exit does not rely on a timer surviving in the Node provider. No global daemon
  stop is invoked. Windows cleanup is implemented but not runtime-accepted on this macOS host.
- Upstream license text whitespace is retained verbatim; generated integrity hashes cover it.

The regression command is `python3 scripts/test-provider-cleanup.py <verified-node> <evidence.json>`.
The acceptance logs and structured process evidence are in `/tmp/asterlyn-android-lsp`. Missing
Gradle dependencies remain an actionable offline import failure; the provider does not download
project dependencies or silently substitute artifacts with matching coordinate/version labels.
