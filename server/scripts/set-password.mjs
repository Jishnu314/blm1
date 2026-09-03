// Set the admin password from the command line.
//
//   node --env-file=.env scripts/set-password.mjs "a long one you will remember"
//   npm run set-password -- "a long one you will remember"
//
// This is the way in when there is no admin account yet and ADMIN_PASSWORD was never
// set, and the way back when the password has been forgotten. It writes the one row in
// admin_account, replacing whatever was there.
//
// It does NOT sign other devices out — POST /api/admin/password does that, because
// there the caller has proved they are the admin. Somebody at the console does not need
// to be told who else is signed in.
//
// The password is on the command line, so it is in your shell history. On a machine you
// share, change it again from the admin page afterwards.

import { migrate, pool } from "../src/db.js";
import { setPassword } from "../src/auth.js";

const password = process.argv[2];

if (!password) {
  console.error(
    'Say what the password should be:\n\n  npm run set-password -- "a long one you will remember"\n'
  );
  process.exit(1);
}

if (password.length < 10) {
  console.error("Use at least 10 characters. This is the only lock on the register.\n");
  process.exit(1);
}

try {
  // So this works on a database the server has never started against.
  await migrate();
  await setPassword(password);
  console.log("The admin password is set. Sessions that were already open still work.");
} catch (problem) {
  console.error("Could not set the password:", problem.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
