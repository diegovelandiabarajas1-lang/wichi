'use strict';
// Service worker de la PWA de Wichi: guarda lo básico para abrir sin conexión y NUNCA toca las llamadas al servidor (API).
const VERSION = 'wichi-pwa-0.6.1-1';
const BASICO = ['./', 'index.html', 'tema.css', 'app.css', 'app.js', 'funciones.js', 'acciones.js', 'voz.js', 'shell.js', 'guias.js', 'qr.js', 'spotify.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/apple-touch-icon.png', 'icons/wichi-w.png', 'icons/logo-wichi.png', 'icons/btn-enviar.png', 'icons/clip.svg', 'icons/mic.svg', 'icons/icono-historial.png', 'icons/icono-consumo.png', 'icons/icono-render.png', 'icons/icono-vps.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(BASICO)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // el servidor del usuario va directo
  // Primero la red (así llegan las versiones nuevas); sin red, lo guardado.
  e.respondWith(
    fetch(req).then((res) => {
      const copia = res.clone();
      caches.open(VERSION).then((c) => c.put(req, copia)).catch(() => {});
      return res;
    }).catch(() => caches.match(req).then((r) => r || caches.match('index.html')))
  );
});
