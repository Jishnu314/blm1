import { POPUP_WORD, popupLine } from "../adminHelpers.js";
import { Toggle, DateBox } from "../fields.jsx";
import { LIMITS } from "../../lib/settings.js";
import { imageSrc } from "../../lib/popup.js";
import Popup from "../../components/Popup.jsx";

// Pulled out of AdminApp.jsx without changing what it draws. Every value it uses
// from the page arrives as a prop of the same name.
export default function PopupSection({ armed, askDrop, askWipe, choosePicture, dropFromShelf, dropPicture, dropping, mark, openShelf, picBusy, picNote, picWord, popHasSomething, popState, popupDraft, popupFrom, popupImage, popupMode, popupOn, popupText, popupTitle, popupTo, setAskWipe, setDropping, setPicNote, setPopupFrom, setPopupImage, setPopupMode, setPopupOn, setPopupText, setPopupTitle, setPopupTo, shelf, shelfBusy, wipePopup }) {
  return (
<section className="section" onChangeCapture={mark} onClickCapture={mark}>
              <div className="section-head">
                <h2 className="section-title">Popup announcement</h2>
                <span className="section-note">{POPUP_WORD[popState]}</span>
              </div>
              <Toggle
                label="Pop it up on the form"
                on={popupOn}
                onToggle={() => setPopupOn(!popupOn)}
                onText="On"
                offText="Off"
              />
              {/* Outside the switch on purpose. Off only stops it popping up — the
                  heading, the words and the picture are all still written down, and
                  with the switch off the boxes are hidden, so there was no way to
                  get rid of them. This is that way. It asks first, in place. */}
              {popHasSomething && (
                <>
                  {askWipe && (
                    <p className="hint">
                      The heading, the words, the picture and both dates all go, and
                      the switch goes off with them. Nothing leaves an agent's phone
                      until you save.
                    </p>
                  )}
                  <div className="section-foot">
                    {askWipe ? (
                      <>
                        {/* Far apart on purpose: the red one is not the one a thumb
                            should find by accident. */}
                        <button type="button" className="add is-danger" onClick={wipePopup}>
                          Yes, take it down
                        </button>
                        <button
                          type="button"
                          className="add"
                          onClick={() => setAskWipe(false)}
                        >
                          Keep it
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="add is-danger"
                          onClick={() => setAskWipe(true)}
                        >
                          Delete the announcement
                        </button>
                        <span className="section-total">
                          {popupOn ? "" : "switched off, still written down"}
                        </span>
                      </>
                    )}
                  </div>
                </>
              )}
              {popupOn && (
                <>
                  {/* Deliberately not "Open" and "Closed": those two words belong
                      to the collection switch two boxes up, and reusing them here
                      would read as the same setting. */}
                  <div className="choice">
                    <button
                      type="button"
                      className={popupMode === "always" ? "chip is-on" : "chip"}
                      onClick={() => setPopupMode("always")}
                    >
                      Until I turn it off
                    </button>
                    <button
                      type="button"
                      className={popupMode === "window" ? "chip is-on" : "chip"}
                      onClick={() => setPopupMode("window")}
                    >
                      Between two dates
                    </button>
                  </div>
                  {popupMode === "window" && (
                    <div className="pair is-even">
                      <DateBox
                        id="pop-from"
                        label="First day"
                        value={popupFrom}
                        onChange={setPopupFrom}
                      />
                      <DateBox
                        id="pop-to"
                        label="Last day"
                        value={popupTo}
                        onChange={setPopupTo}
                      />
                    </div>
                  )}
                  <p className="hint">{popupLine(popState, popupDraft)}</p>
                  <p className="hint">
                    Each agent gets it once a day. Change the words or the picture and it
                    comes up again straight away, even for someone who has already seen
                    today's.
                  </p>
                  <div className="row">
                    <label className="label" htmlFor="pop-title">
                      Heading
                    </label>
                    <div className="well">
                      <input
                        id="pop-title"
                        className="scheme-input"
                        value={popupTitle}
                        onChange={(event) => setPopupTitle(event.target.value)}
                        placeholder="e.g. New RD scheme from 1 October"
                        autoComplete="off"
                        maxLength={LIMITS.popupTitle}
                      />
                    </div>
                  </div>
                  <div className="row">
                    <label className="label" htmlFor="pop-text">
                      What it says
                    </label>
                    <div className="well">
                      <textarea
                        id="pop-text"
                        className="scheme-input note-input"
                        value={popupText}
                        onChange={(event) => setPopupText(event.target.value)}
                        rows={3}
                        placeholder="A line or two. Press Enter for a new line."
                        maxLength={LIMITS.popupText}
                      />
                    </div>
                    <p className="hint">
                      A picture, a heading, a few words — any one of the three is enough.
                      With none of them nothing pops up, whatever the switch says.
                    </p>
                  </div>
                  <div className="row">
                    {popupImage ? (
                      // A picture that is already chosen is shown in words with the
                      // way off it, whatever it came from — an upload, a link, or one
                      // left over from the Drive era. The text box was only ever for
                      // typing one in, and an inline picture cannot go in a box at
                      // all: it is the picture itself, hundreds of thousands of
                      // characters.
                      <>
                        <p className="label">Picture</p>
                        <div className="held">
                          <span className="held-word">{picWord}</span>
                          <button
                            type="button"
                            className="add is-danger"
                            onClick={dropPicture}
                          >
                            Remove
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <label className="label" htmlFor="pop-image">
                          Picture
                        </label>
                        <div className="well">
                          <input
                            id="pop-image"
                            className="scheme-input"
                            value={popupImage}
                            onChange={(event) => setPopupImage(event.target.value)}
                            placeholder="https://… , or choose a picture below"
                            autoComplete="off"
                            spellCheck="false"
                            maxLength={LIMITS.popupImage}
                          />
                        </div>
                      </>
                    )}
                    <div className="section-foot">
                      {/* A label wrapping a hidden file input: the browser's own
                          file picker, wearing the same button as everything else. */}
                      <label className="add is-file">
                        {picBusy ? "Working…" : "Choose a picture"}
                        <input
                          type="file"
                          className="sr-only"
                          accept="image/*"
                          onChange={choosePicture}
                          disabled={picBusy}
                        />
                      </label>
                      <button
                        type="button"
                        className="add"
                        onClick={openShelf}
                        disabled={shelfBusy}
                      >
                        {shelfBusy ? "Looking…" : "Ones uploaded before"}
                      </button>
                    </div>
                    {picNote && <p className="hint">{picNote}</p>}
                  </div>
                  {shelf !== undefined &&
                    (shelf === null ? (
                      <p className="hint">
                        The pictures could not be read just now. Check the connection
                        and try again.
                      </p>
                    ) : shelf.length === 0 ? (
                      <p className="hint">Nothing uploaded yet.</p>
                    ) : (
                      <>
                        <div className="shelf">
                          {shelf.map((one) => {
                            // The address the server gave, not one built here. A guess
                            // at the shape of it is a broken picture on every phone.
                            const ref = one.url;
                            return (
                              // A tile is two buttons now — use this one, or delete it
                              // — so they are siblings inside a wrapper. A button
                              // inside a button is not something a browser keeps.
                              <div className="shelf-item" key={one.id}>
                                <button
                                  type="button"
                                  className={popupImage === ref ? "shelf-pic is-on" : "shelf-pic"}
                                  onClick={() => {
                                    setPopupImage(ref);
                                    setPicNote(`Using ${one.name}.`);
                                  }}
                                  aria-pressed={popupImage === ref}
                                >
                                  <img src={imageSrc(ref)} alt="" loading="lazy" />
                                  <span className="shelf-name">{one.name}</span>
                                </button>
                                <button
                                  type="button"
                                  className={
                                    dropping === one.id ? "shelf-drop is-on" : "shelf-drop"
                                  }
                                  onClick={() => askDrop(one)}
                                  disabled={shelfBusy}
                                  aria-label={`Delete ${one.name} from the shelf`}
                                >
                                  ×
                                </button>
                              </div>
                            );
                          })}
                        </div>
                        {/* The question goes under the shelf, where a tile 88px wide
                            has no room for it, and it names the file so it is plainly
                            the one whose × was pressed. */}
                        {armed && (
                          <>
                            <p className="hint is-error">
                              Delete {armed.name}? It leaves the server for good —
                              the one thing on this page that Cancel cannot put back.
                            </p>
                            <div className="section-foot">
                              {/* Far apart, like the announcement's own delete: the
                                  red one is not the one a thumb finds by accident. */}
                              <button
                                type="button"
                                className="add is-danger"
                                onClick={() => dropFromShelf(armed)}
                                disabled={shelfBusy}
                              >
                                {shelfBusy ? "Deleting…" : "Yes, delete it"}
                              </button>
                              <button
                                type="button"
                                className="add"
                                onClick={() => setDropping("")}
                                disabled={shelfBusy}
                              >
                                Keep it
                              </button>
                            </div>
                          </>
                        )}
                      </>
                    ))}

                  {/* The very same card the agents get, sitting on the page. Not a
                      drawing of it — the component itself, reading the boxes above. */}
                  <p className="label preview-label">What an agent will see</p>
                  {popState === "empty" ? (
                    <p className="hint">Nothing yet.</p>
                  ) : (
                    <Popup settings={popupDraft} preview />
                  )}
                </>
              )}
            </section>
  );
}
