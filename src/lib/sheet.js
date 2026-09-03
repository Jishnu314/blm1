// Gone. The address, the errors and the fetch wrapper all live in api.js now.
//
// This file should have been deleted outright; it is kept only because the tools
// used for this change could not remove a file, and an import left pointing at a
// missing module is a worse failure than one pointing at a redirection. Nothing
// in src/ imports it any more — WEBHOOK_URL and isSheetConnected do not exist,
// because there is always a server now and "is it working?" is a fact about the
// last call rather than about the build. Delete this file when you next touch the
// folder.

export * from "./api.js";
