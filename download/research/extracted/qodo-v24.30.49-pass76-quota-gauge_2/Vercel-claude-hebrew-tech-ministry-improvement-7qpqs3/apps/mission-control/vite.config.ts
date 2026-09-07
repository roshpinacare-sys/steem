import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { readFileSync } from "fs";

// Stamp the built app with its package version so the About panel can show
// exactly which build a phone is running — invaluable when a teammate reports
// a bug against "the app" and you need to know which APK they have.
const pkgVersion = (JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf8")) as { version: string }).version;

// Cross-origin isolation headers — REQUIRED for the Studio's WebContainer to
// boot (SharedArrayBuffer). Applied to the dev + preview servers here; a
// production host must send the same two headers for the in-browser runtime.
const crossOriginIsolation = {
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin",
};

export default defineConfig({
  plugins: [react()],

  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
  },

  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },

  resolve: {
    alias: {
      // Bundles agent *source* into the browser build (EdgePrefetchServer).
      // Only isomorphic modules may be imported through this alias — the
      // agent's logger is environment-guarded for exactly this reason.
      "@qodo/agent": resolve(__dirname, "../../packages/agent/src"),
    },
  },

  build: {
    // Emit source maps for production debugging without exposing source.
    sourcemap: "hidden",

    minify: "esbuild",

    // Raise the inline-asset threshold so small icons stay inlined.
    assetsInlineLimit: 8192,

    // Silence oversized vendor chunk warnings while we rely on manual chunks.
    chunkSizeWarningLimit: 1_400,

    rollupOptions: {
      // @webcontainer/api is a declared npm dependency and is BUNDLED.
      // It was previously externalized to a `WebContainer` UMD global that
      // no import map or CDN <script> ever provided — every boot() call
      // would have thrown ReferenceError at runtime.
      // NO manualChunks. Forcing vendor chunks (object or function form) let
      // Rollup home floating shared modules — Vite's own preload helper,
      // babel runtime helpers — inside the "lazy" vendor-three/vendor-syntax
      // chunks, which made the ENTRY statically import them: every visitor
      // downloaded ~1MB of three.js at startup despite React.lazy. Rollup's
      // automatic chunking follows the dynamic-import graph correctly: heavy
      // libs load only when their lazy consumer (NeuralCore, CodeView) does.
    },
  },
});
