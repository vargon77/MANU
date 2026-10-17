// @ts-check
import { access, stat } from 'node:fs/promises';
import { constants, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

/** @typedef {{ host: string, port: number, logLevel: string }} ServerConfig */
/** @typedef {{ whisper: string, llama: string, piper: string, rhubarb: string }} BinaryConfig */
/** @typedef {{ whisper: string, llama: string, piper: string }} ModelConfig */
/** @typedef {'whisper' | 'llama' | 'piper' | 'rhubarb'} BinaryName */
/** @typedef {'whisper' | 'llama' | 'piper'} ModelName */
/** @typedef {{
 * server: ServerConfig,
 * binaries: BinaryConfig,
 * models: ModelConfig,
 * upstream: { whisperHost: string, whisperPort: number, llamaHost: string, llamaPort: number },
 * audio: { sampleRate: number, maxSeconds: number, preRollMs: number, maxQueuedMs: number },
 * vad: { threshold: number, silenceMs: number, minSpeechMs: number, model: string },
 * timeouts: { requestMs: number, processMs: number },
 * bargeIn: { threshold: number, confirmMs: number },
 * limits: { maxTextChars: number, maxSessions: number }
 * }} EnvironmentConfig */

const BINARY_ENV = Object.freeze({
  whisper: 'WHISPER_BIN',
  llama: 'LLAMA_BIN',
  piper: 'PIPER_BIN',
  rhubarb: 'RHUBARB_BIN'
});

const MODEL_ENV = Object.freeze({
  whisper: 'WHISPER_MODEL',
  llama: 'LLAMA_MODEL',
  piper: 'PIPER_MODEL'
});
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** @param {NodeJS.ProcessEnv} env @param {string} name @param {number} fallback @param {number} min @param {number} max */
function parseInteger(env, name, fallback, min, max) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} debe ser un entero entre ${min} y ${max}.`);
  }
  return value;
}

/** @param {NodeJS.ProcessEnv} env @param {string} name @param {number} fallback @param {number} min @param {number} max */
function parseNumber(env, name, fallback, min, max) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} debe ser un número entre ${min} y ${max}.`);
  }
  return value;
}

/** @param {Record<string, unknown>} value */
function freezeDeep(value) {
  for (const nested of Object.values(value)) {
    if (nested && typeof nested === 'object' && !Object.isFrozen(nested)) freezeDeep(/** @type {Record<string, unknown>} */ (nested));
  }
  return Object.freeze(value);
}

/** Load and validate environment variables into an immutable configuration. */
export function loadConfig(env = process.env) {
  const missing = Object.values(BINARY_ENV).filter((name) => !env[name]?.trim());
  if (missing.length) throw new Error(`Variables de entorno obligatorias ausentes: ${missing.join(', ')}`);

  const binaryPaths = Object.fromEntries(Object.entries(BINARY_ENV).map(([key, name]) => [key, env[name]?.trim() ?? '']));
  const modelPaths = Object.fromEntries(Object.entries(MODEL_ENV).map(([key, name]) => [key, env[name]?.trim() ?? '']));
  const port = parseInteger(env, 'PORT', 8787, 1, 65535);

  /** @type {EnvironmentConfig} */
  const config = {
    server: { host: env.HOST?.trim() || '127.0.0.1', port, logLevel: env.LOG_LEVEL?.trim() || 'info' },
    binaries: /** @type {BinaryConfig} */ (binaryPaths),
    models: /** @type {ModelConfig} */ (modelPaths),
    upstream: {
      whisperHost: env.WHISPER_HOST?.trim() || '127.0.0.1',
      whisperPort: parseInteger(env, 'WHISPER_PORT', 8788, 1, 65535),
      llamaHost: env.LLAMA_HOST?.trim() || '127.0.0.1',
      llamaPort: parseInteger(env, 'LLAMA_PORT', 8789, 1, 65535)
    },
    audio: {
      sampleRate: parseInteger(env, 'SAMPLE_RATE', 16000, 16000, 16000),
      maxSeconds: parseInteger(env, 'MAX_AUDIO_SECONDS', 30, 1, 300),
      preRollMs: parseInteger(env, 'PRE_ROLL_MS', 300, 0, 5000),
      maxQueuedMs: parseInteger(env, 'MAX_QUEUED_AUDIO_MS', 2000, 250, 10000)
    },
    vad: {
      threshold: parseNumber(env, 'VAD_THRESHOLD', 0.5, 0, 1),
      silenceMs: parseInteger(env, 'VAD_SILENCE_MS', 650, 100, 10000),
      minSpeechMs: parseInteger(env, 'VAD_MIN_SPEECH_MS', 180, 50, 10000),
      model: env.VAD_MODEL?.trim() ?? ''
    },
    timeouts: {
      requestMs: parseInteger(env, 'REQUEST_TIMEOUT_MS', 30000, 100, 300000),
      processMs: parseInteger(env, 'PROCESS_TIMEOUT_MS', 60000, 100, 600000)
    },
    bargeIn: {
      threshold: parseNumber(env, 'BARGE_IN_THRESHOLD', 0.65, 0, 1),
      confirmMs: parseInteger(env, 'BARGE_IN_CONFIRM_MS', 120, 0, 5000)
    },
    limits: {
      maxTextChars: parseInteger(env, 'MAX_TEXT_CHARS', 4000, 1, 100000),
      maxSessions: parseInteger(env, 'MAX_SESSIONS', 100, 1, 10000)
    }
  };
  return /** @type {Readonly<EnvironmentConfig>} */ (freezeDeep(/** @type {Record<string, unknown>} */ (config)));
}

const REQUIRED_FLAGS = Object.freeze({
  whisper: '--port',
  llama: '--jinja',
  piper: '--output_raw',
  rhubarb: '--recognizer'
});

/** @param {string} binaryPath @param {number} timeoutMs @returns {Promise<string>} */
function runHelp(binaryPath, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, ['--help'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    let outputBytes = 0;
    const maxHelpBytes = 1024 * 1024;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Tiempo agotado ejecutando --help en ${binaryPath}.`));
    }, timeoutMs);
    const collect = (chunk) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > maxHelpBytes) {
        child.kill('SIGKILL');
        clearTimeout(timer);
        reject(new Error(`La salida de --help en ${binaryPath} excede ${maxHelpBytes} bytes.`));
        return;
      }
      output += chunk;
    };
    child.stdout.setEncoding('utf8').on('data', collect);
    child.stderr.setEncoding('utf8').on('data', collect);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', () => { clearTimeout(timer); resolve(output); });
  });
}

/** @param {Readonly<EnvironmentConfig>} config Validate executable/model access and supported CLI flags before starting. */
export async function preflight(config) {
  const failures = [];
  for (const [rawName, binaryPath] of Object.entries(config.binaries)) {
    const name = /** @type {BinaryName} */ (rawName);
    try {
      await access(binaryPath, constants.R_OK | (process.platform === 'win32' ? 0 : constants.X_OK));
      if (!(await stat(binaryPath)).isFile()) throw new Error('la ruta no es un archivo');
    } catch {
      failures.push(`${BINARY_ENV[name]}: binario inexistente o sin permiso de ejecución: ${binaryPath}`);
      continue;
    }
    try {
      const help = await runHelp(binaryPath, config.timeouts.processMs);
      const flag = REQUIRED_FLAGS[name];
      if (!help.includes(flag)) failures.push(`${BINARY_ENV[name]}: el binario no anuncia el flag requerido ${flag} en --help.`);
    } catch (error) {
      failures.push(`${BINARY_ENV[name]}: no se pudo validar --help (${error instanceof Error ? error.message : String(error)}).`);
    }
  }

  for (const [rawName, modelPath] of Object.entries(config.models)) {
    const name = /** @type {ModelName} */ (rawName);
    if (!modelPath) {
      failures.push(`${MODEL_ENV[name]}: ruta de modelo obligatoria ausente.`);
      continue;
    }
    try {
      await access(modelPath, constants.R_OK);
      if (!(await stat(modelPath)).isFile()) throw new Error('la ruta no es un archivo');
    } catch {
      failures.push(`${MODEL_ENV[name]}: modelo inexistente o sin permiso de lectura: ${modelPath}`);
    }
  }

  if (config.models.piper) {
    try {
      await access(`${config.models.piper}.json`, constants.R_OK);
      if (!(await stat(`${config.models.piper}.json`)).isFile()) throw new Error('la ruta no es un archivo');
    } catch {
      failures.push(`PIPER_MODEL: falta el archivo de configuración legible ${config.models.piper}.json.`);
    }
  }

  if (!config.vad.model) failures.push('VAD_MODEL: ruta del modelo Silero VAD ausente.');
  else {
    try {
      await access(config.vad.model, constants.R_OK);
      if (!(await stat(config.vad.model)).isFile()) throw new Error('la ruta no es un archivo');
    } catch {
      failures.push(`VAD_MODEL: modelo inexistente o sin permiso de lectura: ${config.vad.model}`);
    }
  }

  if (failures.length) throw new Error(`Preflight fallido:\n- ${failures.join('\n- ')}`);
  return true;
}

/** Load the project's .env file without overriding explicitly supplied values. */
export function loadDotEnv() {
  const localFile = resolve(PROJECT_ROOT, '.env.local');
  const defaultFile = resolve(PROJECT_ROOT, '.env');
  if (existsSync(localFile)) dotenv.config({ path: localFile, override: false });
  if (existsSync(defaultFile)) dotenv.config({ path: defaultFile, override: false });
}