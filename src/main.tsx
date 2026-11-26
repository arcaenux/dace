import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Retire the obsolete appearance preference without a migration path.
// data-theme is deliberately left untouched as a future theme hook; no theme
// selector or persisted preference is part of this milestone.
try {
  window.localStorage.removeItem("dace_appearance_mode");
  document.documentElement.classList.remove(
    "theme-expression",
    "theme-dull",
    "theme-transitioning"
  );
  const rawSettings = window.localStorage.getItem("dace.settings.fallback.v1");
  const parsed = rawSettings ? JSON.parse(rawSettings) : null;
  const initialMode =
    parsed?.appearance?.colorMode === "dark" ? "dark" : "light";
  document.documentElement.dataset.appearance = initialMode;
} catch {
  document.documentElement.dataset.appearance = "light";
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
