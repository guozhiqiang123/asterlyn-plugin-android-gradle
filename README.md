# Asterlyn Android / Gradle plugin

First-party Android and Gradle integration for Asterlyn. The repository builds a trusted ESM
artifact that is pinned into the desktop host at build time. It is not a runtime third-party plugin.

The plugin depends only on `@asterlyn/plugin-sdk`; it does not import Asterlyn host source, DOM,
Tauri, filesystem, or process bridges. The host retains workspace authority, task review,
execution, cancellation, cache storage, Settings rendering, and Tasks UI.

Run `npm run verify` before producing an artifact. The checked-in SDK tarball pins the exact
contract used by clean and offline builds; update it only together with `package-lock.json` and a
recorded host compatibility change.
