// Keep the app shell available offline and make installable on supported browsers.
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  window.addEventListener("load", () => {
    const appBase = new URL(import.meta.env.BASE_URL, location.origin);
    navigator.serviceWorker.register(new URL("sw.js", appBase), { scope: appBase.pathname }).catch(() => {});
  }, { once: true });
}
