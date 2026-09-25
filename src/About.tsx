import { useEffect, useRef } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useReturnFocus } from "./useReturnFocus";

const REPO_URL = "https://github.com/Johnstands/bible-app";

// The donation QR is whichever image sits at src/assets/donate-qr.*; until there is one, the section shows a
// placeholder while developing and is left out of builds.
const DONATE_QR = Object.values(
  import.meta.glob<string>("./assets/donate-qr.{png,jpg,jpeg,webp,svg}", { eager: true, query: "?url", import: "default" }),
)[0];

interface Props {
  /** The running app's version, if it can be read. */
  version: string | null;
  onClose: () => void;
}

/** What the app is, who made it, where its text comes from, and how to give toward it. */
export function About({ version, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useReturnFocus();

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div
        ref={panelRef}
        className="goto settings about"
        role="dialog"
        aria-modal="true"
        aria-label="About"
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="settings-body">
          <header className="about-head">
            <h2 className="about-title">KJV Reader’s Bible</h2>
            <div className="ornament" aria-hidden="true" />
            <p className="about-version">{version ? `Version ${version}` : ""}</p>
          </header>

          <section className="set-section">
            <p className="set-about">
              A quiet place to read the King James Bible, with word help, the original languages, reading plans and
              presentation mode for church. It works offline, keeps your notes on your own computer, and is free: no
              ads, no accounts, nothing to buy.
            </p>
            <p className="set-about about-byline">Made by John Carlo Cahimat.</p>
            <button className="set-link" onClick={() => void openUrl(REPO_URL)}>
              Source code on GitHub
            </button>
          </section>

          {(DONATE_QR || import.meta.env.DEV) && (
            <section className="set-section">
              <h2 className="set-heading">Support</h2>
              <p className="set-about">
                If this app has been a blessing to you and you would like to help keep it going, you can give through
                GCash by scanning the code below. It is an InstaPay code, so most Philippine bank apps can scan it too. Any
                amount is appreciated, and the app stays free either way.
              </p>
              {DONATE_QR ? (
                <img className="about-qr" src={DONATE_QR} alt="GCash QR code for giving a donation" />
              ) : (
                <div className="about-qr about-qr--missing">Put the QR image at src/assets/donate-qr.png</div>
              )}
            </section>
          )}

          <section className="set-section">
            <h2 className="set-heading">Sources</h2>
            <p className="set-about">
              The King James text and its Strong’s numbers are from eBible.org (public domain). Strong’s dictionary is by
              James Strong (1890, 1894); its JSON edition is by Open Scriptures, licensed CC BY-SA. Cross-references are from
              OpenBible.info (CC BY), drawn mostly from the public-domain Treasury of Scripture Knowledge.
            </p>
          </section>
        </div>
        <div className="goto-footer">
          <span />
          <span>esc to close</span>
        </div>
      </div>
    </div>
  );
}
