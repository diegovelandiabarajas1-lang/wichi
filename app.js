'use strict';
/* Wichi PWA: cliente web de Wichi para iPhone (y cualquier navegador moderno).
   Habla con un servidor Wichinion por su API HTTP (usuario «opencode» + contraseña).
   Sin dependencias ni compilación. Los datos (cuentas) viven solo en este dispositivo (localStorage). */

const $ = (id) => document.getElementById(id);
const LS = { cuentas: 'wichi.cuentas', actual: 'wichi.actual', usuario: 'wichi.usuario' };

/* ───────────── la cuenta de Wichi (nombre + contraseña), como en el APK ─────────────
 * Son también el usuario y la contraseña de TU servidor Wichinion. Se guardan solo en este dispositivo. */
const Sesion = {
  MIN_CLAVE: 12,
  leer() { try { const u = JSON.parse(leerLS(LS.usuario) || 'null'); return u && u.nombre && u.clave ? u : null; } catch { return null; } },
  guardar(nombre, clave) { guardarLS(LS.usuario, JSON.stringify({ nombre: nombre.trim(), clave })); },
  cerrar() { try { localStorage.removeItem(LS.usuario); } catch { /* nada */ } },
  /** null si todo está bien; si no, el mensaje. `repetir` es undefined al iniciar sesión. */
  validar(nombre, clave, repetir) {
    const n = (nombre || '').trim();
    if (n.length < 3 || n.length > 32) return 'El nombre debe tener entre 3 y 32 caracteres.';
    if (!/^[\p{L}\p{N}._-]+$/u.test(n)) return 'El nombre solo puede llevar letras, números, punto, guion y guion bajo (sin espacios).';
    if ((clave || '').length < Sesion.MIN_CLAVE) return `La contraseña debe tener al menos ${Sesion.MIN_CLAVE} caracteres (así lo exige Wichinion).`;
    if (repetir !== undefined && clave !== repetir) return 'Las contraseñas no coinciden.';
    return null;
  },
};

/* ───────────── utilidades ───────────── */
const enc = encodeURIComponent;
const locationQuery = (dir) => 'location%5Bdirectory%5D=' + enc(dir);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function guardarLS(k, v) { try { localStorage.setItem(k, v); } catch { /* modo privado: no se guarda */ } }
function leerLS(k) { try { return localStorage.getItem(k); } catch { return null; } }
function toast(t, ms = 3500) {
  const el = $('toast'); el.textContent = t; el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, ms);
}
function b64(s) { return btoa(unescape(encodeURIComponent(s))); }

/* ───────────── cuentas ───────────── */
const Cuentas = {
  lista: [],
  cargar() {
    try { this.lista = JSON.parse(leerLS(LS.cuentas) || '[]').filter((c) => c && c.url); } catch { this.lista = []; }
  },
  guardar() { guardarLS(LS.cuentas, JSON.stringify(this.lista)); },
  /** Un nombre que no se repita: «Casa», «Casa 2»… (el nombre lo elige la persona; el tipo no lo decide). */
  nombreLibre(base, ignorar) {
    const b = base.trim();
    const usados = new Set(this.lista.filter((c) => c !== ignorar).map((c) => c.name.trim().toLowerCase()));
    if (!usados.has(b.toLowerCase())) return b;
    let n = 2;
    while (usados.has((b + ' ' + n).toLowerCase())) n++;
    return b + ' ' + n;
  },
  normalizarUrl(url, tipo) {
    let u = url.trim();
    if (!/^https?:\/\//i.test(u)) u = (tipo === 'local' ? 'http://' : 'https://') + u;
    if (tipo === 'local' && !/:\d+(\/|$)/.test(u.replace(/^https?:\/\//i, ''))) u += ':4096';
    return u.replace(/\/+$/, '');
  },
  /** tipo: «cowork» (en la nube: Render), «vps» (Mi VPS) o «local» (antiguo «Mi PC», se trata como VPS). user: el usuario de Wichinion (el nombre de tu cuenta; «opencode» en los servidores de siempre, nombre conservado por compatibilidad). */
  añadir(nombre, tipo, url, clave, user) {
    const u = this.normalizarUrl(url, tipo);
    let host = u; try { host = new URL(u).host; } catch { /* queda la dirección */ }
    const previo = this.lista.find((x) => x.url === u); // volver a añadir la misma dirección la reemplaza sin cambiarle el nombre
    const c = { name: this.nombreLibre(nombre || host, previo), kind: tipo === 'local' ? 'local' : tipo === 'vps' ? 'vps' : 'cowork', url: u, password: clave.trim(), user: (user || '').trim() || 'opencode' };
    this.lista = this.lista.filter((x) => x.url !== c.url).concat(c);
    this.guardar();
    return c;
  },
  renombrar(c, nuevo) { c.name = this.nombreLibre(nuevo || c.name, c); this.guardar(); },
  olvidar(c) { this.lista = this.lista.filter((x) => x !== c); this.guardar(); },
};

/* ───────────── API ───────────── */
class ApiError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

class Api {
  constructor(base, password, user) {
    this.base = base.trim().replace(/\/+$/, '');
    this.auth = 'Basic ' + b64((user || 'opencode') + ':' + password);
  }
  headers(extra) { return { Authorization: this.auth, Accept: 'application/json', ...(extra || {}) }; }
  async fail(res) {
    let msg = '';
    try { const t = await res.text(); try { msg = JSON.parse(t).message || ''; } catch { msg = ''; } } catch { /* nada */ }
    if (res.status === 401) throw new ApiError(401, 'Contraseña incorrecta (401)');
    throw new ApiError(res.status, msg ? `HTTP ${res.status}: ${msg}` : `HTTP ${res.status}`);
  }
  async call(method, path, body, timeoutMs = 30000) {
    let res;
    try {
      res = await fetch(this.base + path, {
        method,
        headers: this.headers(body !== undefined ? { 'Content-Type': 'application/json' } : undefined),
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
      });
    } catch (e) {
      throw new ApiError(0, explicarRed(this.base, e));
    }
    if (!res.ok) await this.fail(res);
    const t = await res.text();
    return t.trim() ? JSON.parse(t) : null;
  }
  get(p, t) { return this.call('GET', p, undefined, t); }
  post(p, b, t) { return this.call('POST', p, b, t); }
  /** true si algo contesta (incluso 401). Espera hasta ~70 s a que un servidor gratuito despierte. */
  async awake(timeoutMs = 70000) {
    try {
      const res = await fetch(this.base + '/api/info', { headers: this.headers(), signal: AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined });
      return { ok: res.status > 0, status: res.status };
    } catch (e) {
      return { ok: false, error: explicarRed(this.base, e) };
    }
  }
  /** Eventos en directo (SSE) de todo el servidor; llama a `onEvent` por cada uno. Termina si se corta. */
  async events(signal, onEvent) {
    const res = await fetch(this.base + '/api/event', { headers: this.headers({ Accept: 'text/event-stream' }), signal });
    if (!res.ok || !res.body) await this.fail(res);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try { onEvent(JSON.parse(payload)); } catch { /* línea ajena */ }
      }
    }
  }
}

/** Mensaje de red entendible: casi siempre es CORS, servidor dormido o http desde una página https. */
function explicarRed(base, e) {
  if (location.protocol === 'https:' && base.startsWith('http://')) {
    return 'Esta página es https y el servidor es http: el navegador lo bloquea. Usa un servidor con https (Cowork) o abre la PWA desde la misma red por http.';
  }
  return 'No se pudo conectar. Puede que el servidor esté dormido (espera 1 min y reintenta), que la dirección esté mal, o que el servidor no permita esta página (CORS).';
}

/* ───────────── lectura de mensajes (igual que la app y la extensión) ───────────── */
function toolName(p, fb) { for (const k of ['name', 'tool', 'toolName', 'title']) if (typeof p[k] === 'string' && p[k]) return p[k]; return fb; }
function toolStatus(p) {
  for (const k of ['status', 'state', 'outcome']) {
    const v = p[k];
    if (typeof v === 'string' && v) return v;
    if (v && typeof v === 'object' && typeof v.status === 'string' && v.status) return v.status;
  }
  return '';
}
function resumir(input) {
  if (!input || typeof input !== 'object') return '';
  for (const k of ['command', 'filePath', 'path', 'file', 'pattern', 'url', 'query', 'description', 'prompt']) {
    const v = input[k]; if (typeof v === 'string' && v.trim()) return v.replace(/\n/g, ' ').slice(0, 110);
  }
  for (const v of Object.values(input)) if (typeof v === 'string' && v.trim()) return v.replace(/\n/g, ' ').slice(0, 110);
  return '';
}
function detalleTool(p) {
  const st = p.state; let out = '';
  if (st && st.input) out += JSON.stringify(st.input, null, 2).slice(0, 1500);
  for (const c of (st && st.content) || []) if (c && c.type === 'text') out += '\n\n' + String(c.text).slice(0, 2500);
  return out.trim() || JSON.stringify(p).slice(0, 1500);
}
function toolKey(d) {
  for (const k of ['callID', 'toolCallID', 'id', 'toolID']) if (typeof d[k] === 'string' && d[k]) return d[k];
  return `${d.assistantMessageID || ''}:${d.ordinal || 0}`;
}
function parseSesion(o) {
  const m = o.model;
  return {
    id: String(o.id || ''),
    title: (o.title && String(o.title)) || 'Sin título',
    updated: Number((o.time && o.time.updated) || 0),
    directory: String((o.location && o.location.directory) || ''),
    model: m ? `${m.providerID || ''}/${m.id || ''}` : '',
    archived: !!(o.archived || (o.time && o.time.archived)),
    agent: String(o.agent || ''),
    modo: o.modo === 'plan' || o.modo === 'auto' ? o.modo : '',
    equipo: !!o.equipo,
  };
}
function parseMensajes(arr) {
  const out = [];
  for (const m of arr) {
    if (m.type === 'user') {
      out.push({ kind: 'user', key: String(m.id), text: window.Acciones ? Acciones.quitarProtocolo(String(m.text || '')) : String(m.text || ''), files: (m.files || []).map((f) => String(f.name || 'archivo')) });
    } else if (m.type === 'assistant') {
      (m.content || []).forEach((p, i) => {
        const key = `${m.id}:${i}`;
        if (p.type === 'text') out.push({ kind: 'text', key, text: String(p.text || '') });
        else if (p.type === 'reasoning') out.push({ kind: 'reasoning', key, text: String(p.text || '') });
        else out.push({ kind: 'tool', key, name: toolName(p, String(p.type)), status: toolStatus(p), summary: resumir(p.state && p.state.input), input: p.state && p.state.input, detail: detalleTool(p) });
      });
    } else if (m.type === 'idle' && m.outcome === 'failed') {
      const e = m.error;
      out.push({ kind: 'note', key: String(m.id), text: 'La ejecución terminó con error.' + (e && e.message ? ' ' + String(e.message) : '') });
    }
  }
  return out;
}

/* ───────────── Markdown mínimo y seguro (escapa todo antes) ───────────── */
function inline(t) {
  let s = esc(t);
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return s;
}
function markdown(src) {
  const partes = String(src).split(/```/);
  let html = '';
  partes.forEach((trozo, i) => {
    if (i % 2 === 1) {
      const nl = trozo.indexOf('\n');
      const codigo = nl >= 0 ? trozo.slice(nl + 1) : trozo;
      html += `<pre><button type="button" class="mini copiar">Copiar</button><code>${esc(codigo.replace(/\n$/, ''))}</code></pre>`;
      return;
    }
    let lista = null; let abierto = false; let par = [];
    const cierraPar = () => { if (par.length) { html += '<p>' + par.join('<br>') + '</p>'; par = []; } };
    const cierraLista = () => { if (abierto) { html += `</${lista}>`; abierto = false; lista = null; } };
    for (const linea of trozo.split('\n')) {
      let m;
      if ((m = linea.match(/^(#{1,3})\s+(.*)$/))) { cierraPar(); cierraLista(); html += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`; }
      else if ((m = linea.match(/^\s*[-*]\s+(.*)$/))) { cierraPar(); if (lista !== 'ul') { cierraLista(); html += '<ul>'; lista = 'ul'; abierto = true; } html += `<li>${inline(m[1])}</li>`; }
      else if ((m = linea.match(/^\s*\d+[.)]\s+(.*)$/))) { cierraPar(); if (lista !== 'ol') { cierraLista(); html += '<ol>'; lista = 'ol'; abierto = true; } html += `<li>${inline(m[1])}</li>`; }
      else if (!linea.trim()) { cierraPar(); cierraLista(); }
      else { cierraLista(); par.push(inline(linea)); }
    }
    cierraPar(); cierraLista();
  });
  return html;
}

/* ───────────── estado de la app ───────────── */
const S = {
  cuenta: null, api: null,
  sesiones: [], actual: null, items: [], busy: false, permisos: [],
  needsKey: undefined, nvidia: null, elegidoAMano: false,
  abortEventos: null, conectando: 0,
  antes: [], cursorAntes: null, cargandoAntes: false, tokens: '', offline: false, pegado: true,
};

const VISTAS = ['v-cuentas', 'v-inicio', 'v-historial', 'v-chat', 'v-ajustes', 'v-consumo'];
function vista(id) {
  for (const v of VISTAS) $(v).hidden = v !== id;
  if (window.Shell) Shell.alCambiarVista(id);
}

/* ───────────── pantalla: conectar (como ConnectScreen del APK) ───────────── */
function esStandalone() { return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches; }
let cuentaSel = null;
function pintarCuentas() {
  if (window.Guias) Guias.cerrar();
  vista('v-cuentas');
  const esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  $('aviso-instalar').hidden = !(esIOS && !esStandalone());
  const lista = $('lista-cuentas');
  lista.innerHTML = '';
  $('c-guardados').hidden = !Cuentas.lista.length;
  for (const c of Cuentas.lista) {
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `<div class="txt"><div class="t1">${c.kind === 'cowork' ? '<span class="ico" data-i="nube"></span>' : '<span class="ico" data-i="servidor"></span>'} ${esc(c.name)}</div><div class="t2">${esc(c.url)}</div></div><button class="mini" data-a="mas" type="button" aria-label="Más acciones">⋯</button>`;
    el.setAttribute('role', 'button'); el.tabIndex = 0;
    el.addEventListener('click', () => conectar(c));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); conectar(c); } });
    el.querySelector('[data-a=mas]').addEventListener('click', (e) => { e.stopPropagation(); abrirAccionesCuenta(c); });
    lista.appendChild(el);
  }
  const hayHttp = location.protocol === 'https:' && Cuentas.lista.some((c) => c.url.startsWith('http://'));
  $('aviso-https').hidden = !hayHttp;
  if (hayHttp) $('aviso-https').textContent = 'Hay cuentas con dirección http: desde una página https el navegador las bloquea. Funcionan las de la nube y las https.';
  if (window.Shell) Shell.pintarWake();
}

function abrirAccionesCuenta(c) { cuentaSel = c; $('ca-titulo').textContent = c.name; $('dlg-cuenta-acciones').showModal(); }

function abrirDialogoCuenta(prefill) {
  const f = $('form-cuenta');
  f.reset();
  $('c-nombre').value = (prefill && prefill.name) || '';
  actualizarAyudaTipo();
  $('dlg-cuenta').showModal();
}
function actualizarAyudaTipo() {
  const tipo = document.querySelector('input[name=c-tipo]:checked').value;
  $('c-url').placeholder = tipo === 'cowork' ? 'https://…onrender.com' : 'https://wichi.midominio.com';
  $('c-ayuda').textContent = tipo === 'cowork'
    ? 'Servidor en la nube (Render, https). El tipo solo indica cómo conectar; el nombre es el que escribiste.'
    : 'Tu propio servidor (VPS) con HTTPS. Si es Wichinion con cuenta propia, escribe también el usuario.';
}
let cuentaRenombrando = null;
function pedirRenombrar(c) { cuentaRenombrando = c; $('r-nombre').value = c.name; $('dlg-renombrar').showModal(); setTimeout(() => $('r-nombre').select(), 50); }

/* ───────────── conexión ───────────── */
async function conectar(c) {
  const mia = ++S.conectando;
  detenerEventos();
  S.cuenta = c; S.api = new Api(c.url, c.password, c.user);
  S.sesiones = []; S.actual = null; S.items = []; S.permisos = []; S.needsKey = undefined; S.nvidia = null;
  guardarLS(LS.actual, c.url);
  S.offline = false; S.antes = []; S.cursorAntes = null; S.tokens = '';
  vista('v-inicio');
  $('nombre-cuenta').textContent = c.name;
  $('estado-conexion').textContent = 'Conectando… (si estaba dormido, tarda hasta 1 minuto)';
  $('lista-sesiones').innerHTML = '';
  if (window.Shell) { Shell.pintarInicio(); Shell.pintarPanel(); }
  const r = await S.api.awake();
  if (mia !== S.conectando) return;
  if (!r.ok) { $('estado-conexion').textContent = ''; toast(r.error, 8000); pintarCuentas(); return; }
  if (r.status === 401) { $('estado-conexion').textContent = ''; toast('Contraseña incorrecta (401). Revisa la cuenta.', 6000); pintarCuentas(); return; }
  try {
    await cargarSesiones();
    $('estado-conexion').textContent = 'conectado';
    if (window.Shell) Shell.pintarWake();
    iniciarEventos();
    void comprobarClave().then(() => { if (window.Extra) Extra.alConectar(); });
  } catch (e) {
    $('estado-conexion').textContent = '';
    toast(e.message, 8000);
    pintarCuentas();
  }
}

async function comprobarClave() {
  try {
    const r = await S.api.get('/api/integration/nvidia');
    const con = (r && r.data && r.data.connections) || [];
    S.needsKey = con.length === 0;
    if (window.Shell) Shell.pintarClave();
  } catch { /* opcional */ }
}

async function cargarSesiones() {
  const r = await S.api.get('/api/session?limit=200&order=desc');
  const todas = ((r && r.data) || []).map(parseSesion);
  S.sesiones = todas.filter((s) => !s.archived);
  pintarSesiones();
  if (window.Extra) await Extra.alCargarSesiones(todas);
}
function fechaLarga(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString('es', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
/** Pulsación larga (o clic derecho): abre las acciones de una fila, como en el APK. */
function pulsacionLarga(el, fn) {
  let t = null, usado = false;
  const parar = () => { clearTimeout(t); t = null; };
  el.addEventListener('touchstart', () => { usado = false; t = setTimeout(() => { usado = true; fn(); }, 550); }, { passive: true });
  el.addEventListener('touchmove', parar, { passive: true });
  el.addEventListener('touchend', parar); el.addEventListener('touchcancel', parar);
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); fn(); });
  el.addEventListener('click', (e) => { if (usado) { e.stopImmediatePropagation(); e.preventDefault(); usado = false; } }, true);
}
/** Pinta el Historial completo y, de paso, los «Recientes» del inicio y del panel lateral. */
function pintarSesiones() {
  const lista = $('lista-sesiones');
  lista.innerHTML = '';
  const q = (($('buscar') && $('buscar').value) || '').trim().toLowerCase();
  const vistas = q ? S.sesiones.filter((s) => (s.title + ' ' + s.directory + ' ' + s.model).toLowerCase().includes(q)) : S.sesiones;
  if (!vistas.length) lista.innerHTML = '<p class="vacio">' + (q ? 'Ninguna sesión coincide.' : 'Aún no hay sesiones. Pulsa ＋ para crear una.') + '</p>';
  for (const s of vistas) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'fila-sesion';
    b.innerHTML = `<div class="t1">${esc(s.title)}</div><div class="t2">${esc(fechaLarga(s.updated))} · ${esc(s.directory || '')} · ${esc((s.model || '').split('/').pop())}</div>`;
    pulsacionLarga(b, () => { if (window.Extra) Extra.accionesSesion(s); });
    b.addEventListener('click', () => abrirSesion(s));
    lista.appendChild(b);
  }
  if (window.Shell) Shell.pintarRecientes();
}

/* ───────────── sesiones y chat ───────────── */
async function nuevaSesion(dir) {
  try {
    const body = { location: { directory: (dir || '').trim() || '/workspace' } };
    const r = await S.api.post('/api/session', body);
    const s = parseSesion(r.data);
    await abrirSesion(s);
    void cargarSesiones();
  } catch (e) { toast('No se pudo crear la conversación: ' + e.message, 6000); }
}

async function abrirSesion(s) {
  S.actual = s; S.items = []; S.antes = []; S.cursorAntes = null; S.tokens = ''; S.pegado = true; S.busy = false; S.elegidoAMano = false;
  vista('v-chat');
  if (window.Extra) Extra.pintarModo();
  $('titulo-chat').textContent = s.title;
  $('modelo-chat').textContent = (s.model || '').split('/').pop() || 'modelo por defecto';
  $('mensajes').innerHTML = '';
  pintarTokens(); pintarOffline();
  if (window.Shell) Shell.pintarClave();
  await refrescarChat();
  try {
    const act = await S.api.get('/api/session/active');
    S.busy = !!(act && act.data && act.data[s.id]);
  } catch { /* opcional */ }
  pintarBusy();
  void cargarPermisosPendientes();
  if (window.Extra) Extra.alAbrirSesion(s);
}

async function refrescarChat() {
  const s = S.actual; if (!s) return;
  try {
    // Los más NUEVOS primero (en sesiones largas, si no, se verían los más antiguos).
    const r = await S.api.get(`/api/session/${s.id}/message?order=desc&limit=100`);
    const datos = (r && r.data) || [];
    const lista = [...datos].reverse();
    if (S.actual && S.actual.id === s.id) {
      S.items = parseMensajes(lista); S.antes = [];
      S.cursorAntes = datos.length >= 100 && r.cursor && r.cursor.next ? String(r.cursor.next) : null;
      const ult = [...lista].reverse().find((m) => m.type === 'assistant' && m.tokens);
      S.tokens = ult ? `tokens: ${Number(ult.tokens.input) || 0} entrada · ${Number(ult.tokens.output) || 0} salida` : '';
      pintarMensajes(true); pintarTokens();
    }
    const sess = (await S.api.get(`/api/session/${s.id}`)).data;
    if (sess && S.actual && S.actual.id === s.id) {
      S.actual = parseSesion(sess);
      $('titulo-chat').textContent = S.actual.title; $('modelo-chat').textContent = (S.actual.model || '').split('/').pop() || 'modelo por defecto';
      if (window.Extra) Extra.pintarModo();
    }
    if (S.offline) { S.offline = false; pintarOffline(); }
  } catch (e) { nota('No se pudo leer la conversación: ' + e.message); }
}

/** «Cargar mensajes anteriores»: la página siguiente del cursor, que se añade por arriba. */
async function cargarAnteriores() {
  const s = S.actual; const c = S.cursorAntes;
  if (!s || !c || S.cargandoAntes) return;
  S.cargandoAntes = true; pintarMensajes(false);
  try {
    const r = await S.api.get(`/api/session/${s.id}/message?limit=100&cursor=${encodeURIComponent(c)}`);
    const datos = (r && r.data) || [];
    if (S.actual && S.actual.id === s.id) {
      S.antes = [...parseMensajes([...datos].reverse()), ...(S.antes || [])];
      S.cursorAntes = datos.length >= 100 && r.cursor && r.cursor.next ? String(r.cursor.next) : null;
    }
  } catch (e) { toast('No se pudieron cargar: ' + e.message, 5000); }
  S.cargandoAntes = false;
  const cont = $('mensajes'); const alto = cont.scrollHeight; S.pegado = false;
  pintarMensajes(false); cont.scrollTop = cont.scrollHeight - alto;
}

function nota(t) { S.items.push({ kind: 'note', key: 'note:' + Date.now() + Math.random(), text: t }); pintarMensajes(true); }

/* Filas visibles: un mensaje suelto, o un grupo plegado de razonamientos + herramientas seguidos (como en el APK). */
function construirFilas(items) {
  const out = []; let run = [];
  const cierra = () => { if (run.length) { out.push({ tipo: 'trabajo', key: 'work:' + run[0].key, items: run }); run = []; } };
  for (const it of items) { if (it.kind === 'reasoning' || it.kind === 'tool') run.push(it); else { cierra(); out.push({ tipo: 'uno', key: it.key, item: it }); } }
  cierra();
  return out;
}
const estadoTool = (s) => ({ completed: 'listo', success: 'listo', listo: 'listo', running: 'ejecutando…', pending: 'ejecutando…', ejecutando: 'ejecutando…', preparando: 'preparando…', error: 'falló', failed: 'falló', 'falló': 'falló' }[s] || s || '');

const esTecnico = () => document.body.classList.contains('tecnico');
function tituloTrabajo(items) {
  const tools = items.filter((i) => i.kind === 'tool');
  if (!esTecnico() && window.Actividad && tools.length) {
    const r = Actividad.resumen(items);
    const corriendo0 = tools.some((t) => /^(ejecutando|preparando)/.test(estadoTool(t.status)));
    return (r.texto || 'Trabajando') + (r.fallos ? ' · ' + r.fallos + (r.fallos === 1 ? ' falló' : ' fallaron') : '') + (corriendo0 ? ' · en curso…' : '');
  }
  const fallaron = tools.filter((t) => estadoTool(t.status) === 'falló').length;
  const corriendo = tools.some((t) => /^(ejecutando|preparando)/.test(estadoTool(t.status)));
  let t = '';
  if (tools.length) t += `${tools.length} ${tools.length === 1 ? 'herramienta' : 'herramientas'}`;
  if (items.some((i) => i.kind === 'reasoning')) t += (t ? ' · ' : '') + 'razonamiento';
  if (fallaron) t += ` · ${fallaron} ${fallaron === 1 ? 'falló' : 'fallaron'}`;
  if (corriendo) t += ' · ejecutando…';
  return t;
}

function nodoFila(f) {
  let el;
  if (f.tipo === 'trabajo') {
    el = document.createElement('details'); el.className = 'trabajo';
    const ult = [...f.items].reverse().find((i) => i.kind === 'tool');
    const sum = document.createElement('summary'); sum.textContent = tituloTrabajo(f.items);
    if (ult && ult.summary) { const u = document.createElement('span'); u.className = 'ultimo'; u.textContent = ult.name + ' · ' + ult.summary; sum.appendChild(u); }
    el.appendChild(sum);
    const dentro = document.createElement('div'); dentro.className = 'interior';
    for (const i of f.items) {
      if (i.kind === 'reasoning') { const r = document.createElement('div'); r.className = 'razon'; r.textContent = i.text; dentro.appendChild(r); }
      else {
        const d = document.createElement('details'); d.className = 'tool-card';
        const fr = window.Actividad ? Actividad.frase(i.name, i.input) : null;
        const est = estadoTool(i.status);
        const marca = est === 'listo' ? '✓' : est === 'falló' ? '✗' : '…';
        d.className = 'tool-card ' + (est === 'falló' ? 'fallo' : est === 'listo' ? 'ok' : 'curso');
        d.innerHTML = fr
          ? `<summary><span class="ico cat-${fr.cat}" data-i="${fr.cat}"></span> <span class="t-simple">${esc(fr.texto)}</span> <span class="t-marca">${marca}</span><span class="t-tecnico">${esc(Actividad.tecnico(i))}</span></summary><details class="detalle-tec"><summary>Ver el detalle técnico</summary><pre>${esc(i.detail)}</pre></details>`
          : `<summary>${esc(i.name)}${i.status ? ' · ' + esc(est) : ''}<span class="resumen">${esc(i.summary || '')}</span></summary><pre>${esc(i.detail)}</pre>`;
        dentro.appendChild(d);
      }
    }
    el.appendChild(dentro);
  } else {
    const it = f.item;
    if (it.kind === 'user') {
      el = document.createElement('div'); el.className = 'msg user';
      el.textContent = String(it.text).split('\n\n[Archivo ')[0];
      if (it.files && it.files.length) { for (const n of it.files) { const a = document.createElement('div'); a.className = 'archivos'; a.textContent = n; el.appendChild(a); } }
    } else if (it.kind === 'text') {
      // Las líneas «ACCION: …» son para la app, no para leerlas.
      const mostrado = window.Acciones ? Acciones.separarAcciones(it.text).texto : it.text;
      el = document.createElement('div'); el.className = 'msg text';
      el.innerHTML = `<img class="marca-w" src="icons/wichi-w.png" alt="">${markdown(mostrado)}<button type="button" class="copiar-msg">⧉  Copiar</button>`;
      el.querySelector('.copiar-msg').dataset.texto = mostrado;
    } else if (it.kind === 'checkpoint') {
      el = document.createElement('div'); el.className = 'msg note punto';
      const t = document.createElement('span'); t.innerHTML = '<span class="ico" data-i="guardar"></span> Guardé el estado del proyecto antes de cambiarlo'; el.appendChild(t);
      const tec = document.createElement('span'); tec.className = 'solo-tecnico'; tec.textContent = ' · ' + String(it.text).slice(0, 90) + ' · ' + String(it.id).slice(0, 8); el.appendChild(tec);
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn texto'; b.innerHTML = '<span class="ico" data-i="volver"></span> Volver aquí';
      b.addEventListener('click', () => void volverAPunto(it.id));
      el.appendChild(b);
    } else {
      el = document.createElement('div'); el.className = 'msg note'; el.textContent = it.text;
    }
  }
  el.dataset.key = f.key;
  return el;
}

/** Repinta solo lo que cambió (así no se pierde el desplazamiento ni lo que está abierto). */
function pintarMensajes(abajo) {
  const cont = $('mensajes');
  const cerca = cont.scrollHeight - cont.scrollTop - cont.clientHeight < 90;
  const filas = construirFilas([...(S.antes || []), ...S.items]);
  const porClave = new Map([...cont.children].map((c) => [c.dataset.key, c]));
  let btnAntes = porClave.get('antes');
  if (S.cursorAntes) {
    if (!btnAntes) { btnAntes = document.createElement('button'); btnAntes.type = 'button'; btnAntes.className = 'cargar-antes'; btnAntes.dataset.key = 'antes'; btnAntes.addEventListener('click', () => void cargarAnteriores()); cont.prepend(btnAntes); }
    btnAntes.textContent = S.cargandoAntes ? 'Cargando…' : 'Cargar mensajes anteriores';
  } else if (btnAntes) { btnAntes.remove(); btnAntes = null; }
  const vistos = new Set();
  let previo = btnAntes || null;
  for (const f of filas) {
    vistos.add(f.key);
    let el = porClave.get(f.key);
    const firma = JSON.stringify(f.tipo === 'trabajo' ? f.items.map((i) => [i.kind, i.text, i.status, i.detail, i.summary]) : [f.item.kind, f.item.text, (f.item.files || []).length]);
    if (!el || el.dataset.firma !== firma) {
      const nuevo = nodoFila(f); nuevo.dataset.firma = firma;
      if (el) { if (el.open) nuevo.open = true; el.replaceWith(nuevo); } else if (previo) previo.after(nuevo); else cont.prepend(nuevo);
      el = nuevo;
    }
    previo = el;
  }
  for (const [k, el] of porClave) if (!vistos.has(k) && k !== 'escribiendo' && k !== 'antes') el.remove();
  let esc2 = cont.querySelector('[data-key=escribiendo]');
  const ultima = filas[filas.length - 1];
  if (S.busy && !(ultima && ultima.tipo === 'uno' && ultima.item.kind === 'text')) {
    if (!esc2) { esc2 = document.createElement('div'); esc2.className = 'escribiendo'; esc2.dataset.key = 'escribiendo'; esc2.innerHTML = '<img src="icons/wichi-w.png" alt=""><span>Pensando…</span>'; }
    cont.appendChild(esc2);
  } else if (esc2) esc2.remove();
  pintarEstadoVivo();
  if (abajo || S.pegado !== false || cerca) cont.scrollTop = cont.scrollHeight;
  $('btn-final').hidden = cont.scrollHeight - cont.scrollTop - cont.clientHeight < 90 || !filas.length;
}

function pintarEstadoVivo() {
  const el = $('estado-vivo'); if (!el) return;
  const v = window.Actividad ? Actividad.vivo(S.items, S.busy) : null;
  el.hidden = !v;
  if (v) { const ei = el.querySelector('.ev-ico'); ei.className = 'ev-ico ico cat-' + v.cat; ei.setAttribute('data-i', v.cat); el.querySelector('.ev-txt').textContent = v.texto; }
}
function pintarBusy() {
  $('btn-parar').hidden = !S.busy;
  $('barra-ocupado').hidden = !S.busy;
  pintarEstadoVivo();
  pintarMensajes(false);
  if (window.Shell) Shell.actualizarComposer();
}

function pintarTokens() { const t = S.tokens || ''; $('tokens-linea').hidden = !t; $('tokens-linea').textContent = t; }
function pintarOffline() { for (const id of ['chat-offline', 'hi-offline']) { const e = $(id); if (e) e.hidden = !S.offline; } }

function upsert(key, hacer) {
  const i = S.items.findIndex((x) => x.key === key);
  const nuevo = hacer(i >= 0 ? S.items[i] : undefined);
  if (i >= 0) S.items[i] = nuevo; else S.items.push(nuevo);
  pintarMensajes(false);
}

/* ───────────── eventos en directo ───────────── */
function detenerEventos() { if (S.abortEventos) { S.abortEventos.abort(); S.abortEventos = null; } }
function iniciarEventos() {
  detenerEventos();
  const ac = new AbortController(); S.abortEventos = ac;
  const api = S.api;
  (async () => {
    let fallos = 0;
    while (!ac.signal.aborted && S.api === api) {
      try {
        await api.events(ac.signal, manejarEvento);
        fallos = 0;
      } catch (e) {
        if (ac.signal.aborted) return;
        fallos++;
        if (fallos >= 2 && !S.offline) { S.offline = true; pintarOffline(); }   // «Sin conexión con el servidor. Reintentando…»
      }
      if (ac.signal.aborted) return;
      await sleep(Math.min(1500 * (fallos + 1), 10000));
      // tras un corte se relee la conversación abierta para quedar exactos
      if (S.actual) void refrescarChat();
    }
  })();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.api) {
    if (!S.abortEventos || S.abortEventos.signal.aborted) iniciarEventos();
    if (S.actual) void refrescarChat();
    else if (S.sesiones.length || !$('v-inicio').hidden) void cargarSesiones().catch(() => {});
  }
});

function manejarEvento(ev) {
  if (S.offline) { S.offline = false; pintarOffline(); }
  const type = String(ev.type || ''); const data = ev.data || {}; const sid = String(data.sessionID || '');
  if (type.startsWith('permission.')) {
    const req = data.request || data;
    if (type === 'permission.asked') añadirPermiso(req);
    else if (type === 'permission.replied') { const id = String(data.requestID || data.id || ''); S.permisos = S.permisos.filter((p) => p.id !== id); pintarPermisos(); }
    return;
  }
  if (type.startsWith('session.execution.') && (!S.actual || sid !== S.actual.id)) { void cargarSesiones().catch(() => {}); return; }
  if (!sid || !S.actual || sid !== S.actual.id) return;
  const mid = String(data.assistantMessageID || ''); const ord = Number(data.ordinal || 0);
  const kt = `live:text:${mid}:${ord}`; const kr = `live:think:${mid}:${ord}`;
  switch (type) {
    case 'session.checkpoint': {
      const k = 'cp:' + String(data.id || Date.now());
      upsert(k, () => ({ kind: 'checkpoint', key: k, id: String(data.id || ''), text: String(data.etiqueta || 'Punto de restauración') }));
      break;
    }
    case 'session.compacted': nota('La conversación era muy larga: resumí lo viejo para poder seguir sin perder el hilo (' + String(data.resumidos || '') + ' mensajes archivados).'); break;
    case 'session.checkpoint.restored': nota('Volví el proyecto a un punto anterior.'); break;
    case 'session.team.changed': S.actual = { ...S.actual, equipo: !!data.activo }; if (!data.activo && window.Extra) Extra.equipo = null; if (window.Extra) Extra.pintarEquipo(); break;
    case 'session.team.updated': if (window.Extra) { Extra.equipo = data.equipo || null; Extra.pintarEquipo(); } break;
    case 'session.mode.changed': S.actual = { ...S.actual, modo: data.modo === 'plan' || data.modo === 'auto' ? data.modo : '' }; if (window.Extra) Extra.pintarModo(); break;
    case 'session.execution.started': S.busy = true; pintarBusy(); break;
    case 'session.execution.succeeded': case 'session.execution.failed': case 'session.execution.interrupted':
      S.busy = false; pintarBusy(); setTimeout(() => void refrescarChat(), 300); void cargarSesiones().catch(() => {}); if (window.Extra) Extra.alTurno(sid);
      // Si el agente pidió acciones del teléfono en el chat escrito, se preguntan después de que se vea la respuesta.
      if (window.Acciones && type === 'session.execution.succeeded') setTimeout(() => void Acciones.alTerminar(), 1200);
      break;
    case 'session.text.started': upsert(kt, () => ({ kind: 'text', key: kt, text: '' })); break;
    case 'session.text.delta': upsert(kt, (o) => ({ kind: 'text', key: kt, text: ((o && o.text) || '') + String(data.delta || '') })); break;
    case 'session.reasoning.started': upsert(kr, () => ({ kind: 'reasoning', key: kr, text: '' })); break;
    case 'session.reasoning.delta': upsert(kr, (o) => ({ kind: 'reasoning', key: kr, text: ((o && o.text) || '') + String(data.delta || '') })); break;
    case 'session.tool.input.started': { const k = 'live:tool:' + toolKey(data); upsert(k, () => ({ kind: 'tool', key: k, name: String(data.name || 'herramienta'), status: 'preparando', summary: '', input: null, detail: '' })); break; }
    case 'session.tool.called': {
      const k = 'live:tool:' + toolKey(data); const inp = data.input || (data.state && data.state.input);
      upsert(k, (o) => ({ kind: 'tool', key: k, name: o && o.name && o.name !== 'herramienta' ? o.name : toolName(data, 'herramienta'), status: 'ejecutando', summary: resumir(inp), input: inp || null, detail: inp ? JSON.stringify(inp, null, 2).slice(0, 1500) : (o && o.detail) || '' }));
      break;
    }
    case 'session.tool.success': case 'session.tool.failed': {
      const k = 'live:tool:' + toolKey(data);
      upsert(k, (o) => {
        let out = (o && o.detail) || '';
        for (const c of data.content || []) if (c && c.type === 'text') out += '\n\n' + String(c.text).slice(0, 2500);
        return { kind: 'tool', key: k, name: (o && o.name) || toolName(data, 'herramienta'), status: type.endsWith('success') ? 'listo' : 'falló', summary: (o && o.summary) || '', input: (o && o.input) || null, detail: out.trim() || JSON.stringify(data).slice(0, 1500) };
      });
      break;
    }
  }
}

/* ───────────── volver a un punto de restauración ───────────── */
async function volverAPunto(id) {
  if (!S.actual || !id) return;
  try {
    const v = await S.api.get('/api/session/' + S.actual.id + '/puntos/' + id + '/vista');
    const lista = ((v && v.data) || []).slice(0, 12).map((x) => (x.estado === 'D' ? 'Se recuperará: ' : x.estado === 'A' ? 'Se quitará: ' : 'Se restaurará: ') + x.archivo);
    const txt = lista.length ? lista.join('\n') : 'No hay diferencias con el estado actual.';
    if (!window.confirm('¿Volver el proyecto a ese punto?\n\n' + txt + '\n\nEl estado actual también se guarda, así que se puede deshacer.')) return;
    await S.api.post('/api/session/' + S.actual.id + '/puntos/' + id + '/restaurar', {});
  } catch (e) { nota('No se pudo volver atrás: ' + e.message); }
}

/* ───────────── permisos ───────────── */
function añadirPermiso(o) {
  const id = String(o.id || '');
  if (!id || S.permisos.some((p) => p.id === id)) return;
  S.permisos.push({ id, sessionID: String(o.sessionID || ''), action: String(o.action || ''), resources: (o.resources || []).map(String), message: String(o.message || '') });
  pintarPermisos();
}
async function cargarPermisosPendientes() {
  if (!S.actual) return;
  const dirs = new Set(['/workspace', S.actual.directory].filter(Boolean));
  for (const d of dirs) {
    try { const r = await S.api.get('/api/permission/request?' + locationQuery(d)); for (const p of (r && r.data) || []) añadirPermiso(p); } catch { /* nada */ }
  }
}
function pintarPermisos() {
  const cont = $('permisos');
  cont.innerHTML = '';
  for (const p of S.permisos.filter((x) => !S.actual || x.sessionID === S.actual.id)) {
    const el = document.createElement('div'); el.className = 'permiso';
    const pm = window.Actividad ? Actividad.permiso(p) : null;
    if (pm) {
      el.className = 'permiso' + (pm.irreversible ? ' irreversible' : '');
      el.innerHTML = `${pm.irreversible ? '<div class="p-alerta"><span class="ico" data-i="alerta"></span> Esto no se puede deshacer</div>' : ''}<div class="p-titulo">${esc(pm.titulo)}</div>${pm.motivo ? '<div class="p-motivo">' + esc(pm.motivo) + '</div>' : ''}<div class="p-tecnico"><code>${esc(pm.tecnico)}</code></div>
      <div class="acciones"><button class="btn principal" data-d="once">Permitir esta vez</button>${pm.irreversible ? '' : '<button class="btn" data-d="always">Siempre</button>'}<button class="btn" data-d="reject">No permitir</button></div>`;
    } else el.innerHTML = `<div><b>Permiso:</b> ${esc(p.action || 'acción')}${p.message ? ' · ' + esc(p.message) : ''}</div>${p.resources.length ? '<div><code>' + esc(p.resources.join(', ')) + '</code></div>' : ''}
      <div class="acciones"><button class="btn principal" data-d="once">Permitir una vez</button><button class="btn" data-d="always">Siempre</button><button class="btn" data-d="reject">Rechazar</button></div>`;
    el.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => responderPermiso(p, b.dataset.d)));
    cont.appendChild(el);
  }
}
async function responderPermiso(p, decision) {
  S.permisos = S.permisos.filter((x) => x.id !== p.id); pintarPermisos();
  try { await S.api.post(`/api/session/${p.sessionID}/permission/${p.id}/reply`, { decision }); } catch (e) { nota('No se pudo responder el permiso: ' + e.message); }
}

/* ───────────── enviar ───────────── */
/** Si la conversación quedó con el modelo gratuito de un servidor anterior (sin cupo), la pasa a NVIDIA antes de enviar. */
async function asegurarNvidia() {
  const s = S.actual; if (!s || S.elegidoAMano) return;
  try {
    if (S.needsKey === undefined) await comprobarClave();
    if (S.needsKey !== false) return;
    // Se pregunta al servidor el modelo REAL de la conversación (el texto local puede no traer el proveedor).
    const real = ((await S.api.get(`/api/session/${s.id}`)).data || {}).model;
    if (real && real.providerID === 'nvidia') return;
    const m = window.Extra ? await Extra.modeloPreferido() : null;
    if (!m) return;
    await S.api.post(`/api/session/${s.id}/model`, { model: { id: m.id, providerID: m.providerID } });
    $('modelo-chat').textContent = `${m.providerID}/${m.id}`;
  } catch { /* se intenta igual */ }
}

async function enviar(texto, op = {}) {
  texto = texto.trim();
  const hayAdj = !!(window.Extra && Extra.adjuntos.length);
  if ((!texto && !hayAdj) || !S.actual) return;
  // La clave de NVIDIA pegada en el mensaje se guarda en el servidor y NO se manda al modelo.
  const clave = texto.match(/nvapi-[A-Za-z0-9_-]{20,}/);
  if (clave && window.Extra) {
    S.items.push({ kind: 'user', key: 'local:' + Date.now(), text: 'nvapi-••••••••••••', files: [] }); pintarMensajes(true);
    const resto = texto.replace(clave[0], '').trim();
    await Extra.guardarClave(clave[0]);
    if (resto) void enviar(resto);
    return;
  }
  if (S.needsKey === true && !texto.startsWith('/')) { nota('El servidor no tiene tu clave de NVIDIA. Guárdala en Ajustes o pégala aquí en el chat.'); return; }
  S.busy = true; pintarBusy();
  try {
    if (texto.startsWith('/')) {
      const nombre = texto.slice(1).split(/\s+/)[0]; const resto = texto.slice(1 + nombre.length).trim();
      S.items.push({ kind: 'user', key: 'local:' + Date.now(), text: texto, files: [] }); pintarMensajes(true);
      await S.api.post(`/api/session/${S.actual.id}/command`, { name: nombre, text: resto });
    } else {
      const adj = window.Extra ? await Extra.prepararAdjuntos(texto) : { text: texto, files: [], nombres: [] };
      S.items.push({ kind: 'user', key: 'local:' + Date.now(), text: texto || adj.text, files: adj.nombres }); pintarMensajes(true);
      await asegurarNvidia();
      // El agente recibe (oculto en el chat) cómo pedir acciones del teléfono: en voz siempre, en el chat escrito la primera vez de cada conversación.
      const cuerpo = { text: window.Acciones ? Acciones.conProtocolo(adj.text, S.actual.id, !!op.voz) : adj.text };
      if (adj.files.length) cuerpo.files = adj.files;
      await S.api.post(`/api/session/${S.actual.id}/prompt`, cuerpo);
    }
  } catch (e) { S.busy = false; pintarBusy(); nota('No se pudo enviar: ' + e.message); }
}

/* ───────────── eventos de la interfaz ───────────── */
function ajustarAltura(el) { const t = el || $('entrada'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 160) + 'px'; }

function abrirClave() { $('form-clave').reset(); $('dlg-clave').showModal(); }

function iniciarUI() {
  // ── Conectar
  $('form-conectar').addEventListener('submit', (e) => {
    e.preventDefault();
    const url = $('cx-url').value.trim(); const clave = $('cx-clave').value.trim();
    if (!url || !clave) { toast('Escribe la dirección y la contraseña del servidor.'); return; }
    const tipo = /\.onrender\.com/i.test(url) ? 'cowork' : 'vps';
    const c = Cuentas.añadir($('cx-nombre').value, tipo, url, clave, $('cx-user').value);
    $('form-conectar').reset();
    void conectar(c);
  });
  $('cx-ver').addEventListener('click', () => { const i = $('cx-clave'); const ver = i.type === 'password'; i.type = ver ? 'text' : 'password'; $('cx-ver').textContent = ver ? 'Ocultar' : 'Ver'; });
  $('cx-qr').addEventListener('click', () => { if (window.Qr) Qr.escanear(); else toast('El escáner no está disponible.'); });
  $('cx-guias').addEventListener('click', () => { if (window.Guias) { if (Sesion.leer()) Guias.hospedaje(); else Guias.cuenta(); } });
  // ── Cuentas
  document.querySelectorAll('input[name=c-tipo]').forEach((r) => r.addEventListener('change', actualizarAyudaTipo));
  $('c-cancelar').addEventListener('click', () => $('dlg-cuenta').close());
  $('form-cuenta').addEventListener('submit', (e) => {
    e.preventDefault();
    const tipo = document.querySelector('input[name=c-tipo]:checked').value;
    const c = Cuentas.añadir($('c-nombre').value, tipo, $('c-url').value, $('c-clave').value, $('c-user').value);
    $('dlg-cuenta').close();
    void conectar(c);
  });
  $('r-cancelar').addEventListener('click', () => $('dlg-renombrar').close());
  $('form-renombrar').addEventListener('submit', (e) => {
    e.preventDefault();
    if (cuentaRenombrando) { Cuentas.renombrar(cuentaRenombrando, $('r-nombre').value); if (S.cuenta === cuentaRenombrando) $('nombre-cuenta').textContent = cuentaRenombrando.name; }
    $('dlg-renombrar').close();
    if (!$('v-cuentas').hidden) pintarCuentas();
    if (!$('v-ajustes').hidden && window.Extra) Extra.pintarAjustes();
    if (window.Shell) Shell.pintarPanel();
  });
  $('ca-cerrar').addEventListener('click', () => $('dlg-cuenta-acciones').close());
  $('ca-renombrar').addEventListener('click', () => { $('dlg-cuenta-acciones').close(); if (cuentaSel) pedirRenombrar(cuentaSel); });
  $('ca-qr').addEventListener('click', () => { $('dlg-cuenta-acciones').close(); if (cuentaSel && window.Qr) Qr.mostrarCuenta(cuentaSel); });
  $('ca-olvidar').addEventListener('click', () => {
    $('dlg-cuenta-acciones').close();
    if (cuentaSel && confirm(`¿Olvidar la cuenta «${cuentaSel.name}»? Solo se borra de este dispositivo.`)) { Cuentas.olvidar(cuentaSel); if (!$('v-ajustes').hidden && window.Extra) Extra.pintarAjustes(); else pintarCuentas(); }
  });
  // ── Chat
  $('btn-atras').addEventListener('click', () => { if (window.Extra && S.actual) Extra.alCerrarChat(S.actual.id); S.actual = null; vista('v-inicio'); if (window.Shell) Shell.pintarInicio(); void cargarSesiones().catch(() => {}); });
  $('btn-parar').addEventListener('click', async () => { try { await S.api.post(`/api/session/${S.actual.id}/interrupt`); } catch (e) { toast('No se pudo detener: ' + e.message); } });
  $('btn-modelo').addEventListener('click', () => { if (window.Extra) void Extra.abrirModelos(); });
  $('btn-agente').addEventListener('click', () => { if (window.Extra) void Extra.abrirAgentes(); });
  $('btn-modo').addEventListener('click', () => { if (window.Extra) Extra.abrirModos(); });
  const aplicarTecnico = (on) => { document.body.classList.toggle('tecnico', on); const b = $('btn-tecnico'); if (b) { b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.classList.toggle('activo', on); } pintarMensajes(false); };
  aplicarTecnico(leerLS('wichi.tecnico') === '1');
  $('btn-tecnico').addEventListener('click', () => { const on = !document.body.classList.contains('tecnico'); guardarLS('wichi.tecnico', on ? '1' : '0'); aplicarTecnico(on); });
  $('btn-equipo').addEventListener('click', () => { if (window.Extra) Extra.abrirEquipo(); });
  $('equipo-cerrar').addEventListener('click', () => $('dlg-equipo').close());
  $('modo-cerrar').addEventListener('click', () => $('dlg-modo').close());
  $('auto-no').addEventListener('click', () => $('dlg-auto').close());
  $('auto-si').addEventListener('click', () => { $('dlg-auto').close(); if (window.Extra) void Extra.cambiarModo('auto', true); });
  $('ag-cerrar').addEventListener('click', () => $('dlg-agente').close());
  $('ag-aprobar').addEventListener('click', () => { $('dlg-agente').close(); if (window.Extra) void Extra.aprobarPlan(); });
  $('k-cancelar').addEventListener('click', () => $('dlg-clave').close());
  $('form-clave').addEventListener('submit', async (e) => {
    e.preventDefault();
    const k = $('k-clave').value.trim();
    $('dlg-clave').close();
    if (k.length < 11) { toast('Pega la clave completa.'); return; }
    if (window.Extra) await Extra.guardarClave(k);
  });
  $('form-envio').addEventListener('submit', (e) => {
    e.preventDefault();
    const t = $('entrada').value; $('entrada').value = ''; ajustarAltura();
    S.pegado = true;
    void enviar(t);
    if (window.Shell) Shell.actualizarComposer();
  });
  $('entrada').addEventListener('input', () => { ajustarAltura(); if (window.Shell) Shell.actualizarComposer(); });
  // «Enviar» en el teclado del iPhone (enterkeyhint=send) y Enter en un ordenador envían; Mayús+Enter hace salto de línea.
  $('entrada').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('form-envio').requestSubmit(); }
  });
  $('mensajes').addEventListener('click', (e) => {
    const b = e.target.closest('.copiar');
    if (b) {
      const code = b.parentElement.querySelector('code').textContent;
      (navigator.clipboard ? navigator.clipboard.writeText(code) : Promise.reject()).then(() => { b.textContent = 'Copiado'; setTimeout(() => { b.textContent = 'Copiar'; }, 1500); }).catch(() => toast('No se pudo copiar.'));
      return;
    }
    const m = e.target.closest('.copiar-msg');
    if (m) (navigator.clipboard ? navigator.clipboard.writeText(m.dataset.texto || '') : Promise.reject()).then(() => { m.textContent = '✓  Copiado'; setTimeout(() => { m.textContent = '⧉  Copiar'; }, 1500); }).catch(() => toast('No se pudo copiar.'));
  });
  $('mensajes').addEventListener('scroll', () => {
    const c = $('mensajes'); const lejos = c.scrollHeight - c.scrollTop - c.clientHeight > 90;
    S.pegado = !lejos; $('btn-final').hidden = !lejos;
  }, { passive: true });
  $('btn-final').addEventListener('click', () => { S.pegado = true; $('mensajes').scrollTop = $('mensajes').scrollHeight; $('btn-final').hidden = true; });
}

/* ───────────── arranque ───────────── */
/** Pantallas a las que vuelven las guías de bienvenida. */
window.abrirInicio = () => { if (S.api) { vista('v-inicio'); if (window.Shell) Shell.pintarInicio(); } else pintarCuentas(); };
window.abrirConectar = () => pintarCuentas();
window.alOmitirClave = () => { if (S.api) window.abrirInicio(); };

function entrar() {
  // Enlace de conexión: …/#conectar?u=<url>&p=<contraseña>&n=<nombre>&k=<cowork|vps>&w=<usuario> (el que genera el QR de la app)
  const h = location.hash;
  if (h.startsWith('#conectar?')) {
    const q = new URLSearchParams(h.slice('#conectar?'.length));
    const u = q.get('u'); const p = q.get('p');
    history.replaceState(null, '', location.pathname + location.search); // la contraseña no se queda en la barra ni en el historial
    if (u && p) { const k = q.get('k'); const c = Cuentas.añadir(q.get('n') || '', k === 'local' ? 'local' : k === 'vps' ? 'vps' : 'cowork', u, p, q.get('w') || ''); void conectar(c); return; }
  }
  const ultima = leerLS(LS.actual);
  const c = Cuentas.lista.find((x) => x.url === ultima) || (Cuentas.lista.length === 1 ? Cuentas.lista[0] : null);
  if (c) { void conectar(c); return; }
  // Primera vez: crear la cuenta de Wichi y elegir dónde hospedar el servidor (como el APK).
  if (!Cuentas.lista.length && window.Guias) { if (Sesion.leer()) Guias.hospedaje(); else Guias.cuenta(); return; }
  pintarCuentas();
}

function arrancar() {
  Cuentas.cargar();
  iniciarUI();
  if (window.Shell) Shell.iniciar();
  // Si volvemos de iniciar sesión en Spotify, se termina primero (la URL trae ?code=…).
  const sp = window.Spotify ? Promise.resolve(Spotify.alCargar()).catch(() => false) : Promise.resolve(false);
  void sp.then(entrar);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { /* sin instalación sin conexión */ });
}
// Los demás scripts (funciones, acciones, voz, shell…) se cargan después de este: se arranca cuando ya están todos.
// (con scripts «defer» el documento ya está «interactive» al ejecutarse este; DOMContentLoaded llega cuando todos terminaron)
if (document.readyState === 'complete') arrancar(); else document.addEventListener('DOMContentLoaded', arrancar);
