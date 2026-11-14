import Board from "./Board.jsx";
import { boardLive } from "../lib/board.js";

export default function ClosedCollection({ month, settings, announcement, seeAgain }) {
  const standing = boardLive(settings) ? <Board settings={settings} /> : null;
  return (
    <div className="app">
      {announcement}
      <main className="card">
        <div className="panel">
          <p className="eyebrow">
            <span className="dot" aria-hidden="true" />
            Monthly report collection
          </p>
          <h1 className="month">
            {month.name}
            <span className="month-year">{month.year}</span>
          </h1>
          <p className="lede">
            Collection is closed for now. Your leader will reopen it when the next
            month's figures are due.
          </p>
          {seeAgain}
        </div>
        {standing}
      </main>
      <p className="credit">{settings.credit}</p>
    </div>
  );
}
