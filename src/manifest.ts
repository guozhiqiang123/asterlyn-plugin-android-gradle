import type { SdkPluginPackageManifest } from "@asterlyn/plugin-sdk";
import packageManifest from "../manifest.json" with { type: "json" };

/** Static package metadata is the source of truth for runtime plugin identity and copy. */
export const ANDROID_GRADLE_PLUGIN_MANIFEST = Object.freeze(
  packageManifest as unknown as SdkPluginPackageManifest,
);
