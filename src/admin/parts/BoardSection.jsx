import { BOARD_WORD, blankPlayer } from "../adminHelpers.js";
import { boardState } from "../../lib/board.js";
import { Toggle } from "../fields.jsx";
import { LIMITS } from "../../lib/settings.js";
import { MAX_NAME } from "../../lib/rows.js";
import { toDigits } from "../../lib/currency.js";
import Board from "../../components/Board.jsx";

// Pulled out of AdminApp.jsx without changing what it draws. Every value it uses
// from the page arrives as a prop of the same name.
export default function BoardSection({ boardDraft, boardOn, boardTitle, editPlayer, mark, players, setBoardOn, setBoardTitle, setPlayers, standing }) {
  return (
<section className="section" onChangeCapture={mark} onClickCapture={mark}>
              <div className="section-head">
                <h2 className="section-title">Game board</h2>
                <span className="section-note">{BOARD_WORD[boardState(boardDraft)]}</span>
              </div>
              <Toggle
                label="Put the standing on the form"
                on={boardOn}
                onToggle={() => setBoardOn(!boardOn)}
                onText="On"
                offText="Off"
              />
              {boardOn && (
                <>
                  <p className="hint">
                    You type these yourself — the board never works itself out from the
                    reports, so it says exactly what you decide it says. Most points
                    first. Two people level are both first and both take a gold. The top
                    three stand on the podium; however many more you type sit behind
                    “See all”.
                  </p>
                  <div className="row">
                    <label className="label" htmlFor="board-title">
                      Heading
                    </label>
                    <div className="well">
                      <input
                        id="board-title"
                        className="scheme-input"
                        value={boardTitle}
                        onChange={(event) => setBoardTitle(event.target.value)}
                        placeholder="Top performers"
                        autoComplete="off"
                        maxLength={LIMITS.boardTitle}
                      />
                    </div>
                  </div>

                  {/* Headed once, above the rows, rather than labelling every row:
                      the two boxes are a name and a figure and now say so, and ten
                      people do not repeat the same two words ten times. */}
                  {players.length > 0 && (
                    <div className="player-head" aria-hidden="true">
                      <p className="label">Name</p>
                      <p className="label">Points</p>
                      <span />
                    </div>
                  )}

                  {players.map((row, index) => (
                    <div key={row.id} className="player">
                      <div className="well">
                        <input
                          className="scheme-input"
                          value={row.name}
                          onChange={(event) => editPlayer(row.id, { name: event.target.value })}
                          placeholder={index === 0 ? "e.g. Anil Kumar" : "Name"}
                          autoComplete="off"
                          /* The register refuses the whole list past 20,000
                             characters, and it is the only limit it puts on the
                             board. Eighty per name — the same as every other name
                             in this app — puts that wall beyond about 170 people,
                             which is further than any board this is for. The points
                             box needs no limit: toDigits() already stops at nine
                             digits, the largest figure the register takes. */
                          maxLength={MAX_NAME}
                          aria-label={`Name ${index + 1}`}
                        />
                      </div>
                      <div className="well">
                        <input
                          className="scheme-input player-points"
                          value={row.points}
                          onChange={(event) =>
                            editPlayer(row.id, { points: toDigits(event.target.value) })
                          }
                          inputMode="numeric"
                          placeholder="0"
                          autoComplete="off"
                          aria-label={`Points ${index + 1}`}
                        />
                      </div>
                      <button
                        type="button"
                        className="drop"
                        onClick={() => setPlayers((rows) => rows.filter((one) => one.id !== row.id))}
                        aria-label={`Take ${row.name.trim() || "this row"} off the board`}
                      >
                        ×
                      </button>
                    </div>
                  ))}

                  <div className="section-foot">
                    <button
                      type="button"
                      className="add"
                      onClick={() => setPlayers((rows) => [...rows, blankPlayer(rows)])}
                    >
                      Add someone
                    </button>
                    <span className="section-total">
                      {standing.length === 0
                        ? "nobody yet"
                        : `${standing.length} on the board`}
                    </span>
                  </div>

                  {/* The component itself, on the list as it stands — not a drawing
                      of it. A row with no name is left out here exactly as it is on
                      an agent's phone. */}
                  <p className="label preview-label">What an agent will see</p>
                  {standing.length === 0 ? (
                    <p className="hint">Nobody on it yet. Add a name and a figure above.</p>
                  ) : (
                    <Board settings={boardDraft} preview />
                  )}
                </>
              )}
            </section>
  );
}
