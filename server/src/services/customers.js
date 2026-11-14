import { query } from "../db.js";
import { nowIso } from "../lib/time.js";
import { enqueue, kick } from "./mirror.js";

const EMPTY = [];

export async function readCustomers() {
  const { rows } = await query(`select customers from customer_ledger where id = 1`);
  if (rows.length === 0) return EMPTY;
  try {
    const parsed = JSON.parse(rows[0].customers || "[]");
    return Array.isArray(parsed) ? parsed : EMPTY;
  } catch {
    return EMPTY;
  }
}

export async function writeCustomers(customers) {
  const at = nowIso();
  const payload = JSON.stringify(customers);
  await query(
    `insert into customer_ledger (id, customers, updated_at)
          values (1, $1, $2)
     on conflict (id) do update
             set customers = excluded.customers,
                 updated_at = excluded.updated_at`,
    [payload, at]
  );
  await enqueue({ query }, "settings", "customers", payload);
  kick();
  return customers;
}
