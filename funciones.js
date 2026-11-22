'use strict';
const VERSION_PWA = '0.6.0';
/* Wichi PWA: funciones que igualan a la app de Android (APK).
   Modelos, comandos «/», adjuntos, archivos del agente (entregas), conectores (MCP), consumo de tokens,
   respaldo de conversaciones, renombrar/archivar/eliminar y ajustes. Todo vive en este dispositivo (IndexedDB y localStorage). */

/* ───────────── Api: métodos que faltaban ───────────── */
Object.assign(Api.prototype, {
  put(p, b) { return this.call('PUT', p, b); },
  patch(p, b) { return this.call('PATCH', p, b); },
  del(p) { return this.call('DELETE', p); },
  async putBytes(path, bytes) {
    let res;
    try {
      res = await fetch(this.base + path, { method: 'POST', headers: this.headers({ 'Content-Type': 'application/octet-stream' }), body: bytes, signal: AbortSignal.timeout ? AbortSignal.timeout(180000) : undefined });
    } catch (e) { throw new ApiError(0, explicarRed(this.base, e)); }
    if (!res.ok) await this.fail(res);
    const t = await res.text();
    return t.trim() ? JSON.parse(t) : null;
  },
  async getBytes(path) {
    let res;
    try {
      res = await fetch(this.base + path, { headers: this.headers({ Accept: '*/*' }), signal: AbortSignal.timeout ? AbortSignal.timeout(120000) : undefined });
    } catch (e) { throw new ApiError(0, explicarRed(this.base, e)); }
    if (!res.ok) await this.fail(res);
    return new Uint8Array(await res.arrayBuffer());
  },
});

(function () {
  /* ───────────── almacenamiento: IndexedDB (con respaldo en memoria si no hay) ───────────── */
  const DB = {
    _db: null, _mem: new Map(), roto: false,
    open() {
      return new Promise((res, rej) => {
        if (this._db) return res(this._db);
        if (!window.indexedDB) return rej(new Error('sin IndexedDB'));
        const rq = indexedDB.open('wichi', 1);
        rq.onupgradeneeded = () => { rq.result.createObjectStore('kv'); };
        rq.onsuccess = () => { this._db = rq.result; res(this._db); };
        rq.onerror = () => rej(rq.error);
      });
    },
    async tx(modo, fn) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const t = db.transaction('kv', modo);
        const out = fn(t.objectStore('kv'));
        t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error);
      });
    },
    async get(k) { try { return await this.tx('readonly', (s) => s.get(k)); } catch { this.roto = true; return this._mem.get(k); } },
    async set(k, v) { try { await this.tx('readwrite', (s) => s.put(v, k)); } catch { this.roto = true; this._mem.set(k, v); } },
    async del(k) { try { await this.tx('readwrite', (s) => s.delete(k)); } catch { this._mem.delete(k); } },
    async keys(prefijo) {
      try {
        return await this.tx('readonly', (s) => s.getAllKeys(IDBKeyRange.bound(prefijo, prefijo + '￿')));
      } catch { return [...this._mem.keys()].filter((k) => k.startsWith(prefijo)); }
    },
  };

  /** Copias que la persona puso (clave de NVIDIA y conectores), por servidor, para devolverlas si Render se reinicia. */
  const Sec = {
    leer() { try { return JSON.parse(leerLS('wichi.secretos') || '{}'); } catch { return {}; } },
    de(url) { return this.leer()[url] || {}; },
    poner(url, parte) { const t = this.leer(); t[url] = { ...(t[url] || {}), ...parte }; guardarLS('wichi.secretos', JSON.stringify(t)); },
    borrar(url) { const t = this.leer(); delete t[url]; guardarLS('wichi.secretos', JSON.stringify(t)); },
  };

  const esEfimero = (c) => !!c && (c.url.startsWith('https://') || c.kind === 'cowork');
  const dirDe = () => ((S.actual && S.actual.directory) || '/workspace').replace(/\/+$/, '') || '/workspace';
  const fmt = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + ' G' : n >= 1e6 ? (n / 1e6).toFixed(2) + ' M' : n >= 1e3 ? (n / 1e3).toFixed(1) + ' k' : String(Math.round(n)));
  const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf', txt: 'text/plain', md: 'text/plain', log: 'text/plain', csv: 'text/csv', json: 'application/json', html: 'text/html', zip: 'application/zip', mp3: 'audio/mpeg', mp4: 'video/mp4', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  const mimeDe = (n) => MIME[(n.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';

  const E = {
    adjuntos: [],
    modelos: [], preferido: null, comandos: [],
    _restaurando: false, _intentadas: new Set(), _consumo: null, _escaneando: false,

    /* ───────────── ganchos desde app.js ───────────── */
    async alConectar() {
      this.modelos = []; this.preferido = null; this.comandos = []; this._intentadas = new Set();
      $('aviso-restaurado').hidden = true;
      await this.restaurarClave();
      await this.restaurarConectores();
    },
    async alCargarSesiones(todas) {
      this.escanearConsumo(todas, false);
      if (!this.comandos.length) void this.cargarComandos('/workspace');
      const n = await this.restaurarFaltantes(new Set(todas.map((s) => s.id)));
      if (n > 0 && !this._recargando) {
        this._recargando = true;
        try { await cargarSesiones(); } finally { this._recargando = false; }
      }
    },
    alAbrirSesion(s) {
      void this.cargarComandos(s.directory || '/workspace');
      void this.cargarEntregas(true);
      if (esEfimero(S.cuenta)) void this.existeRespaldo(s.id).then((ya) => { if (!ya) void this.respaldar(s.id); });
    },
    alTurno(sid) {
      void this.respaldar(sid);
      this.escanearConsumo(S.sesiones, true, sid);
      void this.cargarEntregas(true);
    },
    alCerrarChat(id) { void this.respaldar(id); },

    /* ───────────── clave de NVIDIA ───────────── */
    async guardarClave(k, silencioso) {
      const api = S.api; if (!api) return;
      try {
        await api.post('/api/integration/nvidia/connect/key', { key: k, label: 'Wichi PWA' });
        if (esEfimero(S.cuenta)) Sec.poner(S.cuenta.url, { nvidia: k });
        try { await api.putBytes('/api/experimental/fs/write?path=' + enc('/root/.wichi/nvidia.key'), new TextEncoder().encode(k)); } catch { /* opcional */ }
        S.needsKey = false; if (window.Shell) { if (silencioso) Shell.pintarClave(); else Shell.claveGuardada(); }
        this.modelos = []; this.preferido = null;
        await this.cargarModelos().catch(() => {});
        if (S.actual && this.preferido && !S.elegidoAMano) await this.cambiarModelo(this.preferido, true);
        if (!silencioso) toast('Clave guardada en el servidor «' + S.cuenta.name + '».');
      } catch (err) { toast('No se pudo guardar la clave: ' + err.message, 6000); }
    },
    /** Si Render se reinició y perdió la clave, se vuelve a poner la que la persona ya había dado. */
    async restaurarClave() {
      if (S.needsKey !== true || !esEfimero(S.cuenta)) return;
      const k = Sec.de(S.cuenta.url).nvidia;
      if (!k) return;
      await this.guardarClave(k, true);
      if (S.needsKey === false) this.avisoRestaurado('tu clave');
    },
    avisoRestaurado(texto) {
      const el = $('aviso-restaurado');
      el.textContent = 'Tu servidor se había reiniciado: restauré ' + texto + '.';
      el.hidden = false;
      clearTimeout(this._tAviso); this._tAviso = setTimeout(() => { el.hidden = true; }, 8000);
    },

    /* ───────────── modelos ───────────── */
    async cargarModelos() {
      const api = S.api; if (!api) return;
      if (S.needsKey === undefined) await comprobarClave();
      // Solo proveedores realmente activos (los «auto» no tienen clave); NVIDIA cuenta si el servidor ya tiene su clave.
      const provs = new Set(((await api.get('/api/provider')).data || []).map((p) => (p.activation === 'enabled' || (p.id === 'nvidia' && S.needsKey === false) ? p.id : null)).filter(Boolean));
      const r = await api.get('/api/model?types=chat');
      this.modelos = ((r && r.data) || [])
        .filter((m) => m.enabled !== false && (provs.size === 0 || provs.has(m.providerID)))
        .map((m) => ({ id: String(m.id), providerID: String(m.providerID), name: String(m.name || m.id) }))
        .sort((a, b) => (a.providerID === 'nvidia' ? 0 : 1) - (b.providerID === 'nvidia' ? 0 : 1));
      const nv = this.modelos.filter((m) => m.providerID === 'nvidia');
      this.preferido = nv.find((m) => m.id.includes('lightning')) || nv.find((m) => m.id.includes('nemotron')) || nv[0] || null;
    },
    async modeloPreferido() {
      if (!this.preferido) await this.cargarModelos().catch(() => {});
      return this.preferido;
    },
    async cambiarModelo(m, auto) {
      if (!S.actual) return;
      try {
        await S.api.post(`/api/session/${S.actual.id}/model`, { model: { id: m.id, providerID: m.providerID } });
        S.actual = { ...S.actual, model: `${m.providerID}/${m.id}` };
        $('modelo-chat').textContent = (S.actual.model || '').split('/').pop();
        if (!auto) S.elegidoAMano = true;
      } catch (e) { toast('No se pudo cambiar el modelo: ' + e.message, 5000); }
    },
    async abrirModelos() {
      const lista = $('lista-modelos');
      lista.innerHTML = '<p class="suave">Cargando…</p>';
      $('dlg-modelo').showModal();
      try { if (!this.modelos.length) await this.cargarModelos(); } catch (e) { lista.innerHTML = '<p class="suave">No se pudo leer los modelos: ' + esc(e.message) + '</p>'; return; }
      lista.innerHTML = '';
      if (!this.modelos.length) lista.innerHTML = '<p class="suave">El servidor no tiene modelos activos todavía. Guarda tu clave de NVIDIA en Ajustes.</p>';
      const actual = S.actual && S.actual.model;
      for (const m of this.modelos) {
        const b = document.createElement('button');
        b.className = 'btn ancho opcion' + (actual === m.providerID + '/' + m.id ? ' elegido' : '');
        b.innerHTML = `<span>${esc(m.name)}</span><small>${esc(m.providerID)}</small>`;
        b.addEventListener('click', async () => { $('dlg-modelo').close(); await this.cambiarModelo(m, false); });
        lista.appendChild(b);
      }
    },

    /* ───────────── comandos «/» ───────────── */
    async cargarComandos(dir) {
      try {
        const r = await S.api.get('/api/command?' + locationQuery(dir || '/workspace'));
        this.comandos = ((r && r.data) || []).map((c) => ({ name: String(c.name), description: String(c.description || '') }));
      } catch { /* opcional */ }
    },
    pintarComandos() {
      const t = $('entrada').value;
      const menu = $('menu-comandos');
      if (!t.startsWith('/') || /\s/.test(t) || !this.comandos.length) { menu.hidden = true; return; }
      const q = t.slice(1).toLowerCase();
      const lista = this.comandos.filter((c) => c.name.toLowerCase().startsWith(q)).slice(0, 8);
      if (!lista.length) { menu.hidden = true; return; }
      menu.innerHTML = '';
      for (const c of lista) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'cmd';
        b.innerHTML = `<b>/${esc(c.name)}</b><small>${esc(c.description)}</small>`;
        b.addEventListener('click', () => { $('entrada').value = '/' + c.name + ' '; menu.hidden = true; $('entrada').focus(); });
        menu.appendChild(b);
      }
      menu.hidden = false;
    },

    /* ───────────── adjuntos ───────────── */
    pintarAdjuntos() {
      for (const id of ['adjuntos', 'h-adjuntos']) {
        const el = $(id);
        el.hidden = !this.adjuntos.length;
        el.innerHTML = '';
        this.adjuntos.forEach((a, i) => {
          const c = document.createElement('span'); c.className = 'chip-adj';
          c.textContent = (a.esImagen ? '🖼 ' : '📎 ') + a.name;
          const x = document.createElement('button'); x.type = 'button'; x.textContent = '✕'; x.setAttribute('aria-label', 'Quitar ' + a.name);
          x.addEventListener('click', () => { this.adjuntos.splice(i, 1); this.pintarAdjuntos(); });
          c.appendChild(x); el.appendChild(c);
        });
      }
      if (window.Shell) Shell.actualizarComposer();
    },
    esTexto(f) {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      return f.type.startsWith('text/') || f.type === 'application/json' || f.type === 'application/xml' ||
        ['md', 'txt', 'kt', 'js', 'ts', 'py', 'c', 'h', 'cpp', 'java', 'json', 'csv', 'html', 'css', 'xml', 'yml', 'yaml', 'sh', 'ps1', 'esl', 'n', 'log', 'sql'].includes(ext);
    },
    leerComoDataUrl(blob) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); }); },
    /** Reduce una foto (lado mayor 1600 px, JPEG) para no mandar megas de más al servidor. */
    async reducirImagen(file) {
      try {
        const bmp = await createImageBitmap(file);
        const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
        const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
        cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
        const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.85));
        if (!blob) return null;
        return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
      } catch { return null; }
    },
    async añadirArchivos(files) {
      for (let f of files) {
        if (f.type.startsWith('image/') && f.type !== 'image/gif') { const r = await this.reducirImagen(f); if (r) f = r; }
        if (this.esTexto(f)) {
          if (f.size > 150000) { toast(`«${f.name}» es muy grande para ir dentro del mensaje (máx. 150 KB de texto).`, 5000); continue; }
        } else if (f.size > 40000000) { toast(`«${f.name}» pesa más de 40 MB.`, 5000); continue; }
        this.adjuntos.push({ name: f.name, mime: f.type || mimeDe(f.name), file: f, esImagen: f.type.startsWith('image/'), texto: this.esTexto(f) });
      }
      this.pintarAdjuntos();
    },
    /** Arma el mensaje con los adjuntos como lo hace el APK: texto dentro del mensaje; lo demás, subido a «subidas» (y las imágenes chicas, también inline). */
    async prepararAdjuntos(texto) {
      const pend = this.adjuntos.splice(0); this.pintarAdjuntos();
      let t = texto;
      const files = [];
      const nombres = pend.map((a) => a.name);
      for (const a of pend.filter((x) => x.texto)) t += `\n\n[Archivo adjunto: ${a.name}]\n\`\`\`\n${await a.file.text()}\n\`\`\``;
      const dir = dirDe();
      for (const a of pend.filter((x) => !x.texto)) {
        if (a.file.size <= 6000000) files.push({ uri: await this.leerComoDataUrl(a.file), name: a.name });
        const limpio = a.name.replace(/[\\/:*?"<>|]/g, '_');
        const ruta = `${dir}/subidas/${limpio}`;
        try { await S.api.putBytes('/api/experimental/fs/write?path=' + enc(ruta), new Uint8Array(await a.file.arrayBuffer())); t += `\n\n[Archivo subido al servidor: ${ruta}]`; }
        catch (e) { toast(`No se pudo subir «${a.name}»: ${e.message}`, 5000); }
      }
      if (!t.trim()) t = 'Mira el archivo adjunto.';
      return { text: t, files, nombres };
    },

    /* ───────────── archivos del agente (entregas) ───────────── */
    entregas: [],
    async cargarEntregas(silencioso) {
      try {
        const r = await S.api.get('/api/fs/list?path=' + enc(dirDe() + '/entregas'));
        this.entregas = ((r && r.data) || []).filter((x) => x.type === 'file').map((x) => String(x.path).split('/').pop()).sort();
      } catch { this.entregas = []; }
      const be = $('btn-entregas'); be.hidden = !this.entregas.length; be.classList.toggle('con-algo', this.entregas.length > 0); be.textContent = '📁 Archivos del agente (' + this.entregas.length + ')';
      if (!silencioso) this.pintarEntregas();
    },
    pintarEntregas() {
      const l = $('lista-entregas'); l.innerHTML = '';
      if (!this.entregas.length) l.innerHTML = '<p class="suave">Todavía no hay archivos. Pídele a Wichi que cree un documento o una imagen.</p>';
      for (const n of this.entregas) {
        const b = document.createElement('button'); b.className = 'btn ancho opcion'; b.innerHTML = `<span>${esc(n)}</span><small>${esc(mimeDe(n).split('/')[1] || '')}</small>`;
        b.addEventListener('click', () => void this.verEntrega(n));
        l.appendChild(b);
      }
    },
    async abrirEntregas() { $('dlg-entregas').showModal(); await this.cargarEntregas(false); },
    async verEntrega(nombre) {
      try {
        // La ruta es relativa a la carpeta de la sesión (location); con «workspace/…» daba 404.
        const bytes = await S.api.getBytes('/api/fs/read/entregas/' + encPath(nombre) + '?' + locationQuery(dirDe()));
        const blob = new Blob([bytes], { type: mimeDe(nombre) });
        this._blob = { nombre, blob };
        if (blob.type.startsWith('image/')) {
          if (this._url) URL.revokeObjectURL(this._url);
          this._url = URL.createObjectURL(blob);
          $('im-img').src = this._url; $('im-titulo').textContent = nombre;
          $('dlg-entregas').close(); $('dlg-imagen').showModal();
        } else { await this.guardarBlob(nombre, blob); }
      } catch (e) { toast('No se pudo abrir el archivo: ' + e.message, 5000); }
    },
    /** En el iPhone se comparte (Guardar en Archivos, AirDrop…); en otros navegadores se descarga. */
    async guardarBlob(nombre, blob) {
      try {
        const f = new File([blob], nombre, { type: blob.type });
        if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: nombre }); return; }
      } catch (e) { if (e && e.name === 'AbortError') return; }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    },

    /* ───────────── conectores (MCP) ───────────── */
    conectores: [],
    async cargarConectores() {
      try {
        const r = await S.api.get('/api/mcp');
        this.conectores = ((r && r.data) || []).map((c) => {
          const st = c.status;
          return { name: String(c.name), estado: st && typeof st === 'object' ? String(st.status || '') : String(st || ''), detalle: st && typeof st === 'object' ? String(st.error || '') : '' };
        });
      } catch (e) { this.conectores = []; toast('No se pudo leer los conectores: ' + e.message, 5000); }
    },
    configConector(url, llave) {
      const cfg = { type: 'remote', url };
      if (llave) cfg.headers = { Authorization: /^Bearer /i.test(llave) ? llave : 'Bearer ' + llave };
      return { config: cfg };
    },
    guardarCopiaConectores(nombre, url, llave, quitar) {
      if (!esEfimero(S.cuenta)) return;
      let lista = (Sec.de(S.cuenta.url).mcp || []).filter((c) => c.name !== nombre);
      if (!quitar) lista.push({ name: nombre, url, token: llave });
      Sec.poner(S.cuenta.url, { mcp: lista });
    },
    async agregarConector(nombre, url, llave) {
      const n = nombre.trim().replace(/[^A-Za-z0-9_-]/g, '-'); const u = url.trim();
      if (!n || !/^https?:\/\//i.test(u)) { toast('Escribe un nombre y una dirección que empiece por http.', 5000); return; }
      try {
        await S.api.put('/api/experimental/mcp/' + encPath(n), this.configConector(u, llave.trim()));
        try { await S.api.post('/api/experimental/mcp/' + encPath(n) + '/connect'); } catch { /* se conecta luego */ }
        this.guardarCopiaConectores(n, u, llave.trim(), false);
        toast(`Conector «${n}» agregado.`);
        await this.cargarConectores(); this.pintarAjustes();
      } catch (e) { toast('No se pudo agregar: ' + e.message, 6000); }
    },
    async quitarConector(nombre) {
      try {
        await S.api.del('/api/experimental/mcp/' + encPath(nombre));
        this.guardarCopiaConectores(nombre, '', '', true);
        await this.cargarConectores(); this.pintarAjustes();
      } catch (e) { toast('No se pudo quitar: ' + e.message, 6000); }
    },
    /** Si Render reinició y perdió los conectores, se vuelven a poner los que la persona ya había agregado. */
    async restaurarConectores() {
      try {
        if (!esEfimero(S.cuenta)) return;
        const guardados = Sec.de(S.cuenta.url).mcp || [];
        if (!guardados.length) return;
        const hay = (((await S.api.get('/api/mcp')).data) || []).length;
        if (hay > 0) return;
        for (const c of guardados) { try { await S.api.put('/api/experimental/mcp/' + encPath(c.name), this.configConector(c.url, c.token || '')); } catch { /* sigue con el resto */ } }
        this.avisoRestaurado('tus conectores');
      } catch { /* opcional */ }
    },

    /* ───────────── respaldo de conversaciones (Render pierde sus datos al reiniciar) ───────────── */
    _k(id) { return `resp|${S.cuenta.url}|${id}`; },
    async existeRespaldo(id) { return (await DB.get(this._k(id))) !== undefined; },
    async respaldar(id) {
      if (!S.api || !esEfimero(S.cuenta) || !id) return;
      const cuenta = S.cuenta;
      try {
        await sleep(900); // deja que el servidor termine de guardar
        const d = ((await S.api.get(`/api/experimental/session/${id}/export`)) || {}).data;
        if (!d || S.cuenta !== cuenta) return;
        const json = JSON.stringify(d);
        if (json.length > 20000000) return; // conversaciones enormes (con muchas imágenes): no se copian
        await DB.set(`resp|${cuenta.url}|${id}`, json);
      } catch { /* se reintenta en el próximo turno */ }
    },
    /** Devuelve al servidor las conversaciones que este dispositivo tiene copiadas y él ya no conoce. */
    async restaurarFaltantes(enServidor) {
      if (!esEfimero(S.cuenta) || this._restaurando) return 0;
      const pref = `resp|${S.cuenta.url}|`;
      const claves = (await DB.keys(pref)).filter((k) => !enServidor.has(k.slice(pref.length)) && !this._intentadas.has(k));
      if (!claves.length) return 0;
      this._restaurando = true; let n = 0;
      try {
        for (const k of claves) {
          this._intentadas.add(k);
          try { const json = await DB.get(k); await S.api.post('/api/experimental/session/import', JSON.parse(json)); n++; } catch { /* sigue con las demás */ }
        }
      } finally { this._restaurando = false; }
      if (n > 0) this.avisoRestaurado(`${n} ${n === 1 ? 'conversación' : 'conversaciones'}`);
      return n;
    },

    /* ───────────── acciones sobre una conversación ───────────── */
    accionesSesion(s) {
      $('ds-titulo').textContent = s.title;
      this._sel = s;
      $('dlg-sesion').showModal();
    },
    async renombrarSesion(id, titulo) {
      const t = titulo.trim(); if (!t) return;
      try { await S.api.patch(`/api/session/${id}`, { title: t }); S.sesiones = S.sesiones.map((x) => (x.id === id ? { ...x, title: t } : x)); pintarSesiones(); }
      catch (e) { toast('No se pudo renombrar: ' + e.message, 5000); }
    },
    async archivarSesion(id) {
      try { await S.api.patch(`/api/session/${id}`, { archived: true }); S.sesiones = S.sesiones.filter((x) => x.id !== id); pintarSesiones(); }
      catch (e) { toast('No se pudo archivar: ' + e.message, 5000); }
    },
    async borrarSesion(id) {
      try { await S.api.del(`/api/session/${id}`); S.sesiones = S.sesiones.filter((x) => x.id !== id); await DB.del(this._k(id)); pintarSesiones(); }
      catch (e) { toast('No se pudo eliminar: ' + e.message, 5000); }
    },

    /* ───────────── consumo de tokens ───────────── */
    async libro() {
      if (!this._consumo) this._consumo = (await DB.get('consumo')) || { recs: {}, scanned: {} };
      return this._consumo;
    },
    async escanearConsumo(sesiones, forzar, soloId) {
      if (!S.api) return;
      if (this._escaneando && !soloId) return;
      const api = S.api, cuenta = S.cuenta;
      if (!soloId) this._escaneando = true;
      let cambio = false;
      try {
        const L = await this.libro();
        for (const s of sesiones) {
          if (soloId && s.id !== soloId) continue;
          const k = cuenta.url + '|' + s.id;
          if (!soloId && !forzar && L.scanned[k] === s.updated) continue;
          try { await this.escanearSesion(api, cuenta, s.id, L); L.scanned[k] = s.updated; cambio = true; } catch { /* se reintenta luego */ }
        }
        if (cambio) { await DB.set('consumo', L); if (!$('v-consumo').hidden) this.pintarConsumo(); }
      } finally { if (!soloId) this._escaneando = false; }
    },
    async escanearSesion(api, cuenta, id, L) {
      let cursor = '';
      for (let pag = 0; pag < 30; pag++) {
        const q = cursor ? `limit=100&cursor=${encodeURIComponent(cursor)}` : 'order=desc&limit=100';
        const r = await api.get(`/api/session/${id}/message?${q}`);
        for (const m of (r && r.data) || []) this.anotar(cuenta, m, L);
        const sig = (((r && r.data) || []).length >= 100) ? (r.cursor && r.cursor.next) : '';
        if (!sig) break;
        cursor = String(sig);
      }
    },
    anotar(cuenta, m, L) {
      if (!m || m.type !== 'assistant') return;
      const tk = m.tokens || m.usage; const costo = Number(m.cost || 0) || 0;
      if (!tk && !costo) return;
      const n = (v) => Number(v) || 0;
      const rec = { t: n(m.time && (m.time.completed || m.time.created)), i: n(tk && (tk.input ?? tk.inputTokens)), o: n(tk && (tk.output ?? tk.outputTokens)), r: n(tk && tk.reasoning), cr: n(tk && tk.cache && tk.cache.read), cw: n(tk && tk.cache && tk.cache.write), c: costo, m: m.model ? String(m.model.id || '') : '', s: cuenta.name };
      if (!rec.t || rec.i + rec.o + rec.r + rec.cr + rec.cw === 0) return;
      L.recs[cuenta.url + '|' + String(m.id)] = rec;
    },
    vacio() { return { i: 0, o: 0, r: 0, cr: 0, cw: 0, c: 0, n: 0 }; },
    sumar(a, r) { a.i += r.i; a.o += r.o; a.r += r.r; a.cr += r.cr; a.cw += r.cw; a.c += r.c; a.n++; },
    dia(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); },
    lunes(d) { const x = this.dia(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; },
    periodo(tipo, k, hoy) {
      let a, b, label;
      if (tipo === 'semana') { a = this.lunes(hoy); a.setDate(a.getDate() - 7 * k); b = new Date(a); b.setDate(b.getDate() + 7); label = `${a.getDate()}/${a.getMonth() + 1}`; }
      else if (tipo === 'mes') { a = new Date(hoy.getFullYear(), hoy.getMonth() - k, 1); b = new Date(a.getFullYear(), a.getMonth() + 1, 1); label = a.toLocaleString('es-CO', { month: 'short' }).replace('.', ''); }
      else { a = new Date(hoy.getFullYear() - k, 0, 1); b = new Date(a.getFullYear() + 1, 0, 1); label = String(a.getFullYear()); }
      return { a: a.getTime(), b: b.getTime(), label };
    },
    totales(L, desde, hasta) { const t = this.vacio(); for (const r of Object.values(L.recs)) if (r.t >= desde && r.t < hasta) this.sumar(t, r); return t; },
    agrupar(L, desde, hasta, campo) {
      const m = new Map();
      for (const r of Object.values(L.recs)) { if (r.t < desde || r.t >= hasta) continue; const k = r[campo] || 'desconocido'; if (!m.has(k)) m.set(k, this.vacio()); this.sumar(m.get(k), r); }
      return [...m.entries()].map(([k, t]) => ({ k, t })).sort((x, y) => (y.t.i + y.t.o + y.t.r) - (x.t.i + x.t.o + x.t.r));
    },
    tabConsumo: 'semana',
    async abrirConsumo() {
      vista('v-consumo');
      await this.pintarConsumo();
      if (S.sesiones.length || S.api) void this.escanearConsumo(S.sesiones, false).then(() => this.pintarConsumo());
    },
    async pintarConsumo() {
      const L = await this.libro();
      const hoy = new Date(); const tipo = this.tabConsumo;
      const nSerie = tipo === 'año' ? 5 : 12;
      const serie = []; for (let k = nSerie - 1; k >= 0; k--) { const p = this.periodo(tipo, k, hoy); serie.push({ ...p, t: this.totales(L, p.a, p.b) }); }
      const actual = serie[serie.length - 1];
      const tot = (t) => t.i + t.o + t.r;
      const max = Math.max(1, ...serie.map((s) => tot(s.t)));
      const W = 560, H = 150, base = 120, ancho = W / serie.length, bw = Math.min(34, ancho * 0.62);
      let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Consumo por ${tipo}">`;
      serie.forEach((s, k) => {
        const hi = (s.t.i / max) * (base - 14), ho = (s.t.o / max) * (base - 14), hr = (s.t.r / max) * (base - 14);
        const x = k * ancho + (ancho - bw) / 2; let y = base;
        for (const [h, cl] of [[hi, 'var(--c-in)'], [ho, 'var(--c-out)'], [hr, 'var(--c-rz)']]) { if (h > 0) { y -= h; svg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${cl}"/>`; } }
        if (tot(s.t) > 0) svg += `<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" font-size="10" fill="var(--suave)">${fmt(tot(s.t))}</text>`;
        svg += `<text x="${(x + bw / 2).toFixed(1)}" y="${base + 14}" text-anchor="middle" font-size="10" fill="var(--suave)">${esc(s.label)}</text>`;
      });
      svg += '</svg>';
      const tarjeta = (titulo, t) => `<div class="tarjeta-num"><div class="t-titulo">${titulo}</div><div class="t-num">${fmt(tot(t))}</div><div class="t-det">entrada ${fmt(t.i)} · salida ${fmt(t.o)} · razonamiento ${fmt(t.r)}<br>caché leída ${fmt(t.cr)} · mensajes ${t.n}${t.c ? ' · costo $' + t.c.toFixed(2) : ''}</div></div>`;
      const sem = this.periodo('semana', 0, hoy), mes = this.periodo('mes', 0, hoy), anio = this.periodo('año', 0, hoy);
      const filas = (arr) => arr.length ? '<table class="tabla">' + arr.map((x) => `<tr><td>${esc(x.k)}</td><td>${fmt(tot(x.t))}</td></tr>`).join('') + '</table>' : '<p class="suave pequeno">Sin datos todavía.</p>';
      const pm = this.agrupar(L, actual.a, actual.b, 'm'), ps = this.agrupar(L, actual.a, actual.b, 's');
      const n = Object.keys(L.recs).length;
      $('co-sub').textContent = n ? `${n} mensajes anotados en este dispositivo` : 'Aún sin datos';
      $('co-cuerpo').innerHTML = `
        <div class="pestanas">${['semana', 'mes', 'año'].map((p) => `<button class="pestana${p === tipo ? ' activa' : ''}" data-p="${p}">${p === 'año' ? 'Año' : p[0].toUpperCase() + p.slice(1)}</button>`).join('')}</div>
        ${tarjeta('Esta semana', this.totales(L, sem.a, sem.b))}${tarjeta('Este mes', this.totales(L, mes.a, mes.b))}${tarjeta('Este año', this.totales(L, anio.a, anio.b))}
        <h2 class="seccion">${tipo === 'semana' ? 'Últimas 12 semanas' : tipo === 'mes' ? 'Últimos 12 meses' : 'Años'}</h2>
        <div class="tarjeta">${svg}<div class="leyenda"><span><i style="background:var(--c-in)"></i>entrada</span><span><i style="background:var(--c-out)"></i>salida</span><span><i style="background:var(--c-rz)"></i>razonamiento</span></div></div>
        <h2 class="seccion">Por modelo (${tipo === 'semana' ? 'esta semana' : tipo === 'mes' ? 'este mes' : 'este año'})</h2>${filas(pm)}
        <h2 class="seccion">Por servidor</h2>${filas(ps)}
        <p class="suave pequeno">El libro se guarda solo en este dispositivo: así conserva el historial aunque el servidor gratuito se reinicie. Los avisos no cuentan mensajes de otros dispositivos.</p>
        <button class="btn ancho peligro" id="co-borrar">Borrar el libro de este dispositivo</button>`;
      $('co-cuerpo').querySelectorAll('.pestana').forEach((b) => b.addEventListener('click', () => { this.tabConsumo = b.dataset.p; void this.pintarConsumo(); }));
      $('co-borrar').addEventListener('click', async () => {
        if (!confirm('¿Borrar el libro de consumo de este dispositivo? Se volverá a llenar con lo que aún tenga el servidor.')) return;
        this._consumo = { recs: {}, scanned: {} }; await DB.set('consumo', this._consumo); void this.pintarConsumo(); void this.escanearConsumo(S.sesiones, true);
      });
    },

    /* ───────────── ajustes ───────────── */
    async abrirAjustes() { vista('v-ajustes'); this.pintarAjustes(); await this.cargarConectores(); this.pintarAjustes(); },
    pintarAjustes() {
      const c = S.cuenta; const ses = Sesion.leer();
      const estadoSw = !('serviceWorker' in navigator) ? 'no disponible en este navegador' : (navigator.serviceWorker.controller ? 'activo' : 'se activa al abrirla otra vez');
      const servidor = c ? esc(c.name || c.url) : 'este servidor';
      const cuentas = Cuentas.lista.map((x, i) => `<div class="item col"><div class="txt"><div class="t1">${x.kind === 'cowork' ? '☁' : '🖥'} ${esc(x.name)}</div><div class="t2">${esc(x.url)}</div></div>
          <button class="mini" type="button" data-cr="${i}">Renombrar</button><button class="mini" type="button" data-cq="${i}">QR</button><button class="mini" type="button" data-co="${i}">Olvidar</button></div>`).join('');
      $('aj-cuerpo').innerHTML = `
        <div class="tarjeta"><h3>Avisarme del agente</h3>
          <p>En el iPhone las notificaciones de una app web necesitan un servidor que las envíe, y esta versión no lo trae. Para saber si Wichi terminó, abre la app: se pone al día sola.</p></div>
        <div class="tarjeta"><h3>Mi clave de NVIDIA</h3>
          <p>Se guarda en el servidor «${servidor}» (no en el teléfono) y Wichinion la usará para los modelos de NVIDIA. Si ese servidor es el PC de otra persona, le cambiarías su clave: úsalo solo en tu propio servidor.</p>
          <label class="campo"><span class="con-boton"><input id="aj-nv" type="password" placeholder="nvapi-…" autocomplete="off" autocapitalize="off"><button type="button" id="aj-nv-ver">Ver</button></span></label>
          <div class="fila-btn"><button class="btn principal" id="aj-nv-guardar" type="button" disabled>Guardar en el servidor</button></div>
          <p id="aj-nv-msg"></p></div>
        ${ses
          ? `<div class="tarjeta"><h3>Mi cuenta</h3><p>Sesión iniciada como «${esc(ses.nombre)}». Tu nombre y tu contraseña son también el usuario y la contraseña de tu servidor Wichinion. Se guardan solo en este dispositivo.</p><div class="fila-btn"><button class="btn texto" id="aj-cerrar-sesion" type="button">Cerrar sesión</button></div></div>`
          : `<div class="tarjeta"><h3>Mi cuenta</h3><p>Sin cuenta en este dispositivo.</p><div class="fila-btn"><button class="btn tonal" id="aj-crear-cuenta" type="button">Crear cuenta o iniciar sesión</button></div></div>`}
        <div class="tarjeta"><h3>Actualizaciones</h3>
          <p>Versión ${VERSION_PWA} · uso sin conexión: ${estadoSw}. Esta app se actualiza sola al abrirla con internet.</p>
          <div class="fila-btn"><button class="btn tonal" id="aj-act" type="button">Buscar actualización</button></div></div>
        <div class="tarjeta"><h3>Voz y música</h3>
          <p>El botón «Hablar» abre el modo de voz: hablas, Wichi responde en voz alta y puede abrir enlaces, preparar mensajes, buscar música y más (cada acción te pide un «Sí»). En un iPhone una web no puede escuchar «Hey Wichi», ni crear alarmas, ni cambiar el volumen del teléfono.</p></div>
        <div id="aj-spotify"></div>
        <div class="tarjeta"><h3>Conectores</h3>
          <p>Conecta apps con API (servidores MCP) al servidor: el agente podrá usarlas como herramientas. La llave se guarda en el servidor y una copia en este dispositivo, para volver a ponerla si Render reinicia.</p>
          <div id="aj-conectores">${this.conectores.length ? this.conectores.map((x) => `<div class="item"><div class="txt"><div class="t1">${esc(x.name)}</div><div class="t2">${esc(x.estado)}${x.detalle ? ' · ' + esc(x.detalle) : ''}</div></div><button class="mini" type="button" data-q="${esc(x.name)}">Quitar</button></div>`).join('') : '<p>Ninguno todavía.</p>'}</div>
          <div class="fila-btn"><button class="btn tonal" id="aj-add-con" type="button">＋ Añadir conector</button></div></div>
        <div class="tarjeta"><h3>Copia de seguridad</h3>
          <p>Si tu servidor gratuito se reinicia y pierde las conversaciones, esta app las devuelve (se guardan en este dispositivo). <span id="aj-resp-n"></span></p>
          <div class="fila-btn"><button class="btn tonal" id="aj-resp" type="button">Copiar ahora todas las conversaciones</button></div></div>
        <div class="tarjeta"><h3>Cuentas</h3>
          <p>Cada cuenta lleva el nombre que tú le pongas. Cloud o Mi VPS solo indica el tipo de conexión.</p>
          ${cuentas || '<p>Ninguna todavía.</p>'}
          <div class="fila-btn"><button class="btn tonal" id="aj-add-cuenta" type="button">＋ Añadir cuenta</button><button class="btn tonal" id="aj-escanear" type="button">Escanear QR</button></div>
          <div class="fila-btn"><button class="btn texto" id="aj-guias" type="button">Crear mi propio servidor (Render o VPS)</button><button class="btn texto" id="aj-cambiar" type="button">Cambiar de servidor</button></div></div>`;
      const $$ = (s) => $('aj-cuerpo').querySelector(s);
      // clave de NVIDIA
      const nv = $$('#aj-nv'), guardar = $$('#aj-nv-guardar');
      nv.addEventListener('input', () => { guardar.disabled = nv.value.trim().length <= 10; });
      $$('#aj-nv-ver').addEventListener('click', (e) => { const ver = nv.type === 'password'; nv.type = ver ? 'text' : 'password'; e.target.textContent = ver ? 'Ocultar' : 'Ver'; });
      guardar.addEventListener('click', async () => { const k = nv.value.trim(); nv.value = ''; guardar.disabled = true; await this.guardarClave(k); $$('#aj-nv-msg').textContent = S.needsKey === false ? 'Clave guardada en el servidor.' : ''; });
      // cuenta de Wichi
      const cs = $$('#aj-cerrar-sesion'); if (cs) cs.addEventListener('click', () => { if (confirm('¿Cerrar sesión? Se olvida el nombre y la contraseña de este dispositivo; tus servidores guardados no se tocan.')) { Sesion.cerrar(); this.pintarAjustes(); } });
      const cc = $$('#aj-crear-cuenta'); if (cc) cc.addEventListener('click', () => { if (window.Guias) Guias.cuenta(); });
      $$('#aj-act').addEventListener('click', () => void this.buscarActualizacion());
      // Spotify
      if (window.Spotify) Spotify.pintarTarjeta($$('#aj-spotify'));
      // conectores
      $$('#aj-add-con').addEventListener('click', () => { $('form-conector').reset(); $('dlg-conector').showModal(); });
      $('aj-cuerpo').querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => { if (confirm(`¿Quitar el conector «${b.dataset.q}»?`)) void this.quitarConector(b.dataset.q); }));
      // copia de seguridad
      $$('#aj-resp').addEventListener('click', async () => {
        if (!esEfimero(S.cuenta)) { toast('Este servidor no se reinicia: no hace falta la copia.', 4000); return; }
        toast('Copiando…', 2000);
        for (const s of S.sesiones) await this.respaldar(s.id);
        void this.contarRespaldos();
        toast('Copia lista.');
      });
      // cuentas
      $('aj-cuerpo').querySelectorAll('[data-cr]').forEach((b) => b.addEventListener('click', () => pedirRenombrar(Cuentas.lista[Number(b.dataset.cr)])));
      $('aj-cuerpo').querySelectorAll('[data-cq]').forEach((b) => b.addEventListener('click', () => { if (window.Qr) Qr.mostrarCuenta(Cuentas.lista[Number(b.dataset.cq)]); }));
      $('aj-cuerpo').querySelectorAll('[data-co]').forEach((b) => b.addEventListener('click', () => { const x = Cuentas.lista[Number(b.dataset.co)]; if (x && confirm(`¿Olvidar la cuenta «${x.name}»? Solo se borra de este dispositivo.`)) { Cuentas.olvidar(x); this.pintarAjustes(); if (window.Shell) Shell.pintarPanel(); } }));
      $$('#aj-add-cuenta').addEventListener('click', () => abrirDialogoCuenta());
      $$('#aj-escanear').addEventListener('click', () => { if (window.Qr) Qr.escanear(); });
      $$('#aj-guias').addEventListener('click', () => { if (window.Guias) { if (Sesion.leer()) Guias.hospedaje(); else Guias.cuenta(); } });
      $$('#aj-cambiar').addEventListener('click', () => { detenerEventos(); S.api = null; pintarCuentas(); });
      void this.contarRespaldos();
    },
    async contarRespaldos() {
      if (!S.cuenta) return;
      const n = (await DB.keys(`resp|${S.cuenta.url}|`)).length;
      const el = $('aj-resp-n'); if (el) el.textContent = n ? `Copiadas: ${n}.` : (esEfimero(S.cuenta) ? 'Aún no hay copias.' : '');
    },
    async buscarActualizacion() {
      try {
        if (!('serviceWorker' in navigator)) { location.reload(); return; }
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) await reg.update();
        toast('Revisé: si había una versión nueva, se aplica al volver a abrir la app.', 4500);
        setTimeout(() => location.reload(), 1200);
      } catch { location.reload(); }
    },
  };
  window.Extra = E;

  /* ───────────── cableado de la interfaz ───────────── */
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  on('aj-atras', 'click', () => { vista('v-inicio'); if (window.Shell) Shell.pintarInicio(); });
  on('co-atras', 'click', () => { vista('v-inicio'); if (window.Shell) Shell.pintarInicio(); });
  on('co-refrescar', 'click', () => { toast('Actualizando…', 1500); void E.escanearConsumo(S.sesiones, true).then(() => E.pintarConsumo()); });
  on('modelo-chat', 'click', () => void E.abrirModelos());
  on('m-cerrar', 'click', () => $('dlg-modelo').close());
  on('btn-entregas', 'click', () => void E.abrirEntregas());
  on('e-actualizar', 'click', () => void E.cargarEntregas(false));
  on('e-cerrar', 'click', () => $('dlg-entregas').close());
  on('im-cerrar', 'click', () => $('dlg-imagen').close());
  on('im-guardar', 'click', () => { if (E._blob) void E.guardarBlob(E._blob.nombre, E._blob.blob); });
  on('in-archivos', 'change', (e) => { void E.añadirArchivos([...e.target.files]); e.target.value = ''; });
  on('entrada', 'input', () => E.pintarComandos());
  on('ds-cerrar', 'click', () => $('dlg-sesion').close());
  on('ds-renombrar', 'click', () => { $('dlg-sesion').close(); $('rs-titulo').value = E._sel.title; $('dlg-ren-sesion').showModal(); });
  on('rs-cancelar', 'click', () => $('dlg-ren-sesion').close());
  on('form-ren-sesion', 'submit', (e) => { e.preventDefault(); $('dlg-ren-sesion').close(); void E.renombrarSesion(E._sel.id, $('rs-titulo').value); });
  on('ds-archivar', 'click', () => { $('dlg-sesion').close(); void E.archivarSesion(E._sel.id); });
  on('ds-borrar', 'click', () => { $('dlg-sesion').close(); if (confirm(`¿Eliminar «${E._sel.title}»? No se puede deshacer.`)) void E.borrarSesion(E._sel.id); });
  on('cn-cancelar', 'click', () => $('dlg-conector').close());
  on('form-conector', 'submit', (e) => { e.preventDefault(); $('dlg-conector').close(); void E.agregarConector($('cn-nombre').value, $('cn-url').value, $('cn-llave').value); });
  // Arrastrar o pegar una imagen en el cuadro de mensaje (en iPhone: pegar desde el portapapeles)
  on('entrada', 'paste', (e) => { const fs = [...((e.clipboardData && e.clipboardData.files) || [])]; if (fs.length) { e.preventDefault(); void E.añadirArchivos(fs); } });
  // Tras pintar la lista de sesiones por primera vez, si ya hay datos de consumo, nada más que hacer.
})();
