# boostCleaner IDE model recovery

The production extractor now uses AGP's published
`InjectedProperties.PROPERTY_BUILD_MODEL_V2_ONLY` and `PROPERTY_INVOKED_FROM_IDE` constants.
The former expands to `android.injected.build.model.v2=true`; similarly named `model.only.v2`
is not that property. IDE v2 sync records unresolved test graph entries without aborting the
main-artifact graph. The normalizer continues rejecting any nonzero main unresolved count.

The unchanged real boostCleaner project (`:app/cleanx100Debug`, Gradle 8.13, AGP 8.13.2) previously
failed offline on `:clean:cleanx100DebugUnitTestCompileClasspath` and JUnit 4.14-SNAPSHOT. An online
diagnostic attempt then hit an AppLovin Maven TLS handshake failure. Existing local proxy and
direct requests both reproduced that vendor endpoint failure, while Google and Central verified
normally. The solution for this offline main-source import is correct IDE model scope, not disabled
TLS checks, a fabricated snapshot artifact, a dependency downgrade or a repository substitution.

The proper IDE v2 probe returned 25 modules, 1,438 compile entries and zero main unresolved entries
in 9,941 ms. The exact production provider also succeeded (18,372 ms including Java compilation
and cold caches). These are individual local samples, not a distribution. Main dependencies were
already present in the current user cache; no business build/source files or global network settings
were changed. Test-source LSP support is not claimed by this main-source model.

`scripts/test-model-import.py` copies a real Android fixture and invokes the actual provider twice:
missing test dependency must still produce a complete main graph, whereas missing main dependency
must fail with no model stdout. The exact 0.6.1 archive passes both (25,118 ms combined). Pass
`--fixture`, `--input` and `--package-root` for another retained fixture/cache or an extracted package;
the script alters only disposable source copies and uses a bounded owned process group.

Android package 0.6.1: 4,787,454 bytes, SHA-256
`69a831aa265713e90e2ab2f2a860b6b19dc0057d57fcf23a839e95deb9318339`.
Typecheck, 69 ordinary tests, package build and native package inspection pass. Full semantic and
installed evidence belongs to the host's
[real-project recovery record](../../asterlyn/docs/engineering/2026-10-27-boostcleaner-lsp-recovery.md).
