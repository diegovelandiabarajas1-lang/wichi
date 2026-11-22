'use strict';
/*
 * Modo de voz de Wichi en la PWA (como «Hablar» en el APK): escuchas, Wichi responde en voz alta y vuelve a escucharte
 * (conversación continua) hasta que no digas nada o te despidas. Usa el reconocimiento y la voz del navegador (Web Speech).
 * Límites de iPhone: el reconocimiento de voz funciona en Safari; en la app instalada en la pantalla de inicio puede no estar
 * disponible (si es así, la app te lo dice y puedes usar el micrófono del teclado). Las acciones piden su toque en «Sí».
 */
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const V = { activo: false, estado: 'inactivo', cancelar: false, reconocedor: null };

  function lengua() { const l = navigator.language || 'es-ES'; return /^es/i.test(l) ? l : 'es-ES'; }

  function pintar(estado, dicho, resp) {
    V.estado = estado;
    const o = $('voz-orbe'); if (o) o.dataset.estado = estado;
    const txt = { escuchando: 'Te escucho…', pensando: 'Pensando…', hablando: 'Hablando…', inactivo: '' }[estado] || '';
    if ($('voz-estado')) $('voz-estado').textContent = txt;
    if (dicho !== undefined && $('voz-dicho')) $('voz-dicho').textContent = dicho;
    if (resp !== undefined && $('voz-resp')) $('voz-resp').textContent = resp;
  }

  /* ───────────── escuchar ───────────── */
  function escuchar() {
    return new Promise((resolver) => {
      if (!SR) { resolver({ texto: null, error: 'no-soportado' }); return; }
      const r = new SR();
      V.reconocedor = r;
      r.lang = lengua(); r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
      let final = '', parcial = '', error = '';
      r.onresult = (e) => {
        let t = '';
        for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
        parcial = t; pintar('escuchando', t);
        if (e.results[e.results.length - 1].isFinal) final = t;
      };
      r.onerror = (e) => { error = e.error || 'error'; };
      r.onend = () => { V.reconocedor = null; resolver({ texto: (final || parcial || '').trim() || null, error }); };
      try { pintar('escuchando', ''); r.start(); } catch (e) { resolver({ texto: null, error: String(e && e.message || e) }); }
    });
  }

  /* ───────────── hablar ───────────── */
  function paraVoz(md) {
    let t = String(md || '').replace(/```[\s\S]*?```/g, ' (hay código en la pantalla) ');
    t = t.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, 'un enlace');
    t = t.replace(/[`*_#>|~]/g, '').replace(/^\s*[-•]\s+/gm, '').replace(/\s+/g, ' ').trim();
    return t.length > 600 ? t.slice(0, 600).replace(/\s+\S*$/, '') + '. El resto está en la pantalla.' : t;
  }

  function hablar(texto) {
    pintar('hablando', undefined, texto);
    return new Promise((resolver) => {
      const ss = window.speechSynthesis;
      if (!ss || !texto) { resolver(); return; }
      let fin = false;
      const listo = () => { if (!fin) { fin = true; clearTimeout(tope); resolver(); } };
      // iOS a veces no avisa del final: se pone un tope según la longitud del texto.
      const tope = setTimeout(listo, Math.min(60000, 2500 + texto.length * 90));
      try {
        ss.cancel();
        const u = new SpeechSynthesisUtterance(texto);
        u.lang = lengua();
        const v = ss.getVoices().find((x) => x.lang && x.lang.toLowerCase().startsWith(u.lang.slice(0, 2).toLowerCase()));
        if (v) u.voice = v;
        u.onend = listo; u.onerror = listo;
        ss.speak(u);
      } catch { listo(); }
    });
  }

  /* ───────────── el agente ───────────── */
  /** Espera a que el agente empiece y termine (con tope), atendiendo sus permisos con botones en pantalla. */
  async function esperarAgente() {
    let vioOcupado = false, espera = 0;
    for (;;) {
      if (V.cancelar) return false;
      await sleep(400);
      const pend = (S.permisos || []).find((p) => S.actual && p.sessionID === S.actual.id);
      if (pend) { await preguntarPermiso(pend); continue; }
      if (S.busy) { vioOcupado = true; continue; }
      if (vioOcupado) { await sleep(1100); return true; }
      if (++espera > 75) return false; // 30 s sin que arranque (servidor dormido, sin conexión…)
    }
  }

  function preguntarPermiso(p) {
    return new Promise((resolver) => {
      const caja = $('voz-pregunta');
      $('voz-pregunta-texto').textContent = 'El agente pide permiso: ' + (p.action || 'una acción') + (p.resources && p.resources.length ? ' (' + p.resources.join(', ') + ')' : '') + '.';
      $('voz-si').textContent = 'Permitir una vez'; $('voz-no').textContent = 'Rechazar';
      caja.hidden = false;
      const fin = (d) => { caja.hidden = true; $('voz-si').onclick = $('voz-no').onclick = null; void responderPermiso(p, d); resolver(); };
      $('voz-si').onclick = () => fin('once'); $('voz-no').onclick = () => fin('reject');
      void hablar('El agente pide permiso para ' + (p.action || 'una acción') + '. ¿Lo permito?');
    });
  }

  /** Pregunta «Sí / No» de una acción del teléfono; el «Sí» la ejecuta en el mismo toque (iOS lo exige). */
  async function preguntarAccion(acc) {
    if (acc.soloDecir) { await hablar(acc.pregunta); return null; }
    // Controles de Spotify (pausa, siguiente, volumen, ¿qué suena?): inofensivos, se hacen sin preguntar y se dice el resultado.
    if (acc.sinPregunta) { const t = await Acciones.correr(acc); if (t) await hablar(t); return true; }
    const caja = $('voz-pregunta');
    $('voz-pregunta-texto').textContent = acc.pregunta;
    $('voz-si').textContent = 'Sí'; $('voz-no').textContent = 'No';
    caja.hidden = false;
    void hablar(acc.pregunta);
    return new Promise((resolver) => {
      const fin = (v) => { caja.hidden = true; $('voz-si').onclick = $('voz-no').onclick = null; resolver(v); };
      $('voz-si').onclick = () => {
        const r = acc.ejecutar();
        if (window.speechSynthesis) speechSynthesis.cancel();
        // Las acciones de Spotify contestan por la API (una promesa con la frase que se dice en voz alta).
        if (r && typeof r.then === 'function') { r.then((t) => { pintar('inactivo', undefined, t); return hablar(t); }).catch(() => {}); fin(true); return; }
        const ok = !!r;
        pintar('inactivo', undefined, ok ? (acc.listo || 'Listo.') : 'No se pudo hacer en este teléfono.');
        fin(ok);
      };
      $('voz-no').onclick = () => { if (window.speechSynthesis) speechSynthesis.cancel(); fin(false); };
    });
  }

  async function alAgente(texto) {
    if (!S.actual) await nuevaSesion();
    if (!S.actual) { await hablar('No pude abrir una conversación. Revisa la conexión.'); return; }
    pintar('pensando', undefined, 'Pensando…');
    await enviar(texto, { voz: true });
    const ok = await esperarAgente();
    if (V.cancelar) return;
    if (!ok) { await hablar('No obtuve respuesta del servidor. Mira la conversación en la app.'); return; }
    const t = [...S.items].reverse().find((i) => i.kind === 'text');
    const { texto: hablado, acciones } = Acciones.separarAcciones(t ? t.text : '');
    const limpio = paraVoz(hablado);
    if (limpio) await hablar(limpio); else if (!acciones.length) await hablar('Listo.');
    for (const a of acciones) {
      if (V.cancelar) return;
      const acc = Acciones.construir(a);
      if (!acc) continue;
      const r = await preguntarAccion(acc);
      if (r === false) break;
    }
  }

  /* ───────────── el bucle de la conversación ───────────── */
  async function bucle() {
    let silencios = 0;
    while (V.activo && !V.cancelar) {
      const { texto, error } = await escuchar();
      if (V.cancelar) break;
      if (error === 'not-allowed' || error === 'service-not-allowed') { await hablar('Necesito permiso para usar el micrófono. Actívalo en los ajustes del navegador.'); break; }
      if (!texto) { if (++silencios >= (V.primera ? 1 : 1)) break; continue; }
      silencios = 0; V.primera = false;
      pintar('pensando', texto);
      if (Acciones.esDespedida(texto)) { await hablar('Hasta luego.'); break; }
      const acc = Acciones.interpretar(texto);
      if (acc) {
        const r = await preguntarAccion(acc);
        if (r !== false) await sleep(300);
        continue;
      }
      await alAgente(texto);
    }
    cerrar();
  }

  function cerrar() {
    V.cancelar = true; V.activo = false;
    try { if (V.reconocedor) V.reconocedor.abort(); } catch { /* nada */ }
    try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch { /* nada */ }
    const o = $('voz'); if (o) o.hidden = true;
    const c = $('voz-pregunta'); if (c) c.hidden = true;
    pintar('inactivo', '', '');
  }

  function abrir() {
    if (V.activo) return;
    if (!SR) { if (window.toast) toast('Este navegador no tiene reconocimiento de voz. En iPhone ábrelo en Safari (no en la app instalada) o usa el micrófono del teclado.', 7000); return; }
    if (!S.api) { if (window.toast) toast('Conéctate a un servidor primero.'); return; }
    // El primer sonido tiene que salir de un toque (iOS): se «desbloquea» la voz con una frase vacía.
    try { if (window.speechSynthesis) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } } catch { /* nada */ }
    V.activo = true; V.cancelar = false; V.primera = true;
    $('voz').hidden = false; $('voz-pregunta').hidden = true;
    pintar('escuchando', '', '');
    void bucle();
  }

  /** Dictado: lo que dices se escribe en el cuadro de texto (el micrófono de al lado de «Hablar» en el APK). */
  let dictando = null;
  function dictar(area, boton) {
    if (!SR) { if (window.toast) toast('Este navegador no tiene reconocimiento de voz. En iPhone ábrelo en Safari o usa el micrófono del teclado.', 7000); return; }
    if (dictando) { try { dictando.stop(); } catch { /* nada */ } return; }
    const r = new SR(); dictando = r;
    r.lang = lengua(); r.interimResults = true; r.continuous = false;
    const base = area.value ? area.value.replace(/\s*$/, ' ') : '';
    if (boton) boton.classList.add('grabando');
    r.onresult = (e) => { let t = ''; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript; area.value = base + t; area.dispatchEvent(new Event('input')); };
    r.onerror = (e) => { if ((e.error === 'not-allowed' || e.error === 'service-not-allowed') && window.toast) toast('Permite el micrófono en los ajustes del navegador.', 5000); };
    r.onend = () => { dictando = null; if (boton) boton.classList.remove('grabando'); };
    try { r.start(); } catch { dictando = null; if (boton) boton.classList.remove('grabando'); }
  }

  function iniciar() {
    const x = $('voz-cerrar'); if (x) x.addEventListener('click', cerrar);
  }

  window.Voz = { get activo() { return V.activo; }, abrir, cerrar, dictar, iniciar, soportado: !!SR };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
