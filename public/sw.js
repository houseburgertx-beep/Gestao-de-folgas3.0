const CACHE_NAME = "house-folgas-v6.16.1";
const APP_BASE = new URL("./", self.location.href);
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest?v=6.16.1",
  "./apple-touch-icon-6.1.5.png",
  "./apple-touch-icon.png",
  "./icons/app-icon-192.png",
  "./icons/app-icon-512.png",
  "./icons/app-icon-maskable-512.png",
].map((path) => new URL(path, APP_BASE).href);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key.startsWith("house-folgas-") && key !== CACHE_NAME,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim())
      .then(async () => {
        const clients = await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });
        clients.forEach((client) =>
          client.postMessage({ type: "FORCE_UPDATE", version: "6.16.1" }),
        );
      }),
  );
});

const staleWhileRevalidate = async (request) => {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(async (response) => {
      if (response && response.ok) {
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);

  return cached || network;
};

const navigateHandler = async (request) => {
  const cache = await caches.open(CACHE_NAME);
  const cached =
    (await cache.match(request)) ||
    (await cache.match(new URL("./index.html", APP_BASE).href)) ||
    (await cache.match(new URL("./", APP_BASE).href));

  const network = fetch(request)
    .then(async (response) => {
      if (response && response.ok) {
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);

  return cached || network;
};

const cachedAsset = async (request) => {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(async (response) => {
      if (response.ok && response.type === "basic") {
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);
  return cached || network;
};

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const isGstaticFirebase =
    url.origin === "https://www.gstatic.com" &&
    url.pathname.includes("/firebasejs/");

  if (url.origin !== self.location.origin && !isGstaticFirebase) return;

  if (isGstaticFirebase) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(navigateHandler(request));
    return;
  }

  if (["script", "style"].includes(request.destination)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (["image", "font", "manifest"].includes(request.destination)) {
    event.respondWith(cachedAsset(request));
  }
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// Web Push works while the page is closed; no background timers are required.
self.addEventListener("push", event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { /* Always show a safe visible fallback. */ }
  const destination = new URL("./", APP_BASE);
  const viewMap = { timeclock: "timeclock", tasks: "tasks", timeoff: "timeoff", notifications: "notifications" };
  destination.searchParams.set("view", viewMap[data.view] || "notifications");
  event.waitUntil(self.registration.showNotification(String(data.title || "House 190"), {
    body: String(data.body || "Você tem um novo aviso no aplicativo."),
    icon: new URL("./icons/app-icon-192.png", APP_BASE).href,
    badge: new URL("./icons/app-icon-192.png", APP_BASE).href,
    tag: String(data.tag || "house-aviso"),
    vibrate: [200, 100, 200],
    renotify: true,
    data: { url: destination.href },
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "./", APP_BASE);
  if (target.origin !== APP_BASE.origin || !target.pathname.startsWith(APP_BASE.pathname)) return;
  event.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(async clients => {
    const existing = clients.find(client => new URL(client.url).pathname.startsWith(APP_BASE.pathname));
    if (existing) { existing.postMessage({type:"gestao-open-view",view:target.searchParams.get("view")}); return existing.focus(); }
    return self.clients.openWindow(target.href);
  }));
});
