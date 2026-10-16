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

- Derive module/variant/install-task candidates from the exact verified task snapshot, but require
  a matching exact assemble task before a configuration becomes runnable.
- Require explicit selection whenever more than one candidate exists.
- Acquire application ID and launcher component from the verified final APK after the selected
  assemble task succeeds. Parse bounded output metadata and APK-manifest tool output, including
  `activity-alias`; build-file regexes are not final authority.
- Invalidate stale configurations when Gradle fingerprints or candidate identity changes.

### AP5 — supervised application Run

- Return an orchestration plan; never execute a child process directly.
- Validate configuration and target before Gradle execution, before install, and before launch.
- Build through the reviewed Gradle task service, then install through the host's admitted
  exact-device Android operation.
- Launch through a second admitted ADB operation using the exact current device serial and application
  component.
- Map every terminal result into one deterministic run-session result and plugin notification.

The corrected Run deliberately uses post-build authority: exact `assemble<Variant>`, bounded AGP
output metadata, final APK inspection, fresh target validation, exact-device install, then exact
component launch. A future Gradle project model
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
  workspace has Android evidence and a matching runnable `assemble<Variant>` task;
- `install<Variant>AndroidTest` is excluded from application Run;
- the selected configuration is remembered through plugin-namespaced workspace state;
- the build plan limits host artifact and `output-metadata.json` sidecar discovery to the exact
  module APK output root;
- AGP output metadata must identify the exact variant and one contained `SINGLE` APK;
- AAPT badging must provide one application ID and one unique ordinary or Leanback launcher
  component; split/multiple APKs or launchers, missing metadata, malformed data, and truncated output all
  fail closed; and
- the plugin returns typed `android.apk.inspect`, `android.adb.install`, and
  `android.adb.launch` requests while the host
  retains all execution and lifecycle authority.

The plugin passes TypeScript checking, all 59 tests, and build verification. Against the real
FilesRecovery task catalog it projected 25 application configurations from 15,980 Gradle tasks;
an existing flavor APK resolved to `com.photo.recovery.global.tt` and
`com.files.recovery.page.SplashActivity` through final-artifact inspection. Host packaging,
installation, and rendered smoke passed. Interactive install-and-launch remains the user's manual
acceptance step; debugger, Logcat, split APKs, parallel Runs, and full Android Studio parity remain
outside this release.

### Exact-device deployment checkpoint

Plugin `0.4.0` adopts SDK `1.6.0` and corrects the Run boundary:

- install tasks remain application-variant evidence, but a matching assemble task is now required
  and is the only Gradle task executed by Run;
- bounded `output-metadata.json` sidecars identify the exact variant and one contained `SINGLE`
  APK without relying on stale-directory order or Gradle console text;
- the plugin requests `android.adb.install` with the selected target and exact workspace APK before
  requesting component launch; and
- split or ambiguous outputs fail closed until target-aware multi-APK selection is implemented.

### Signature-conflict recovery

When the exact-device install result contains the bounded
`INSTALL_FAILED_UPDATE_INCOMPATIBLE` code, the plugin may return one declarative recovery request.
It uses the application ID already proven by AAPT inspection and the selected target already bound
to the deployment request. The host must present a destructive confirmation explaining that
uninstall removes the existing app and local data. Approval invokes only the admitted
`android.adb.uninstall` operation, after which the host retries the same APK once; cancellation or
any other install failure ends Run without uninstalling. The plugin never calls ADB or host UI
directly.

Plugin `0.5.0` adopts SDK `1.7.0` and implements this recovery as a failure-only lazy-loaded module.
It recognizes only a complete, untruncated `INSTALL_FAILED_UPDATE_INCOMPATIBLE` token, derives the
package exclusively from the already inspected APK, and returns the selected target plus package
to `android.adb.uninstall`. All 60 plugin tests and the package build pass. Real FilesRecovery
acceptance produced the expected signature conflict without uninstalling the retained application;
the installed host now owns the explicit cancel-or-uninstall interaction.

### AGP variant identity correction

Gradle task names capitalize the first character of their variant suffix (`assembleSuperboostDebug`),
while AGP writes the same variant to `output-metadata.json` in lower camel case
(`superboostDebug`). Artifact selection normalizes only that task-name boundary before requiring an
otherwise exact metadata match. It does not make module, variant, path, output type, or APK matching
case-insensitive.

The `superboost_lite` project is the regression case: `:SuperBoost:assembleSuperboostDebug`
produces one `SINGLE` APK at
`SuperBoost/build/outputs/apk/superboost/debug/SuperBoost-superboost-debug.apk`. The corrected
resolver accepts that artifact and still rejects missing, duplicate, split, escaped, or differently
named metadata.
