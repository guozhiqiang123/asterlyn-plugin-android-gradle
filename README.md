# Asterlyn Android plugin

Android development integration for Asterlyn's public plugin foundation. The repository
builds both the trusted ESM artifact pinned into the desktop host and a schema-2 GitHub Release
package admitted by Asterlyn's plugin marketplace. External activation remains gated on the host's
isolated plugin runtime.

The plugin depends only on `@asterlyn/plugin-sdk`; it does not import Asterlyn host source, DOM,
Tauri, filesystem, or process bridges. The host retains workspace authority, task review,
execution, cancellation, cache storage, Settings rendering, and Tasks UI.

`manifest.json` is the package's static source of truth. It owns plugin identity, capabilities,
declarative settings, task-authorization presentation policy, and plain-text English/Chinese locale
catalogs; the executable module reuses that manifest rather than maintaining another version or
copy table. Asterlyn owns and enforces the native authorization store; this plugin owns only the
stable authorization IDs and user-facing copy.

Workspace applicability is determined from the bounded catalog supplied by the host. The plugin
requires a platform-matching Gradle wrapper at the workspace root (`gradlew` on POSIX or
`gradlew.bat` on Windows); Android manifests enrich Android quick actions but are not required for
the complete Gradle task tree. The plugin never probes the filesystem directly.

Run `npm run verify` before producing an artifact. The checked-in SDK tarball pins the exact
contract used by clean and offline builds; update it only together with `package-lock.json` and a
recorded host compatibility change.

Run `npm run release:verify` to build and inspect the exact Release asset. The command emits one
`release/asterlyn-plugin-android-gradle-<version>.asterlyn-plugin.tgz`, computes the integrity table,
and invokes the host's canonical Rust validator from the sibling `asterlyn` checkout. Tags matching
`v<package version>` publish that same asset through GitHub Actions.

The staged expansion from Gradle Tasks to the host-rendered Android workbench, including bounded
ADB device discovery and future Run configurations, is documented in
[`docs/android-workbench-plan.md`](docs/android-workbench-plan.md).

The pure `parseAndroidDevicesOutput` helper parses the host-supplied, bounded output of
`adb devices -l`. It accepts the normal daemon preamble and CRLF output, reports explicit
online/offline/unauthorized/unknown states, and marks only online devices as selectable. It does
not invoke adb or infer an online device when the output is incomplete or malformed.
