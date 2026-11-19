import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Retire the obsolete appearance preference without a migration path: the
// single cinematic identity is the only supported presentation now.
try {
  window.localStorage.removeItem("dace_appearance_mode");
  document.documentElement.removeAttribute("data-theme");
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
