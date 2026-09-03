// A 10ms buzz on each key press makes a glass keypad feel like real buttons.
// Unsupported on iOS Safari and inside some in-app browsers, so it is a bonus,
// never the only feedback (the keys also visibly depress).

export function tick(ms = 10) {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(ms);
    }
  } catch {
    // Some browsers throw when vibration is blocked by policy — ignore.
  }
}

export function thud() {
  tick(18);
}
