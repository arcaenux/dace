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
} catch {
  // Storage may be unavailable; stale classes have no visual effect.
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
