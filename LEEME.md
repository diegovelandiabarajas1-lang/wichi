# Wichi PWA (iPhone y cualquier navegador) — versión 0.6.0

Cliente web de Wichi que se instala en el iPhone como una app (PWA). Es solo HTML, CSS y JavaScript: no hay que compilar nada. Tiene el **mismo diseño y las mismas funciones que la app de Android (APK 0.5.30)**, salvo las que un iPhone no permite desde una web (ver al final).

Publicada en: https://diegovelandiabarajas1-lang.github.io/wichi/

## Diseño (el del APK)
Tema negro grisáceo fijo (los mismos colores de `MainActivity.kt`), botones en píldora gris claro, tarjetas oscuras de esquinas grandes, fondo con degradado azul grisáceo en las pantallas de bienvenida. Los íconos son los del APK: el de la app (W sobre verde), `wichi_w`, `logo_wichi`, Render, VPS, Historial, Consumo, el botón de enviar, y el clip y el micrófono en vectores. Los colores y estilos compartidos están en `tema.css`.

## Pantallas (igual que en el APK)
- **Primera vez:** «Hola, crea una cuenta» (o «inicia sesión») → «¿Dónde lo hospedamos?» → **Render** (guía de 4 pasos que copia tu contraseña, abre la plantilla y detecta la dirección `….onrender.com` del portapapeles) o **Configurar VPS propio** (guía de 6 pasos con todos los comandos que se copian con un botón, sin mostrarlos). También la pantalla «¡Hola! Solo falta un paso» para la clave de NVIDIA.
- **Conectar:** servidores guardados (tocas para conectar; «⋯» para renombrar, compartir por QR u olvidar), interruptor del **servidor Cowork** (lo despierta), conexión manual (nombre, dirección, contraseña y usuario de Wichinion opcional) y **«Escanear QR de conexión»** con la cámara.
- **Inicio:** «¿En qué trabajamos hoy?», compositor con adjuntar, selector de cuenta, **Hablar** y dictado, sugerencias, las 4 conversaciones recientes y «Ver todo el historial →».
- **Panel lateral (☰ o deslizar desde el borde):** Nueva conversación, **Historial completo**, Consumo de tokens, Espacios (tus cuentas), Recientes agrupadas por Hoy / Ayer / Últimos 7 días / Anteriores con búsqueda, interruptor del servidor y ⚙ Ajustes.
- **Historial:** buscador, lista con fecha · carpeta · modelo, «Actualizar», menú ⋮, botón ＋ (Nueva sesión: cuenta y carpeta de trabajo) y pulsación larga en una conversación para renombrar, archivar o borrar.
- **Chat:** respuesta en directo (SSE), Markdown y bloques de código con «Copiar», herramientas y razonamiento agrupados en una píldora plegable, «Pensando…», «Copiar» bajo cada respuesta, **«Cargar mensajes anteriores»**, «↓ Al final», línea de tokens, aviso «Sin conexión con el servidor», botón ■ para detener, permisos (una vez / siempre / rechazar), barra de **Archivos del agente**, tarjeta de la clave de NVIDIA y botón **Modelo**. El «＋» del compositor adjunta archivos o elige un comando «/» del servidor.
- **Ajustes:** Avisos, Mi clave de NVIDIA, Mi cuenta (cerrar sesión), Actualizaciones, Voz y música (con la tarjeta de **Spotify**), Conectores (MCP), Copia de seguridad y Cuentas (renombrar, QR, olvidar, añadir, escanear QR, crear mi servidor).
- **Consumo de tokens:** semana, mes y año, barras de las últimas 12 semanas/12 meses/años, por modelo y por servidor. El libro vive en este dispositivo.
- Habla con OpenCode y con **Wichinion** (misma API). Cuentas con **usuario** (el nombre de tu cuenta de Wichi en Wichinion) y tipo ☁ Cloud / 🖥 Mi VPS.

## Voz y acciones del teléfono (como en el APK)
- **Modo de voz (botón «Hablar»):** hablas, Wichi responde en voz alta y vuelve a escucharte (conversación continua) hasta que no digas nada o te despidas («gracias», «adiós», «eso es todo»). Si el agente pide un permiso, te lo pregunta con botones. Usa el reconocimiento y la voz del navegador (Web Speech). El micrófono de al lado dicta en el cuadro de texto.
- **Acciones del teléfono, por voz y en el chat escrito:** el agente responde normal y, si hace falta, pide acciones (abrir un enlace o una app, llamar, SMS, WhatsApp, correo, compartir, mapa, buscar, YouTube, música). Cada una sale como pregunta «Sí / No» y solo se hace con tu toque en «Sí»; nunca llama ni envía sola: deja el número marcado o el mensaje escrito y tú pulsas. Las instrucciones para el agente viajan ocultas, y las líneas «ACCION: …» no se ven.
- **Spotify con la API oficial:** conectas tu cuenta en Ajustes (Client ID propio y gratis; la dirección de redirección es la de esta página y se muestra con botón «Copiar»). Con **Spotify Premium** puedes decir «ponme música de…», «pausa», «siguiente», «anterior», «sube el volumen» y «¿qué suena?», y se hace por la API. Hay que tener la app de Spotify abierta o con algo sonando (una web no puede abrirla).
- **Órdenes cortas sin pasar por el agente:** «abre WhatsApp», «llévame a…», «busca X en Google Maps / Spotify / YouTube», «busca X». Lo demás va al modelo.
- Solo se abren enlaces de una lista permitida (web, tel, sms, mailto, WhatsApp, Spotify, Telegram, YouTube, Instagram, Mapas, Waze). Nunca archivos, scripts ni Atajos del sistema.

## Lo que un iPhone no permite desde una web (por eso no está)
- **Avisos del sistema** cuando Wichi termina (requieren notificaciones push desde un servidor). Se pone al día sola al abrir la app.
- **«Hey Wichi»**, la **voz con la app cerrada** y el gesto de **asistente del sistema**: una web no puede escuchar sin que toques.
- **Alarmas, temporizador y volumen del teléfono**, y las **teclas multimedia** (pausa/siguiente sin Premium) y «¿qué suena?» sin Spotify conectado: iOS no los expone a una web. La app lo dice en vez de fingirlo.
- **Abrir una app o un enlace por tu «sí» hablado:** iOS exige un toque en pantalla, por eso cada acción necesita pulsar «Sí».
- **Reconocimiento de voz:** funciona en **Safari**; en la app instalada en la pantalla de inicio iOS puede no ofrecerlo (la app te avisa y puedes usar el micrófono del teclado).
- **Guardar en «Descargas/Wichi»:** se usa «Compartir» (Guardar en Archivos).

## Instalarla en el iPhone
1. Abre la dirección en **Safari** (en iOS solo Safari instala PWA).
2. Toca **Compartir** y luego **Añadir a pantalla de inicio**.

## Lo que el servidor debe permitir (CORS)
La PWA es una página web: el navegador solo la deja hablar con un servidor que acepte su dirección (`https://diegovelandiabarajas1-lang.github.io`).
- **Wichinion:** ya lo trae. Arrancarlo con `MOTOR_CORS=https://diegovelandiabarajas1-lang.github.io`.
- **OpenCode (Cowork en Render, Docker local):** de fábrica solo acepta *localhost* y los dominios de opencode.ai. Hay que arrancarlo permitiendo ese origen (la opción `--cors` de `opencode serve`) y, en Render, volver a desplegar. **Sin esto, la PWA no conecta con esos servidores.**
- **Servidores http en la red local:** desde una página https el navegador los bloquea. Hace falta un túnel https para ese caso.

## Privacidad
Las cuentas (dirección y contraseña), la cuenta de Wichi, las copias, el libro de consumo y los datos de Spotify se guardan **solo en el dispositivo** (almacenamiento del navegador). La PWA no tiene servidor propio ni envía nada a terceros. El QR de una cuenta contiene su contraseña: enséñalo solo a quien confíes.

## Probado y no probado
Probado en un navegador de escritorio con el tamaño de un iPhone, contra un servidor simulado y con micrófono y voz simulados: todas las pantallas, la navegación, el panel lateral, las guías de bienvenida, el chat con herramientas, ajustes, consumo, el QR de una cuenta, el menú ＋, el flujo de voz completo y las acciones con su «Sí / No». La lógica pura (acciones, QR, Spotify, comandos de la guía VPS) tiene pruebas en Node.
**No probado:** un iPhone real, la instalación en la pantalla de inicio, el escáner de QR con la cámara, el inicio de sesión de Spotify y sus órdenes con una cuenta real, el reconocimiento de voz de Safari, el uso sin conexión y la conexión con un Cowork real (necesita el CORS de arriba).

## Archivos
`index.html`, `tema.css` (diseño compartido), `app.css`, `app.js` (núcleo: cuentas, API, chat), `funciones.js` (modelos, adjuntos, entregas, conectores, consumo, respaldo, ajustes), `shell.js` (inicio, panel lateral, historial, compositores), `guias.js` (cuenta, Render, VPS, clave), `qr.js` (QR de cuenta y escáner), `spotify.js` (Spotify), `acciones.js` (acciones del teléfono), `voz.js` (voz y dictado), `sw.js` (abre sin conexión lo básico; nunca toca las llamadas al servidor), `manifest.webmanifest`, `icons/`, `lib/` (jsQR y generador de QR, se cargan solo al usarse).
