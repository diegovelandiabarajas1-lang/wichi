/* Wichi PWA · pantallas de bienvenida (port fiel de Onboarding.kt, Wizard.kt y Home.kt del APK).
 * API: window.Guias = { cuenta(), hospedaje(), render(), vps(), claveNvidia(), cerrar() }.
 * Todo el texto se inserta con textContent (nunca innerHTML con datos). Los comandos nunca se muestran: solo se copian. */
(function () {
  'use strict';

  /* ───────────── lo puro (probado con Node) ───────────── */
  const PLANTILLA_RENDER = 'https://render.com/deploy?repo=https://github.com/diegovelandiabarajas1-lang/ai-mobile-render';
  const RE_RENDER = /https:\/\/[A-Za-z0-9-]+\.onrender\.com/;
  const ABC = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function generarClave(largo) {
    largo = largo || 20;
    let out = '';
    const c = (typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto : null;
    if (c) {
      // sin sesgo: se descartan los valores que no caben en un múltiplo del alfabeto
      const tope = 256 - (256 % ABC.length);
      while (out.length < largo) {
        const b = c.getRandomValues(new Uint8Array(32));
        for (let i = 0; i < b.length && out.length < largo; i++) if (b[i] < tope) out += ABC[b[i] % ABC.length];
      }
    } else {
      while (out.length < largo) out += ABC[Math.floor(Math.random() * ABC.length)];
    }
    return out;
  }

  const MIN_CLAVE = 12;
  const NOMBRE_OK = /^[\p{L}\p{N}._-]+$/u;
  function validarCuenta(nombre, clave, repetir) { // respaldo idéntico a Cuenta.validar; en la PWA se usa Sesion.validar si existe
    const n = (nombre || '').trim();
    if (n.length < 3 || n.length > 32) return 'El nombre debe tener entre 3 y 32 caracteres.';
    if (!NOMBRE_OK.test(n)) return 'El nombre solo puede llevar letras, números, punto, guion y guion bajo (sin espacios).';
    if ((clave || '').length < MIN_CLAVE) return 'La contraseña debe tener al menos ' + MIN_CLAVE + ' caracteres (así lo exige Wichinion).';
    if (repetir !== undefined && repetir !== null && clave !== repetir) return 'Las contraseñas no coinciden.';
    return null;
  }

  const VpsGuia = (function () {
    const PUERTO = 4097;
    const REPO = 'https://github.com/diegovelandiabarajas1-lang/wichinion-render.git';
    const o = (v, def) => (v == null || String(v).trim() === '') ? def : String(v).trim();
    const DOMINIO = /^(?=.{4,253}$)([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;
    const TOKEN = /^[A-Za-z0-9._-]+$/;
    return {
      PUERTO, REPO,
      ssh: (usuario, ip) => 'ssh ' + o(usuario, 'root') + '@' + o(ip, 'IP_DEL_VPS'),
      nodeYCodigo: () => 'curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && ' +
        'sudo apt-get install -y nodejs git && sudo rm -rf /opt/wichinion && ' +
        'sudo git clone --depth 1 ' + REPO + ' /opt/wichinion && node --version',
      instalar: (nombre, clave) => [
        'sudo mkdir -p /var/lib/wichinion/data /var/lib/wichinion/trabajo',
        'id wichinion >/dev/null 2>&1 || sudo useradd --system --home /var/lib/wichinion --shell /usr/sbin/nologin wichinion',
        'sudo chown -R wichinion:wichinion /var/lib/wichinion',
        "sudo tee /etc/wichinion.env >/dev/null <<'WICHI_ENV'",
        'MOTOR_USER=' + nombre,
        'MOTOR_PASSWORD=' + clave,
        'MOTOR_HOST=127.0.0.1',
        'MOTOR_PORT=' + PUERTO,
        'MOTOR_DATA=/var/lib/wichinion/data',
        'MOTOR_WORKDIR=/var/lib/wichinion/trabajo',
        'WICHI_ENV',
        'sudo chmod 600 /etc/wichinion.env',
        "sudo tee /etc/systemd/system/wichinion.service >/dev/null <<'WICHI_UNIT'",
        '[Unit]',
        'Description=Wichinion (servidor de Wichi)',
        'After=network.target',
        '',
        '[Service]',
        'User=wichinion',
        'EnvironmentFile=/etc/wichinion.env',
        'ExecStart=/usr/bin/node /opt/wichinion/src/server.js',
        'Restart=always',
        'RestartSec=3',
        'NoNewPrivileges=true',
        'ProtectSystem=full',
        'ReadWritePaths=/var/lib/wichinion',
        '',
        '[Install]',
        'WantedBy=multi-user.target',
        'WICHI_UNIT',
        'sudo systemctl daemon-reload && sudo systemctl enable --now wichinion',
        "sleep 2 && curl -s -o /dev/null -w 'Wichinion responde: HTTP %{http_code}\\n' http://127.0.0.1:" + PUERTO + '/api/info',
      ].join('\n') + '\n',
      https: (dominio) => [
        'sudo apt-get install -y caddy',
        "sudo tee /etc/caddy/Caddyfile >/dev/null <<'WICHI_CADDY'",
        o(dominio, 'TU_DOMINIO') + ' {',
        '    reverse_proxy 127.0.0.1:' + PUERTO,
        '}',
        'WICHI_CADDY',
        'sudo systemctl reload caddy',
        'command -v ufw >/dev/null && sudo ufw allow 80,443/tcp || true',
      ].join('\n') + '\n',
      dominioValido: (d) => d != null && String(d).trim() !== '' && DOMINIO.test(String(d).trim()),
      tokenSeguro: (s) => s != null && String(s).trim() !== '' && TOKEN.test(String(s).trim()),
    };
  })();

  function claveNvidiaValida(k) { return k.startsWith('nvapi-') && k.length >= 20; }

  /* ───────────── DOM ───────────── */
  if (typeof document === 'undefined') {
    if (typeof module !== 'undefined') module.exports = { VpsGuia, generarClave, validarCuenta, claveNvidiaValida, PLANTILLA_RENDER, RE_RENDER };
    return;
  }

  /** h('div', {class:'x', onclick:fn}, hijo|texto, ...) — los textos van como nodos de texto. */
  function h(tag, attrs) {
    const el = document.createElement(tag);
    if (attrs) for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (let i = 2; i < arguments.length; i++) {
      const c = arguments[i];
      if (c == null || c === false) continue;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }

  const aviso = (t) => { if (typeof toast === 'function') toast(t); };
  const sesion = () => (typeof Sesion !== 'undefined' && Sesion.leer) ? Sesion.leer() : null;

  function copiar(texto, mensaje) {
    const ok = () => aviso(mensaje || 'Copiado');
    const respaldo = () => {
      const ta = h('textarea', { 'aria-hidden': 'true', tabindex: '-1', readonly: true, style: 'position:fixed;left:-9999px;top:0;opacity:0;font-size:16px' });
      ta.value = texto;
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      try { ta.setSelectionRange(0, texto.length); } catch (e) { /* nada */ }
      let hecho = false;
      try { hecho = document.execCommand('copy'); } catch (e) { hecho = false; }
      document.body.removeChild(ta);
      if (hecho) ok(); else aviso('No se pudo copiar.');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(texto).then(ok, respaldo);
    else respaldo();
  }

  async function leerPortapapeles() {
    try { if (navigator.clipboard && navigator.clipboard.readText) return ((await navigator.clipboard.readText()) || '').trim(); } catch (e) { /* permiso o fallo */ }
    return '';
  }

  const SIN_ESCRIBIR = { autocapitalize: 'off', autocorrect: 'off', autocomplete: 'off', spellcheck: 'false' };

  let actual = null;      // sección activa
  let limpiar = null;     // quita listeners de la pantalla activa

  function cerrar() {
    if (limpiar) { try { limpiar(); } catch (e) { /* nada */ } limpiar = null; }
    if (actual && actual.parentNode) actual.parentNode.removeChild(actual);
    actual = null;
  }

  function mostrar(hijos, conIcono) {
    cerrar();
    const app = document.querySelector('.app') || document.body;
    const sec = h('section', { class: 'guia hero' });
    if (conIcono !== false) sec.appendChild(h('img', { class: 'logo-w', src: 'icons/wichi-w.png', alt: '' }));
    hijos.forEach((c) => c && sec.appendChild(c));
    app.appendChild(sec);
    actual = sec;
    sec.scrollTop = 0;
    return sec;
  }

  const btn = (texto, clase, fn, extra) => h('button', Object.assign({ type: 'button', class: 'btn ' + (clase || ''), onclick: fn }, extra || {}), texto);
  const texto = (t, clase) => h('p', { class: clase || 't-suave' }, t);
  const paso = (n, titulo, desc, ...contenido) => h('div', { class: 'paso' },
    h('div', { class: 'num' }, String(n)),
    h('div', { class: 'cuerpo' }, h('h3', null, titulo), h('p', null, desc), ...contenido));
  const campo = (etiqueta, input) => h('label', { class: 'campo' }, etiqueta, input);

  /* ───────────── 1. cuenta ───────────── */
  function cuenta() {
    let entrar = false;
    const nombre = h('input', Object.assign({ type: 'text', name: 'wichi-nombre', inputmode: 'text', enterkeyhint: 'next' }, SIN_ESCRIBIR));
    const clave = h('input', Object.assign({ type: 'password', name: 'wichi-clave', enterkeyhint: 'next' }, SIN_ESCRIBIR));
    const repetir = h('input', Object.assign({ type: 'password', name: 'wichi-repetir', enterkeyhint: 'done' }, SIN_ESCRIBIR));
    const ver = h('button', { type: 'button', 'aria-label': 'Mostrar u ocultar la contraseña' }, 'Ver');
    const titulo = h('h1', { class: 't-titulo' });
    const sub = h('p', { class: 't-suave' });
    const campoRepetir = campo('Repetir contraseña', repetir);
    const minimo = h('p', { class: 't-suave t-pequeno' }, 'La contraseña debe tener al menos ' + MIN_CLAVE + ' caracteres (así lo exige Wichinion).');
    const error = h('p', { class: 't-error', role: 'alert', hidden: true });
    const ir = btn('', 'principal ancho', enviar);
    const alterna = btn('', 'texto', () => { entrar = !entrar; pintar(); });

    function quitarError() { error.hidden = true; error.textContent = ''; }
    function pintar() {
      titulo.textContent = entrar ? 'Hola, inicia sesión' : 'Hola, crea una cuenta';
      sub.textContent = entrar
        ? 'Escribe el nombre y la contraseña de tu cuenta de Wichi.'
        : 'Tu nombre y tu contraseña serán también el usuario y la contraseña de tu servidor Wichinion. Se guardan solo en este teléfono.';
      campoRepetir.hidden = entrar; minimo.hidden = entrar;
      clave.autocomplete = entrar ? 'current-password' : 'new-password';
      ir.textContent = entrar ? 'Iniciar sesión' : 'Crear cuenta';
      alterna.textContent = entrar ? 'No tengo cuenta → Crear una' : 'Ya tengo cuenta → Iniciar sesión';
      quitarError();
    }
    function enviar() {
      const n = nombre.value.trim();
      const rep = entrar ? undefined : repetir.value;
      const msg = (typeof Sesion !== 'undefined' && Sesion.validar) ? Sesion.validar(n, clave.value, rep) : validarCuenta(n, clave.value, rep);
      if (msg) { error.textContent = msg; error.hidden = false; return; }
      if (typeof Sesion === 'undefined' || !Sesion.guardar) { error.textContent = 'No se pudo guardar la cuenta.'; error.hidden = false; return; }
      Sesion.guardar(n, clave.value);
      hospedaje();
    }
    ver.addEventListener('click', () => {
      const oculto = clave.type === 'password';
      clave.type = repetir.type = oculto ? 'text' : 'password';
      ver.textContent = oculto ? 'Ocultar' : 'Ver';
    });
    [nombre, clave, repetir].forEach((i) => { i.addEventListener('input', quitarError); i.addEventListener('keydown', (e) => { if (e.key === 'Enter') enviar(); }); });
    nombre.addEventListener('blur', () => { nombre.value = nombre.value.trim(); });

    mostrar([
      titulo, sub,
      campo('Nombre', nombre),
      campo('Contraseña', h('div', { class: 'con-boton' }, clave, ver)),
      campoRepetir, minimo, error, ir, alterna,
    ]);
    pintar();
  }

  /* ───────────── 2. hospedaje ───────────── */
  function opcion(icono, titulo, desc, fn) {
    return h('button', { type: 'button', class: 'opcion', onclick: fn },
      h('img', { src: icono, alt: '' }),
      h('span', null, h('div', { class: 't' }, titulo), h('div', { class: 'd' }, desc)));
  }
  function hospedaje() {
    const u = sesion();
    const hay = typeof Cuentas !== 'undefined' && Cuentas.lista && Cuentas.lista.length > 0;
    mostrar([
      u ? h('p', { class: 't-suave' }, 'Hola, ' + u.nombre) : null,
      h('h1', { class: 't-subtitulo' }, 'Bueno, debido a que no usarás tu dispositivo actual para hostear el modelo o a Wichinion, necesitamos uno que sí.'),
      h('p', { class: 't-suave' }, '¿Dónde lo hospedamos?'),
      opcion('icons/icono-render.png', 'Render', 'Gratis y sin tarjeta, listo en unos 5 minutos. Se duerme tras 15 minutos sin uso y tarda cerca de 1 minuto en despertar.', render),
      opcion('icons/icono-vps.png', 'Configurar VPS propio', 'Tu propio servidor Linux: siempre encendido y con más control. Requiere un poco más de configuración; te guío paso a paso.', vps),
      hay ? btn('← Volver', 'texto', () => { cerrar(); if (typeof window.abrirInicio === 'function') window.abrirInicio(); }) : null,
    ]);
  }

  /* ───────────── 3. Render ───────────── */
  function ayuda(t, d) { return h('div', { class: 'ayuda' }, h('b', null, t), h('span', null, d)); }
  function render() {
    const u = sesion();
    const clave = u ? u.clave : generarClave();
    let abierto = false;
    const dir = h('input', Object.assign({ type: 'url', inputmode: 'url', placeholder: 'https://…onrender.com', 'aria-label': 'Dirección del servidor' }, SIN_ESCRIBIR));
    const av = h('p', { class: 't-error t-pequeno', role: 'alert', hidden: true });
    const conectarBtn = btn('Conectar', 'principal', alConectar, { disabled: true });
    const quitar = () => { av.hidden = true; av.textContent = ''; };
    const msg = (t) => { av.textContent = t; av.hidden = false; };
    const refrescar = () => { if (dir.value.trim()) conectarBtn.removeAttribute('disabled'); else conectarBtn.setAttribute('disabled', ''); };

    async function alVolver() {
      if (document.visibilityState !== 'visible' || !abierto || dir.value.trim()) return;
      const m = RE_RENDER.exec(await leerPortapapeles());
      if (m && !dir.value.trim()) { dir.value = m[0]; quitar(); refrescar(); }
    }
    document.addEventListener('visibilitychange', alVolver);
    limpiar = () => document.removeEventListener('visibilitychange', alVolver);

    dir.addEventListener('input', () => { quitar(); refrescar(); });
    dir.addEventListener('blur', () => { dir.value = dir.value.trim(); refrescar(); });

    async function pegar() {
      const m = RE_RENDER.exec(await leerPortapapeles());
      if (m) { dir.value = m[0]; quitar(); refrescar(); } else msg('No veo ninguna dirección copiada todavía.');
    }
    async function alConectar() {
      const m = RE_RENDER.exec(dir.value.trim());
      if (!m) { msg('La dirección debe verse como https://algo.onrender.com'); return; }
      quitar();
      if (typeof Cuentas === 'undefined' || typeof conectar !== 'function') { msg('Falta conectar con la app.'); return; }
      const c = Cuentas.añadir('Mi servidor', 'cowork', m[0], clave);
      cerrar();
      try { await conectar(c); } catch (e) { /* conectar() ya avisa */ }
    }

    mostrar([
      h('h1', { class: 't-titulo' }, 'Crea tu servidor gratis'),
      texto('Un servidor es una computadora en internet que trabaja por ti aunque tu teléfono esté apagado. Render lo presta gratis y no pide tarjeta. Son 4 pasos y tarda unos 5 minutos.'),
      paso(1, 'Crear tu cuenta en Render', 'Toca «Abrir Render». Se abre una página web. Entra con tu cuenta de Google o de GitHub (es lo más rápido) o con tu correo. Ya te copié tu contraseña de Wichi: la vas a necesitar en el paso 2.',
        h('div', { class: 'fila' }, btn('Abrir Render', 'principal', () => { copiar(clave, 'Copiado'); abierto = true; window.open(PLANTILLA_RENDER, '_blank', 'noopener'); }))),
      paso(2, 'Poner tu contraseña', 'Render te muestra una página con un casillero que pide una contraseña. Toca ese casillero, mantén pulsado y elige «Pegar». La contraseña que pegas es la de tu cuenta de Wichi, no tienes que inventar otra. ¿No aparece nada pegado? Toca «Copiar otra vez» y vuelve a pegar.',
        u ? null : h('p', null, 'Tu contraseña: ' + clave),
        h('div', { class: 'fila' }, btn('Copiar otra vez', 'texto', () => copiar(clave)))),
      paso(3, 'Crear el servidor', 'Baja hasta el final de la página y toca el botón grande que dice «Deploy Blueprint». Render empieza a armar tu servidor. Espera unos minutos hasta que veas la palabra «Live» en verde: significa que ya está listo. No cierres la página mientras tanto.'),
      paso(4, 'Traer la dirección a Wichi', 'Arriba, bajo el nombre de tu servidor, hay una dirección que termina en .onrender.com. Tócala o toca el ícono de copiar. Vuelve a Wichi: la dirección se pega sola y solo tienes que tocar «Conectar».',
        h('div', { class: 'campo' }, dir),
        h('div', { class: 'fila' }, btn('Pegar', 'texto', pegar), conectarBtn),
        av),
      h('h2', { class: 't-seccion' }, 'Si algo no sale'),
      ayuda('«Se queda en proceso»', 'Es normal: la primera vez tarda hasta 10 minutos. Espera y no lo repitas.'),
      ayuda('«Me pide una tarjeta»', 'No debería. Si pasa, cierra la página y avísame, para revisarlo.'),
      ayuda('«Me equivoqué o salí de la página»', 'Puedes empezar otra vez desde el paso 1; no se crea nada doble.'),
      ayuda('«Mi servidor tarda en responder»', 'El servidor gratis se duerme si no lo usas 15 minutos y tarda cerca de 1 minuto en despertar. No es un error.'),
      btn('← Volver', 'texto', hospedaje),
      btn('Ya tengo un servidor Wichinion', 'texto', () => { cerrar(); if (typeof window.abrirConectar === 'function') window.abrirConectar(); }),
    ]);
  }

  /* ───────────── 4. VPS ───────────── */
  function vps() {
    const u = sesion();
    const ip = h('input', Object.assign({ type: 'text', inputmode: 'decimal', placeholder: '203.0.113.10' }, SIN_ESCRIBIR));
    const usr = h('input', Object.assign({ type: 'text', value: 'root' }, SIN_ESCRIBIR));
    const dom = h('input', Object.assign({ type: 'text', inputmode: 'url', placeholder: 'wichi.midominio.com' }, SIN_ESCRIBIR));
    const dir = h('input', Object.assign({ type: 'url', inputmode: 'url', placeholder: 'https://wichi.midominio.com' }, SIN_ESCRIBIR));
    const av = h('p', { class: 't-error t-pequeno', role: 'alert', hidden: true });
    const msg = (t) => { av.textContent = t; av.hidden = !t; };
    const limpio = (i) => { i.value = i.value.trim(); };
    [ip, usr, dom, dir].forEach((i) => { i.addEventListener('input', () => msg('')); i.addEventListener('blur', () => limpio(i)); });
    dom.addEventListener('input', () => {
      const v = dom.value.trim();
      if (VpsGuia.dominioValido(v) && !dir.value.trim()) dir.value = 'https://' + v;
      conectarBtn.toggleAttribute('disabled', !(dir.value.trim() && sesion()));
    });
    dir.addEventListener('input', () => conectarBtn.toggleAttribute('disabled', !(dir.value.trim() && sesion())));

    function copiarSiOk(ok, fn) {
      if (!ok) { msg('Escribe la IP del VPS y el usuario SSH (solo letras, números, punto y guion).'); return; }
      msg(''); copiar(fn());
    }
    const conectarBtn = btn('Conectar', 'principal', async () => {
      const d = dir.value.trim(); const c0 = sesion();
      if (!d.startsWith('https://') || d.length < 12) { msg('La dirección debe empezar por https://'); return; }
      if (!c0) return;
      msg('');
      if (typeof Cuentas === 'undefined' || typeof conectar !== 'function') { msg('Falta conectar con la app.'); return; }
      const c = Cuentas.añadir('Mi VPS', 'vps', d, c0.clave, c0.nombre);
      cerrar();
      try { await conectar(c); } catch (e) { /* conectar() ya avisa */ }
    }, { disabled: true });

    mostrar([
      h('h1', { class: 't-titulo' }, 'Configurar VPS propio'),
      texto('Una guía de 6 pasos. Es la opción con más control: tu servidor, siempre encendido. Todos los comandos se copian con un botón; pégalos en una app de SSH del teléfono (por ejemplo Termius o JuiceSSH) o en la terminal de tu PC.'),
      paso(1, 'Consigue un VPS', 'Cualquier proveedor sirve: pide un servidor con Ubuntu 22.04 o 24.04, al menos 1 GB de RAM y acceso SSH (root o un usuario con sudo). Anota su IP y escríbela aquí para que los comandos salgan completos.',
        campo('IP del VPS', ip), campo('Usuario SSH', usr), av),
      paso(2, 'Conéctate al VPS', 'Abre tu app de SSH, o PowerShell en tu PC, y pega este comando (te pedirá la contraseña del VPS).',
        h('div', { class: 'fila' }, btn('Copiar «Conectar»', 'tonal', () => copiarSiOk(VpsGuia.tokenSeguro(ip.value) && VpsGuia.tokenSeguro(usr.value), () => VpsGuia.ssh(usr.value, ip.value))))),
      paso(3, 'Instala Node.js y Wichinion', 'Ya dentro del VPS, pega este comando: instala Node.js y baja el código de Wichinion del repositorio público.',
        h('div', { class: 'fila' }, btn('Copiar comando de instalación', 'tonal', () => copiar(VpsGuia.nodeYCodigo())))),
      paso(4, 'Déjalo encendido como servicio',
        u ? 'Pega este script: instala Wichinion con tu usuario «' + u.nombre + '» y la contraseña de tu cuenta (va dentro del script, por eso no se muestra). Queda encendido siempre y solo escucha dentro del VPS.'
          : 'Primero inicia sesión en Wichi (el script usa tu nombre y contraseña).',
        h('div', { class: 'fila' }, btn('Copiar script de instalación', 'principal', () => { const c = sesion(); if (c) copiar(VpsGuia.instalar(c.nombre, c.clave)); }, { disabled: !u }))),
      paso(5, 'Pon HTTPS (candado) con tu dominio', 'Necesitas un dominio (o subdominio) que apunte a la IP del VPS; sin HTTPS tu contraseña viajaría sin cifrar. Escríbelo y pega el script: instala Caddy, saca el certificado gratis y abre los puertos 80 y 443.',
        campo('Tu dominio', dom),
        h('div', { class: 'fila' }, btn('Copiar script de HTTPS', 'tonal', () => {
          if (!VpsGuia.dominioValido(dom.value)) msg('Escribe un dominio válido, como wichi.midominio.com.'); else { msg(''); copiar(VpsGuia.https(dom.value)); }
        }))),
      paso(6, 'Conecta Wichi', 'Escribe (o confirma) la dirección de tu servidor. Después de conectar, pega tu clave de NVIDIA en Ajustes para que el agente pueda responder.',
        campo('Dirección', dir), h('div', { class: 'fila' }, conectarBtn)),
      btn('← Volver', 'texto', hospedaje),
    ], false);
    // el ícono del VPS va primero (64 px, como en el APK)
    actual.insertBefore(h('img', { class: 'logo-w', src: 'icons/icono-vps.png', alt: '', style: 'width:64px;height:64px' }), actual.firstChild);
  }

  /* ───────────── 5. clave de NVIDIA ───────────── */
  function claveNvidia() {
    const clave = h('input', Object.assign({ type: 'text', inputmode: 'text', placeholder: 'nvapi-…', 'aria-label': 'Clave de NVIDIA' }, SIN_ESCRIBIR));
    const av = h('p', { class: 't-suave t-pequeno', role: 'status', hidden: true });
    const msg = (t) => { av.textContent = t; av.hidden = !t; };
    const guardarBtn = btn('Guardar y empezar', 'principal', async () => {
      const k = clave.value.trim();
      if (!claveNvidiaValida(k)) { msg('Esa clave no parece correcta: debe empezar por nvapi-'); return; }
      msg('');
      if (!window.Extra || typeof window.Extra.guardarClave !== 'function') { msg('Falta conectar con la app.'); return; }
      clave.value = '';
      cerrar();
      try { await window.Extra.guardarClave(k); } catch (e) { /* guardarClave ya avisa */ }
    }, { disabled: true });
    clave.addEventListener('input', () => { msg(''); guardarBtn.toggleAttribute('disabled', !clave.value.trim()); });
    clave.addEventListener('blur', () => { clave.value = clave.value.trim(); });

    mostrar([
      h('p', { class: 't-seccion' }, 'Paso 2 de 2'),
      h('h1', { class: 't-titulo' }, '¡Hola! Solo falta un paso'),
      texto('Para que el asistente te responda necesitas tu propia clave de NVIDIA. Es gratis, tarda unos 2 minutos y solo la usas tú.'),
      paso(1, 'Crea tu cuenta gratis', 'Entra con tu correo. Si ya tienes cuenta, pasa al paso 2.',
        h('div', { class: 'fila' }, btn('Abrir la página de NVIDIA', 'tonal', () => window.open('https://build.nvidia.com', '_blank', 'noopener')))),
      paso(2, 'Crea tu clave y cópiala', 'Pulsa «Generate API Key», ponle cualquier nombre y copia el texto largo que empieza por nvapi-.',
        h('div', { class: 'fila' }, btn('Abrir la página de claves', 'tonal', () => window.open('https://build.nvidia.com/settings/api-keys', '_blank', 'noopener')))),
      paso(3, 'Pégala aquí', 'Vuelve a esta app y pega la clave.',
        h('div', { class: 'campo' }, clave),
        h('div', { class: 'fila' },
          btn('Pegar', 'texto', async () => {
            const t = await leerPortapapeles();
            if (t) { clave.value = t; msg(''); guardarBtn.removeAttribute('disabled'); } else msg('No hay nada copiado todavía.');
          }),
          guardarBtn),
        av),
      btn('Ahora no', 'texto', () => { cerrar(); if (typeof window.alOmitirClave === 'function') window.alOmitirClave(); }),
    ]);
  }

  window.Guias = { cuenta, hospedaje, render, vps, claveNvidia, cerrar };
  if (typeof module !== 'undefined') module.exports = { VpsGuia, generarClave, validarCuenta, claveNvidiaValida, PLANTILLA_RENDER, RE_RENDER };
})();
