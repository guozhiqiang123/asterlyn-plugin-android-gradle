# Android workbench evolution plan

## Direction

This repository evolves from a Gradle task provider into Asterlyn's Android development plugin.
The user-facing name becomes **Android** while the stable identity remains
`dev.asterlyn.android-gradle`. Existing enablement, settings, workspace trust, remembered task
reviews, and task caches therefore remain valid.

The plugin continues to depend only on `@asterlyn/plugin-sdk`. It does not import host source,
Tauri, DOM, filesystem, Terminal, notification UI, or process APIs. Android behavior is expressed
through bounded host capabilities and declarative contributions.

## Ownership

This repository owns:

- Gradle/Android project matching;
- Gradle task discovery, cache semantics, and hierarchical task data;
- ADB output parsing and Android target semantics;
- module/variant/run-configuration semantics;
- application ID and launcher-activity acquisition;
- build, install, and launch orchestration intent;
- Android-specific settings, validation, copy, and localization; and
- migrations for plugin-owned configuration/state schemas.

The host owns:

- process/tool admission, execution, timeout, cancellation, and child cleanup;
- workspace identity and lifecycle;
- namespaced bounded persistence;
- workbench layout and all rendered controls;
- configuration/target selection interaction;
- Terminal tabs, output, notification presentation, accessibility, and theme; and
- package admission, SDK compatibility, enablement, update, and rollback.

## Delivery slices

### AP1 — package identity and SDK adoption

- Keep the existing plugin ID and package compatibility aliases.
- Change localized name/description to Android development tooling.
- Adopt the SDK revision that introduces workspace tools, execution targets, run configurations,
  bounded process queries, and namespaced workspace state.

### AP2 — ADB device discovery

- Declare one exact `adb.devices` process query for `adb devices -l`.
- Parse device serial, state, product/model/device/transport fields, and emulator identity.
- Preserve offline and unauthorized targets as visible, non-selectable entries.
- Bound line length, target count, metadata count, and total output.
- Publish explicit loading, ready, unavailable, stale, and error snapshots.
- Abort or ignore late results after dispose or workspace-generation replacement.

Device snapshots are transient. Only an explicitly selected target ID may be stored, and every
restored ID is invalid until it appears online in the current snapshot.

### AP3 — Android workbench contribution

- Contribute the Android tool identity and Run, Tasks, Devices views.
- Reuse the existing Gradle task provider unchanged inside Tasks.
- Supply semantic action availability; never supply markup, icon bytes, or CSS.
- Keep task filtering, tree/flat state, disclosure, and execution under host ownership.

### AP4 — run configurations

- Derive module/variant/install-task candidates from the exact verified task snapshot.
- Require explicit selection whenever more than one candidate exists.
- Acquire application ID and launcher component from the verified final APK after the selected
  install task succeeds. Parse bounded output metadata and APK-manifest tool output, including
  `activity-alias`; build-file regexes are not final authority.
- Invalidate stale configurations when Gradle fingerprints or candidate identity changes.

### AP5 — supervised application Run

- Return an orchestration plan; never execute a child process directly.
- Validate configuration and target before Gradle execution and before launch.
- Build/install through the reviewed Gradle task service.
- Launch through an admitted ADB operation using the exact current device serial and application
  component.
- Map every terminal result into one deterministic run-session result and plugin notification.

The first complete Run deliberately uses post-build authority: exact `install<Variant>`, final base
APK inspection, fresh target validation, then exact component launch. A future Gradle project model
may make package/component data visible before the first build, but it cannot replace final-
artifact validation for the session being launched.

The host SDK must provide staged Run, contained artifact resolution, and typed declared tool-
operation contracts before this repository contributes an executable Run plan. This plugin never
widens the fixed `adb.devices` process query or obtains a raw process/filesystem handle.

## ADB parsing contract

The parser accepts LF or CRLF and ignores the normal daemon startup preamble. The first meaningful
header is `List of devices attached`. Each following non-empty record begins with a serial and a
state. Known states are `device`, `offline`, and `unauthorized`; unknown states remain visible as
unknown and are not selectable.

Recognized `key:value` fields are bounded plain text. Duplicate serials are resolved
deterministically, preferring the least-operable state so ambiguous output cannot incorrectly mark
a target online. Malformed or over-limit output returns an error snapshot rather than a partial
selectable list.

## Compatibility and release

Every plugin release must pass TypeScript checks, unit/contract tests, package identity validation,
and build output verification. The host pins one exact tarball and digest. SDK and plugin changes
land in this order:

1. host SDK release and fixture;
2. plugin source update and release artifact;
3. host artifact pin and adapter/UI rollout;
4. installed native acceptance; and
5. retained prior artifact rollback proof.

The initial device-discovery release does not claim a debugger, Logcat, wireless pairing, emulator
management, or full Android Studio Run parity.

## Implementation checkpoint — 2026-10-16

Plugin `0.3.0` adopts SDK `1.5.0` and implements AP4–AP5's first executable slice:

- exact runnable `install<Variant>` tasks become stable module/variant configurations only when the
  workspace has Android evidence;
- `install<Variant>AndroidTest` is excluded from application Run;
- the selected configuration is remembered through plugin-namespaced workspace state;
- the install plan limits host artifact discovery to the exact module APK output root;
- Gradle installation output must identify one APK basename, and host discovery must resolve that
  identity to one contained APK;
- AAPT badging must provide one application ID and one unique ordinary or Leanback launcher
  component; multiple APKs or launchers, missing metadata, malformed data, and truncated output all
  fail closed; and
- the plugin returns typed `android.apk.inspect` and `android.adb.launch` requests while the host
  retains all execution and lifecycle authority.

The plugin passes TypeScript checking, all 59 tests, and build verification. Against the real
FilesRecovery task catalog it projected 25 application configurations from 15,980 Gradle tasks;
an existing flavor APK resolved to `com.photo.recovery.global.tt` and
`com.files.recovery.page.SplashActivity` through final-artifact inspection. Host packaging,
installation, and rendered smoke passed. Interactive install-and-launch remains the user's manual
acceptance step; debugger, Logcat, split APKs, parallel Runs, and full Android Studio parity remain
outside this release.
