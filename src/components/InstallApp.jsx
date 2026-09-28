import { useEffect, useState } from "react";
import "./InstallApp.css";

function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function isAppleMobile() {
  return /iPhone|iPad|iPod/i.test(window.navigator.userAgent) ||
    (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
}

export default function InstallApp() {
  const [standalone, setStandalone] = useState(isStandalone);
  const [appleMobile, setAppleMobile] = useState(false);
  const [android, setAndroid] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setAppleMobile(isAppleMobile());
    setAndroid(/Android/i.test(window.navigator.userAgent));

    const onPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    const onInstalled = () => {
      setStandalone(true);
      setInstallPrompt(null);
      setShowHelp(false);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (standalone || dismissed || (!installPrompt && !appleMobile && !android)) return null;

  async function install() {
    if (!installPrompt) {
      setShowHelp(true);
      return;
    }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);
    if (choice?.outcome === "accepted") setStandalone(true);
    else if (appleMobile || android) setShowHelp(true);
  }

  return (
    <>
      <div className="pwa-install-dock">
        <button type="button" className="pwa-install-button" onClick={install}>
          <span aria-hidden="true">＋</span> {appleMobile ? "Add to Home Screen" : "Install app"}
        </button>
        <button type="button" className="pwa-install-dismiss" aria-label="Hide install suggestion" onClick={() => setDismissed(true)}>×</button>
      </div>
      {showHelp && (
        <div className="pwa-install-backdrop" onClick={() => setShowHelp(false)}>
          <section
            className="pwa-install-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pwa-install-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" className="pwa-install-close" aria-label="Close" onClick={() => setShowHelp(false)}>×</button>
            <p className="pwa-install-kicker">USE LIKE AN APP</p>
            <h2 id="pwa-install-title">Add Monthly Reports to your device</h2>
            {appleMobile ? (
              <ol>
                <li>Open this page in <strong>Safari</strong>.</li>
                <li>Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</li>
                <li>Tap <strong>Add</strong>, then open Monthly Reports from your Home Screen.</li>
              </ol>
            ) : (
              <ol>
                <li>Open your browser menu.</li>
                <li>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
                <li>Open Monthly Reports from your app list or Home Screen.</li>
              </ol>
            )}
            <p className="pwa-install-note">Once installed, it opens in its own window without the browser address bar.</p>
            <button type="button" className="pwa-install-done" onClick={() => setShowHelp(false)}>Got it</button>
          </section>
        </div>
      )}
    </>
  );
}
