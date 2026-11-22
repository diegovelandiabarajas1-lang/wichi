'use strict';
/*
 * Acciones del teléfono pedidas por el agente (igual que en el APK de Android).
 * El agente responde normal y, si hace falta algo del teléfono, añade líneas «ACCION: nombre | dato | dato».
 * La PWA las lee, te pregunta («¿Abro…?») y solo con tu toque en «Sí» las ejecuta. Nunca manda mensajes ni llama sola:
 * deja WhatsApp, SMS, correo o el marcador listos y tú pulsas enviar o llamar.
 * En iPhone una web solo puede abrir otra app con un toque tuyo, por eso cada acción pide su «Sí».
 */
(function () {
  const ABRE = '[[wichi-voz]]', CIERRA = '[[/wichi-voz]]';
  const ES_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

  // Tipos de enlace permitidos: nada de archivos, scripts ni atajos del sistema.
  const ESQUEMAS = new Set(['http:', 'https:', 'tel:', 'sms:', 'mailto:', 'whatsapp:', 'spotify:', 'tg:', 'vnd.youtube:', 'youtube:', 'maps:', 'comgooglemaps:', 'waze:', 'instagram:']);

  // Apps que se pueden abrir por nombre (esquema propio de cada app en iOS).
  const APPS = {
    whatsapp: 'whatsapp://', spotify: 'spotify://', youtube: 'youtube://', instagram: 'instagram://', telegram: 'tg://',
    mapas: 'maps://', maps: 'maps://', 'google maps': 'comgooglemaps://', waze: 'waze://',
    correo: 'mailto:', email: 'mailto:', telefono: 'tel:', llamadas: 'tel:', mensajes: 'sms:', sms: 'sms:',
  };

  const spotifyOn = () => !!(window.Spotify && Spotify.conectado && Spotify.conectado());
  const accionesTxt = () =>
    'Si el usuario quiere que el teléfono haga algo, resuélvelo tú (por ejemplo averigua el título y el artista reales de una canción) ' +
    'y al final de tu respuesta pon una línea por acción con este formato exacto: ' +
    'ACCION: ver | enlace (cualquier enlace o enlace profundo de una app: https://…, https://wa.me/número?text=…, https://www.youtube.com/results?search_query=…, https://open.spotify.com/search/…, spotify:search:…, tg://…) · ' +
    'ACCION: musica | Título de Artista (o solo Artista) · ACCION: spotify | texto · ACCION: youtube | texto · ' +
    'ACCION: llamar | número · ACCION: sms | número | texto · ACCION: whatsapp | número con código de país | texto · ' +
    'ACCION: correo | dirección | asunto | cuerpo · ACCION: compartir | texto · ACCION: mapa | lugar · ACCION: buscar | texto · ACCION: abrir | app. ' +
    (spotifyOn()
      ? 'Spotify está conectado: para controlarlo usa ACCION: pausa · ACCION: continuar · ACCION: siguiente · ACCION: anterior · ACCION: volumen | 0-100 · ACCION: quesuena, y ACCION: musica reproduce directo. '
      : '') +
    'El teléfono es un iPhone: no se pueden crear alarmas ni cambiar el volumen del teléfono desde la app' + (spotifyOn() ? '. ' : ', ni controlar la música, así que no pidas esas acciones. ') +
    'Con ver, llamar, sms, whatsapp y correo la app solo deja todo listo: el usuario pulsa enviar o llamar él mismo. ' +
    'Para cualquier app que no esté en la lista, usa ver con el enlace profundo que conozcas. ' +
    'Si no hace falta ninguna acción, no pongas ninguna línea. Nunca digas que no puedes abrir apps o buscar música: la app del teléfono lo hace con esas líneas.';

  const protocoloVoz = () => ABRE + 'Hablas por voz con el usuario desde su teléfono. Responde en español, breve y natural, sin markdown ni listas. ' + accionesTxt() + CIERRA;
  const protocoloChat = () => ABRE + 'Escribes en el chat de la app Wichi, en el teléfono del usuario. ' + accionesTxt() + CIERRA;

  const sinTildes = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
  const enc = encodeURIComponent;

  const conProtocoloEnSesion = new Set();
  /** Antepone (oculto en el chat) cómo pedir acciones: en voz siempre; en el chat escrito, la primera vez de cada conversación. */
  function conProtocolo(texto, sesionId, voz) {
    if (texto.includes(ABRE)) return texto;
    if (voz) return protocoloVoz() + '\n' + texto;
    if (conProtocoloEnSesion.has(sesionId)) return texto;
    conProtocoloEnSesion.add(sesionId);
    return protocoloChat() + '\n' + texto;
  }

  /** Quita las instrucciones ocultas de un mensaje del usuario antes de mostrarlo. */
  function quitarProtocolo(s) {
    if (!s || !s.includes(ABRE)) return s;
    return s.replace(new RegExp(ABRE.replace(/[[\]]/g, '\\$&') + '[\\s\\S]*?' + CIERRA.replace(/[[\]/]/g, '\\$&') + '\\s*', 'g'), '').trim();
  }

  const LINEA = /^\s*[-*•]?\s*ACCION\s*:\s*([A-Za-zÁÉÍÓÚáéíóú_]+)\s*(?:\|\s*(.*))?$/i;
  /** Separa la respuesta del agente en el texto que se lee y la lista de acciones pedidas. */
  function separarAcciones(crudo) {
    const acciones = [];
    const texto = String(crudo || '').split('\n').filter((l) => {
      const m = LINEA.exec(l.trim());
      if (!m) return true;
      acciones.push({ nombre: sinTildes(m[1]).toLowerCase(), args: (m[2] || '').split('|').map((x) => x.trim()) });
      return false;
    }).join('\n').trim();
    return { texto, acciones };
  }

  function esquemaOk(u) {
    try { return ESQUEMAS.has(new URL(u).protocol); } catch { return false; }
  }

  /** Abre un enlace (hay que llamarla dentro del toque del usuario, si no iOS la ignora). */
  function abrir(url) {
    if (!esquemaOk(url)) return false;
    if (/^https?:/i.test(url)) { const w = window.open(url, '_blank'); if (!w) location.href = url; }
    else location.href = url;
    return true;
  }

  /** Convierte {nombre, args} en una acción con su pregunta; null si no se entiende o no se puede en un iPhone. */
  function construir(a) {
    const n = a.nombre, g = a.args || [], g1 = g[0] || '', g2 = g[1] || '', g3 = g[2] || '';
    const tel = g1.replace(/[^\d+]/g, '');
    const web = (url, q, listo) => ({ pregunta: q, listo: listo || 'Listo.', ejecutar: () => abrir(url) });
    switch (n) {
      case 'ver': case 'url': case 'enlace': {
        if (!esquemaOk(g1)) return null;
        const u = new URL(g1);
        return web(g1, /^https?:$/.test(u.protocol) ? `¿Abro la página ${u.hostname}?` : `¿Abro este enlace de ${u.protocol.replace(':', '')}?`);
      }
      case 'llamar': return tel ? web('tel:' + tel, `¿Marco el número ${tel}?`, 'Listo, el número está marcado. Pulsa llamar.') : null;
      case 'sms': return tel ? web('sms:' + tel + (ES_IOS ? '&' : '?') + 'body=' + enc(g2), `¿Preparo un mensaje de texto para el ${tel}?`, 'Listo, el mensaje está escrito. Pulsa enviar.') : null;
      case 'whatsapp': {
        const num = tel.replace(/^\+/, '');
        return num ? web(`https://wa.me/${num}?text=${enc(g2)}`, `¿Preparo un WhatsApp para el ${num}?`, 'Listo, el mensaje está escrito. Pulsa enviar.') : null;
      }
      case 'correo': return g1.includes('@') ? web(`mailto:${g1}?subject=${enc(g2)}&body=${enc(g3)}`, `¿Preparo un correo para ${g1}?`, 'Listo, el correo está escrito. Pulsa enviar.') : null;
      case 'compartir': return g1 ? {
        pregunta: '¿Comparto ese texto?', listo: 'Listo.',
        ejecutar: () => {
          if (navigator.share) { navigator.share({ text: g1 }).catch(() => {}); return true; }
          if (navigator.clipboard) { navigator.clipboard.writeText(g1).catch(() => {}); return true; }
          return false;
        },
      } : null;
      case 'mapa': case 'navegar': return g1 ? web('https://maps.apple.com/?q=' + enc(g1), `¿Busco ${g1} en el mapa?`, 'Listo, abriendo el mapa.') : null;
      case 'buscar': return g1 ? web('https://www.google.com/search?q=' + enc(g1), `¿Busco «${g1}» en internet?`, 'Listo, buscando.') : null;
      case 'spotify': case 'musica':
        if (g1 && spotifyOn()) return { pregunta: `¿Pongo «${g1}» en Spotify?`, listo: '', ejecutar: () => Spotify.reproducir(g1) };
        return g1 ? web('https://open.spotify.com/search/' + enc(g1), `¿Busco «${g1}» en Spotify?`, `Abrí Spotify con «${g1}». En iPhone toca reproducir tú.`) : null;
      case 'youtube': return g1 ? web('https://www.youtube.com/results?search_query=' + enc(g1), `¿Busco «${g1}» en YouTube?`, 'Listo, buscando en YouTube.') : null;
      case 'abrir': {
        const clave = sinTildes(g1).toLowerCase().replace(/^(la |el )?(app |aplicacion )?(de )?/, '').trim();
        const esquema = APPS[clave];
        return esquema ? web(esquema, `¿Abro ${g1}?`, `Listo, abriendo ${g1}.`) : { pregunta: `No sé abrir «${g1}» desde una web en iPhone.`, listo: '', soloDecir: true, ejecutar: () => false };
      }
      case 'quesuena': if (spotifyOn()) return { pregunta: '', sinPregunta: true, listo: '', ejecutar: () => Spotify.queSuena() }; return null;
      case 'pausa': case 'continuar': case 'siguiente': case 'anterior': case 'volumen':
        if (spotifyOn()) {
          const f = { pausa: () => Spotify.pausar(), continuar: () => Spotify.reanudar(), siguiente: () => Spotify.siguiente(), anterior: () => Spotify.anterior(), volumen: () => Spotify.volumen(Number(g1.replace(/\D/g, '')) || 0) }[n];
          return { pregunta: '', sinPregunta: true, listo: '', ejecutar: f };
        }
      // sin Spotify conectado, sigue al aviso de abajo
      case 'alarma': case 'temporizador':
        return { pregunta: 'En iPhone, una web no puede hacer eso (alarmas, volumen y control de la música). Díselo a Siri o usa la app Reloj.', listo: '', soloDecir: true, ejecutar: () => false };
      default: return null;
    }
  }

  /**
   * Órdenes cortas que se entienden sin preguntarle al agente (lo demás va al modelo): «abre WhatsApp», «llévame a la UIS»,
   * «busca la UIS en Google Maps», «busca X en Spotify/YouTube», «busca X».
   */
  function interpretar(dicho) {
    const t = sinTildes(String(dicho || '').toLowerCase()).replace(/^(?:oye|hey|ok|hola)\s+wichi[\s,]*/, '').trim().replace(/[.,!?¿¡]+$/g, '');
    let m;
    if (spotifyOn()) {
      if (/^(?:pausa|pausar|deten|detener|para|parar|pausa la musica|pausa spotify)$/.test(t)) return construir({ nombre: 'pausa', args: [] });
      if (/^(?:continua|continuar|reanuda|reanudar|sigue|seguir|play|continua la musica)$/.test(t)) return construir({ nombre: 'continuar', args: [] });
      if (/^(?:siguiente|la siguiente|pasa|pasala|salta|saltala|otra|cambia|cambiala|siguiente cancion|cambia la cancion|salta la cancion|cambia de cancion)$/.test(t)) return construir({ nombre: 'siguiente', args: [] });
      if (/^(?:anterior|la anterior|cancion anterior|atras|vuelve a la anterior)$/.test(t)) return construir({ nombre: 'anterior', args: [] });
      if ((m = /volumen.*?(\d{1,3})/.exec(t))) return construir({ nombre: 'volumen', args: [m[1]] });
      if (/que (?:cancion )?(?:suena|esta sonando|es esta)|como se llama esta cancion|que estoy escuchando/.test(t)) return construir({ nombre: 'quesuena', args: [] });
      if ((m = /^(?:ponme|pon|reproduce|reproduceme|toca|tocame)\s+(?:algo de musica de\s+|musica de\s+|algo de\s+|la cancion\s+|el album\s+)?(.+?)(?:\s+en spotify)?$/.exec(t)) && !/^(?:la camara|whatsapp|youtube)$/.test(m[1])) return construir({ nombre: 'musica', args: [m[1]] });
    }
    if ((m = /^(?:abre|abreme|abrir|lanza|inicia)\s+(?:la\s+app\s+(?:de\s+)?|la\s+aplicacion\s+(?:de\s+)?|el\s+|la\s+)?(.+)$/.exec(t))) return construir({ nombre: 'abrir', args: [m[1]] });
    if ((m = /^(?:llevame|navega|ruta|como llego|indicame como llegar)\s+(?:a|al|hasta|hacia)\s+(.+)$/.exec(t))) return construir({ nombre: 'mapa', args: [m[1]] });
    if ((m = /^(?:busca|buscame|encuentra|localiza|muestrame)\s+(.+?)\s+en\s+(?:mi\s+|el\s+|tu\s+)?(?:google\s+)?(?:maps|mapas|mapa)$/.exec(t))) return construir({ nombre: 'mapa', args: [m[1]] });
    if ((m = /^(?:busca|buscame)\s+(.+?)\s+(?:en|con|por)\s+spotify$/.exec(t))) return construir({ nombre: 'spotify', args: [m[1]] });
    if ((m = /^(?:busca|buscame)\s+(.+?)\s+(?:en|con|por)\s+youtube$/.exec(t))) return construir({ nombre: 'youtube', args: [m[1]] });
    // «busca X en <otra app>» no es una búsqueda web: se la dejamos al modelo.
    if ((m = /^(?:busca|buscame|googlea|investiga)\s+(?:en\s+(?:internet|google|la web)\s+)?(.+)$/.exec(t))) {
      if (/\s+en\s+(?:mi\s+|el\s+|la\s+|tu\s+)?(?:whatsapp|instagram|telegram|tiktok|facebook|twitter|amazon|mercado libre)$/.test(m[1])) return null;
      return construir({ nombre: 'buscar', args: [m[1]] });
    }
    return null;
  }

  /** «gracias», «adiós», «eso es todo»…: termina la conversación de voz. */
  function esDespedida(dicho) {
    const t = sinTildes(String(dicho || '').toLowerCase()).trim().replace(/[.,!]+$/g, '');
    return /^(?:muchas )?(?:gracias|adios|chao|chau|hasta luego|eso es todo|nada mas|ya esta|cierra|salir|terminar|listo gracias)(?:\s+\w+){0,2}$/.test(t);
  }

  /* ───────────── preguntar «Sí / No» y ejecutar con el toque ───────────── */
  /** Muestra la pregunta; el «Sí» ejecuta la acción en el mismo toque (iOS lo exige). Resuelve true (hecho), false (no) o null (no se pudo). */
  function preguntar(acc) {
    return new Promise((resolver) => {
      if (acc.soloDecir) { if (window.toast) toast(acc.pregunta, 6000); resolver(null); return; }
      if (acc.sinPregunta) { void correr(acc).then((t) => { if (t && window.toast) toast(t, 6000); resolver(true); }); return; }
      const dlg = document.getElementById('dlg-accion');
      document.getElementById('acc-texto').textContent = acc.pregunta;
      const si = document.getElementById('acc-si'), no = document.getElementById('acc-no');
      // Se resuelve cuando el aviso ya se cerró del todo: si no, el evento «close» de este aviso llegaría tarde y cerraría el siguiente.
      const fin = (v) => {
        si.onclick = no.onclick = null; dlg.onclose = null;
        if (dlg.open) { dlg.addEventListener('close', () => resolver(v), { once: true }); dlg.close(); } else resolver(v);
      };
      si.onclick = () => {
        const r = acc.ejecutar();
        if (r && typeof r.then === 'function') { r.then((t) => { if (t && window.toast) toast(t, 6000); }).catch(() => {}); fin(true); return; }
        const ok = !!r;
        if (window.toast) toast(ok ? (acc.listo || 'Listo.') : 'No se pudo hacer en este teléfono.', 5000);
        fin(ok);
      };
      no.onclick = () => fin(false);
      dlg.onclose = () => fin(false);
      if (!dlg.open) dlg.showModal();
    });
  }

  /** Ejecuta una acción y devuelve la frase del resultado (para las de Spotify, que contestan por la API). */
  async function correr(acc) {
    try {
      const r = await acc.ejecutar();
      return typeof r === 'string' ? r : (r ? (acc.listo || 'Listo.') : 'No se pudo hacer en este teléfono.');
    } catch { return 'No se pudo hacer.'; }
  }

  /** Hace una tras otra las acciones pedidas; si dices «No» a una, se cancelan las demás. */
  async function ejecutarLista(lista) {
    for (const a of lista) {
      const acc = construir(a);
      if (!acc) continue;
      const r = await preguntar(acc);
      if (r === false) break;
    }
  }

  /* ───────────── chat escrito: al terminar el agente ───────────── */
  let ultima = '';
  /** Se llama cuando el agente termina un turno. Si no está abierto el modo de voz (él se encarga), busca acciones en la última respuesta. */
  async function alTerminar() {
    if (window.Voz && Voz.activo) return;
    // «S» (el estado de app.js) es una constante global de otro script: se ve desde aquí pero no cuelga de window.
    const estado = typeof S !== 'undefined' ? S : null;
    if (!estado || !estado.actual) return;
    const S_ = estado;
    const t = [...S.items].reverse().find((i) => i.kind === 'text');
    if (!t) return;
    const { acciones } = separarAcciones(t.text);
    const huella = S.actual.id + '|' + t.text;
    if (!acciones.length || huella === ultima) return;
    ultima = huella;
    await ejecutarLista(acciones);
  }

  window.Acciones = { protocoloVoz, protocoloChat, correr, conProtocolo, quitarProtocolo, separarAcciones, construir, interpretar, esDespedida, preguntar, ejecutarLista, alTerminar };
})();
