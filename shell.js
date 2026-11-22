'use strict';
/*
 * Navegación de Wichi, igual que en el APK: Inicio («¿En qué trabajamos hoy?»), panel lateral, Historial completo,
 * «Nueva sesión», interruptor del servidor en la nube y los botones del compositor (adjuntar, hablar, dictar, enviar).
 * Usa los globales de app.js: S, Cuentas, Api, conectar, nuevaSesion, abrirSesion, enviar, vista, toast, esc…
 */
(function () {
  const el = (id) => document.getElementById(id);
  const Shell = {};
  let homeCuenta = null;                         // cuenta elegida en el chip del inicio
  const wake = { ocupado: false, estado: 'off', t: 0 };

  const icono = (c) => (c && c.kind === 'cowork' ? '☁' : '🖥');
  const cuentaInicio = () => homeCuenta || S.cuenta;
  const tipoTexto = (c) => (c && c.kind === 'cowork' ? 'En la nube' : 'Mi VPS');

  /* ───────────── Inicio ───────────── */
  Shell.pintarInicio = function () {
    const c = S.cuenta;
    el('nombre-cuenta').textContent = c ? c.name : 'Wichi';
    const ch = cuentaInicio();
    el('h-chip').textContent = ch ? `${icono(ch)} ${ch.name} ▾` : '☁ Cloud ▾';
    Shell.pintarRecientes(); Shell.pintarClave(); Shell.actualizarComposer();
  };

  function grupoDe(ms) {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const d = 86400000, t0 = hoy.getTime();
    if (ms >= t0) return 'Hoy';
    if (ms >= t0 - d) return 'Ayer';
    if (ms >= t0 - 7 * d) return 'Últimos 7 días';
    return 'Anteriores';
  }

  Shell.pintarRecientes = function () {
    // Inicio: las 4 más recientes + «Ver todo el historial →»
    const rec = (S.sesiones || []).slice(0, 4);
    const caja = el('h-recientes'); caja.innerHTML = '';
    el('h-recientes-wrap').hidden = !rec.length;
    for (const s of rec) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'fila-reciente'; b.textContent = s.title;
      b.addEventListener('click', () => abrirSesion(s));
      caja.appendChild(b);
    }
    // Panel lateral: agrupadas por día y con búsqueda
    const q = el('p-buscar').value.trim().toLowerCase();
    const lista = (S.sesiones || []).filter((s) => !q || (s.title + ' ' + (s.directory || '')).toLowerCase().includes(q)).slice(0, 60);
    const p = el('p-recientes'); p.innerHTML = '';
    if (!lista.length) { p.innerHTML = `<p class="vacio">${q ? 'Nada coincide.' : 'Aún no hay conversaciones.'}</p>`; return; }
    for (const g of ['Hoy', 'Ayer', 'Últimos 7 días', 'Anteriores']) {
      const filas = lista.filter((s) => grupoDe(s.updated) === g);
      if (!filas.length) continue;
      const h = document.createElement('div'); h.className = 'grupo'; h.textContent = g; p.appendChild(h);
      for (const s of filas) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'fila' + (S.actual && S.actual.id === s.id ? ' sel' : ''); b.textContent = s.title;
        pulsacionLarga(b, () => { if (window.Extra) Extra.accionesSesion(s); });
        b.addEventListener('click', () => { Shell.cerrarPanel(); abrirSesion(s); });
        p.appendChild(b);
      }
    }
  };

  /** La clave de NVIDIA: aviso en el inicio y tarjeta en el chat (como WelcomeKey y KeyCard del APK). */
  Shell.pintarClave = function () {
    const falta = S.needsKey === true;
    el('aviso-clave').hidden = !falta;
    el('aviso-clave-chat').hidden = !falta;
  };
  Shell.claveGuardada = function () {
    Shell.pintarClave();
    const c = el('clave-guardada'); c.hidden = false;
    clearTimeout(Shell._tc); Shell._tc = setTimeout(() => { c.hidden = true; }, 4000);
  };

  /* ───────────── Panel lateral ───────────── */
  Shell.abrirPanel = function () {
    Shell.pintarPanel();
    el('panel-fondo').hidden = false;
    el('panel').classList.add('abierto'); el('panel').setAttribute('aria-hidden', 'false');
  };
  Shell.cerrarPanel = function () {
    el('panel').classList.remove('abierto'); el('panel').setAttribute('aria-hidden', 'true');
    el('panel-fondo').hidden = true;
  };
  Shell.pintarPanel = function () {
    const c = S.cuenta;
    el('p-servidor').textContent = (c && c.name) || 'Servidor';
    el('p-tipo').textContent = tipoTexto(c);
    el('p-avatar').textContent = ((c && c.name) || 'W').trim().charAt(0).toUpperCase() || 'W';
    // Espacios = las cuentas guardadas
    const caja = el('p-espacios'); caja.innerHTML = '';
    el('p-espacios-caja').hidden = !Cuentas.lista.length;
    for (const x of Cuentas.lista) {
      const b = document.createElement('button'); b.type = 'button';
      const activo = S.cuenta && x.url === S.cuenta.url;
      b.className = 'fila' + (activo ? ' sel' : '');
      b.innerHTML = (x.kind === 'cowork' ? '<span class="fila-ico">☁</span>' : '<img src="icons/icono-vps.png" alt="">') + `<span>${esc(x.name)}</span>` + (activo ? '<span class="pista">activo</span>' : '');
      b.addEventListener('click', () => { Shell.cerrarPanel(); if (!activo) void conectar(x); });
      caja.appendChild(b);
    }
    Shell.pintarWake();
    Shell.pintarRecientes();
  };

  /* ───────────── Interruptor del servidor en la nube ───────────── */
  function cuentaCowork() {
    if (S.cuenta && S.cuenta.kind === 'cowork') return S.cuenta;
    return S.api ? null : Cuentas.lista.find((c) => c.kind === 'cowork') || null;
  }
  Shell.pintarWake = function (forzar) {
    const c = cuentaCowork();
    const enPanel = !!(S.cuenta && S.cuenta.kind === 'cowork');
    el('p-wake').hidden = !enPanel;
    el('c-wake').hidden = !(c && !S.api);
    const txt = wake.ocupado ? 'Encendiendo…' : (wake.estado === 'on' ? 'Encendido (ON)' : 'Apagado (OFF)');
    for (const [est, sw] of [['p-wake-estado', 'p-wake-sw'], ['c-wake-estado', 'c-wake-sw']]) {
      el(est).textContent = txt; el(est).className = wake.estado === 'on' && !wake.ocupado ? 'on' : '';
      el(sw).checked = wake.ocupado || wake.estado === 'on'; el(sw).disabled = wake.ocupado;
    }
    // ¿está respondiendo ahora? (se comprueba como mucho cada 20 s)
    if (c && !wake.ocupado && (forzar || Date.now() - wake.t > 20000)) {
      wake.t = Date.now();
      new Api(c.url, c.password, c.user).awake(4000).then((r) => { const on = !!r.ok; if (on !== (wake.estado === 'on')) { wake.estado = on ? 'on' : 'off'; Shell.pintarWake(); } }).catch(() => {});
    }
  };
  async function encender() {
    const c = cuentaCowork(); if (!c || wake.ocupado) return;
    wake.ocupado = true; Shell.pintarWake();
    const r = await new Api(c.url, c.password, c.user).awake(70000);
    wake.ocupado = false; wake.estado = r.ok ? 'on' : 'off'; wake.t = Date.now();
    if (!r.ok) toast(r.error || 'No se pudo encender el servidor.', 6000);
    else if (!S.api || S.cuenta !== c) await conectar(c);       // en la pantalla de conectar, además conecta
    Shell.pintarWake();
  }
  function cambioWake(e) {
    if (e.target.checked) void encender();
    else { e.target.checked = true; toast('El servidor gratuito se duerme solo tras 15 min sin uso.', 4500); }
  }

  /* ───────────── Nueva sesión ───────────── */
  Shell.abrirNueva = function () {
    if (!S.api) { toast('Conéctate a un servidor primero.'); return; }
    const caja = el('nv-cuentas'); caja.innerHTML = '';
    const actual = S.cuenta && S.cuenta.url;
    Cuentas.lista.forEach((c, i) => {
      const l = document.createElement('label'); l.className = 'chipradio';
      l.innerHTML = `<input type="radio" name="nv-c" value="${esc(c.url)}"${c.url === actual || (!actual && i === 0) ? ' checked' : ''}><span>${icono(c)} ${esc(c.name)}</span>`;
      caja.appendChild(l);
    });
    el('nv-dir').value = '/workspace';
    el('dlg-nueva').showModal();
  };

  /* ───────────── Historial ───────────── */
  Shell.abrirHistorial = function () {
    if (!S.api) { pintarCuentas(); return; }
    vista('v-historial'); pintarOffline();
    el('hi-cargando').hidden = false;
    cargarSesiones().catch((e) => toast(e.message, 5000)).finally(() => { el('hi-cargando').hidden = true; });
  };

  /* ───────────── compositores ───────────── */
  Shell.actualizarComposer = function () {
    const adj = window.Extra ? Extra.adjuntos.length : 0;
    const tc = el('entrada').value.trim().length > 0 || adj > 0;
    el('btn-enviar').hidden = !(tc && !S.busy);
    el('btn-voz').hidden = tc || S.busy; el('btn-dictar').hidden = tc || S.busy;
    const th = el('h-entrada').value.trim().length > 0 || adj > 0;
    el('h-enviar').hidden = !th; el('h-voz').hidden = th; el('h-dictar').hidden = th;
  };

  async function enviarInicio() {
    const t = el('h-entrada');
    const texto = t.value.trim();
    if (!texto && !(window.Extra && Extra.adjuntos.length)) return;
    if (!S.api) { toast('Conéctate a un servidor primero.'); return; }
    t.value = ''; ajustarAltura(t); Shell.actualizarComposer();
    const dest = homeCuenta;
    if (dest && S.cuenta && dest.url !== S.cuenta.url) await conectar(dest);
    await nuevaSesion();
    if (S.actual) await enviar(texto);
  }

  function menuCuentas() {
    const m = el('h-menu-cuentas');
    if (!m.hidden) { m.hidden = true; return; }
    m.innerHTML = '';
    for (const c of Cuentas.lista) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = `${icono(c)} ${c.name}`;
      b.addEventListener('click', () => { homeCuenta = c; m.hidden = true; Shell.pintarInicio(); });
      m.appendChild(b);
    }
    const mas = document.createElement('button'); mas.type = 'button'; mas.textContent = '＋ Añadir cuenta';
    mas.addEventListener('click', () => { m.hidden = true; abrirDialogoCuenta(); });
    m.appendChild(mas);
    m.hidden = false;
  }

  /** «＋» del chat: adjuntar un archivo o elegir un comando «/» del servidor. */
  function menuMas() {
    const m = el('menu-mas');
    if (!m.hidden) { m.hidden = true; return; }
    m.innerHTML = '';
    const a = document.createElement('button'); a.type = 'button'; a.innerHTML = '📎&nbsp; Adjuntar archivo o imagen';
    a.addEventListener('click', () => { m.hidden = true; el('in-archivos').click(); });
    m.appendChild(a);
    for (const c of ((window.Extra && Extra.comandos) || [])) {
      const b = document.createElement('button'); b.type = 'button';
      b.innerHTML = `/${esc(c.name)}${c.description ? `<small>${esc(c.description)}</small>` : ''}`;
      b.addEventListener('click', () => { m.hidden = true; const t = el('entrada'); t.value = '/' + c.name + ' '; ajustarAltura(t); Shell.actualizarComposer(); t.focus(); });
      m.appendChild(b);
    }
    m.hidden = false;
  }

  /* ───────────── cambios de pantalla ───────────── */
  Shell.alCambiarVista = function (id) {
    Shell.cerrarPanel();
    for (const m of document.querySelectorAll('.menu-flotante')) m.hidden = true;
    if (id === 'v-inicio') Shell.pintarInicio();
  };

  const vistasConPanel = ['v-inicio', 'v-historial', 'v-chat', 'v-consumo'];
  const hayPanelAqui = () => vistasConPanel.some((v) => !el(v).hidden);

  /* ───────────── cableado ───────────── */
  Shell.iniciar = function () {
    // Panel lateral
    el('btn-cuentas').addEventListener('click', Shell.abrirPanel);
    el('panel-fondo').addEventListener('click', Shell.cerrarPanel);
    el('p-buscar-btn').addEventListener('click', () => { const i = el('p-buscar'); i.hidden = !i.hidden; if (i.hidden) { i.value = ''; Shell.pintarRecientes(); } else i.focus(); });
    el('p-buscar').addEventListener('input', Shell.pintarRecientes);
    el('p-nueva').addEventListener('click', () => {
      Shell.cerrarPanel();
      if (window.Extra && S.actual) Extra.alCerrarChat(S.actual.id);
      S.actual = null; homeCuenta = null; vista('v-inicio'); Shell.pintarInicio(); el('h-entrada').focus();
    });
    el('p-historial').addEventListener('click', () => { Shell.cerrarPanel(); Shell.abrirHistorial(); });
    el('p-consumo').addEventListener('click', () => { Shell.cerrarPanel(); if (window.Extra) void Extra.abrirConsumo(); });
    el('p-ajustes').addEventListener('click', () => { Shell.cerrarPanel(); if (window.Extra) void Extra.abrirAjustes(); });
    el('p-wake-sw').addEventListener('change', cambioWake);
    el('c-wake-sw').addEventListener('change', cambioWake);
    // Gesto: deslizar desde el borde izquierdo abre el panel; deslizar hacia la izquierda lo cierra
    let sx = null, sy = 0;
    document.addEventListener('touchstart', (e) => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; }, { passive: true });
    document.addEventListener('touchend', (e) => {
      if (sx === null) return;
      const t = e.changedTouches[0]; const dx = t.clientX - sx, dy = Math.abs(t.clientY - sy);
      const abierto = el('panel').classList.contains('abierto');
      if (!abierto && sx < 24 && dx > 70 && dy < 60 && hayPanelAqui() && el('voz').hidden) Shell.abrirPanel();
      else if (abierto && dx < -70 && dy < 60) Shell.cerrarPanel();
      sx = null;
    }, { passive: true });
    // Menús flotantes: se cierran al tocar fuera
    document.addEventListener('click', (e) => { if (e.target.closest('.menu-ancla')) return; for (const m of document.querySelectorAll('.menu-flotante')) m.hidden = true; });
    // Inicio
    const t = el('h-entrada');
    t.addEventListener('input', () => { ajustarAltura(t); Shell.actualizarComposer(); });
    t.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); void enviarInicio(); } });
    el('h-enviar').addEventListener('click', () => void enviarInicio());
    el('h-mas').addEventListener('click', () => el('in-archivos').click());
    el('h-sugerencias').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; t.value = b.textContent + ': '; ajustarAltura(t); Shell.actualizarComposer(); t.focus(); });
    el('h-chip').addEventListener('click', menuCuentas);
    el('h-voz').addEventListener('click', () => { if (window.Voz) Voz.abrir(); });
    el('h-dictar').addEventListener('click', () => { if (window.Voz) Voz.dictar(t, el('h-dictar')); });
    el('h-historial').addEventListener('click', Shell.abrirHistorial);
    el('aviso-clave-btn').addEventListener('click', abrirClave);
    // Historial
    el('hi-atras').addEventListener('click', () => { vista('v-inicio'); Shell.pintarInicio(); });
    el('hi-actualizar').addEventListener('click', () => { el('hi-cargando').hidden = false; cargarSesiones().catch((e) => toast(e.message, 5000)).finally(() => { el('hi-cargando').hidden = true; }); });
    el('hi-mas').addEventListener('click', () => { const m = el('hi-menu'); m.hidden = !m.hidden; });
    el('hi-ajustes').addEventListener('click', () => { el('hi-menu').hidden = true; if (window.Extra) void Extra.abrirAjustes(); });
    el('hi-servidor').addEventListener('click', () => { el('hi-menu').hidden = true; detenerEventos(); S.api = null; pintarCuentas(); });
    el('buscar').addEventListener('input', pintarSesiones);
    el('btn-nueva').addEventListener('click', Shell.abrirNueva);
    // Nueva sesión
    el('nv-cancelar').addEventListener('click', () => el('dlg-nueva').close());
    el('form-nueva').addEventListener('submit', async (e) => {
      e.preventDefault();
      const dir = el('nv-dir').value.trim() || '/workspace';
      const sel = document.querySelector('input[name=nv-c]:checked');
      const dest = sel ? Cuentas.lista.find((c) => c.url === sel.value) : null;
      el('dlg-nueva').close();
      if (dest && S.cuenta && dest.url !== S.cuenta.url) await conectar(dest);
      await nuevaSesion(dir);
    });
    // Compositor del chat
    el('btn-adjuntar').addEventListener('click', menuMas);
    el('btn-voz').addEventListener('click', () => { if (window.Voz) Voz.abrir(); });
    el('btn-dictar').addEventListener('click', () => { if (window.Voz) Voz.dictar(el('entrada'), el('btn-dictar')); });
    Shell.actualizarComposer();
  };

  window.Shell = Shell;
})();
