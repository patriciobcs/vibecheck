import { init, setCollectionPermission, track } from "./index";

/**
 * Script-tag entry:
 *   <script src="https://app.vibecheck.dev/sdk/vibecheck.js" data-key="pk_..." defer></script>
 * The API origin defaults to the script's own origin.
 */
const current = document.currentScript as HTMLScriptElement | null;
const key = current?.dataset.key;
if (key) {
  const apiOrigin = current?.dataset.origin ?? new URL(current?.src ?? location.href).origin;
  const quiet = current?.dataset.quietPaths?.split(",").map((p) => new RegExp(p.trim())) ?? [];
  const permission = current?.dataset.collectionPermission;
  init({
    publishableKey: key,
    apiOrigin,
    quietPaths: quiet,
    buildRef: current?.dataset.buildRef,
    collectionPermission:
      permission === "granted" || permission === "denied" ? permission : "unknown",
  });
} else {
  console.warn("[vibecheck] missing data-key on the SDK script tag");
}

export { init, setCollectionPermission, track };
