/* Wichi PWA · conexión con Spotify (API web oficial, OAuth con PKCE, sin secretos).
   Port del objeto Spotify del APK. Necesita Spotify Premium y un Client ID propio.
   Globals opcionales: toast(t) de app.js. Se expone como window.Spotify. */
(function () {
  'use strict';

  var SCOPES = 'user-modify-playback-state user-read-playback-state user-read-currently-playing';
  var PFX = 'wichi.spotify.';
  var REDIRECT = location.origin + location.pathname;
  var SIN_DISPOSITIVO = 'No veo ningún Spotify activo. Abre la app de Spotify en tu iPhone, pon cualquier canción un segundo y vuelve a pedírmelo.';

  var mensaje = null;
  var vistas = [];

  /* ───────── almacenamiento ───────── */
  function leer(k) { try { return localStorage.getItem(PFX + k) || ''; } catch (e) { return ''; } }
  function guardar(k, v) { try { localStorage.setItem(PFX + k, v); } catch (e) { /* modo privado */ } }
  function borrar(k) { try { localStorage.removeItem(PFX + k); } catch (e) { /* nada */ } }

  function clientId() { return leer('client_id').trim(); }
  function guardarClientId(id) { guardar('client_id', String(id || '').trim()); }
  function conectado() { return !!leer('refresh'); }

  function avisar(t) { try { if (typeof toast === 'function') toast(t); } catch (e) { /* sin toast */ } }
  function cambia() {
    vistas = vistas.filter(function (v) { return v.cont.isConnected !== false; });
    vistas.forEach(function (v) { try { v.pintar(); } catch (e) { /* no rompe */ } });
  }

  /* ───────── puro ───────── */
  function b64url(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function aleatorio(n) { var b = new Uint8Array(n); crypto.getRandomValues(b); return b64url(b); }
  async function desafio(verificador) {
    var h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verificador));
    return b64url(new Uint8Array(h));
  }
  function norm(s) { return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]+/g, ''); }
  function form(o) {
    return Object.keys(o).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]); }).join('&');
  }
  function urlAutorizacion(id, redirect, ch, estado) {
    var q = new URLSearchParams({
      client_id: id, response_type: 'code', redirect_uri: redirect,
      code_challenge_method: 'S256', code_challenge: ch, scope: SCOPES, state: estado,
    });
    return 'https://accounts.spotify.com/authorize?' + q.toString();
  }
  function falla(codigo) {
    switch (codigo) {
      case 401: return 'Spotify no está conectado. Conéctalo en Ajustes.';
      case 403: return 'Para controlar Spotify necesitas Spotify Premium.';
      case 404: return SIN_DISPOSITIVO;
      case 429: return 'Spotify está recibiendo muchas órdenes. Espera un momento.';
      case -1: return 'No pude comunicarme con Spotify. Revisa tu internet.';
      default: return 'Spotify respondió con un error (' + codigo + ').';
    }
  }

  /* ───────── red ───────── */
  async function http(metodo, url, cuerpo, bearer, tipo) {
    var opts = { method: metodo, headers: {} };
    if (bearer) opts.headers.Authorization = 'Bearer ' + bearer;
    if (cuerpo != null) { opts.headers['Content-Type'] = tipo || 'application/json'; opts.body = cuerpo; }
    var ctl = null, timer = null;
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) opts.signal = AbortSignal.timeout(15000);
    else if (typeof AbortController !== 'undefined') { ctl = new AbortController(); opts.signal = ctl.signal; timer = setTimeout(function () { ctl.abort(); }, 15000); }
    try {
      var r = await fetch(url, opts);
      var t = '';
      try { t = await r.text(); } catch (e) { t = ''; }
      return { codigo: r.status, texto: t };
    } catch (e) {
      return { codigo: -1, texto: '' };
    } finally { if (timer) clearTimeout(timer); }
  }

  async function token(f) {
    var r = await http('POST', 'https://accounts.spotify.com/api/token', f, null, 'application/x-www-form-urlencoded');
    if (r.codigo < 200 || r.codigo > 299) return r.codigo;
    var o;
    try { o = JSON.parse(r.texto); } catch (e) { return 500; }
    if (!o || !o.access_token) return 500;
    guardar('access', o.access_token);
    guardar('expira', String(Date.now() + ((Number(o.expires_in) || 3600) - 60) * 1000));
    if (o.refresh_token) guardar('refresh', o.refresh_token);
    return 200;
  }

  var refrescando = null;
  /* Devuelve {token} o {codigo} con el error. */
  async function acceso() {
    var a = leer('access');
    if (a && Date.now() < Number(leer('expira') || 0)) return { token: a };
    var rf = leer('refresh');
    if (!rf) return { codigo: 401 };
    if (!refrescando) {
      refrescando = token(form({ grant_type: 'refresh_token', refresh_token: rf, client_id: clientId() }))
        .finally(function () { refrescando = null; });
    }
    var c = await refrescando;
    if (c === 200) return { token: leer('access') };
    if (c === -1 || c >= 500 || c === 429) return { codigo: c === 429 ? 429 : -1 };
    desconectar('Spotify se desconectó. Vuelve a conectarlo en Ajustes.');
    return { codigo: 401 };
  }

  async function api(metodo, ruta, cuerpo) {
    var a = await acceso();
    if (!a.token) return { codigo: a.codigo, texto: '' };
    return http(metodo, 'https://api.spotify.com/v1' + ruta, cuerpo == null ? (metodo === 'GET' ? null : '{}') : JSON.stringify(cuerpo), a.token);
  }

  /* Orden de reproducción; si no hay dispositivo activo, prueba con uno inactivo (device_id). */
  async function conDispositivo(metodo, ruta, cuerpo) {
    var r = await api(metodo, ruta, cuerpo);
    if (r.codigo !== 404) return r;
    var d = await api('GET', '/me/player/devices');
    var id = '';
    try {
      var lista = (JSON.parse(d.texto).devices || []).filter(function (x) { return x && x.id && !x.is_restricted; });
      if (lista.length) id = lista[0].id;
    } catch (e) { id = ''; }
    if (!id) return r;
    return api(metodo, ruta + (ruta.indexOf('?') >= 0 ? '&' : '?') + 'device_id=' + encodeURIComponent(id), cuerpo);
  }

  /* ───────── sesión ───────── */
  async function conectar() {
    var id = clientId();
    if (!id) { mensaje = 'Pega primero tu Client ID.'; cambia(); return mensaje; }
    if (!(window.crypto && crypto.subtle)) { mensaje = 'Este navegador no permite iniciar sesión con Spotify (hace falta https).'; cambia(); return mensaje; }
    var ver = aleatorio(48), estado = aleatorio(16);
    var ch = await desafio(ver);
    guardar('verificador', ver);
    guardar('estado', estado);
    mensaje = 'Autoriza a Wichi en la página de Spotify…';
    cambia();
    location.href = urlAutorizacion(id, REDIRECT, ch, estado);
    return null;
  }

  function desconectar(msg) {
    ['access', 'refresh', 'expira', 'verificador', 'estado'].forEach(borrar);
    mensaje = typeof msg === 'string' ? msg : 'Spotify desconectado.';
    cambia();
  }

  async function alCargar() {
    var q;
    try { q = new URLSearchParams(location.search); } catch (e) { return false; }
    var code = q.get('code'), error = q.get('error');
    if (!code && !error) return false;
    var estadoRecibido = q.get('state') || '';
    var estadoGuardado = leer('estado');
    var ver = leer('verificador');
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* nada */ }
    borrar('estado'); borrar('verificador');
    var msg;
    if (error) msg = 'Spotify no autorizó la conexión (' + error + ').';
    else if (!estadoGuardado || estadoRecibido !== estadoGuardado) msg = 'La respuesta de Spotify no coincide con la solicitud. Vuelve a intentarlo.';
    else {
      var c = await token(form({ grant_type: 'authorization_code', code: code, redirect_uri: REDIRECT, client_id: clientId(), code_verifier: ver }));
      msg = c === 200 ? 'Spotify conectado.' : 'No se pudo conectar con Spotify. Revisa el Client ID y la dirección de redirección.';
    }
    mensaje = msg;
    avisar(msg);
    cambia();
    return true;
  }

  /* ───────── órdenes (siempre devuelven una frase) ───────── */
  async function reproducir(consulta) {
    consulta = String(consulta || '').trim();
    if (!consulta) return '¿Qué quieres que ponga?';
    var b = await api('GET', '/search?q=' + encodeURIComponent(consulta) + '&type=track,artist&limit=1&market=from_token');
    if (b.codigo !== 200) return falla(b.codigo);
    var j;
    try { j = JSON.parse(b.texto); } catch (e) { return falla(500); }
    var artista = j.artists && j.artists.items && j.artists.items[0];
    var cancion = j.tracks && j.tracks.items && j.tracks.items[0];
    var nombreArtista = (artista && artista.name) || '';
    var esArtista = artista && nombreArtista && norm(consulta).indexOf(norm(nombreArtista)) >= 0;
    var cuerpo, dice;
    if (esArtista) { cuerpo = { context_uri: artista.uri }; dice = 'Poniendo música de ' + nombreArtista + '.'; }
    else if (cancion) {
      var aut = (cancion.artists && cancion.artists[0] && cancion.artists[0].name) || '';
      cuerpo = { uris: [cancion.uri] };
      dice = 'Poniendo ' + (cancion.name || '') + (aut ? ' de ' + aut + '.' : '.');
    } else return 'No encontré «' + consulta + '» en Spotify.';
    var r = await conDispositivo('PUT', '/me/player/play', cuerpo);
    return r.codigo >= 200 && r.codigo <= 299 ? dice : falla(r.codigo);
  }

  async function control(metodo, ruta, ok, conDisp) {
    var r = conDisp ? await conDispositivo(metodo, ruta, {}) : await api(metodo, ruta, {});
    return r.codigo >= 200 && r.codigo <= 299 ? ok : falla(r.codigo);
  }
  function reanudar() { return control('PUT', '/me/player/play', 'Reanudado.', true); }
  function pausar() { return control('PUT', '/me/player/pause', 'Pausado.', false); }
  function siguiente() { return control('POST', '/me/player/next', 'Siguiente canción.', false); }
  function anterior() { return control('POST', '/me/player/previous', 'Canción anterior.', false); }

  async function volumen(fijo, delta) {
    var v = (fijo === null || fijo === undefined) ? null : Number(fijo);
    if (v === null || isNaN(v)) {
      var e = await api('GET', '/me/player');
      if (e.codigo !== 200) return e.codigo === 204 ? SIN_DISPOSITIVO : falla(e.codigo);
      var actual = 50;
      try { var p = JSON.parse(e.texto).device.volume_percent; if (typeof p === 'number') actual = p; } catch (x) { /* 50 */ }
      v = actual + (Number(delta) || 0);
    }
    v = Math.max(0, Math.min(100, Math.round(v)));
    var r = await api('PUT', '/me/player/volume?volume_percent=' + v, {});
    return r.codigo >= 200 && r.codigo <= 299 ? 'Volumen al ' + v + ' por ciento.' : falla(r.codigo);
  }

  async function queSuena() {
    var r = await api('GET', '/me/player/currently-playing');
    if (r.codigo === 204 || (r.codigo === 200 && !r.texto.trim())) return 'Ahora no está sonando nada.';
    if (r.codigo !== 200) return falla(r.codigo);
    var o = null;
    try { o = JSON.parse(r.texto).item; } catch (e) { o = null; }
    if (!o) return 'Ahora no está sonando nada.';
    var aut = (o.artists && o.artists[0] && o.artists[0].name) || '';
    return 'Suena ' + (o.name || '') + (aut ? ' de ' + aut + '.' : '.');
  }

  /* ───────── tarjeta de Ajustes ───────── */
  function h(tag, clase, texto) {
    var e = document.createElement(tag);
    if (clase) e.className = clase;
    if (texto != null) e.textContent = texto;
    return e;
  }

  function copiar(texto, campo) {
    var ok = function () { avisar('Dirección copiada.'); };
    var viejo = function () {
      try { campo.focus(); campo.select(); campo.setSelectionRange(0, 999); document.execCommand('copy'); ok(); }
      catch (e) { avisar('Mantén pulsada la dirección para copiarla.'); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(texto).then(ok, viejo);
    else viejo();
  }

  function pintarTarjeta(cont) {
    var ayudaAbierta = false;
    function pintar() {
      var on = conectado();
      var t = h('section', 'tarjeta');
      t.appendChild(h('h3', null, 'Spotify'));
      t.appendChild(h('p', 't-suave', on
        ? 'Conectado. Puedes decir «Wichi, ponme música de…», «pausa», «siguiente», «sube el volumen» o «qué suena».'
        : 'Conecta tu cuenta para que Wichi pueda poner música, pausar, cambiar de canción y subir el volumen por voz. Hace falta Spotify Premium para controlar la reproducción.'));
      if (!on) {
        var lc = h('label', 'campo');
        lc.appendChild(h('span', null, 'Client ID de Spotify'));
        var inp = h('input');
        inp.type = 'text'; inp.value = clientId(); inp.placeholder = 'Pega aquí tu Client ID';
        inp.setAttribute('autocomplete', 'off'); inp.setAttribute('autocapitalize', 'off');
        inp.setAttribute('autocorrect', 'off'); inp.setAttribute('spellcheck', 'false');
        inp.addEventListener('input', function () { guardarClientId(inp.value); });
        lc.appendChild(inp);
        t.appendChild(lc);

        var lr = h('label', 'campo');
        lr.appendChild(h('span', null, 'Redirect URI (cópiala tal cual en tu app de Spotify)'));
        var cb = h('div', 'con-boton');
        var ri = h('input'); ri.type = 'text'; ri.readOnly = true; ri.value = REDIRECT;
        var bc = h('button', null, 'Copiar'); bc.type = 'button';
        bc.addEventListener('click', function (ev) { ev.preventDefault(); copiar(REDIRECT, ri); });
        cb.appendChild(ri); cb.appendChild(bc); lr.appendChild(cb);
        t.appendChild(lr);

        var ba = h('button', 'btn texto chico', ayudaAbierta ? 'Ocultar cómo conseguirlo' : '¿Cómo consigo el Client ID?');
        ba.type = 'button';
        ba.addEventListener('click', function () { ayudaAbierta = !ayudaAbierta; pintar(); });
        t.appendChild(ba);
        if (ayudaAbierta) {
          var ol = h('ol', 't-suave');
          ol.style.margin = '0'; ol.style.paddingLeft = '20px';
          [
            'Entra a developer.spotify.com/dashboard con tu cuenta de Spotify y pulsa «Create app».',
            'Ponle el nombre que quieras. En «Redirect URI» escribe exactamente la dirección de arriba.',
            'Marca «Web API», acepta y guarda.',
            'Abre la app que creaste, copia el «Client ID» y pégalo aquí.',
          ].forEach(function (s) { ol.appendChild(h('li', null, s)); });
          t.appendChild(ol);
        }
      }
      var fila = h('div');
      fila.style.display = 'flex'; fila.style.gap = '8px';
      if (on) {
        var bd = h('button', 'btn peligro', 'Desconectar'); bd.type = 'button';
        bd.addEventListener('click', function () { desconectar(); });
        fila.appendChild(bd);
      } else {
        var bk = h('button', 'btn principal', 'Conectar con Spotify'); bk.type = 'button';
        bk.addEventListener('click', function () { conectar(); });
        fila.appendChild(bk);
      }
      t.appendChild(fila);
      if (mensaje) t.appendChild(h('p', 't-suave', mensaje));
      while (cont.firstChild) cont.removeChild(cont.firstChild);
      cont.appendChild(t);
    }
    vistas.push({ cont: cont, pintar: pintar });
    pintar();
  }

  window.Spotify = {
    REDIRECT: REDIRECT, SCOPES: SCOPES,
    conectado: conectado, clientId: clientId, guardarClientId: guardarClientId,
    conectar: conectar, alCargar: alCargar, desconectar: desconectar,
    reproducir: reproducir, pausar: pausar, reanudar: reanudar, siguiente: siguiente, anterior: anterior,
    volumen: volumen, queSuena: queSuena, pintarTarjeta: pintarTarjeta,
    puro: { b64url: b64url, desafio: desafio, norm: norm, falla: falla, urlAutorizacion: urlAutorizacion, form: form },
  };
})();
