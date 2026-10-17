# Binarios y modelos locales

Esta carpeta mantiene los artefactos fuera de Git. El backend no descarga ejecutables ni pesos por su cuenta: las versiones, licencias, cuantización y compilaciones CPU/GPU deben ser elegidas explícitamente por quien despliega. El script de aprovisionamiento valida los flags CLI, el JSON de Piper y los SHA-256 de las copias, y genera `.env.local` más `local/asset-lock.json`.

## Fuentes

Descarga cada artefacto desde la publicación o repositorio que hayas revisado y acepta las licencias aplicables antes de usarlo:

- Whisper.cpp y modelos GGML multilingües: [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp) y [ggerganov/whisper.cpp en Hugging Face](https://huggingface.co/ggerganov/whisper.cpp). Para conversaciones en español elige un modelo multilingüe, no uno terminado en `.en`.
- llama.cpp: [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp). Debe ser una compilación Windows compatible con la CPU/GPU de destino e incluir `llama-server.exe` con soporte `--jinja`.
- Gemma: [Google Gemma en Hugging Face](https://huggingface.co/google/gemma-3-1b-it). El servidor requiere un GGUF compatible con llama.cpp; la conversión/cuantización puede requerir un repositorio de terceros. Revisa su origen, licencia y términos antes de adoptarlo.
- Piper: [OHF-Voice/piper1-gpl](https://github.com/OHF-Voice/piper1-gpl) y [Piper voices](https://huggingface.co/rhasspy/piper-voices). Selecciona una voz española compatible y conserva el `.onnx.json` que acompaña al modelo.
- Silero VAD ONNX: [snakers4/silero-vad](https://github.com/snakers4/silero-vad). El backend usa el modelo ONNX recurrente con entradas `input`, `state` y `sr`, a 16 kHz.
- Rhubarb Lip Sync: [DanielSWolf/rhubarb-lip-sync](https://github.com/DanielSWolf/rhubarb-lip-sync). Usa una versión Windows que exponga `--recognizer`.

No se fijan URLs de descarga directa ni checksums de terceros en el repositorio: los nombres de assets de releases cambian entre versiones y Gemma/Piper están sujetos a condiciones de distribución. El instalador guarda el SHA-256 de cada artefacto efectivamente copiado para que puedas auditar y reproducir el despliegue.

## Aprovisionar en Windows

Desde `backend_avatar`, invoca `scripts/Install-LocalAssets.ps1`; PowerShell pedirá la ruta completa de cada archivo. También puedes pasar las rutas directamente. Los parámetros obligatorios son:

- `-WhisperServerPath` y `-WhisperModelPath`
- `-LlamaServerPath` y `-GemmaModelPath`
- `-PiperPath` y `-PiperModelPath`
- `-RhubarbPath` y `-SileroModelPath`

`-PiperConfigPath` es opcional: si no se indica, se utiliza `<PiperModelPath>.json`. El script ejecuta `--help` en los cuatro binarios y requiere `--port`, `--jinja`, `--output_raw` y `--recognizer`, respectivamente. También valida `audio.sample_rate` del JSON de Piper.

Los archivos se organizan así:

```text
local/
  bin/
    whisper-server.exe
    llama-server.exe
    piper.exe
    rhubarb.exe
  models/
    whisper/ggml-model.bin
    llm/gemma-model.gguf
    tts/voice.onnx
    tts/voice.onnx.json
    vad/silero-vad.onnx
  asset-lock.json
.env.local
```

Sin `-Force`, el script conserva un destino ya existente con el mismo hash y se detiene si intenta reemplazar un artefacto distinto o un `.env.local` personalizado. Usa `-Force` únicamente cuando quieras reemplazar esos archivos. Las copias se verifican contra el SHA-256 del origen; `asset-lock.json` no incluye las rutas privadas de descarga. `.env.local`, los pesos, ejecutables y el inventario local están excluidos de Git.

Una vez provisionados los assets, `server.js` carga `.env.local` automáticamente (y después `.env` para completar opciones no definidas) y el preflight vuelve a comprobar archivos, permisos y compatibilidad antes de levantar los servicios. Los pesos pueden ocupar varios GB; planifica espacio y memoria según el modelo Gemma y la compilación llama.cpp elegidos.
