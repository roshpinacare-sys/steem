import type { CapacitorConfig } from "@capacitor/cli";

// Android wrap of the Mission Control dashboard. The native project is NOT
// committed — CI regenerates it with `npx cap add android` (see the
// android-apk job in .github/workflows/agent-pipeline.yml), which keeps
// ~100 generated Gradle files out of the tree.
const config: CapacitorConfig = {
  appId: "com.qodo.missioncontrol",
  appName: "Qodo Mission Control",
  webDir: "dist",
  // Match the app's dark surface so launch/rotation never flashes white.
  backgroundColor: "#0D1015",
  plugins: {
    // The chrome is permanently dark: force light status/gesture-bar icons
    // instead of following the device theme (which would render dark icons
    // over the dark header on light-theme phones). Insets stay on the
    // default "css" handling — the shell consumes the injected
    // --safe-area-inset-* variables (see the --sa-* contract in index.html).
    SystemBars: { style: "DARK" },
    // Route window.fetch through native OkHttp on device. This bypasses the
    // browser CORS wall that otherwise blocks direct calls to LLM providers
    // (OpenAI, Anthropic, Groq, …) from the WebView — so "bring your own LLM
    // key" actually works in the APK. On web it's a no-op (normal fetch).
    CapacitorHttp: { enabled: true },
  },
};

export default config;
