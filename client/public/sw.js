// Bump this whenever the caching strategy below changes so the "activate"
// handler below cleans up the previous version's cache instead of leaving it
// around forever.
const APP_SHELL_CACHE = 'ruin-app-shell-v3'
// Every deploy adds new hashed assets/ files and nothing ever asks for the old
// ones again; past this many, the oldest are dropped.
const MAX_CACHED_ASSETS = 100

// Paths (relative to the worker's scope) that only exist on the Vite dev
// server. Its modules aren't content-hashed like a build's assets/, so the
// cache-first strategy below would keep serving the old code after every
// change - the app looked stuck on an old version until its site data was
// cleared by hand.
const DEV_SERVER_PATH_PREFIXES = ['src/', 'node_modules/', '@vite/', '@react-refresh', '@id/', '@fs/']

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys()
      await Promise.all(
        cacheNames.filter((name) => name.startsWith('ruin-app-shell-') && name !== APP_SHELL_CACHE).map((name) => caches.delete(name)),
      )
      await self.clients.claim()
    })(),
  )
})

// Only ever cache this app's own static frontend assets (JS/CSS bundles, the
// root HTML document, icons, manifest, ...). RPC calls and Storage requests
// go straight to Supabase and must never be served from - or written into -
// this cache: cached event/RSVP data would be actively misleading. Anything
// that isn't a plain same-origin GET (Supabase calls, third-party requests,
// POST/PATCH/DELETE, ...) is left completely untouched by not calling
// event.respondWith(), so the browser handles it exactly like it would with
// no service worker installed at all.
function getRelativePath(url) {
  const scopePath = new URL(self.registration.scope).pathname
  return url.pathname.startsWith(scopePath) ? url.pathname.slice(scopePath.length) : url.pathname
}

function isCacheableAppShellRequest(request) {
  if (request.method !== 'GET') {
    return false
  }

  const url = new URL(request.url)

  if (url.origin !== self.location.origin) {
    return false
  }

  const relativePath = getRelativePath(url)

  if (DEV_SERVER_PATH_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) {
    return false
  }

  return true
}

// Navigation requests (full page loads / reloads): try the network first so
// visitors always get the latest app shell when online, but fall back to
// whatever we last cached so a reload while offline still renders the app
// instead of the browser's default offline error page.
async function handleNavigationRequest(request) {
  const cache = await caches.open(APP_SHELL_CACHE)

  try {
    const networkResponse = await fetch(request)

    if (networkResponse && networkResponse.ok) {
      cache.put(request, networkResponse.clone())
    }

    return networkResponse
  } catch (networkError) {
    const cachedResponse = await cache.match(request)

    if (cachedResponse) {
      return cachedResponse
    }

    // Last resort: fall back to whatever we have cached for the app's root
    // document, since a deep-linked route (e.g. "/event/123") won't have its
    // own cache entry - it's the same index.html either way.
    const cachedRoot = await cache.match(self.registration.scope)

    if (cachedRoot) {
      return cachedRoot
    }

    throw networkError
  }
}

async function trimCachedAssets(cache) {
  const assetRequests = (await cache.keys()).filter((request) => getRelativePath(new URL(request.url)).startsWith('assets/'))
  // cache.keys() lists entries oldest first.
  await Promise.all(assetRequests.slice(0, -MAX_CACHED_ASSETS).map((request) => cache.delete(request)))
}

// Build output in assets/ (JS/CSS bundles) has a content hash in its name, so
// a cached copy can never be stale: serve it from cache when we have it (fast,
// works offline), otherwise fetch from the network and stash a copy.
async function handleHashedAssetRequest(request) {
  const cache = await caches.open(APP_SHELL_CACHE)
  const cachedResponse = await cache.match(request)

  if (cachedResponse) {
    return cachedResponse
  }

  const networkResponse = await fetch(request)

  if (networkResponse && networkResponse.ok) {
    await cache.put(request, networkResponse.clone())
    await trimCachedAssets(cache)
  }

  return networkResponse
}

// Everything else (manifest, icons, images, ...) keeps its name when it
// changes: answer from cache right away, but refresh the copy from the network
// in the background so the next load gets the new version.
async function handleStaticAssetRequest(event) {
  const { request } = event
  const cache = await caches.open(APP_SHELL_CACHE)
  const cachedResponse = await cache.match(request)
  const networkFetch = fetch(request).then((networkResponse) => {
    if (networkResponse && networkResponse.ok) {
      return cache.put(request, networkResponse.clone()).then(() => networkResponse)
    }

    return networkResponse
  })

  if (cachedResponse) {
    event.waitUntil(networkFetch.catch(() => {}))
    return cachedResponse
  }

  return networkFetch
}

self.addEventListener('fetch', (event) => {
  const { request } = event

  if (!isCacheableAppShellRequest(request)) {
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(request))
    return
  }

  if (getRelativePath(new URL(request.url)).startsWith('assets/')) {
    event.respondWith(handleHashedAssetRequest(request))
    return
  }

  event.respondWith(handleStaticAssetRequest(event))
})

// send-event-reminders sends title, body, url and tag.
self.addEventListener('push', (event) => {
  let data = {}

  try {
    data = event.data?.json() || {}
  } catch {
    // Not JSON - still show something, a push without a notification can get
    // the subscription revoked.
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'RUin?', {
      body: data.body || 'Máte novou notifikaci.',
      tag: data.tag || 'ruin-notification',
      icon: new URL('ruinfavicon/web-app-manifest-192x192.png', self.registration.scope).href,
      badge: new URL('ruinfavicon/favicon-96x96.png', self.registration.scope).href,
      data: { url: data.url || '#/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  const targetUrl = new URL(event.notification.data?.url || '#/', self.registration.scope)
  // Only ever open this app's own pages, whatever the payload says.
  const absoluteTargetUrl = targetUrl.origin === self.location.origin ? targetUrl.href : self.registration.scope

  event.notification.close()

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // A prefix match has to end at a path or query boundary, or
      // "#/event/abc" would also match another event "#/event/abcd".
      const focusedClient = clients.find(
        (client) =>
          client.url === absoluteTargetUrl || (client.url.startsWith(absoluteTargetUrl) && '/?'.includes(client.url[absoluteTargetUrl.length])),
      )

      if (focusedClient) {
        return focusedClient.focus()
      }

      return self.clients.openWindow(absoluteTargetUrl)
    }),
  )
})
