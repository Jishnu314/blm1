import { useState } from "react";
import { rankPlayers, splitBoard, podiumOrder, boardTitle } from "../lib/board.js";
import { formatINR } from "../lib/currency.js";

/**
 * The game board an agent sees on the form: a podium for the top three, then the
 * rest of the team on request.
 *
 * This is the one loud thing in the app, and deliberately so — everything else is
 * white cards and hairlines because it is a form to be filled in, but a standing
 * is meant to be enjoyed. Gold, silver and bronze are the only colours in the app
 * that are not one of the three money colours; medals cannot be mistaken for
 * rupees, so the rule that colour means money still holds.
 *
 * `preview` is for the admin page: the same board, sitting on the page, so what
 * is typed is what the agents get.
 */
export default function Board({ settings, preview = false }) {
  // The rest of the team is one tap away rather than always open: an agent came
  // here to type a figure, and a twenty-name list would push the form off screen.
  const [showAll, setShowAll] = useState(false);

  const ranked = rankPlayers(settings.boardPlayers);
  if (ranked.length === 0) return null;

  const { top, rest } = splitBoard(ranked);
  const title = boardTitle(settings);

  return (
    <section className={preview ? "board is-preview" : "board"}>
      {/* Decoration only, and the first thing to go when motion is unwelcome. */}
      <div className="fetti" aria-hidden="true">
        {Array.from({ length: 14 }, (unused, index) => (
          <span key={index} className={`bit bit-${index % 7}`} />
        ))}
      </div>

      <p className="board-tag">
        <span className="cup" aria-hidden="true">
          🏆
        </span>
        {title}
      </p>

      <ol className="podium">
        {podiumOrder(top).map((player) => (
          <li key={player.name} className={`step is-${player.medal}`}>
            <span className="medal" aria-hidden="true">
              {player.medal === "gold" ? "🥇" : player.medal === "silver" ? "🥈" : "🥉"}
            </span>
            <span className="step-name">{player.name}</span>
            <span className="step-points">{formatINR(String(player.points))}</span>
            {player.draw ? <span className="draw">Draw</span> : null}
            <span className="block" aria-hidden="true">
              {player.place}
            </span>
          </li>
        ))}
      </ol>

      {rest.length > 0 && (
        <>
          <button
            type="button"
            className="board-more"
            onClick={() => setShowAll((was) => !was)}
            aria-expanded={showAll}
          >
            {showAll ? "Hide the rest" : `See all ${ranked.length}`}
          </button>

          {showAll && (
            <ol className="league">
              {rest.map((player) => (
                <li key={player.name} className="rung">
                  <span className="rung-place">{player.draw ? "=" : ""}{player.place}</span>
                  <span className="rung-name">{player.name}</span>
                  <span className="rung-points">{formatINR(String(player.points))}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
