// Smoke test for the LOCAL TEST database API. Usage:
//   npm run demo            (in one terminal)
//   npm run smoke           (in another)
//
// It writes test reports, so it refuses to run against anything but this PC. It can
// never be pointed at the live Supabase register.

const base = (process.argv[2] || "http://localhost:8787").replace(/\/+$/, "");
const host = new URL(base).hostname;
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
  console.error(`Refusing to run against ${host}. This test only runs against the local test server.`);
  process.exit(2);
}
const password = process.env.ADMIN_PASSWORD || "demo-admin-10";

let failed = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`);
  if (!cond) failed += 1;
};
let token = "";
async function call(method, path, body, auth = true) {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(auth && token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  return { status: res.status, data };
}

const id = `smoke-${Date.now()}`;
const report = (extra = {}) => ({ report: { id, name: "Smoke Tester", month: "2026-10", renewal: 1200, rd: [{ amount: 500, scheme: "RD A" }], fd: [], ...extra } });

let r = await call("GET", "/api/health", undefined, false);
ok("health says this is the SQLite test database", r.data?.engine === "sqlite" && r.data?.database === true, JSON.stringify(r.data));

r = await call("GET", "/api/reports", undefined, false);
ok("reading reports needs sign-in", r.status === 401, r.status);

r = await call("POST", "/api/admin/login", { password: "wrong-password-x" }, false);
ok("wrong password is refused", r.status === 401, r.status);
r = await call("POST", "/api/admin/login", { password }, false);
token = r.data?.token || "";
ok("admin sign-in works", r.status === 200 && token.length > 20, r.status);

r = await call("POST", "/api/reports", report({ month: "2026-13" }), false);
ok("bad month is refused (400)", r.status === 400, r.status);
r = await call("POST", "/api/reports", report({ renewal: -5 }), false);
ok("negative amount is refused (400)", r.status === 400, r.status);

r = await call("POST", "/api/reports", report(), false);
ok("form can send a report (201 created)", r.status === 201 && r.data?.created === true, JSON.stringify(r.data));
r = await call("POST", "/api/reports", report(), false);
ok("sending the same id again is safe (200, not created)", r.status === 200 && r.data?.created === false, JSON.stringify(r.data));

r = await call("GET", "/api/reports?month=2026-10");
const mine = r.data?.reports?.find((x) => x.id === id);
ok("admin sees it with renewal and RD", mine?.renewal === 1200 && mine?.rd?.[0]?.amount === 500, JSON.stringify(mine));

r = await call("PUT", `/api/reports/${id}`, report({ renewal: 2500, rd: [], fd: [{ amount: 9000, scheme: "FD B" }] }));
ok("admin can correct it", r.status === 200 && r.data?.report?.renewal === 2500 && r.data?.report?.fd?.length === 1 && r.data?.report?.editedIn === "web", JSON.stringify(r.data));

r = await call("DELETE", `/api/reports/${id}`);
ok("admin can delete", r.status === 200, r.status);
r = await call("GET", "/api/reports?month=2026-10");
ok("deleted report is hidden", !r.data?.reports?.some((x) => x.id === id));
r = await call("GET", "/api/reports?includeDeleted=1");
ok("deleted report still exists when asked for", r.data?.reports?.some((x) => x.id === id));
r = await call("POST", `/api/reports/${id}/restore`);
ok("admin can restore it", r.status === 200 && !r.data?.report?.deletedAt, JSON.stringify(r.data));
await call("DELETE", `/api/reports/${id}`);

r = await call("GET", "/api/settings", undefined, false);
ok("form can read settings without signing in", r.status === 200 && typeof r.data?.settings?.open === "boolean");
r = await call("PUT", "/api/settings", { settings: { open: false } }, false);
ok("settings cannot be changed without sign-in", r.status === 401, r.status);
r = await call("PUT", "/api/settings", { settings: { open: false } });
ok("admin can close collection", r.status === 200 && r.data?.settings?.open === false);
r = await call("PUT", "/api/settings", { settings: { open: true } });
ok("admin can reopen collection", r.data?.settings?.open === true);
r = await call("PUT", "/api/settings", { settings: { nonsense: 1 } });
ok("unknown setting is refused (400)", r.status === 400, r.status);

const before = (await call("GET", "/api/settings", undefined, false)).data?.settings?.agentIds || "{}";
// Add to the IDs already applied: the server (rightly) refuses to drop any of them.
const existing = JSON.parse(before || "{}");
const roster = JSON.stringify({ ...existing, "smoke tester": ["SMK-1"] });
r = await call("PUT", "/api/settings", { settings: { agentIds: roster } });
ok("admin can assign an agent ID", r.status === 200, JSON.stringify(r.data));
const id2 = `${id}-b`;
r = await call("POST", "/api/reports", { report: { ...report().report, id: id2, agentId: "WRONG" } }, false);
ok("wrong agent ID is refused (400)", r.status === 400, r.status);
r = await call("POST", "/api/reports", { report: { ...report().report, id: id2 } }, false);
ok("single assigned ID is filled in automatically", r.status === 201 && r.data?.report?.agentId === "SMK-1", JSON.stringify(r.data));
r = await call("PUT", "/api/settings", { settings: { agentIds: before } });
ok("an applied agent ID cannot be removed (409)", r.status === 409, `${r.status} ${JSON.stringify(r.data)}`);
await call("DELETE", `/api/reports/${id2}`);

r = await call("PUT", "/api/admin/sheet", { url: "https://script.google.com/macros/s/AKfycbxTEST/exec" });
ok("test database refuses to connect to the live Google Sheet (409)", r.status === 409 && r.data?.error?.code === "not_available_in_demo", JSON.stringify(r.data));

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed. (Smoke rows were deleted again; roster/settings changes may remain: npm run demo:reset wipes them.)");
process.exit(failed ? 1 : 0);
