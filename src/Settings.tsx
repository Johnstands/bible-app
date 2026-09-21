import { useEffect, useRef } from "react";
import {
  clampScale, DEFAULT_SETTINGS, FONT_SCALE, FONTS, THEME_LABELS, THEMES, WORD_HELP_LABELS, WORD_HELP_LEVELS,
} from "./settings";
import type { FontFamily, Settings as SettingsValue } from "./settings";

interface Props {
  settings: SettingsValue;
  onChange: (settings: SettingsValue) => void;
  onShowVerse: () => void;
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
export function Settings({ settings, onChange, onShowVerse, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const set = (patch: Partial<SettingsValue>) => onChange({ ...settings, ...patch });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>("[aria-pressed='true']")?.focus();
    return () => opener?.focus?.();
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
