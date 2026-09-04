import { formatINR } from "../lib/currency.js";

/** 1,25,000 → "1.3L". Enough to read a bar at a glance without crowding it. */
const round = (value) => (value >= 10 ? Math.round(value) : Math.round(value * 10) / 10);
function short(value) {
  if (value >= 10000000) return `${round(value / 10000000)}cr`;
  if (value >= 100000) return `${round(value / 100000)}L`;
  if (value >= 1000) return `${round(value / 1000)}k`;
  return String(Math.round(value));
}

/** A bar at least this tall can hold its own figure inside its top — the bar
    area is about 152px, so 12% is roughly 18px against 9px of type. A shorter
    bar writes its figure just above itself instead. */
const INSIDE = 0.12;

/** The shortest a bar is drawn once anything was collected. ₹13,000 of renewal
    against a ₹3.7L scale is a third of a pixel, and "a little came in" is worth
    more on this screen than a truthful third of a pixel — the figure written
    with the bar is exact either way. A scheme that collected *nothing* is a grey
    hairline instead, so none is never read as a little. */
const FLOOR = "6px";

/** Left to right, the same order and the same names as everywhere else. */
const KINDS = [
  { kind: "renewal", label: "Renewal" },
  { kind: "rd", label: "New RD" },
  { kind: "fd", label: "New FD" },
];

/**
 * One month as three bars: how tall each is drawn, and where its figure goes.
 *
 * The height is a CSS `max()` rather than a number, so a bar keeps its true
 * place on the scale while the floor under it stays a pixel count whatever size
 * the chart ends up.
 */
function barsOf(month, top) {
  return KINDS.map((one) => {
    const value = month[one.kind] || 0;
    const share = value / top;
    return {
      ...one,
      value,
      height: `max(${FLOOR}, ${(share * 100).toFixed(2)}%)`,
      inside: share >= INSIDE,
    };
  });
}

/** "August 2026" → "Aug", and "Jan 26" when a new year starts, so a window that
    crosses December still reads correctly. */
function tick(month) {
  const name = String(month.label).slice(0, 3);
  return String(month.key).endsWith("-01") ? `${name} ${String(month.key).slice(2, 4)}` : name;
}

/**
 * A list of months as bars. Each month is a slot with three bars standing side by
 * side in it — renewal, then new RD, then new FD, the order the legend reads.
 * Plain divs on purpose: no chart library, nothing to keep updated, and it prints
 * and scales like the rest of the page.
 *
 * The months can be one agent's or every agent added together — the register
 * draws its own six months with this same component, so there is only ever one
 * way a month is drawn on this page. `name` only names what is being charted, for
 * anyone reading the page with a screen reader.
 *
 * The three used to be stacked in a single bar per month, until ₹13,000 of
 * renewal against a ₹3.7L month showed what that costs: the band was a hairline,
 * its figure had to be written beside the bar, and beside the *last* month means
 * beside the month before it. Side by side, every figure sits over the bar it
 * belongs to, and the schemes compare with each other as well as the months do.
 *
 * Four things make a month readable: the scale down the left, the quarter lines
 * behind it, the month's total written above the slot, and each bar's own figure
 * — inside the bar when it is tall enough to hold it, just above the bar when it
 * is not. Resting on a month gives all of them in full rupees. `max` is passed
 * in from outside, and is the tallest single bar rather than the tallest month,
 * so every agent shares one scale and two of them compare honestly.
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
            const bars = barsOf(month, top);

            return (
              <div className="chart-col" key={month.key}>
                <span className="chart-value">{month.total > 0 ? short(month.total) : ""}</span>

                {/* The month's own slot: one box, three bars standing in it. */}
                <div className="chart-group">
                  {bars.map((bar) => (
                    <div className="gslot" key={bar.kind}>
                      {bar.value > 0 ? (
                        <>
                          <span
                            className={`gbar gbar-${bar.kind}`}
                            style={{ height: bar.height }}
                          />
                          <b
                            className={bar.inside ? "gfig gfig-in" : `gfig c-${bar.kind}`}
                            style={{
                              bottom: bar.inside
                                ? `calc(${bar.height} - 13px)`
                                : `calc(${bar.height} + 4px)`,
                            }}
                          >
                            {short(bar.value)}
                          </b>
                        </>
                      ) : (
                        <span className="gbar gbar-nil" />
                      )}
                    </div>
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

      <p className="chart-legend">
        <span className="key key-renewal">Renewal</span>
        <span className="key key-rd">New RD</span>
        <span className="key key-fd">New FD</span>
      </p>
    </div>
  );
}
