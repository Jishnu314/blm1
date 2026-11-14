// Sample rows for the local demo file. Runs only when the register is empty.

import { openDb } from "./db.js";

const now = () => new Date().toISOString();

function nameKey(name) {
  return String(name).trim().toLowerCase().replace(/\s+/g, " ");
}

export function seedIfEmpty() {
  const database = openDb();
  const held = database.prepare("select count(*) as n from reports").get();
  if (Number(held?.n) > 0) return false;

  const at = now();
  const insertReport = database.prepare(
    `insert into reports (id, name, name_key, agent_id, month, renewal, submitted_at, edited_at, edited_in, deleted_at)
     values (@id, @name, @name_key, @agent_id, @month, @renewal, @submitted_at, null, '', null)`
  );
  const insertDeposit = database.prepare(
    `insert into deposits (report_id, kind, amount, scheme, position) values (?, ?, ?, ?, ?)`
  );
  const upsertSetting = database.prepare(
    `insert into settings (key, value, updated_at) values (?, ?, ?)
     on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at`
  );

  const agents = [
    { name: "Anil Kumar", agentId: "ANIL-10021" },
    { name: "Beena", agentId: "BEENA-10034" },
    { name: "Ramesh", agentId: "RAMESH-10088" },
  ];

  const reports = [
    { id: "demo-anil-2026-08", name: "Anil Kumar", agentId: "ANIL-10021", month: "2026-08", renewal: 42000, submitted: "2026-09-02T10:15:00.000Z", rd: [{ amount: 5000, scheme: "Sumangal" }], fd: [] },
    { id: "demo-beena-2026-08", name: "Beena", agentId: "BEENA-10034", month: "2026-08", renewal: 28000, submitted: "2026-09-03T08:40:00.000Z", rd: [], fd: [{ amount: 100000, scheme: "Bhagyalakshmi" }] },
    { id: "demo-ramesh-2026-08", name: "Ramesh", agentId: "RAMESH-10088", month: "2026-08", renewal: 15000, submitted: "2026-09-04T12:05:00.000Z", rd: [{ amount: 2000, scheme: "Jeevan Anand" }], fd: [] },
    { id: "demo-anil-2026-09", name: "Anil Kumar", agentId: "ANIL-10021", month: "2026-09", renewal: 51000, submitted: "2026-10-02T09:20:00.000Z", rd: [{ amount: 5000, scheme: "Sumangal" }, { amount: 3000, scheme: "New Money Back" }], fd: [] },
    { id: "demo-beena-2026-09", name: "Beena", agentId: "BEENA-10034", month: "2026-09", renewal: 31000, submitted: "2026-10-03T11:00:00.000Z", rd: [], fd: [] },
    { id: "demo-anil-2026-10", name: "Anil Kumar", agentId: "ANIL-10021", month: "2026-10", renewal: 39000, submitted: "2026-10-24T07:45:00.000Z", rd: [{ amount: 5000, scheme: "Sumangal" }], fd: [{ amount: 50000, scheme: "Bhima Deposit" }] },
    { id: "demo-ramesh-2026-10", name: "Ramesh", agentId: "RAMESH-10088", month: "2026-10", renewal: 22000, submitted: "2026-10-25T14:12:00.000Z", rd: [], fd: [] },
  ];

  const customers = [
    {
      id: "demo-c-1",
      name: "Lakshmi Nair",
      schemeName: "Sumangal",
      schemeType: "RD",
      paymentMode: "monthly",
      intervalMonths: 1,
      amount: 5000,
      periodYears: 5,
      joinedDate: "2026-04-01T00:00:00.000Z",
      expiryDate: "2031-04-01T00:00:00.000Z",
      claimedDate: null,
      paid: { "2026-Apr": true, "2026-May": true, "2026-Jun": true, "2026-Jul": true, "2026-Aug": true, "2026-Sep": true },
      edited: {},
    },
    {
      id: "demo-c-2",
      name: "Suresh Menon",
      schemeName: "Bhagyalakshmi",
      schemeType: "FD",
      paymentMode: "yearly",
      intervalMonths: 12,
      amount: 100000,
      periodYears: 3,
      joinedDate: "2026-08-01T00:00:00.000Z",
      expiryDate: "2029-08-01T00:00:00.000Z",
      claimedDate: null,
      paid: {},
      edited: {},
    },
    {
      id: "demo-c-3",
      name: "Priya Thomas",
      schemeName: "Jeevan Anand",
      schemeType: "RD",
      paymentMode: "monthly",
      intervalMonths: 1,
      amount: 2000,
      periodYears: 4,
      joinedDate: "2026-01-01T00:00:00.000Z",
      expiryDate: "2030-01-01T00:00:00.000Z",
      claimedDate: null,
      paid: { "2026-Jan": true, "2026-Feb": true, "2026-Mar": true, "2026-Apr": true },
      edited: {},
    },
  ];

  const agentIds = Object.fromEntries(agents.map((one) => [nameKey(one.name), [one.agentId]]));

  const write = database.transaction(() => {
    for (const row of reports) {
      insertReport.run({
        id: row.id,
        name: row.name,
        name_key: nameKey(row.name),
        agent_id: row.agentId,
        month: row.month,
        renewal: row.renewal,
        submitted_at: row.submitted,
      });
      row.rd.forEach((dep, index) => insertDeposit.run(row.id, "rd", dep.amount, dep.scheme, index));
      row.fd.forEach((dep, index) => insertDeposit.run(row.id, "fd", dep.amount, dep.scheme, index));
    }

    upsertSetting.run("agentIds", JSON.stringify(agentIds), at);
    upsertSetting.run("credit", "Jishnu · SLIA", at);
    upsertSetting.run("open", "true", at);
    upsertSetting.run("message", "Demo register — this SQLite file is only on this PC.", at);
    upsertSetting.run("boardOn", "true", at);
    upsertSetting.run("boardTitle", "Top performers (demo)", at);
    upsertSetting.run(
      "boardPlayers",
      JSON.stringify([
        { name: "Anil Kumar", points: 142000 },
        { name: "Beena", points: 131000 },
        { name: "Ramesh", points: 37000 },
      ]),
      at
    );

    database.prepare(
      `insert into customer_ledger (id, customers, updated_at) values (1, ?, ?)`
    ).run(JSON.stringify(customers), at);
  });

  write();
  return true;
}
