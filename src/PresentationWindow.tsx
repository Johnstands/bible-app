import { useEffect, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { PresentationView } from "./PresentationView";
import { STANDBY_STATE } from "./presentation";
import type { PresentationState } from "./presentation";

/** The control window's label, matching `"main"` in src-tauri/tauri.conf.json. */
const MAIN_WINDOW = "main";

/**
 * The whole UI of the dedicated presentation window: just the projected view, driven entirely by
 * state pushed from the control window (App.tsx). It never asks for state itself — it announces it's
 * ready, and the control window responds with whatever is current (see App.tsx's "present:ready" and
 * "present:state" handling), which also covers the case where the window opens after presenting has
 * already started.
 */
export function PresentationWindow() {
  const [state, setState] = useState<PresentationState>(STANDBY_STATE);

  useEffect(() => {
    let stale = false;
    const unlisten = listen<PresentationState>("present:state", (e) => {
      if (!stale) setState(e.payload);
    });
    void emitTo(MAIN_WINDOW, "present:ready");
    return () => {
      stale = true;
      void unlisten.then((f) => f());
    };
  }, []);

  return (
    <div className="present-window">
      <PresentationView state={state} />
    </div>
  );
}
