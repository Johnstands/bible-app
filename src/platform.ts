/** True on macOS, where shortcuts use ⌘ rather than Ctrl. The handlers already accept either key. */
export function isMac(platform: string | undefined): boolean {
  return /^Mac/i.test(platform ?? "");
}

const mac = isMac(typeof navigator === "undefined" ? undefined : navigator.platform);

/** A shortcut as this platform writes it: "Ctrl+F", or "⌘F" on a Mac. */
export function shortcutLabel(key: string, onMac: boolean = mac): string {
  return onMac ? `⌘${key}` : `Ctrl+${key}`;
}
