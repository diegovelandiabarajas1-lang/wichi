# Wichi PWA (iPhone y cualquier navegador)

Cliente web de Wichi que se instala en el iPhone como una app (PWA). Es solo HTML, CSS y JavaScript: no hay que compilar nada. Tiene las mismas funciones que la app de Android (APK), salvo las que un iPhone no permite desde una web (ver abajo).

Publicada en: https://diegovelandiabarajas1-lang.github.io/wichi/

## Funciones (igual que el APK)
- **Cuentas con nombre propio:** «＋ Añadir cuenta», «Renombrar» y «Olvidar». El tipo (☁ en la nube o 🖥 Mi PC) solo indica cómo conectar; el nombre lo pones tú y no se repite («Casa», «Casa 2»).
- **Conversaciones:** lista con buscador, crear, abrir; menú ⋯ para **renombrar, archivar y eliminar**.
- **Chat en directo:** respuesta mientras se escribe (SSE), Markdown con listas y bloques de código con «Copiar», herramientas y razonamiento plegables, botón ■ para detener, permisos (Permitir una vez / Siempre / Rechazar).
- **Modelos:** toca el modelo bajo el título para elegir otro; solo salen los de proveedores activos. Si la conversación quedó con el modelo gratuito, se pasa sola a NVIDIA.
- **Comandos «/»:** al escribir «/» aparece el menú de comandos del servidor.
- **Adjuntos (📎):** texto dentro del mensaje (hasta 150 KB); imágenes (reducidas a 1600 px) y demás archivos se suben a la carpeta `subidas` del servidor y el agente los abre. También se pueden pegar imágenes.
- **Archivos del agente (📁):** lo que Wichi deja en `entregas`; las imágenes se ven en pantalla y todo se guarda o comparte (Archivos, AirDrop…).
- **Conectores (MCP):** en Ajustes, añadir y quitar; se vuelven a poner solos si Render se reinicia.
- **Consumo de tokens (ícono de la barra):** semana, mes y año, barras de las últimas 12 semanas/12 meses/años, por modelo y por servidor. El libro vive en este dispositivo.
- **Clave de NVIDIA:** en Ajustes o pegándola en el chat (se guarda en el servidor, no se manda al modelo). Si Render se reinicia y la pierde, la app la vuelve a poner.
- **Copia de seguridad:** las conversaciones de servidores en la nube se copian en el dispositivo y se devuelven al servidor si se reinicia.
- **Actualizaciones:** la PWA se actualiza sola al abrirla con internet; en Ajustes hay «Buscar actualización».
- **Enlace de conexión:** `…/#conectar?u=<dirección>&p=<contraseña>&n=<nombre>&k=<cowork|local>` crea la cuenta y la borra de la barra de direcciones.
- Habla con OpenCode y con **Wichinion** (misma API).

## Lo que un iPhone no permite desde una web (por eso no está)
- **Avisos del sistema** cuando Wichi termina (requieren notificaciones push desde un servidor). Se pone al día sola al abrir la app.
- **Escanear el QR** de conexión con la cámara dentro de la app: se usa el enlace de conexión (abrirlo en Safari).
- **Guardar en «Descargas/Wichi»:** se usa «Compartir» (Guardar en Archivos).

## Instalarla en el iPhone
1. Abre la dirección en **Safari** (en iOS solo Safari instala PWA).
2. Toca **Compartir** y luego **Añadir a pantalla de inicio**.

## Lo que el servidor debe permitir (CORS)
La PWA es una página web: el navegador solo la deja hablar con un servidor que acepte su dirección (`https://diegovelandiabarajas1-lang.github.io`).
- **Wichinion:** ya lo trae. Arrancarlo con `MOTOR_CORS=https://diegovelandiabarajas1-lang.github.io`.
- **OpenCode (Cowork en Render, Docker local):** de fábrica solo acepta *localhost* y los dominios de opencode.ai. Hay que arrancarlo permitiendo ese origen (la opción `--cors` de `opencode serve`) y, en Render, volver a desplegar. **Sin esto, la PWA no conecta con esos servidores.**
- **Mi PC (http en la red local):** desde una página https el navegador bloquea servidores http. Hace falta un túnel https para ese caso.

## Privacidad
Las cuentas (dirección y contraseña), las copias y el libro de consumo se guardan **solo en el dispositivo** (almacenamiento del navegador). La PWA no tiene servidor propio ni envía nada a terceros.

## Probado y no probado
Probado en un navegador de escritorio con el tamaño de un iPhone, contra un servidor Wichinion de prueba y un modelo simulado: cuentas, conexión, conversaciones, respuesta en directo, adjuntos (texto e imagen), archivos del agente, conectores, consumo, copia y restauración de conversaciones, renombrar/archivar, comandos «/», modelos.
**No probado:** un iPhone real, la instalación en pantalla de inicio, el uso sin conexión (el navegador de prueba no deja registrar el service worker), compartir archivos con la hoja de iOS, el menú de eliminar, la selección de modelo con varios proveedores y la conexión con un Cowork real (necesita el CORS de arriba).

## Archivos
`index.html`, `app.css`, `app.js` (núcleo: cuentas, API, chat), `funciones.js` (modelos, adjuntos, entregas, conectores, consumo, respaldo, ajustes), `sw.js` (abre sin conexión lo básico; nunca toca las llamadas al servidor), `manifest.webmanifest`, `icons/`.
