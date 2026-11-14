import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Self-hosted fonts, bundled by Vite: no CDN and no external requests.
import "@fontsource/ibm-plex-sans-kr/400.css";
import "@fontsource/ibm-plex-sans-kr/500.css";
import "@fontsource/ibm-plex-sans-kr/600.css";
import "galmuri/dist/galmuri.css";

import App from "./App";
import "./index.css";
import { applyTheme, watchSystemTheme } from "./lib/theme";

// index.html already painted the theme before first paint; this keeps React in
// sync for later preference changes and follows the OS while on "system".
applyTheme();
watchSystemTheme();

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element #root was not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
