import { formatINR } from "../lib/currency.js";

/** 1,25,000 → "1.3L". Enough to read a bar at a glance without crowding it. */
const round = (value) => (value >= 10 ? Math.round(value) : Math.round(value * 10) / 10);
function short(value) {
  if (value >= 10000000) return `${round(value / 10000000)}cr`;
  if (value >= 100000) return `${round(value / 100000)}L`;
  if (value >= 1000) return `${round(value / 1000)}k`;
  return String(Math.round(value));
}

/** A band shorter than this cannot hold a figure inside it — the bar area is
    about 152px tall, so this is roughly 17px against a 14px line of type. */
const ROOMY = 0.11;

/** The least distance apart two figures written beside the bar may sit. */
const APART = 0.1;

/** Bottom to top, the same order and the same names as everywhere else. */
const KINDS = [
  { kind: "renewal", label: "Renewal" },
  { kind: "rd", label: "New RD" },
  { kind: "fd", label: "New FD" },
];

/**
 * One month split into the bands to draw: how tall each is, and where to write
 * its figure. A band with room takes the figure inside it; a sliver — ₹10,000
 * of renewal against a ₹3.3L month — has it written beside the bar instead,
 * level with the band, because inside there is nowhere for it to go.
 */
function bandsOf(month, top) {
  const parts = KINDS.map((one) => ({ ...one, value: month[one.kind] || 0 })).filter(
    (one) => one.value > 0
  );

  let base = 0;
  let lastOutside = -Infinity;

  return parts.map((part) => {
    const share = part.value / top;
    const middle = base + share / 2;
    base += share;
    const roomy = share >= ROOMY;
    // Two slivers stacked together would print their figures on top of one
    // another, so each one is nudged up until it clears the one below it.
    const at = roomy ? middle : Math.max(middle, lastOutside + APART);
    if (!roomy) lastOutside = at;
    return { ...part, share, roomy, at };
  });
}

/** "August 2026" → "Aug", and "Jan 26" when a new year starts, so a window that
    crosses December still reads correctly. */
function tick(month) {
  const name = String(month.label).slice(0, 3);
  return String(month.key).endsWith("-01") ? `${name} ${String(month.key).slice(2, 4)}` : name;
}

/**
 * One agent's months as stacked bars — renewal at the bottom, then new RD, then
 * new FD. Plain divs on purpose: no chart library, nothing to keep updated, and
 * it prints and scales like the rest of the page.
 *
 * Four things make a bar readable: the scale down the left, the quarter lines
 * behind it, the month's total written above it, and each band's own figure
 * written on the band. Resting on a month gives all of them in full rupees.
 * `max` is passed in from outside so every agent shares one scale and two of
 * them compare honestly.
 */
export default function AgentChart({ months, max, name }) {
  const top = max > 0 ? max : 1;
  // A screen reader gets everything the bars and the hover card carry.
  const label = `${name}, month by month: ${months
    .map((month) =>
      month.total > 0
        ? `${month.label}, renewal ₹${month.renewal || 0}, new RD ₹${month.rd || 0}, new FD ₹${
            month.fd || 0
          }, total ₹${month.total}`
        : `${month.label}, nothing reported`
    )
    .join("; ")}`;

  return (
    <div className="chart-wrap">
      <div className="plot">
        <div className="plot-scale" aria-hidden="true">
          <span>{short(top)}</span>
          <span>{short(top / 2)}</span>
          <span>0</span>
        </div>

        <div className="chart" role="img" aria-label={label}>
          {months.map((month) => {
            const bands = bandsOf(month, top);
            const slivers = bands.filter((band) => !band.roomy);

            return (
              <div className="chart-col" key={month.key}>
                <span className="chart-value">{month.total > 0 ? short(month.total) : ""}</span>

                <div className="chart-bar">
                  {bands.length === 0 ? (
                    <span className="seg seg-zero" />
                  ) : (
                    bands.map((band) => (
                      <span
                        key={band.kind}
                        className={`seg seg-${band.kind}`}
                        style={{ height: `${Math.max(2, band.share * 100)}%` }}
                      >
                        {band.roomy && <b className="seg-in">{short(band.value)}</b>}
                      </span>
                    ))
                  )}

                  {slivers.map((band) => (
                    <b
                      key={band.kind}
                      className={`seg-out c-${band.kind}`}
                      style={{ bottom: `${band.at * 100}%` }}
                    >
                      {short(band.value)}
                    </b>
                  ))}
                </div>

                <span className="chart-tick">{tick(month)}</span>

                {/* Rest on a month for the figures in full, to the rupee. */}
                <div className="tip" aria-hidden="true">
                  <b className="tip-head">{month.label}</b>
                  {KINDS.map((one) => (
                    <span className="tip-row" key={one.kind}>
                      <span className={`key key-${one.kind}`}>{one.label}</span>
                      <span className="tip-num">
                        {(month[one.kind] || 0) > 0
                          ? formatINR(String(month[one.kind]))
                          : "—"}
                      </span>
                    </span>
                  ))}
                  <span className="tip-row is-sum">
                    <span>Total</span>
                    <span className="tip-num">
                      {month.total > 0 ? formatINR(String(month.total)) : "nothing"}
                    </span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p className="legend">
        <span className="key key-renewal">Renewal</span>
        <span className="key key-rd">New RD</span>
        <span className="key key-fd">New FD</span>
      </p>
    </div>
  );
}
