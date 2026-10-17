// @ts-check
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { loadDotEnv, loadConfig, preflight } from './src/config/environment.js';
import { ConversationOrchestrator } from './src/core/orchestrator.js';
import { SessionManager } from './src/core/session-manager.js';
import { SileroVad } from './src/modules/vad/silero-vad.js';
import { WhisperAsr } from './src/modules/asr/whisper-asr.js';
import { GemmaClient } from './src/modules/llm/gemma-client.js';
import { PiperTts } from './src/modules/tts/piper-tts.js';
import { VisemeExtractor } from './src/modules/lipsync/viseme-extractor.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

/** @param {import('./src/config/environment.js').EnvironmentConfig} config */
export async function createBackend(config) {
  if (!LOOPBACK_HOSTS.has(config.server.host.toLowerCase())) {
    throw new Error('HOST debe ser localhost, 127.0.0.1 o ::1 para impedir exposición de la API local.');
  }
  await preflight(config);
  const vad = await new SileroVad({
    modelPath: config.vad.model,
    threshold: config.vad.threshold,
    silenceMs: config.vad.silenceMs,
    minSpeechMs: config.vad.minSpeechMs,
    sampleRate: config.audio.sampleRate
  }).initialize();
  const asr = new WhisperAsr({
    binary: config.binaries.whisper,
    model: config.models.whisper,
    host: config.upstream.whisperHost,
    port: config.upstream.whisperPort,
    timeoutMs: config.timeouts.requestMs,
    sampleRate: config.audio.sampleRate
  });
  const llm = new GemmaClient({
    binary: config.binaries.llama,
    model: config.models.llama,
    host: config.upstream.llamaHost,
    port: config.upstream.llamaPort,
    timeoutMs: config.timeouts.requestMs
  });
  const tts = await new PiperTts({
    binary: config.binaries.piper,
    model: config.models.piper,
    timeoutMs: config.timeouts.processMs,
    maxTextChars: config.limits.maxTextChars
  }).initialize().catch(async (error) => {
    await vad.close();
    throw error;
  });
  const lipsync = new VisemeExtractor({ binary: config.binaries.rhubarb, timeoutMs: config.timeouts.processMs });
  const sessions = new SessionManager({ maxSessions: config.limits.maxSessions });
  const orchestrator = new ConversationOrchestrator({ config, sessions, vad, asr, llm, tts, lipsync });
  const maxPayload = config.audio.sampleRate * config.audio.maxSeconds * 2 + 4096;
  const websocketServer = new WebSocketServer({ noServer: true, maxPayload, perMessageDeflate: false });
  const httpServer = createServer((request, response) => {
    if (request.method === 'GET' && (request.url === '/health' || request.url === '/')) {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ status: 'ok', websocket: '/ws', localOnly: true }));
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    response.end('{"error":"not_found"}');
  });

  httpServer.on('upgrade', (request, socket, head) => {
    if (request.url !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    websocketServer.handleUpgrade(request, socket, head, (websocket) => websocketServer.emit('connection', websocket, request));
  });

  websocketServer.on('connection', (websocket) => {
    const client = {
      sendJson(value) {
        if (websocket.readyState === WebSocket.OPEN) websocket.send(JSON.stringify(value));
      },
      sendBinary(value) {
        if (websocket.readyState === WebSocket.OPEN) websocket.send(value, { binary: true });
      }
    };
    let session;
    try {
      session = orchestrator.connect(client);
    } catch (error) {
      websocket.close(1013, error instanceof Error ? error.message.slice(0, 120) : 'No disponible');
      return;
    }
    websocket.on('message', (data, isBinary) => {
      try {
        const bytes = toBytes(data);
        if (isBinary) {
          void orchestrator.receiveAudio(session, bytes);
          return;
        }
        if (bytes.byteLength > 16 * 1024) throw new RangeError('Los mensajes JSON no pueden superar 16 KiB.');
        const message = JSON.parse(new TextDecoder().decode(bytes));
        if (!message || typeof message !== 'object' || Array.isArray(message)) throw new TypeError('Mensaje JSON inválido.');
        if (message.type === 'text' && typeof message.text === 'string') orchestrator.receiveText(session, message.text);
        else if (message.type === 'ping') client.sendJson({ type: 'pong', timestamp: Date.now() });
        else throw new TypeError('Tipo de mensaje no admitido; use text o ping.');
      } catch (error) {
        client.sendJson({ type: 'error', message: error instanceof Error ? error.message : 'Mensaje inválido.' });
      }
    });
    websocket.on('close', () => orchestrator.disconnect(session));
    websocket.on('error', () => orchestrator.disconnect(session));
  });

  try {
    await Promise.all([asr.start(), llm.start()]);
    await new Promise((resolveListen, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(config.server.port, config.server.host, () => {
        httpServer.removeListener('error', reject);
        resolveListen(undefined);
      });
    });
  } catch (error) {
    sessions.closeAll();
    await Promise.allSettled([asr.stop(), llm.stop(), vad.close()]);
    throw error;
  }

  let closing = null;
  return {
    httpServer,
    websocketServer,
    close() {
      closing ??= (async () => {
        sessions.closeAll();
        for (const client of websocketServer.clients) client.close(1001, 'Servidor detenido');
        await new Promise((resolveClose) => websocketServer.close(() => resolveClose(undefined)));
        await new Promise((resolveClose, reject) => httpServer.close((error) => error ? reject(error) : resolveClose(undefined)));
        await Promise.allSettled([asr.stop(), llm.stop(), vad.close()]);
      })();
      return closing;
    }
  };
}

/** @param {import('ws').RawData} data */
function toBytes(data) {
  if (Buffer.isBuffer(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  throw new TypeError('Formato de trama WebSocket no admitido.');
}

function printHelp() {
  process.stdout.write('Avatar Backend local\n\nConfigura backend_avatar/.env a partir de .env.example y ejecuta npm start.\n');
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    return;
  }
  loadDotEnv();
  let config;
  try {
    config = loadConfig();
    const backend = await createBackend(config);
    process.stdout.write(`Backend listo en http://${config.server.host}:${config.server.port} (WebSocket /ws).\n`);
    const shutdown = () => { void backend.close().then(() => process.exit(0), (error) => {
      process.stderr.write(`Error al detener el backend: ${error.message}\n`);
      process.exit(1);
    }); };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch (error) {
    process.stderr.write(`Error de inicio: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();