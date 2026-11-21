'use strict';
/* Wichi PWA: cliente web de Wichi para iPhone (y cualquier navegador moderno).
   Habla con un servidor OpenCode/Wichinion por su API HTTP (usuario «opencode» + contraseña).
   Sin dependencias ni compilación. Los datos (cuentas) viven solo en este dispositivo (localStorage). */

const $ = (id) => document.getElementById(id);
const LS = { cuentas: 'wichi.cuentas', actual: 'wichi.actual' };

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
  añadir(nombre, tipo, url, clave) {
    const u = this.normalizarUrl(url, tipo);
    let host = u; try { host = new URL(u).host; } catch { /* queda la dirección */ }
    const previo = this.lista.find((x) => x.url === u); // volver a añadir la misma dirección la reemplaza sin cambiarle el nombre
    const c = { name: this.nombreLibre(nombre || host, previo), kind: tipo === 'local' ? 'local' : 'cowork', url: u, password: clave.trim() };
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
  constructor(base, password) {
    this.base = base.trim().replace(/\/+$/, '');
    this.auth = 'Basic ' + b64('opencode:' + password);
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
  };
}
function parseMensajes(arr) {
  const out = [];
  for (const m of arr) {
    if (m.type === 'user') {
      out.push({ kind: 'user', key: String(m.id), text: String(m.text || ''), files: (m.files || []).map((f) => String(f.name || 'archivo')) });
    } else if (m.type === 'assistant') {
      (m.content || []).forEach((p, i) => {
        const key = `${m.id}:${i}`;
        if (p.type === 'text') out.push({ kind: 'text', key, text: String(p.text || '') });
        else if (p.type === 'reasoning') out.push({ kind: 'reasoning', key, text: String(p.text || '') });
        else out.push({ kind: 'tool', key, name: toolName(p, String(p.type)), status: toolStatus(p), summary: resumir(p.state && p.state.input), detail: detalleTool(p) });
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
};

function vista(id) {
  for (const v of ['v-cuentas', 'v-inicio', 'v-chat']) $(v).hidden = v !== id;
}

/* ───────────── pantalla: cuentas ───────────── */
function esStandalone() { return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches; }
function pintarCuentas() {
  vista('v-cuentas');
  const esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  $('aviso-instalar').hidden = !(esIOS && !esStandalone());
  const lista = $('lista-cuentas');
  lista.innerHTML = '';
  if (!Cuentas.lista.length) lista.innerHTML = '<p class="suave">Todavía no tienes cuentas.</p>';
  for (const c of Cuentas.lista) {
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `<div class="txt"><div class="t1">${c.kind === 'cowork' ? '☁' : '🖥'} ${esc(c.name)}</div><div class="t2">${esc(c.url)}</div></div>
      <div class="acc"><button class="mini" data-a="ren">Renombrar</button><button class="mini" data-a="del">Olvidar</button></div>`;
    const txtC = el.querySelector('.txt'); txtC.setAttribute('role', 'button'); txtC.tabIndex = 0;
    txtC.addEventListener('click', () => conectar(c));
    txtC.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); conectar(c); } });
    el.querySelector('[data-a=ren]').addEventListener('click', (e) => { e.stopPropagation(); pedirRenombrar(c); });
    el.querySelector('[data-a=del]').addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`¿Olvidar la cuenta «${c.name}»? Solo se borra de este teléfono.`)) { Cuentas.olvidar(c); pintarCuentas(); }
    });
    lista.appendChild(el);
  }
  const hayHttp = location.protocol === 'https:' && Cuentas.lista.some((c) => c.url.startsWith('http://'));
  $('aviso-https').hidden = !hayHttp;
  if (hayHttp) $('aviso-https').textContent = 'Hay cuentas con dirección http: desde una página https el navegador las bloquea. Funcionan las de la nube (https).';
}

function abrirDialogoCuenta(prefill) {
  const f = $('form-cuenta');
  f.reset();
  $('c-nombre').value = (prefill && prefill.name) || '';
  actualizarAyudaTipo();
  $('dlg-cuenta').showModal();
}
function actualizarAyudaTipo() {
  const tipo = document.querySelector('input[name=c-tipo]:checked').value;
  $('c-url').placeholder = tipo === 'cowork' ? 'https://…onrender.com' : '192.168.1.5';
  $('c-ayuda').textContent = tipo === 'cowork'
    ? 'Servidor en la nube (https). El tipo solo indica cómo conectar; el nombre es el que escribiste.'
    : 'Tu PC en la misma red. Ojo: desde una página https el navegador bloquea servidores http.';
}
let cuentaRenombrando = null;
function pedirRenombrar(c) { cuentaRenombrando = c; $('r-nombre').value = c.name; $('dlg-renombrar').showModal(); setTimeout(() => $('r-nombre').select(), 50); }

/* ───────────── conexión ───────────── */
async function conectar(c) {
  const mia = ++S.conectando;
  detenerEventos();
  S.cuenta = c; S.api = new Api(c.url, c.password);
  S.sesiones = []; S.actual = null; S.items = []; S.permisos = []; S.needsKey = undefined; S.nvidia = null;
  guardarLS(LS.actual, c.url);
  vista('v-inicio');
  $('nombre-cuenta').textContent = c.name;
  $('estado-conexion').textContent = 'Conectando… (si estaba dormido, tarda hasta 1 minuto)';
  $('lista-sesiones').innerHTML = '';
  const r = await S.api.awake();
  if (mia !== S.conectando) return;
  if (!r.ok) { $('estado-conexion').textContent = ''; toast(r.error, 8000); pintarCuentas(); return; }
  if (r.status === 401) { $('estado-conexion').textContent = ''; toast('Contraseña incorrecta (401). Revisa la cuenta.', 6000); pintarCuentas(); return; }
  try {
    await cargarSesiones();
    $('estado-conexion').textContent = 'conectado';
    iniciarEventos();
    void comprobarClave();
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
    $('aviso-clave').hidden = !S.needsKey;
  } catch { /* opcional */ }
}

async function cargarSesiones() {
  const r = await S.api.get('/api/session?limit=200&order=desc');
  S.sesiones = ((r && r.data) || []).map(parseSesion).filter((s) => !s.archived);
  pintarSesiones();
}
function fechaCorta(ms) {
  if (!ms) return '';
  const d = new Date(ms); const hoy = new Date();
  const mismo = d.toDateString() === hoy.toDateString();
  return mismo ? d.toLocaleTimeString('es', { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString('es', { day: 'numeric', month: 'short' });
}
function pintarSesiones() {
  const lista = $('lista-sesiones');
  lista.innerHTML = '';
  if (!S.sesiones.length) lista.innerHTML = '<p class="suave">Aún no hay conversaciones.</p>';
  for (const s of S.sesiones) {
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `<div class="txt"><div class="t1">${esc(s.title)}</div><div class="t2">${esc(fechaCorta(s.updated))} · ${esc(s.directory || '')}</div></div>`;
    el.setAttribute('role', 'button'); el.tabIndex = 0;
    el.addEventListener('click', () => abrirSesion(s));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirSesion(s); } });
    lista.appendChild(el);
  }
}

/* ───────────── sesiones y chat ───────────── */
async function nuevaSesion() {
  try {
    const body = { location: { directory: '/workspace' } };
    const r = await S.api.post('/api/session', body);
    const s = parseSesion(r.data);
    await abrirSesion(s);
    void cargarSesiones();
  } catch (e) { toast('No se pudo crear la conversación: ' + e.message, 6000); }
}

async function abrirSesion(s) {
  S.actual = s; S.items = []; S.busy = false; S.elegidoAMano = false;
  vista('v-chat');
  $('titulo-chat').textContent = s.title;
  $('modelo-chat').textContent = s.model;
  $('mensajes').innerHTML = '';
  await refrescarChat();
  try {
    const act = await S.api.get('/api/session/active');
    S.busy = !!(act && act.data && act.data[s.id]);
  } catch { /* opcional */ }
  pintarBusy();
  void cargarPermisosPendientes();
}

async function refrescarChat() {
  const s = S.actual; if (!s) return;
  try {
    // Los más NUEVOS primero (en sesiones largas, si no, se verían los más antiguos).
    const r = await S.api.get(`/api/session/${s.id}/message?order=desc&limit=100`);
    const lista = [...((r && r.data) || [])].reverse();
    if (S.actual && S.actual.id === s.id) { S.items = parseMensajes(lista); pintarMensajes(true); }
    const sess = (await S.api.get(`/api/session/${s.id}`)).data;
    if (sess && S.actual && S.actual.id === s.id) {
      S.actual = parseSesion(sess);
      $('titulo-chat').textContent = S.actual.title; $('modelo-chat').textContent = S.actual.model;
    }
  } catch (e) { nota('No se pudo leer la conversación: ' + e.message); }
}

function nota(t) { S.items.push({ kind: 'note', key: 'note:' + Date.now() + Math.random(), text: t }); pintarMensajes(true); }

function nodoItem(it) {
  let el;
  if (it.kind === 'user') {
    el = document.createElement('div'); el.className = 'msg user';
    el.textContent = it.text;
    if (it.files && it.files.length) { const f = document.createElement('div'); f.className = 'archivos'; f.textContent = '📎 ' + it.files.join(', '); el.appendChild(f); }
  } else if (it.kind === 'text') {
    el = document.createElement('div'); el.className = 'msg text'; el.innerHTML = markdown(it.text);
  } else if (it.kind === 'note') {
    el = document.createElement('div'); el.className = 'msg note'; el.textContent = it.text;
  } else if (it.kind === 'reasoning') {
    el = document.createElement('details'); el.className = 'detalle pensando';
    el.innerHTML = `<summary>💭 Pensando…</summary><pre>${esc(it.text)}</pre>`;
  } else {
    el = document.createElement('details'); el.className = 'detalle';
    const ic = /fall/i.test(it.status) ? '✖' : /listo|success|complet/i.test(it.status) ? '✔' : '⚙';
    el.innerHTML = `<summary>${ic} <b>${esc(it.name)}</b> <span class="estado-tool">${esc(it.summary || it.status)}</span></summary><pre>${esc(it.detail)}</pre>`;
  }
  el.dataset.key = it.key;
  return el;
}

/** Repinta solo lo que cambió (así no se pierde el desplazamiento ni lo que está abierto). */
function pintarMensajes(abajo) {
  const cont = $('mensajes');
  const cercaDelFinal = cont.scrollHeight - cont.scrollTop - cont.clientHeight < 140;
  const porClave = new Map([...cont.children].map((c) => [c.dataset.key, c]));
  const vistos = new Set();
  let previo = null;
  for (const it of S.items) {
    vistos.add(it.key);
    let el = porClave.get(it.key);
    const firma = it.kind + '|' + (it.text || '') + '|' + (it.status || '') + '|' + (it.detail || '') + '|' + (it.summary || '');
    if (!el || el.dataset.firma !== firma) {
      const nuevo = nodoItem(it); nuevo.dataset.firma = firma;
      if (el) { if (el.open) nuevo.open = true; el.replaceWith(nuevo); } else if (previo) previo.after(nuevo); else cont.prepend(nuevo);
      el = nuevo;
    }
    previo = el;
  }
  for (const [k, el] of porClave) if (!vistos.has(k) && k !== 'escribiendo') el.remove();
  let esc2 = cont.querySelector('[data-key=escribiendo]');
  if (S.busy) {
    if (!esc2) { esc2 = document.createElement('div'); esc2.className = 'escribiendo'; esc2.dataset.key = 'escribiendo'; esc2.textContent = 'Wichi está trabajando…'; }
    cont.appendChild(esc2);
  } else if (esc2) esc2.remove();
  if (abajo || cercaDelFinal) cont.scrollTop = cont.scrollHeight;
}

function pintarBusy() {
  $('btn-parar').hidden = !S.busy;
  pintarMensajes(false);
}

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
    case 'session.execution.started': S.busy = true; pintarBusy(); break;
    case 'session.execution.succeeded': case 'session.execution.failed': case 'session.execution.interrupted':
      S.busy = false; pintarBusy(); setTimeout(() => void refrescarChat(), 300); void cargarSesiones().catch(() => {}); break;
    case 'session.text.started': upsert(kt, () => ({ kind: 'text', key: kt, text: '' })); break;
    case 'session.text.delta': upsert(kt, (o) => ({ kind: 'text', key: kt, text: ((o && o.text) || '') + String(data.delta || '') })); break;
    case 'session.reasoning.started': upsert(kr, () => ({ kind: 'reasoning', key: kr, text: '' })); break;
    case 'session.reasoning.delta': upsert(kr, (o) => ({ kind: 'reasoning', key: kr, text: ((o && o.text) || '') + String(data.delta || '') })); break;
    case 'session.tool.input.started': { const k = 'live:tool:' + toolKey(data); upsert(k, () => ({ kind: 'tool', key: k, name: String(data.name || 'herramienta'), status: 'preparando', summary: '', detail: '' })); break; }
    case 'session.tool.called': {
      const k = 'live:tool:' + toolKey(data); const inp = data.input || (data.state && data.state.input);
      upsert(k, (o) => ({ kind: 'tool', key: k, name: o && o.name && o.name !== 'herramienta' ? o.name : toolName(data, 'herramienta'), status: 'ejecutando', summary: resumir(inp), detail: inp ? JSON.stringify(inp, null, 2).slice(0, 1500) : (o && o.detail) || '' }));
      break;
    }
    case 'session.tool.success': case 'session.tool.failed': {
      const k = 'live:tool:' + toolKey(data);
      upsert(k, (o) => {
        let out = (o && o.detail) || '';
        for (const c of data.content || []) if (c && c.type === 'text') out += '\n\n' + String(c.text).slice(0, 2500);
        return { kind: 'tool', key: k, name: (o && o.name) || toolName(data, 'herramienta'), status: type.endsWith('success') ? 'listo' : 'falló', summary: (o && o.summary) || '', detail: out.trim() || JSON.stringify(data).slice(0, 1500) };
      });
      break;
    }
  }
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
    el.innerHTML = `<div><b>Permiso:</b> ${esc(p.action || 'acción')}${p.message ? ' · ' + esc(p.message) : ''}</div>${p.resources.length ? '<div><code>' + esc(p.resources.join(', ')) + '</code></div>' : ''}
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
/** Si la conversación quedó con el modelo gratuito de OpenCode (sin cupo), la pasa a NVIDIA antes de enviar. */
async function asegurarNvidia() {
  const s = S.actual; if (!s || S.elegidoAMano) return;
  try {
    if (S.needsKey === undefined) await comprobarClave();
    if (S.needsKey !== false) return;
    const real = ((await S.api.get(`/api/session/${s.id}`)).data || {}).model;
    if (real && real.providerID === 'nvidia') return;
    if (!S.nvidia) {
      const r = await S.api.get('/api/model?types=chat');
      const lista = ((r && r.data) || []).filter((m) => m.providerID === 'nvidia');
      S.nvidia = lista.find((m) => /ultra|nemotron/i.test(m.id)) || lista[0] || null;
    }
    if (!S.nvidia) return;
    await S.api.post(`/api/session/${s.id}/model`, { model: { id: S.nvidia.id, providerID: S.nvidia.providerID } });
    $('modelo-chat').textContent = `nvidia/${S.nvidia.id}`;
  } catch { /* se intenta igual */ }
}

async function enviar(texto) {
  texto = texto.trim(); if (!texto || !S.actual) return;
  if (S.needsKey === true && !texto.startsWith('/')) { nota('El servidor no tiene tu clave de NVIDIA. Guárdala con el botón 🔑 de la lista de conversaciones.'); return; }
  S.busy = true; pintarBusy();
  try {
    if (texto.startsWith('/')) {
      const nombre = texto.slice(1).split(/\s+/)[0]; const resto = texto.slice(1 + nombre.length).trim();
      S.items.push({ kind: 'user', key: 'local:' + Date.now(), text: texto, files: [] }); pintarMensajes(true);
      await S.api.post(`/api/session/${S.actual.id}/command`, { name: nombre, text: resto });
    } else {
      S.items.push({ kind: 'user', key: 'local:' + Date.now(), text: texto, files: [] }); pintarMensajes(true);
      await asegurarNvidia();
      await S.api.post(`/api/session/${S.actual.id}/prompt`, { text: texto });
    }
  } catch (e) { S.busy = false; pintarBusy(); nota('No se pudo enviar: ' + e.message); }
}

/* ───────────── eventos de la interfaz ───────────── */
function ajustarAltura() { const t = $('entrada'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 140) + 'px'; }

function iniciarUI() {
  $('btn-añadir').addEventListener('click', () => abrirDialogoCuenta());
  document.querySelectorAll('input[name=c-tipo]').forEach((r) => r.addEventListener('change', actualizarAyudaTipo));
  $('c-cancelar').addEventListener('click', () => $('dlg-cuenta').close());
  $('form-cuenta').addEventListener('submit', (e) => {
    e.preventDefault();
    const tipo = document.querySelector('input[name=c-tipo]:checked').value;
    const c = Cuentas.añadir($('c-nombre').value, tipo, $('c-url').value, $('c-clave').value);
    $('dlg-cuenta').close();
    void conectar(c);
  });
  $('r-cancelar').addEventListener('click', () => $('dlg-renombrar').close());
  $('form-renombrar').addEventListener('submit', (e) => {
    e.preventDefault();
    if (cuentaRenombrando) { Cuentas.renombrar(cuentaRenombrando, $('r-nombre').value); if (S.cuenta === cuentaRenombrando) $('nombre-cuenta').textContent = cuentaRenombrando.name; }
    $('dlg-renombrar').close(); pintarCuentas();
  });
  $('btn-cuentas').addEventListener('click', () => { detenerEventos(); S.api = null; pintarCuentas(); });
  $('btn-nueva').addEventListener('click', () => void nuevaSesion());
  $('btn-atras').addEventListener('click', () => { S.actual = null; S.permisos = S.permisos; vista('v-inicio'); void cargarSesiones().catch(() => {}); });
  $('btn-parar').addEventListener('click', async () => { try { await S.api.post(`/api/session/${S.actual.id}/interrupt`); } catch (e) { toast('No se pudo detener: ' + e.message); } });
  $('btn-clave').addEventListener('click', () => { $('form-clave').reset(); $('dlg-clave').showModal(); });
  $('k-cancelar').addEventListener('click', () => $('dlg-clave').close());
  $('form-clave').addEventListener('submit', async (e) => {
    e.preventDefault();
    const k = $('k-clave').value.trim();
    $('dlg-clave').close();
    if (k.length < 11) { toast('Pega la clave completa.'); return; }
    try {
      await S.api.post('/api/integration/nvidia/connect/key', { key: k, label: 'Wichi PWA' });
      S.needsKey = false; $('aviso-clave').hidden = true; S.nvidia = null;
      toast('Clave guardada en el servidor «' + S.cuenta.name + '».');
    } catch (err) { toast('No se pudo guardar la clave: ' + err.message, 6000); }
  });
  $('form-envio').addEventListener('submit', (e) => {
    e.preventDefault();
    const t = $('entrada').value; $('entrada').value = ''; ajustarAltura();
    void enviar(t);
  });
  $('entrada').addEventListener('input', ajustarAltura);
  // «Enviar» en el teclado del iPhone (enterkeyhint=send) y Enter en un ordenador envían; Mayús+Enter hace salto de línea.
  $('entrada').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('form-envio').requestSubmit(); }
  });
  $('mensajes').addEventListener('click', (e) => {
    const b = e.target.closest('.copiar'); if (!b) return;
    const code = b.parentElement.querySelector('code').textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(code) : Promise.reject()).then(() => { b.textContent = 'Copiado'; setTimeout(() => { b.textContent = 'Copiar'; }, 1500); }).catch(() => toast('No se pudo copiar.'));
  });
}

/* ───────────── arranque ───────────── */
function arrancar() {
  Cuentas.cargar();
  iniciarUI();
  // Enlace de conexión: …/#conectar?u=<url>&p=<contraseña>&n=<nombre>&k=<cowork|local> (el que genera el QR de la app)
  const h = location.hash;
  if (h.startsWith('#conectar?')) {
    const q = new URLSearchParams(h.slice('#conectar?'.length));
    const u = q.get('u'); const p = q.get('p');
    history.replaceState(null, '', location.pathname + location.search); // la contraseña no se queda en la barra ni en el historial
    if (u && p) { const c = Cuentas.añadir(q.get('n') || '', q.get('k') === 'local' ? 'local' : 'cowork', u, p); void conectar(c); return; }
  }
  const ultima = leerLS(LS.actual);
  const c = Cuentas.lista.find((x) => x.url === ultima) || (Cuentas.lista.length === 1 ? Cuentas.lista[0] : null);
  if (c) void conectar(c); else pintarCuentas();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { /* sin instalación sin conexión */ });
}
arrancar();
