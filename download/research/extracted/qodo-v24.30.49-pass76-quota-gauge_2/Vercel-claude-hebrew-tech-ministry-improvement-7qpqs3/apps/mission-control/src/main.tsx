import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TelemetryProvider } from "./context/TelemetryContext.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";

/**
 * One product, every surface. The Platform Shell is fully responsive — a
 * left rail on desktop, a bottom tab bar + drawer on phones — so the same
 * premium experience ships to the browser AND the Capacitor APK. It opens
 * in Demo mode with no sign-in, so the app is alive on first launch.
 */
const AppLazy = React.lazy(() =>
  import("./App.js").then((m) => ({ default: m.App })),
);

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found in index.html");

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary label="Application">
      <TelemetryProvider pollMs={3000}>
        <React.Suspense fallback={null}>
          <AppLazy />
        </React.Suspense>
      </TelemetryProvider>
    </ErrorBoundary>
  </StrictMode>,
);
