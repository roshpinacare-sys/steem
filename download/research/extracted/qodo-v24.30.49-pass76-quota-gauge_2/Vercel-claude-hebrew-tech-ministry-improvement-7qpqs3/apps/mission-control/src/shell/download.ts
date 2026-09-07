/**
 * download.ts — save a Blob to the device via a temporary anchor. Android
 * WebViews without a DownloadListener can silently no-op on blob anchors, so
 * this returns a boolean and callers always render an "Open on GitHub"
 * fallback link next to any download button.
 */
export function downloadBlob(name: string, blob: Blob): boolean {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1200);
    return true;
  } catch {
    return false;
  }
}
