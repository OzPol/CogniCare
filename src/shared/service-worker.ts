/// <reference lib="webworker" />

declare const __COGNICARE_CACHE__: string;
const scope = globalThis as unknown as ServiceWorkerGlobalScope;
const cacheName = __COGNICARE_CACHE__;
const root = "/";
const installFiles = [
  "/manifest.webmanifest", "/lakeside.webp", "/lakeside-small.webp",
  "/icon-32.png", "/icon-180.png", "/icon-192.png", "/icon-512.png",
];

scope.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    const shell = await fetch(root, { cache: "reload", credentials: "omit" });
    if (!shell.ok || !shell.headers.get("content-type")?.includes("text/html")) throw new Error("Offline shell unavailable");
    const html = await shell.clone().text();
    const staticFiles = new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)].map((item) => item[1]));
    await cache.addAll([...installFiles, ...staticFiles]);
    await cache.put(root, shell);
    await scope.skipWaiting();
  })());
});

scope.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const existing = await caches.keys();
    await Promise.all(existing.filter((key) => key.startsWith("cognicare-shell-") && key !== cacheName).map((key) => caches.delete(key)));
    await scope.clients.claim();
  })());
});

scope.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== scope.location.origin) return;

  if (request.mode === "navigate" && url.pathname === root) {
    event.respondWith((async () => {
      try { return await fetch(request); }
      catch { return (await caches.match(root, { cacheName })) ?? Response.error(); }
    })());
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || installFiles.includes(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(cacheName);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && !response.redirected) await cache.put(request, response.clone());
      return response;
    })());
  }
});
