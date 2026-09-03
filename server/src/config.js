// Every environment variable this server reads, read once, here.
//
// One place, so there is one answer to "what does this need to run" and no module
// further down can quietly start depending on a variable nobody documented. A
// missing DATABASE_URL is fatal and says so in plain English — the alternative is
// a connection error forty lines into a stack trace at three in the morning.
//
// There is no dotenv. `npm run dev` uses `node --env-file=.env`, which is Node's
// own (20.6+), and on Render the variables come from the dashboard.

function text(name, fallback = "") {
  const value = process.env[name];
  return value === undefined || value === null ? fallback : String(value).trim();
}

function truthy(name) {
  const said = text(name).toLowerCase();
  return said === "1" || said === "true" || said === "yes" || said === "on";
}

function required(name, why) {
  const value = text(name);
  if (value !== "") return value;
  // Printed as well as thrown: the throw stops the boot, the print is the bit a
  // human is meant to read.
  console.error(`\n${name} is not set.\n\n${why}\n`);
  throw new Error(`${name} is not set`);
}

/**
 * Whether to speak TLS to the database, and how carefully.
 *
 * `auto` means: a database anywhere other than this machine is reached across the
 * internet, so TLS is on. Render's and Supabase's certificates are not signed by
 * anything in Node's trust store, so verification is off — that stops somebody
 * reading the connection, not somebody who can already stand in the middle of it.
 * If your provider gives you a CA file, `require` plus a real ca is the better
 * answer and belongs here.
 */
function sslFor(url, mode) {
  if (mode === "off") return false;
  if (mode === "require") return { rejectUnauthorized: false };

  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    // A password with punctuation in it can defeat the URL parser. Assume remote,
    // which is the safer of the two guesses; DATABASE_SSL=off overrides it.
    return { rejectUnauthorized: false };
  }
  const here = host === "" || host === "localhost" || host === "127.0.0.1" || host === "::1";
  return here ? false : { rejectUnauthorized: false };
}

/**
 * The port to listen on.
 *
 * 8787 rather than 3000 on purpose: 3000 is what every other Node thing on a
 * developer's machine grabs, and the number has to match the one Vite proxies to
 * in vite.config.js. Render sets PORT itself and this default is ignored there.
 */
function port() {
  const asked = Number(text("PORT", "8787"));
  if (Number.isInteger(asked) && asked > 0 && asked < 65536) return asked;
  console.warn(`PORT is not a usable port number, so 8787 is being used instead.`);
  return 8787;
}

const databaseUrl = required(
  "DATABASE_URL",
  [
    "The server keeps the register in Postgres, so it needs to know where that is.",
    "Copy server/.env.example to server/.env and put your connection string in it:",
    "",
    "  DATABASE_URL=postgres://user:password@localhost:5432/renewal_register",
    "",
    "On Render, set it in the service's Environment tab instead.",
  ].join("\n")
);

const nodeEnv = text("NODE_ENV", "development");

export const config = {
  databaseUrl,
  ssl: sslFor(databaseUrl, text("DATABASE_SSL", "auto").toLowerCase()),
  port: port(),
  nodeEnv,
  isProduction: nodeEnv === "production",
  // Only ever used to create the account the first time. Never compared against.
  adminPassword: text("ADMIN_PASSWORD"),
  // Empty means there is no sheet copy: nothing is queued and nothing is owed.
  sheetWebhookUrl: text("SHEET_WEBHOOK_URL"),
  trustProxy: truthy("TRUST_PROXY"),
};
