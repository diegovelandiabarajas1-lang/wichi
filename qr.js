/* QR de conexión de Wichi: mostrar el QR de una cuenta y escanear el de otra.
   Mismo enlace que el APK: opencodemovil://conectar?u=…&p=…&n=…&k=<cowork|vps>&w=<usuario>
   Necesita (globales de app.js, solo al escanear): Cuentas, conectar, toast. Librerías perezosas: lib/qrcode.min.js, lib/jsQR.min.js. */
(function () {
  'use strict';

  var ESQUEMA = 'opencodemovil://conectar?';

  /* ───────────── parte pura ───────────── */
  function enlaceDeCuenta(c) {
    var k = c && c.kind === 'cowork' ? 'cowork' : 'vps'; // 'local' (antiguo «Mi PC») y 'vps' se exportan como vps
    var user = (c && c.user) || 'opencode';
    return ESQUEMA + 'u=' + encodeURIComponent((c && c.url) || '') + '&p=' + encodeURIComponent((c && c.password) || '') +
      '&n=' + encodeURIComponent((c && c.name) || '') + '&k=' + k +
      (user !== 'opencode' ? '&w=' + encodeURIComponent(user) : '');
  }

  function parseEnlace(texto) {
    if (typeof texto !== 'string') return null;
    var t = texto.trim();
    var consulta = null;
    if (t.toLowerCase().indexOf(ESQUEMA) === 0) consulta = t.slice(ESQUEMA.length);
    else {
      var i = t.indexOf('#conectar?');
      if (i === 0 || (i > 0 && /^https?:\/\//i.test(t))) consulta = t.slice(i + '#conectar?'.length);
    }
    if (consulta === null) return null;
    var q;
    try { q = new URLSearchParams(consulta); } catch (e) { return null; }
    var u = q.get('u'); var p = q.get('p');
    if (!u || p === null) return null;
    var k = q.get('k');
    return { u: u, p: p, n: q.get('n') || '', k: k === 'cowork' ? 'cowork' : 'vps', w: q.get('w') || '' };
  }

  /* ───────────── carga perezosa de librerías ───────────── */
  var cargas = {};
  function cargar(ruta) {
    if (cargas[ruta]) return cargas[ruta];
    cargas[ruta] = new Promise(function (ok, mal) {
      var s = document.createElement('script');
      s.src = ruta;
      s.onload = function () { ok(); };
      s.onerror = function () { delete cargas[ruta]; mal(new Error('No se pudo cargar ' + ruta)); };
      document.head.appendChild(s);
    });
    return cargas[ruta];
  }

  /* ───────────── interfaz ───────────── */
  var CSS = [
    '#dlg-qr{border:1px solid var(--borde,#34373C);border-radius:24px;background:var(--panel,#1B1C1F);color:var(--texto,#E6E7EA);padding:22px;max-width:min(92vw,360px);width:100%}',
    '#dlg-qr::backdrop{background:rgba(0,0,0,.6)}',
    '#dlg-qr h2{margin:0 0 14px;font-size:20px;font-weight:500}',
    '#dlg-qr .qr-lienzo{display:block;width:280px;max-width:100%;aspect-ratio:1;margin:0 auto 14px;border-radius:12px;background:#fff;image-rendering:pixelated}',
    '#dlg-qr p{margin:0 0 8px;font-size:14px;line-height:1.4}',
    '#dlg-qr p.aviso{font-size:13px;color:var(--suave,#A3A7AE)}',
    '#dlg-qr .qr-botones{display:flex;gap:8px;justify-content:flex-end;margin-top:14px;flex-wrap:wrap}',
    '#qr-escaner{position:fixed;inset:0;z-index:100000;background:#000;color:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden}',
    '#qr-escaner video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}',
    '#qr-escaner .qr-guia{position:relative;width:min(68vw,300px);aspect-ratio:1;border:3px solid rgba(255,255,255,.9);border-radius:20px;box-shadow:0 0 0 100vmax rgba(0,0,0,.45)}',
    '#qr-escaner .qr-texto{position:absolute;left:16px;right:16px;bottom:calc(env(safe-area-inset-bottom,0px) + 36px);text-align:center;font-size:16px;text-shadow:0 1px 4px #000}',
    '#qr-escaner .qr-error{position:absolute;left:24px;right:24px;top:50%;transform:translateY(-50%);text-align:center;font-size:16px;line-height:1.5}',
    '#qr-escaner .qr-cerrar{position:absolute;top:calc(env(safe-area-inset-top,0px) + 12px);right:12px;z-index:2;background:rgba(30,30,30,.8);color:#fff}'
  ].join('\n');

  function estilos() {
    if (document.getElementById('qr-estilos')) return;
    var st = document.createElement('style'); st.id = 'qr-estilos'; st.textContent = CSS;
    document.head.appendChild(st);
  }
  function el(tag, cls, texto) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (texto !== undefined) e.textContent = texto;
    return e;
  }
  function avisar(t) { if (typeof toast === 'function') toast(t); }

  function dibujarQr(canvas, texto) {
    var qr = window.qrcode(0, 'M');
    qr.addData(texto);
    qr.make();
    var n = qr.getModuleCount(); var m = 4; var lado = n + 2 * m;
    canvas.width = lado; canvas.height = lado;
    var g = canvas.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, lado, lado);
    g.fillStyle = '#000';
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect(c + m, r + m, 1, 1);
  }

  function copiar(texto) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(texto);
    return new Promise(function (ok, mal) {
      var ta = document.createElement('textarea');
      ta.value = texto; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;opacity:0';
      document.body.appendChild(ta); ta.select();
      var bien = false;
      try { bien = document.execCommand('copy'); } catch (e) { bien = false; }
      document.body.removeChild(ta);
      bien ? ok() : mal(new Error('copiar'));
    });
  }

  function mostrarCuenta(cuenta) {
    estilos();
    var enlace = enlaceDeCuenta(cuenta);
    var dlg = document.getElementById('dlg-qr');
    if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'dlg-qr'; document.body.appendChild(dlg); }
    while (dlg.firstChild) dlg.removeChild(dlg.firstChild);
    dlg.appendChild(el('h2', '', 'Compartir «' + cuenta.name + '»'));
    var lienzo = el('canvas', 'qr-lienzo');
    lienzo.setAttribute('role', 'img');
    lienzo.setAttribute('aria-label', 'Código QR de ' + cuenta.name);
    dlg.appendChild(lienzo);
    dlg.appendChild(el('p', '', 'En el otro teléfono: abre Wichi, «Escanear QR de conexión» y apunta a este código.'));
    dlg.appendChild(el('p', 'aviso', 'Este código incluye la contraseña de «' + cuenta.name + '»: enséñalo solo a quien deba conectarse y no lo captures.'));
    var fila = el('div', 'qr-botones');
    var bCopiar = el('button', 'btn tonal', 'Copiar enlace'); bCopiar.type = 'button';
    var bCerrar = el('button', 'btn principal', 'Cerrar'); bCerrar.type = 'button';
    bCopiar.addEventListener('click', function () {
      copiar(enlace).then(function () { avisar('Enlace copiado'); }, function () { avisar('No se pudo copiar el enlace.'); });
    });
    bCerrar.addEventListener('click', function () { dlg.close(); });
    fila.appendChild(bCopiar); fila.appendChild(bCerrar);
    dlg.appendChild(fila);
    if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); }
    cargar('lib/qrcode.min.js').then(function () { dibujarQr(lienzo, enlace); }, function () {
      lienzo.replaceWith(el('p', '', 'No se pudo preparar el código QR.'));
    });
  }

  /* ───────────── escáner ───────────── */
  var esc = null; // { overlay, stream, timer, ocupado }

  function cerrar() {
    var d = document.getElementById('dlg-qr');
    if (d && d.open) d.close();
    if (!esc) return;
    var e = esc; esc = null;
    clearInterval(e.timer);
    clearTimeout(e.cierre);
    if (e.stream) e.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (x) { /* ya parada */ } });
    if (e.video) { try { e.video.pause(); e.video.srcObject = null; } catch (x) { /* nada */ } }
    if (e.overlay.parentNode) e.overlay.parentNode.removeChild(e.overlay);
  }

  function mensajeError(err) {
    var n = err && err.name;
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return 'La cámara solo funciona en una página segura (https). Abre Wichi desde su dirección https.';
    if (n === 'NotAllowedError' || n === 'SecurityError') return 'Permite el acceso a la cámara en los ajustes del navegador y vuelve a intentarlo.';
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'No se encontró ninguna cámara en este dispositivo.';
    if (n === 'NotReadableError') return 'La cámara está en uso por otra aplicación.';
    return 'No se pudo abrir la cámara.';
  }

  function escanear() {
    cerrar();
    estilos();
    var overlay = el('div'); overlay.id = 'qr-escaner';
    var video = el('video');
    video.setAttribute('playsinline', ''); video.setAttribute('muted', ''); video.setAttribute('autoplay', '');
    video.muted = true; video.playsInline = true; video.autoplay = true;
    var guia = el('div', 'qr-guia');
    var texto = el('div', 'qr-texto', 'Apunta al QR de conexión de Wichi');
    var bCerrar = el('button', 'btn qr-cerrar', 'Cerrar'); bCerrar.type = 'button';
    bCerrar.addEventListener('click', cerrar);
    overlay.appendChild(video); overlay.appendChild(guia); overlay.appendChild(texto); overlay.appendChild(bCerrar);
    document.body.appendChild(overlay);
    var mio = { overlay: overlay, video: video, stream: null, timer: null, cierre: null, ultimoAviso: 0 };
    esc = mio;

    function falla(err) {
      if (esc !== mio) return;
      texto.remove(); guia.remove(); video.remove();
      overlay.appendChild(el('div', 'qr-error', mensajeError(err)));
    }
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { falla(null); return; }

    Promise.all([
      cargar('lib/jsQR.min.js'),
      navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
    ]).then(function (r) {
      var stream = r[1];
      if (esc !== mio) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      mio.stream = stream;
      video.srcObject = stream;
      var p = video.play(); if (p && p.catch) p.catch(function () { /* autoplay ya lo intenta */ });
      var lienzo = document.createElement('canvas');
      var g = lienzo.getContext('2d', { willReadFrequently: true });
      mio.timer = setInterval(function () {
        if (esc !== mio || !video.videoWidth) return;
        var w = video.videoWidth, h = video.videoHeight, f = Math.min(1, 640 / Math.max(w, h));
        var cw = Math.round(w * f), ch = Math.round(h * f);
        lienzo.width = cw; lienzo.height = ch;
        g.drawImage(video, 0, 0, cw, ch);
        var datos;
        try { datos = g.getImageData(0, 0, cw, ch); } catch (e) { return; }
        var res = window.jsQR(datos.data, cw, ch, { inversionAttempts: 'dontInvert' });
        if (!res || !res.data) return;
        var d = parseEnlace(res.data);
        if (!d) {
          var ahora = Date.now();
          if (ahora - mio.ultimoAviso > 3000) { mio.ultimoAviso = ahora; avisar('Ese QR no es de Wichi.'); }
          return;
        }
        cerrar();
        if (typeof Cuentas === 'undefined') { avisar('No se pudo añadir la cuenta.'); return; }
        var c = Cuentas.añadir(d.n, d.k, d.u, d.p, d.w);
        if (typeof conectar === 'function') conectar(c);
        avisar('Cuenta «' + c.name + '» añadida');
      }, 120);
    }).catch(falla);
  }

  var Qr = { enlaceDeCuenta: enlaceDeCuenta, parseEnlace: parseEnlace, mostrarCuenta: mostrarCuenta, escanear: escanear, cerrar: cerrar };
  if (typeof window !== 'undefined') window.Qr = Qr;
  if (typeof module !== 'undefined') module.exports = { enlaceDeCuenta: enlaceDeCuenta, parseEnlace: parseEnlace };
})();
