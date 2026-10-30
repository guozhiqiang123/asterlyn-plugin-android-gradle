# Public release 0.6.3

2026-10-30: published the accepted Android model-provider implementation after host v0.1.25 succeeded.
CI now validates admission and isolated activation against v0.1.25, rather than obsolete v0.1.15.
SDK 1.14.0 is the exact canonical vendored artifact released by that host. Plugin/runtime bytes are
unchanged by this workflow update. This Release supplies the declared LSP 0.3.11 dependency.

The first Linux rehearsal ran two resource-sensitive parity cases concurrently against debug Boa
helpers and exceeded the activation budget. Release verification now uses the production-optimized
helper (`--release --locked`) and serial parity cases. Production limits and assertions are unchanged.

## Completed publication

[v0.6.3 Release](https://github.com/guozhiqiang123/asterlyn-plugin-android-gradle/releases/tag/v0.6.3)
and [Actions 41064460564](https://github.com/guozhiqiang123/asterlyn-plugin-android-gradle/actions/runs/41064460564)
succeeded at tagged source `004d873b6b9f8cedceaef79e114afb23d9ae3fd0`.
The freshly downloaded package is 4,790,541 bytes, SHA-256
`3cb6549c1ab9e741fc6cb9393f0056c0269e7786b7ee29a60ff778eeef08f2e7`.
Its digest matches GitHub, and canonical native admission against host 0.1.25 passes.
LSP 0.3.11 was published after this dependency Release became available.
