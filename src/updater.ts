import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

export interface UpdateOffer {
  version: string;
  notes: string | null;
  /** Downloads and installs it, then restarts the app. */
  install: () => Promise<void>;
}

/** Asks GitHub Releases whether a newer, signed version exists. Null means up to date; a failed check throws. */
export async function findUpdate(): Promise<UpdateOffer | null> {
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    notes: update.body ?? null,
    install: async () => {
      await update.downloadAndInstall();
      await relaunch();
    },
  };
}

/** The version of the running app, or null if it can't be read (for example in a plain browser). */
export const appVersion = () => getVersion().catch(() => null);
