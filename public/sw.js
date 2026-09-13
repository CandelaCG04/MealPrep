// Minimal service worker: makes the app installable and shows a friendly
// offline page instead of the browser error. Data always comes from the network.
const OFFLINE_HTML = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline</title><body style="font-family:system-ui;padding:2rem;background:#f7f5f0;color:#1d1b16">
<h1>You're offline</h1><p>MealPrep needs a connection to load your pantry. Try again when you're back online.</p></body>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(
      () => new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } }),
    ),
  );
});
