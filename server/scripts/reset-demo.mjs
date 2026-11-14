import fs from "node:fs";
import { config } from "../src/config.js";
import { closeDb, migrate } from "../src/db.js";
import { seedIfEmpty } from "../src/seed.js";
import { bootstrapAdmin } from "../src/auth.js";

closeDb();
if (fs.existsSync(config.sqlitePath)) fs.unlinkSync(config.sqlitePath);
const wal = `${config.sqlitePath}-wal`;
const shm = `${config.sqlitePath}-shm`;
if (fs.existsSync(wal)) fs.unlinkSync(wal);
if (fs.existsSync(shm)) fs.unlinkSync(shm);

await migrate();
seedIfEmpty();
await bootstrapAdmin();
closeDb();
console.log(`Demo database reset at ${config.sqlitePath}`);
