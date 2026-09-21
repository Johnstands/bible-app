import { useEffect, useRef } from "react";
import {
  clampScale, DEFAULT_SETTINGS, FONT_SCALE, FONTS, THEME_LABELS, THEMES, WORD_HELP_LABELS, WORD_HELP_LEVELS,
} from "./settings";
import type { FontFamily, Settings as SettingsValue } from "./settings";
import { useReturnFocus } from "./useReturnFocus";
import { shortcutLabel } from "./platform";

// [keys, what they do]
const SHORTCUTS: [string[], string][] = [
  [["/"], `Go to a book, chapter or verse (also ${shortcutLabel("K")})`],
  [[shortcutLabel("F")], "Search"],
  [[shortcutLabel("L")], "Library of bookmarks, notes and highlights"],
  [[shortcutLabel(",")], "Settings"],
  [["←", "→"], "Previous or next chapter"],
  [["J", "K"], "Move down or up through the verses"],
  [["Space"], "Select or unselect the verse"],
  [["Shift+J", "Shift+K"], "Extend the selection"],
  [["B", "N", "C"], "Bookmark, add a note, or copy the selection"],
  [["1", "2", "3", "4", "5"], "Highlight the selection in a color"],
  [["W", "Shift+W"], "Open the next or previous word's meaning"],
  [["Esc"], "Close a card or clear the selection"],
];

interface Props {
  settings: SettingsValue;
  onChange: (settings: SettingsValue) => void;
  onShowVerse: () => void;
  /** The running app's version, if it can be read. */
  version: string | null;
  updateStatus: "idle" | "checking" | "current" | "available" | "installing" | "failed";
  updateVersion: string | null;
  onCheckUpdates: () => void;
  onInstallUpdate: () => void;
  onClose: () => void;
}

interface SwitchProps {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function Switch({ label, hint, checked, onChange }: SwitchProps) {
  return (
    <button className="switch" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>
      <span className="switch-text">
        <span className="switch-label">{label}</span>
        <span className="switch-hint">{hint}</span>
      </span>
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
    </button>
  );
}

/** Changes apply as you make them, so the page behind the panel is the preview. */
export function Settings({
  settings, onChange, onShowVerse, version, updateStatus, updateVersion, onCheckUpdates, onInstallUpdate, onClose,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const set = (patch: Partial<SettingsValue>) => onChange({ ...settings, ...patch });

  useReturnFocus();

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>("[aria-pressed='true']")?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const percent = Math.round(settings.fontScale * 100);
  return (
    <div className="scrim" onMouseDown={onClose}>
      <div
        ref={panelRef}
        className="goto settings"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="settings-body">
          <section className="set-section">
            <h2 className="set-heading">Theme</h2>
            <div className="set-themes" role="group" aria-label="Theme">
              {THEMES.map((t) => (
                <button key={t} aria-pressed={settings.theme === t} onClick={() => set({ theme: t })}>
                  <span className="swatch" data-theme={t} aria-hidden="true">
                    Aa
                  </span>
                  {THEME_LABELS[t]}
                </button>
              ))}
            </div>
          </section>

          <section className="set-section">
            <h2 className="set-heading">Type</h2>
            <div className="set-fonts" role="group" aria-label="Font">
              {(Object.keys(FONTS) as FontFamily[]).map((id) => (
                <button
                  key={id}
                  aria-pressed={settings.fontFamily === id}
                  style={{ fontFamily: FONTS[id].stack }}
                  onClick={() => set({ fontFamily: id })}
                >
                  {FONTS[id].label}
                </button>
              ))}
            </div>
            <div className="set-size">
              <button
                className="size-step size-small"
                aria-label="Smaller text"
                disabled={settings.fontScale <= FONT_SCALE.min}
                onClick={() => set({ fontScale: clampScale(settings.fontScale - FONT_SCALE.step) })}
              >
                A
              </button>
              <input
                type="range"
                aria-label="Text size"
                aria-valuetext={`${percent}%`}
                min={FONT_SCALE.min}
                max={FONT_SCALE.max}
                step={FONT_SCALE.step}
                value={settings.fontScale}
                onChange={(e) => set({ fontScale: clampScale(+e.target.value) })}
              />
              <button
                className="size-step size-large"
                aria-label="Larger text"
                disabled={settings.fontScale >= FONT_SCALE.max}
                onClick={() => set({ fontScale: clampScale(settings.fontScale + FONT_SCALE.step) })}
              >
                A
              </button>
              <span className="size-value">{percent}%</span>
            </div>
            <p className="set-preview">In the beginning God created the heaven and the earth.</p>
          </section>

          <section className="set-section">
            <h2 className="set-heading">Text</h2>
            <div className="set-choice">
              <span className="switch-label">Word help</span>
              <span className="switch-hint">
                Underline words that are archaic or meant something else in 1611; click one for its meaning.
                “Changed meanings” marks only familiar-looking words that mislead.
              </span>
              <div className="set-levels" role="group" aria-label="Word help">
                {WORD_HELP_LEVELS.map((level) => (
                  <button key={level} aria-pressed={settings.wordHelp === level} onClick={() => set({ wordHelp: level })}>
                    {WORD_HELP_LABELS[level]}
                  </button>
                ))}
              </div>
            </div>
            <Switch
              label="Verse by verse"
              hint="Each verse on its own line, instead of flowing paragraphs."
              checked={settings.verseByVerse}
              onChange={(verseByVerse) => set({ verseByVerse })}
            />
            <Switch
              label="Pilcrows"
              hint="A ¶ where each paragraph begins, as in the 1611 text."
              checked={settings.pilcrows}
              onChange={(pilcrows) => set({ pilcrows })}
            />
            <Switch
              label="Verse of the day"
              hint="Show one when the app opens, once a day."
              checked={settings.verseOfTheDay}
              onChange={(verseOfTheDay) => set({ verseOfTheDay })}
            />
            <button className="set-link" onClick={onShowVerse}>
              Show today’s verse
            </button>
          </section>
          <section className="set-section">
            <h2 className="set-heading">Updates</h2>
            <p className="set-about">
              {version ? `You have version ${version}. ` : ""}
              <span role="status">
                {updateStatus === "checking" && "Checking…"}
                {updateStatus === "current" && "This is the latest version."}
                {updateStatus === "failed" && "Couldn’t check for updates. Are you online?"}
                {updateStatus === "available" && `Version ${updateVersion} is available.`}
                {updateStatus === "installing" && "Installing…"}
              </span>
            </p>
            {updateStatus === "available" ? (
              <button className="set-link" onClick={onInstallUpdate}>
                Install and restart
              </button>
            ) : (
              <button className="set-link" onClick={onCheckUpdates} disabled={updateStatus === "checking" || updateStatus === "installing"}>
                Check for updates
              </button>
            )}
          </section>

          <section className="set-section">
            <h2 className="set-heading">Keyboard</h2>
            <dl className="shortcuts">
              {SHORTCUTS.map(([keys, what]) => (
                <div key={what}>
                  <dt>
                    {keys.map((k) => (
                      <kbd key={k}>{k}</kbd>
                    ))}
                  </dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
        <div className="goto-footer">
          <button className="set-reset" onClick={() => onChange(DEFAULT_SETTINGS)}>
            Reset to defaults
          </button>
          <span>esc to close</span>
        </div>
      </div>
    </div>
  );
}
