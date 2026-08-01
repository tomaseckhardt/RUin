// Bump this whenever the caching strategy below changes so the "activate"
// handler below cleans up the previous version's cache instead of leaving it
// around forever.
const APP_SHELL_CACHE = "ruin-app-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((name) => name.startsWith("ruin-app-shell-") && name !== APP_SHELL_CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

// Only ever cache this app's own static frontend assets (JS/CSS bundles, the
// root HTML document, icons, manifest, ...). RPC calls and Storage requests
// go straight to Supabase and must never be served from - or written into -
// this cache: cached event/RSVP data would be actively misleading. Anything
// that isn't a plain same-origin GET (Supabase calls, third-party requests,
// POST/PATCH/DELETE, ...) is left completely untouched by not calling
// event.respondWith(), so the browser handles it exactly like it would with
// no service worker installed at all.
function isCacheableAppShellRequest(request) {
  if (request.method !== "GET") {
    return false;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return false;
  }

  // Belt-and-braces: never cache anything under a supabase.co host, even if
  // it somehow shared this origin (e.g. a same-origin dev proxy rewrite).
  if (url.hostname.endsWith("supabase.co")) {
    return false;
  }

  return true;
}

// Navigation requests (full page loads / reloads): try the network first so
// visitors always get the latest app shell when online, but fall back to
// whatever we last cached so a reload while offline still renders the app
// instead of the browser's default offline error page.
async function handleNavigationRequest(request) {
  const cache = await caches.open(APP_SHELL_CACHE);

  try {
    const networkResponse = await fetch(request);

    if (networkResponse && networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (networkError) {
    const cachedResponse = await cache.match(request);

    if (cachedResponse) {
      return cachedResponse;
    }

    // Last resort: fall back to whatever we have cached for the app's root
    // document, since a deep-linked route (e.g. "/event/123") won't have its
    // own cache entry - it's the same index.html either way.
    const cachedRoot = await cache.match(self.registration.scope);

    if (cachedRoot) {
      return cachedRoot;
    }

    throw networkError;
  }
}

// Other static assets (JS/CSS bundles, icons, manifest, ...): serve from
// cache immediately when we have it (fast, works offline), otherwise fetch
// from the network and stash a copy for next time.
async function handleStaticAssetRequest(request) {
  const cache = await caches.open(APP_SHELL_CACHE);
  const cachedResponse = await cache.match(request);

  if (cachedResponse) {
    return cachedResponse;
  }

  const networkResponse = await fetch(request);

  if (networkResponse && networkResponse.ok) {
    cache.put(request, networkResponse.clone());
  }

  return networkResponse;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (!isCacheableAppShellRequest(request)) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(handleNavigationRequest(request));
    return;
  }

  event.respondWith(handleStaticAssetRequest(request));
});

function pickNotificationData(eventData) {
  const scopedIconUrl = new URL(
    "ruinfavicon/web-app-manifest-192x192.png",
    self.registration.scope,
  ).href;
  const scopedBadgeUrl = new URL(
    "ruinfavicon/favicon-96x96.png",
    self.registration.scope,
  ).href;

  if (!eventData || typeof eventData !== "object") {
    return {
      title: "RUin?",
      body: "Máte novou notifikaci.",
      url: "#/",
      icon: scopedIconUrl,
      badge: scopedBadgeUrl,
    };
  }

  return {
    title: eventData.title || "RUin?",
    body: eventData.body || "Máte novou notifikaci.",
    url: eventData.url || "#/",
    tag: eventData.tag || "ruin-notification",
    icon: eventData.icon || scopedIconUrl,
    badge: eventData.badge || scopedBadgeUrl,
  };
}

self.addEventListener("push", (event) => {
  const payload = event.data ? event.data.json() : null;
  const notification = pickNotificationData(payload);

  event.waitUntil(
    self.registration.showNotification(notification.title, {
      body: notification.body,
      tag: notification.tag,
      icon: notification.icon,
      badge: notification.badge,
      data: {
        url: notification.url,
      },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  const targetUrl = event.notification.data?.url || "#/";
  const absoluteTargetUrl = new URL(targetUrl, self.registration.scope).href;

  event.notification.close();

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const focusedClient = clients.find(
          (client) =>
            client.url === absoluteTargetUrl ||
            client.url.startsWith(absoluteTargetUrl),
        );

        if (focusedClient) {
          return focusedClient.focus();
        }

        return self.clients.openWindow(absoluteTargetUrl);
      }),
  );
});
