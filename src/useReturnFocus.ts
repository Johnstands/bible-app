import { useEffect, useRef } from "react";

/**
 * Gives focus back to whatever had it before a dialog opened, when the dialog closes.
 *
 * The opener is read while rendering, not in an effect: opening a dialog makes the page behind it inert in
 * the same commit, and the browser drops focus from the inert page before any effect runs.
 */
export function useReturnFocus() {
  const opener = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  useEffect(() => {
    const el = opener.current;
    return () => {
      // Skip if it was removed, or is the body, which can't take focus back meaningfully.
      if (el && el !== document.body && el.isConnected) el.focus();
    };
  }, []);
}
