# Asterlyn Android / Gradle plugin

Android and Gradle reference integration for Asterlyn's public plugin foundation. The repository
currently builds a trusted ESM artifact that is pinned into the desktop host at build time; runtime
third-party installation remains gated on the host's package-admission and isolation work.

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
