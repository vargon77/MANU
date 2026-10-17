# Backend local del avatar

Servicio Node.js 22+ para conversación exclusivamente local. Recibe texto JSON o audio PCM16 mono a 16 kHz por WebSocket, procesa VAD/ASR/LLM/TTS/lipsync y devuelve audio binario AVTR v1. El proceso solo escucha en loopback. La provisión de binarios y modelos está descrita en [LOCAL-ASSETS.md](LOCAL-ASSETS.md).

## Requisitos

- Node.js 22 o posterior.
- Whisper.cpp (`whisper-server`), llama.cpp (`llama-server`), Piper, Rhubarb y un modelo ONNX de Silero VAD.
- Modelos locales compatibles: Whisper.cpp GGML, Gemma GGUF servido por llama.cpp y voz ONNX de Piper con su archivo `.json` adyacente.

Las licencias y los formatos exactos deben coincidir con las compilaciones instaladas. El preflight verifica permisos, archivos y flags CLI requeridos antes de iniciar; no descarga modelos ni contacta servicios remotos.

## Instalación

1. Provisiona los binarios y modelos siguiendo [LOCAL-ASSETS.md](LOCAL-ASSETS.md); el script genera `.env.local` y el inventario SHA-256.
2. Desde esta carpeta ejecuta `npm install` para instalar las dependencias del servicio.
3. Ejecuta `npm start`; el servicio queda en `http://127.0.0.1:8787` y WebSocket en `ws://127.0.0.1:8787/ws`.

Las variables `WHISPER_BIN`, `LLAMA_BIN`, `PIPER_BIN`, `RHUBARB_BIN`, `WHISPER_MODEL`, `LLAMA_MODEL`, `PIPER_MODEL` y `VAD_MODEL` son obligatorias. El preflight agrupa rutas ausentes/inaccesibles y comprueba `--port`, `--jinja`, `--output_raw` y `--recognizer`. `npm start -- --help` muestra ayuda sin requerir configuración.

## Protocolo WebSocket

- Audio entrante: tramas binarias PCM16 little-endian, mono, 16 kHz. Se pueden fragmentar entre mensajes; se ensamblan frames VAD de 512 muestras.
- Texto entrante: `{"type":"text","text":"..."}`. Ping: `{"type":"ping"}`.
- Eventos JSON salientes: `ready`, `state`, `speech_started`, `transcript`, `text_delta`, `assistant_text`, `visemes`, `warning`, `turn_cancelled`, `error`.
- Audio saliente: payload binario AVTR v1. Cabecera de 20 bytes: `AVTR`, versión `u8`, flags `u8`, tamaño de cabecera `u16 LE`, `turnId u32 LE`, `sampleRate u32 LE`, tamaño PCM `u32 LE`; después PCM16 mono little-endian. Flags: `1` final, `2` truncado, `4` hay visemas. Los cues se envían también en un evento JSON.

El cliente gestiona cámara y micrófono; el backend no activa dispositivos. `HOST` solo admite `127.0.0.1`, `::1` o `localhost`, evitando exponer una API local sin autenticación.