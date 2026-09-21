import { useEffect } from "react";
import type { RefObject } from "react";

/**
 * Keeps keyboard focus inside a dialog. When the element that had it is removed (the button that started a plan, a
 * row that was deleted), focus would fall to the page; the dialog only hears Escape and the arrow keys while it holds
 * focus, so it takes it back.
 */
export function useKeepFocus(dialog: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = dialog.current;
    if (el && !el.contains(document.activeElement)) el.focus();
  });
}
