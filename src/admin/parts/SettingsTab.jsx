import { Toggle, DayBox } from "../fields.jsx";
import { LIMITS } from "../../lib/settings.js";
import { ordinal } from "../format.js";
import PasswordSection from "./PasswordSection.jsx";
import SheetSection from "./SheetSection.jsx";
import BoardSection from "./BoardSection.jsx";
import PopupSection from "./PopupSection.jsx";

// Pulled out of AdminApp.jsx without changing what it draws. Every value it uses
// from the page arrives as a prop of the same name.
export default function SettingsTab({ armed, askDrop, askWipe, autoWindow, boardDraft, boardOn, boardTitle, changeIt, choosePicture, closesAfter, connectSheet, copied, copyLink, credit, dropFromShelf, dropPicture, dropping, editPlayer, formLink, health, healthBusy, held, importSheet, mark, message, mirror, oldest, open, openNow, openShelf, opensOn, picBusy, picNote, picWord, players, popHasSomething, popState, popupDraft, popupFrom, popupImage, popupMode, popupOn, popupText, popupTitle, popupTo, pwBusy, pwNext, pwNote, pwNow, readHealth, setAskWipe, setAutoWindow, setBoardOn, setBoardTitle, setClosesAfter, setCredit, setDropping, setMessage, setOpen, setOpensOn, setPicNote, setPlayers, setPopupFrom, setPopupImage, setPopupMode, setPopupOn, setPopupText, setPopupTitle, setPopupTo, setPwNext, setPwNote, setPwNow, setSheetUrl, setShowFd, setShowRd, sheetBusy, sheetNote, sheetNoteOk, sheetUrl, sheetWord, shelf, shelfBusy, showFd, showRd, standing, wipePopup }) {
  return (
<>
            <section className="section" onChangeCapture={mark} onClickCapture={mark}>
              <div className="section-head">
                <h2 className="section-title">The form</h2>
              </div>
              <Toggle label="Accepting reports" on={open} onToggle={() => setOpen(!open)} />
              <Toggle
                label="Ask for new RD"
                on={showRd}
                onToggle={() => setShowRd(!showRd)}
                onText="Shown"
                offText="Hidden"
              />
              <Toggle
                label="Ask for new FD"
                on={showFd}
                onToggle={() => setShowFd(!showFd)}
                onText="Shown"
                offText="Hidden"
              />
              <div className="row">
                <label className="label" htmlFor="message">
                  A line for the agents to read
                </label>
                <div className="well">
                  <input
                    id="message"
                    className="scheme-input"
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="e.g. August figures by 5 September please"
                    autoComplete="off"
                    maxLength={LIMITS.message}
                  />
                </div>
                <p className="hint">Left empty, nothing is shown.</p>
              </div>
              <div className="row">
                <label className="label" htmlFor="credit">
                  Footer line
                </label>
                <div className="well">
                  <input
                    id="credit"
                    className="scheme-input"
                    value={credit}
                    onChange={(event) => setCredit(event.target.value)}
                    autoComplete="off"
                    maxLength={LIMITS.credit}
                  />
                </div>
              </div>
            </section>

            <section className="section" onChangeCapture={mark} onClickCapture={mark}>
              <div className="section-head">
                <h2 className="section-title">Open and close by itself</h2>
                <span className="section-note">{autoWindow ? "on" : "off"}</span>
              </div>
              <Toggle
                label="Use a collection window"
                on={autoWindow}
                onToggle={() => setAutoWindow(!autoWindow)}
                onText="On"
                offText="Off"
              />
              {autoWindow && (
                <>
                  <div className="pair is-even">
                    <DayBox
                      id="opens"
                      label="Opens on day"
                      value={opensOn}
                      onChange={setOpensOn}
                      high={31}
                    />
                    <DayBox
                      id="closes"
                      label="Closes after day"
                      value={closesAfter}
                      onChange={setClosesAfter}
                      high={31}
                    />
                  </div>
                  <p className="hint">
                    Open from the {ordinal(Number(opensOn) || 1)} to the{" "}
                    {ordinal(Number(closesAfter) || 0)}, closed in between. Today it is{" "}
                    {openNow ? "open" : "closed"}.
                  </p>
                </>
              )}
            </section>

            {/* --- the popup ------------------------------------------ */}
            <PopupSection armed={armed} askDrop={askDrop} askWipe={askWipe} choosePicture={choosePicture} dropFromShelf={dropFromShelf} dropPicture={dropPicture} dropping={dropping} mark={mark} openShelf={openShelf} picBusy={picBusy} picNote={picNote} picWord={picWord} popHasSomething={popHasSomething} popState={popState} popupDraft={popupDraft} popupFrom={popupFrom} popupImage={popupImage} popupMode={popupMode} popupOn={popupOn} popupText={popupText} popupTitle={popupTitle} popupTo={popupTo} setAskWipe={setAskWipe} setDropping={setDropping} setPicNote={setPicNote} setPopupFrom={setPopupFrom} setPopupImage={setPopupImage} setPopupMode={setPopupMode} setPopupOn={setPopupOn} setPopupText={setPopupText} setPopupTitle={setPopupTitle} setPopupTo={setPopupTo} shelf={shelf} shelfBusy={shelfBusy} wipePopup={wipePopup} />

            {/* --- the game board ------------------------------------- */}
            <BoardSection boardDraft={boardDraft} boardOn={boardOn} boardTitle={boardTitle} editPlayer={editPlayer} mark={mark} players={players} setBoardOn={setBoardOn} setBoardTitle={setBoardTitle} setPlayers={setPlayers} standing={standing} />

            <section className="section">
              <div className="section-head">
                <h2 className="section-title">The link agents open</h2>
              </div>
              <p className="link-line">{formLink}</p>
              <div className="section-foot">
                <button type="button" className="add" onClick={copyLink}>
                  Copy link
                </button>
                {copied && <span className="section-note">copied</span>}
              </div>
              <p className="hint">
                Send this one. Nothing on it points at this page.
              </p>
            </section>

            {/* Connection controls live beside the register health summary, so an
                admin can connect and import the Sheet without a terminal. */}
            <SheetSection connectSheet={connectSheet} health={health} healthBusy={healthBusy} held={held} importSheet={importSheet} mirror={mirror} oldest={oldest} readHealth={readHealth} setSheetUrl={setSheetUrl} sheetBusy={sheetBusy} sheetNote={sheetNote} sheetNoteOk={sheetNoteOk} sheetUrl={sheetUrl} sheetWord={sheetWord} />

            {/* The password, changeable from here rather than from a shell.
                It sits outside the Save button on purpose: everything else on this
                page is a draft until Save, and a password that was "nearly changed"
                is the worst of both. This one commits itself, alone, immediately. */}
            <PasswordSection changeIt={changeIt} pwBusy={pwBusy} pwNext={pwNext} pwNote={pwNote} pwNow={pwNow} setPwNext={setPwNext} setPwNote={setPwNote} setPwNow={setPwNow} />
            </>
  );
}
