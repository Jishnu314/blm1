import { ENV } from "../lib/environment.js";

const ADMIN_PAGES = [
  { id: "register", label: "Overview" },
  { id: "customers", label: "Customers" },
  { id: "reports", label: "Reports" },
  { id: "settings", label: "Settings" },
];

export function AdminNavigation({ activeTab, onSelect }) {
  return (
    <nav className="admin-nav" aria-label="Admin pages">
      {ADMIN_PAGES.map((page) => (
        <button
          key={page.id}
          type="button"
          className={`admin-nav-button${activeTab === page.id ? " is-active" : ""}`}
          aria-current={activeTab === page.id ? "page" : undefined}
          onClick={() => onSelect(page.id)}
        >
          {page.label}
        </button>
      ))}
    </nav>
  );
}

export function AdminTopbar({ onSignOut, onHome }) {
  return (
    <div className="admin-topbar">
      <button type="button" className="admin-brand" onClick={onHome} aria-label="Go to overview">
        <span className="admin-brand-mark" aria-hidden="true">
          MR
        </span>
        <span>
          <strong>Monthly Reports</strong>
          <small>{ENV.topbarNote}</small>
        </span>
      </button>
      <button type="button" className="admin-signout" onClick={onSignOut}>
        Sign out
      </button>
    </div>
  );
}
