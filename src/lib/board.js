// The game board: who is winning this month.
//
// The names and the points are typed by hand in the admin — they are NOT worked
// out from the reports. That is deliberate: jishn wants to decide what the board
// says, the same way the FORM app's board works. So everything here is about
// reading a hand-typed list kindly and ranking it fairly, never about arithmetic
// on anybody's figures.
//
// Because the list is hand-typed it rides along in the settings, which already
// travel to every phone through the sheet. No new endpoint, nothing to compute.

/** A row an admin started and abandoned — dropped without complaint. */
const named = (player) => String(player?.name || "").trim() !== "";

/** "12,000" and " 45 " are 12000 and 45; "" and "abc" are zero, never NaN. */
function points(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  const found = Number(digits);
  return Number.isFinite(found) ? found : 0;
}

/**
 * Read the players out of whatever the settings hold: an array (this device) or
 * a JSON string (a sheet cell). Anything unreadable is an empty board, never a
 * crash — a broken cell must not take the form down with it.
 */
export function parsePlayers(raw) {
  let list = raw;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (text === "") return [];
    try {
      list = JSON.parse(text);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list
    .filter((one) => one && typeof one === "object" && named(one))
    .map((one) => ({
      name: String(one.name).trim(),
      // "score" is what the FORM app called it; accept either spelling.
      points: points(one.points !== undefined ? one.points : one.score),
    }));
}

/** The players as the settings should carry them. */
export function serialisePlayers(players = []) {
  return JSON.stringify(
    parsePlayers(players).map((one) => ({ name: one.name, points: one.points }))
  );
}

const MEDALS = ["gold", "silver", "bronze"];

/**
 * Rank them: most points first, and equal points share a place.
 *
 * Competition ranking, so two people tied at the top are both 1st and the next
 * one is 3rd — nobody is quietly demoted for having drawn. A shared place is
 * marked `draw`, which is what the board prints instead of a bare number.
 *
 * Equal scores are then listed A to Z: the order has to come from somewhere, and
 * alphabetical is the one order nobody can read as a judgement.
 */
export function rankPlayers(raw) {
  const players = parsePlayers(raw);
  players.sort((one, two) => two.points - one.points || one.name.localeCompare(two.name));

  return players.map((player, index) => {
    // The place is this player's position, unless someone above has the same
    // points — then it is that first equal player's place.
    let place = index + 1;
    for (let above = 0; above < index; above += 1) {
      if (players[above].points === player.points) {
        place = above + 1;
        break;
      }
    }
    const draw = players.some((other, at) => at !== index && other.points === player.points);
    return {
      ...player,
      place,
      draw,
      // Medals go by place, so a two-way tie for first takes both golds and
      // nobody gets the silver. That is how a real standing works.
      medal: MEDALS[place - 1] || "",
    };
  });
}

/**
 * The three that go on the podium, and everyone else.
 *
 * By position in the list, not by place: two players drawing for first are still
 * only two of the three podium spots.
 */
export function splitBoard(ranked = []) {
  return { top: ranked.slice(0, 3), rest: ranked.slice(3) };
}

/**
 * The podium, read left to right: second, first, third — the winner in the
 * middle, standing highest. A board with one or two names just leans left.
 */
export function podiumOrder(top = []) {
  if (top.length < 3) return top;
  return [top[1], top[0], top[2]];
}

/** Nothing to show is not the same as switched off, but it looks the same. */
export function boardLive(settings = {}) {
  return Boolean(settings.boardOn) && parsePlayers(settings.boardPlayers).length > 0;
}

/** What the admin's status line says. */
export function boardState(settings = {}) {
  if (!settings.boardOn) return "off";
  return parsePlayers(settings.boardPlayers).length === 0 ? "empty" : "live";
}

/** The heading over the board, with a sensible fallback. */
export function boardTitle(settings = {}) {
  const typed = String(settings.boardTitle || "").trim();
  return typed === "" ? "Top performers" : typed;
}
