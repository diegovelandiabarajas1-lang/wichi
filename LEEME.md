# Wichi PWA (iPhone y cualquier navegador)

Cliente web de Wichi que se instala en el iPhone como una app (PWA). Es solo HTML, CSS y JavaScript: no hay que compilar nada.

## Qué hace
- **Cuentas con nombre propio:** «＋ Añadir cuenta», «Renombrar» y «Olvidar». El tipo (☁ en la nube o 🖥 Mi PC) solo indica cómo conectar; el nombre lo pones tú y se evitan repetidos («Casa», «Casa 2»).
- **Conversaciones:** lista, crear una nueva, abrir y seguir una existente (las que ya tienes en el servidor).
- **Chat en directo:** respuesta que aparece mientras se escribe (eventos SSE), Markdown con listas y bloques de código con «Copiar», herramientas del agente plegables, razonamiento plegable y botón ■ para detener.
- **Permisos:** tarjeta «Permitir una vez / Siempre / Rechazar».
- **Clave de NVIDIA:** botón 🔑 que la guarda en el servidor (no en el teléfono) y pasa la conversación a NVIDIA si quedó con el modelo gratuito.
- **Enlace de conexión:** `…/#conectar?u=<dirección>&p=<contraseña>&n=<nombre>&k=<cowork|local>` crea la cuenta y la borra de la barra de direcciones.
- Habla con OpenCode y con **Wichinion** (misma API).

## Instalarla en el iPhone
1. Abre la dirección donde esté publicada, **en Safari** (en iOS solo Safari instala PWA).
2. Toca **Compartir** y luego **Añadir a pantalla de inicio**.
3. Ábrela desde el ícono: se ve sin barra del navegador.

## Dónde publicarla (hace falta https)
Una PWA solo se instala desde **https**. Opciones sin costo: GitHub Pages, Cloudflare Pages o Netlify. Basta con subir esta carpeta tal cual.

## Lo que el servidor debe permitir (CORS)
La PWA es una página web: el navegador solo la deja hablar con un servidor que acepte su dirección (CORS).
- **Wichinion:** ya lo trae. Arrancarlo con `MOTOR_CORS=https://<dirección de la PWA>` (se admiten varias separadas por coma).
- **OpenCode (Cowork en Render, Docker local):** de fábrica solo acepta *localhost* y los dominios de opencode.ai. Hay que arrancarlo permitiendo el origen de la PWA (la opción `--cors` de `opencode serve`) y, en Render, volver a desplegar. **Sin esto, la PWA no conecta con esos servidores.**
- **Mi PC (http en la red local):** desde una página https el navegador bloquea servidores http. La PWA sirve para servidores con https (la nube); para el PC de casa hace falta un túnel https o usar la app de escritorio.

## Privacidad
Las cuentas (dirección y contraseña) se guardan **solo en el dispositivo** (almacenamiento del navegador). La PWA no tiene servidor propio ni envía nada a terceros.

## Probado y no probado
Probado en un navegador de escritorio con el tamaño de un iPhone, contra un servidor Wichinion de prueba y un modelo simulado: crear cuenta, conectar, recordar la cuenta, crear conversación, enviar, respuesta en directo con Markdown, nombres repetidos, contraseña mala y servidor caído.
**No probado:** en un iPhone real, la instalación en pantalla de inicio, el funcionamiento sin conexión (el service worker no se pudo comprobar en el navegador de prueba), los permisos de herramientas, el envío de archivos (no incluido todavía) y la conexión con un Cowork real (necesita el CORS de arriba).

## Archivos
`index.html`, `app.css`, `app.js`, `sw.js` (abre sin conexión lo básico; nunca toca las llamadas al servidor), `manifest.webmanifest`, `icons/`.
