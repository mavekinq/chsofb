/// <reference lib="webworker" />

import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<unknown>;
};

type PushPayload = {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
};

self.skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

self.addEventListener("push", (event) => {
  const payload = (() => {
    try {
      return (event.data?.json() || {}) as PushPayload;
    } catch {
      return {
        body: event.data?.text(),
      } as PushPayload;
    }
  })();

  const title = payload.title || "Wheelie Watch Pro";
  const body = payload.body || "Yeni bir operasyon bildirimi var.";
  const url = payload.url || "/wheelchair-services";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/celebi-logo.png",
      badge: "/celebi-logo.png",
      tag: payload.tag || "wheelie-watch-push",
      data: { url },
      renotify: true,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const rawUrl = typeof event.notification.data?.url === "string"
    ? event.notification.data.url
    : "/wheelchair-services";
  const targetUrl = new URL(rawUrl, self.location.origin).toString();

  event.waitUntil((async () => {
    const windowClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

    for (const client of windowClients) {
      const windowClient = client as WindowClient;
      const clientUrl = new URL(windowClient.url);

      if (clientUrl.origin !== self.location.origin) {
        continue;
      }

      if ("focus" in windowClient) {
        await windowClient.focus();
      }

      if ("navigate" in windowClient) {
        await windowClient.navigate(targetUrl);
      }

      return;
    }

    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});