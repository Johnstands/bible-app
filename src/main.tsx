import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "@fontsource-variable/eb-garamond";
import "@fontsource-variable/eb-garamond/wght-italic.css";
import "@fontsource-variable/literata";
import "@fontsource-variable/literata/wght-italic.css";
import "@fontsource-variable/source-serif-4";
import "@fontsource-variable/source-serif-4/wght-italic.css";
import "@fontsource-variable/inter";
import "./theme.css";
import App from "./App";
import { PresentationWindow } from "./PresentationWindow";
import { PRESENTATION_WINDOW } from "./presentation";

// The dedicated presentation window loads this same bundle (see src-tauri/src/present.rs); which
// component it mounts is decided by its window label, not by a route.
const isPresentation = getCurrentWindow().label === PRESENTATION_WINDOW;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isPresentation ? <PresentationWindow /> : <App />}
  </React.StrictMode>,
);
