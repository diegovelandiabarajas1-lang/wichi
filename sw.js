'use strict';
// Service worker de la PWA de Wichi: guarda lo básico para abrir sin conexión y NUNCA toca las llamadas al servidor (API).
const VERSION = 'wichi-pwa-0.7.0-3';
const BASICO = ['./', 'index.html', 'tema.css', 'app.css', 'app.js', 'actividad.js', 'funciones.js', 'acciones.js', 'voz.js', 'shell.js', 'guias.js', 'qr.js', 'spotify.js', 'manifest.webmanifest', 'icons/ico-agente.svg', 'icons/ico-ajustes.svg', 'icons/ico-alerta.svg', 'icons/ico-auto.svg', 'icons/ico-borrar.svg', 'icons/ico-build.svg', 'icons/ico-buscar.svg', 'icons/ico-carpeta.svg', 'icons/ico-compilar.svg', 'icons/ico-ejecutar.svg', 'icons/ico-equipo.svg', 'icons/ico-escribir.svg', 'icons/ico-guardar.svg', 'icons/ico-instalar.svg', 'icons/ico-leer.svg', 'icons/ico-mensaje.svg', 'icons/ico-modelo.svg', 'icons/ico-nube.svg', 'icons/ico-otro.svg', 'icons/ico-pantalla.svg', 'icons/ico-pensar.svg', 'icons/ico-plan.svg', 'icons/ico-probar.svg', 'icons/ico-resumen.svg', 'icons/ico-servidor.svg', 'icons/ico-tecnico.svg', 'icons/ico-volver.svg', 'icons/ico-web.svg', 'icons/icon-192.png', 'icons/apple-touch-icon.png', 'icons/wichi-w.png', 'icons/logo-wichi.png', 'icons/btn-enviar.png', 'icons/clip.svg', 'icons/mic.svg', 'icons/icono-historial.png', 'icons/icono-consumo.png', 'icons/icono-render.png', 'icons/icono-vps.png'];

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
