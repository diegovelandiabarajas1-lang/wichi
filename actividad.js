/* Wichi PWA · actividad en palabras simples.
 * Traduce lo que hace el agente (herramientas, permisos, puntos de restauración) a frases cortas con icono para quien no es técnico,
 * y deja a mano el dato técnico (nombre exacto, comando, tamaño, resultado) para quien sí lo es. Lo puro se prueba con Node.
 * API: window.Actividad = { frase, resumen, vivo, tecnico, permiso, resumirInput }. Todo texto se pone con textContent o esc(). */
(function () {
  'use strict';

  const corto = (t, n) => { t = String(t == null ? '' : t).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  const archivo = (p) => { p = String(p || ''); const m = p.replace(/\\/g, '/').split('/').filter(Boolean); return m.length ? m[m.length - 1] : p; };
  const entrada = (i) => (i && typeof i === 'object' ? i : {});

  /** Qué hace un comando de shell, en una frase. */
  function fraseShell(cmd) {
    const c = String(cmd || '').trim();
    const t = c.replace(/^(cd [^;&|]+(&&|;)\s*)+/, '');
    if (/\b(npm|yarn|pnpm)\s+(run\s+)?test\b|\bpytest\b|\bunittest\b|\bdotnet\s+test\b|\bgo\s+test\b|\bcargo\s+test\b|\bnode\s+--test\b|\bmvn\s+test\b|\bgradle\w*\s+test\b/.test(t)) return { texto: 'Probando que todo funcione', cat: 'probar' };
    if (/\b(npm|yarn|pnpm)\s+(install|i|add)\b|\bpip3?\s+install\b|\bapt(-get)?\s+install\b|\bdotnet\s+restore\b|\bcargo\s+(fetch|add)\b/.test(t)) return { texto: 'Instalando lo que necesita', cat: 'instalar' };
    if (/\b(npm|yarn|pnpm)\s+run\s+build\b|\bdotnet\s+build\b|\bcargo\s+build\b|\bmake\b|\btsc\b|\bgradle\w*\s+build\b|\bmvn\s+(package|compile)\b|py_compile/.test(t)) return { texto: 'Armando el programa', cat: 'compilar' };
    if (/^git\s+(status|diff|log|show)\b/.test(t)) return { texto: 'Mirando los cambios del proyecto', cat: 'leer' };
    if (/^git\s+(commit|add|checkout|switch|merge|rebase|stash)\b/.test(t)) return { texto: 'Guardando cambios con git', cat: 'otro' };
    if (/^(ls|dir|tree|pwd|cat|head|tail|wc|stat|file|which|find)\b/.test(t)) return { texto: 'Mirando qué hay en la carpeta', cat: 'leer' };
    if (/^(rm|del|rmdir)\b/.test(t)) return { texto: 'Borrando archivos', cat: 'borrar' };
    if (/^(mv|cp|mkdir|touch)\b/.test(t)) return { texto: 'Moviendo o creando archivos', cat: 'otro' };
    if (/^(python3?|node|dotnet|java|ruby|go\s+run|cargo\s+run|bash|sh)\b/.test(t)) return { icono: '▶️', texto: 'Ejecutando el programa', cat: 'ejecutar' };
    if (/^(curl|wget)\b/.test(t)) return { texto: 'Hablando con un servidor de internet', cat: 'web' };
    return { icono: '⌨️', texto: 'Ejecutando un comando', cat: 'ejecutar' };
  }

  /** {texto, cat} para una herramienta. `texto` es lo que ve una persona no técnica. */
  function frase(nombre, input) {
    const n = String(nombre || '').toLowerCase(); const i = entrada(input);
    const f = (texto, cat) => ({ texto, cat });
    const de = (x) => (x ? ': ' + corto(archivo(x), 40) : '');
    let r;
    if (n === 'read') r = f('Leyendo' + (i.path || i.filePath ? ' «' + corto(archivo(i.path || i.filePath), 40) + '»' : ' un archivo'), 'leer');
    else if (n === 'write') r = f('Escribiendo' + (i.path || i.filePath ? ' «' + corto(archivo(i.path || i.filePath), 40) + '»' : ' un archivo nuevo'), 'escribir');
    else if (n === 'edit') r = f('Cambiando' + (i.path || i.filePath ? ' «' + corto(archivo(i.path || i.filePath), 40) + '»' : ' un archivo'), 'escribir');
    else if (n === 'shell' || n === 'bash') r = fraseShell(i.command);
    else if (n === 'glob' || n === 'grep') r = f('Buscando en el proyecto' + (i.pattern ? ' «' + corto(i.pattern, 30) + '»' : ''), 'buscar');
    else if (n === 'websearch') r = f('Buscando en internet' + (i.query ? ': ' + corto(i.query, 50) : ''), 'web');
    else if (n === 'webfetch') r = f('Leyendo una página web', 'web');
    else if (n === 'todo') r = f('Actualizando su lista de pasos', 'otro');
    else if (n === 'memoria') r = f('Guardando algo para recordarlo', 'otro');
    else if (n === 'skill') r = f('Consultando una guía', 'otro');
    else if (n === 'tarea' || n === 'tareas') r = f('Pidiendo ayuda a otro asistente', 'equipo');
    else if (n === 'revisar') r = f('Pidiendo una revisión del trabajo', 'probar');
    else if (/^(equipo_|pedir_a_equipo)/.test(n)) r = f('Coordinando con su equipo', 'equipo');
    else if (n === 'mcp_activar') r = f('Activando una herramienta', 'otro');
    else if (/^pantalla_/.test(n)) {
      const a = n.slice(9);
      const t = { captura: 'Mirando la pantalla virtual', clic: 'Haciendo clic en la pantalla virtual', escribir: 'Escribiendo en la pantalla virtual', tecla: 'Pulsando una tecla', mantener_tecla: 'Manteniendo una tecla', scroll: 'Bajando o subiendo la página', abrir_aplicacion: 'Abriendo un programa en la pantalla virtual', cerrar_aplicacion: 'Cerrando un programa', instalar_aplicacion: 'Instalando un programa del catálogo', catalogo_aplicaciones: 'Viendo qué programas puede instalar', leer_pagina: 'Leyendo la página abierta', esperar_pagina: 'Esperando a que cargue la página', esperar: 'Esperando', zoom: 'Ampliando una parte de la pantalla', lote: 'Haciendo varias acciones seguidas', pestana: 'Cambiando de pestaña', mover: 'Moviendo el ratón', arrastrar: 'Arrastrando con el ratón', leer_registro: 'Leyendo el registro del programa' }[a];
      r = f(t || 'Usando la pantalla virtual', 'pantalla');
    } else if (/^navegador_/.test(n)) r = f('Usando tu navegador', 'pantalla');
    else if (/^[a-z0-9]+_/.test(n)) r = f('Usando «' + n.split('_')[0] + '»', 'otro');
    else r = f('Trabajando', 'otro');
    return r;
  }

  const PLURAL = (n, uno, varios) => (n === 1 ? uno : varios);

  /** Resumen en palabras simples de un grupo de pasos: «Leyó 3 archivos · Escribió 2 · Probó 1 vez ✓». */
  function resumen(items) {
    const tools = (items || []).filter((x) => x.kind === 'tool');
    const c = {}; let fallos = 0; let probadoOk = 0; let probadoMal = 0;
    for (const t of tools) {
      const fr = frase(t.name, t.input); c[fr.cat] = (c[fr.cat] || 0) + 1;
      const fallo = /^(fall|error|failed)/i.test(String(t.status || ''));
      if (fallo) fallos++;
      if (fr.cat === 'probar') { if (fallo) probadoMal++; else if (/^(list|complet|success)/i.test(String(t.status || ''))) probadoOk++; }
    }
    const p = [];
    if (c.leer) p.push(`Leyó ${c.leer} ${PLURAL(c.leer, 'cosa', 'cosas')}`);
    if (c.escribir) p.push(`Cambió ${c.escribir} ${PLURAL(c.escribir, 'archivo', 'archivos')}`);
    if (c.borrar) p.push(`Borró ${c.borrar} ${PLURAL(c.borrar, 'vez', 'veces')}`);
    if (c.probar) p.push(`Probó ${c.probar} ${PLURAL(c.probar, 'vez', 'veces')}${probadoMal ? ' ✗' : probadoOk ? ' ✓' : ''}`);
    if (c.compilar) p.push('Armó el programa');
    if (c.instalar) p.push('Instaló dependencias');
    if (c.buscar) p.push(`Buscó ${c.buscar} ${PLURAL(c.buscar, 'vez', 'veces')}`);
    if (c.web) p.push('Consultó internet');
    if (c.pantalla) p.push('Usó la pantalla');
    if (c.equipo) p.push('Trabajó con su equipo');
    if (c.ejecutar) p.push(`Ejecutó ${c.ejecutar} ${PLURAL(c.ejecutar, 'programa', 'programas')}`);
    if (!p.length && tools.length) p.push(`Hizo ${tools.length} ${PLURAL(tools.length, 'paso', 'pasos')}`);
    return { texto: p.join(' · '), fallos, total: tools.length };
  }

  /** Lo que está haciendo AHORA (para la barra de estado). */
  function vivo(items, ocupado) {
    if (!ocupado) return null;
    const lista = items || [];
    for (let k = lista.length - 1; k >= 0; k--) {
      const x = lista[k];
      if (x.kind === 'tool' && /^(ejecut|prepar|running|pending)/i.test(String(x.status || ''))) { const fr = frase(x.name, x.input); return { cat: fr.cat, texto: fr.texto + '…' }; }
      if (x.kind === 'text' || x.kind === 'reasoning') break;
    }
    const ult = lista[lista.length - 1];
    if (ult && ult.kind === 'text') return { cat: 'mensaje', texto: 'Escribiendo la respuesta…' };
    return { cat: 'pensar', texto: 'Pensando…' };
  }

  /** Línea técnica concisa para quien quiere el dato exacto: nombre · estado · tamaño. */
  function tecnico(item) {
    const i = entrada(item && item.input); const partes = [item && item.name ? String(item.name) : 'herramienta'];
    if (i.command) partes.push('$ ' + corto(i.command, 90));
    else if (i.path || i.filePath) partes.push(corto(i.path || i.filePath, 80));
    else if (item && item.summary) partes.push(corto(item.summary, 80));
    const salida = item && item.detail ? String(item.detail).length : 0;
    if (salida > 0) partes.push((salida >= 1024 ? Math.round(salida / 1024) + ' KB' : salida + ' B') + ' de datos');
    const m = String((item && item.detail) || '').match(/\bexit(?:Code)?["':= ]+(-?\d+)/i);
    if (m) partes.push('salida ' + m[1]);
    return partes.join(' · ');
  }

  const INFINITIVO = {"Probando que todo funcione":"probar que todo funcione","Instalando lo que necesita":"instalar lo que necesita","Armando el programa":"armar el programa","Mirando los cambios del proyecto":"mirar los cambios del proyecto","Guardando cambios con git":"guardar cambios con git","Mirando qué hay en la carpeta":"mirar qué hay en la carpeta","Borrando archivos":"borrar archivos","Moviendo o creando archivos":"mover o crear archivos","Ejecutando el programa":"ejecutar el programa","Hablando con un servidor de internet":"hablar con un servidor de internet","Ejecutando un comando":"ejecutar un comando"};

  /** Permiso explicado en palabras simples + lo irreversible destacado. */
  function permiso(p) {
    const msg = String((p && p.message) || '');
    const irrev = /no se puede deshacer/i.test(msg) || /NO SE PUEDE DESHACER/.test(JSON.stringify((p && p.metadata) || {}));
    const accion = String((p && p.action) || ''); const rec = ((p && p.resources) || []).map(String);
    let titulo;
    if (accion === 'shell') titulo = INFINITIVO[fraseShell(rec[0]).texto] || 'ejecutar un comando';
    else if (accion === 'edit' || accion === 'write') titulo = 'guardar cambios en ' + (rec.length ? '«' + corto(archivo(rec[0]), 40) + '»' : 'un archivo');
    else if (accion === 'webfetch' || accion === 'websearch') titulo = 'consultar internet';
    else if (accion === 'mcp') titulo = 'usar «' + corto(rec[0] || 'una herramienta', 40) + '»';
    else titulo = 'hacer algo que necesita tu permiso';
    const motivo = irrev ? msg.replace(/^.*no se puede deshacer:\s*/i, '').replace(/^NO SE PUEDE DESHACER:\s*/i, '') : '';
    return { titulo: 'Wichi quiere ' + titulo, irreversible: irrev, motivo: corto(motivo, 160), tecnico: [accion].concat(rec).filter(Boolean).join(' · ') };
  }

  /** Mismo criterio que `resumir` de app.js, pero devolviendo el input entero (para `frase`). */
  const resumirInput = (i) => entrada(i);

  const API = { frase, fraseShell, resumen, vivo, tecnico, permiso, resumirInput, corto };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.Actividad = API;
})();
