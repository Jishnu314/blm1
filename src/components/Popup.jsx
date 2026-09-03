import { useEffect, useRef, useState } from "react";
import { imageSrc } from "../lib/popup.js";

/**
 * The card that greets an agent when they open the form: a picture, a heading,
 * a few words, or any two of the three.
 *
 * It is one tap to get past — the Close button, the × , the backdrop or Escape —
 * because an agent who came to type a figure must never feel trapped by an
 * announcement. `preview` drops the backdrop and the fixed position so the admin
 * page can show the same card inline, on the page, exactly as it will look.
 */
export default function Popup({ settings, onClose, preview = false }) {
  const [brokenPicture, setBrokenPicture] = useState(false);
  const closeRef = useRef(null);

  const src = imageSrc(settings.popupImage);
  const title = String(settings.popupTitle || "").trim();
  const words = String(settings.popupText || "").trim();

  // Escape closes it, and the page behind it holds still while it is up.
  useEffect(() => {
    if (preview) return undefined;
    closeRef.current?.focus();
    const onKey = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    const held = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = held;
    };
  }, [preview, onClose]);

  const card = (
    <div
      className={preview ? "pop is-preview" : "pop"}
      role={preview ? undefined : "dialog"}
      aria-modal={preview ? undefined : "true"}
      aria-labelledby={preview ? undefined : "pop-tag"}
      // A tap inside the card must not reach the backdrop and close it.
      onClick={(event) => event.stopPropagation()}
    >
      {src !== "" && !brokenPicture && (
        <img
          className="pop-img"
          src={src}
          alt={title || "Announcement"}
          onError={() => setBrokenPicture(true)}
        />
      )}

      <div className="pop-body">
        <p className="pop-tag" id={preview ? undefined : "pop-tag"}>
          Announcement
        </p>
        {title !== "" && <h2 className="pop-title">{title}</h2>}
        {words !== "" && <p className="pop-text">{words}</p>}
        {/* A picture that will not load leaves the card silent otherwise. */}
        {brokenPicture && title === "" && words === "" && (
          <p className="pop-text">That picture could not be loaded.</p>
        )}
      </div>

      {!preview && (
        <>
          <button
            type="button"
            className="pop-x"
            onClick={onClose}
            aria-label="Close this announcement"
          >
            ×
          </button>
          <button type="button" ref={closeRef} className="pop-close" onClick={onClose}>
            Close
          </button>
        </>
      )}
    </div>
  );

  if (preview) return card;

  return (
    <div className="pop-back" onClick={onClose}>
      {card}
    </div>
  );
}
