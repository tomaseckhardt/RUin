self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
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
