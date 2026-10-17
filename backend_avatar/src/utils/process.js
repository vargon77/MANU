// @ts-check
import { spawn } from 'node:child_process';

/** @typedef {{ input?: Uint8Array | string, timeoutMs: number, signal?: AbortSignal, maxOutputBytes?: number }} RunOptions */

/** @param {string} executable @param {string[]} args @param {RunOptions} options */
export function runCommand(executable, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const stdout = [];
    const stderr = [];
    const maxOutputBytes = options.maxOutputBytes ?? 64 * 1024 * 1024;
    let capturedBytes = 0;
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(result);
    };
    const onAbort = () => {
      child.kill('SIGTERM');
      const killTimer = setTimeout(() => child.kill('SIGKILL'), 1000);
      killTimer.unref();
      finish(options.signal?.reason instanceof Error ? options.signal.reason : new Error('Proceso cancelado.'));
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      const killTimer = setTimeout(() => child.kill('SIGKILL'), 1000);
      killTimer.unref();
      finish(new Error(`Tiempo agotado ejecutando ${executable}.`));
    }, options.timeoutMs);
    timer.unref();
    if (options.signal?.aborted) return onAbort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const collect = (destination) => (chunk) => {
      capturedBytes += chunk.length;
      if (capturedBytes > maxOutputBytes) {
        child.kill('SIGTERM');
        finish(new Error(`Salida de ${executable} excede el límite de ${maxOutputBytes} bytes.`));
        return;
      }
      destination.push(Buffer.from(chunk));
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    child.once('error', (error) => finish(error));
    child.once('close', (code, signal) => {
      const out = Buffer.concat(stdout);
      const err = Buffer.concat(stderr).toString('utf8');
      if (code !== 0) {
        finish(new Error(`${executable} terminó con ${signal ? `señal ${signal}` : `código ${code}`}: ${err.trim()}`));
      } else finish(null, { stdout: out, stderr: err });
    });
    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

/** @param {string} url @param {number} timeoutMs @param {AbortSignal} [signal] */
export async function waitForHttp(url, timeoutMs, signal) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'sin respuesta';
  while (Date.now() < deadline) {
    if (signal?.aborted) throw signal.reason ?? new Error('Arranque cancelado.');
    try {
      const response = await fetch(url, { signal: AbortSignal.any([AbortSignal.timeout(1000), ...(signal ? [signal] : [])]) });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 200);
      timer.unref();
    });
  }
  throw new Error(`Servicio local no disponible en ${url}: ${lastError}.`);
}

export class LocalHttpService {
  /** @param {{ binary: string, args: string[], healthUrl: string, timeoutMs: number }} options */
  constructor(options) {
    this.options = options;
    this.child = null;
    this.exit = null;
    this.startError = null;
  }

  async start() {
    if (this.child && this.exit === null) return;
    this.exit = null;
    this.startError = null;
    const child = spawn(this.options.binary, this.options.args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    this.child = child;
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr = (stderr + chunk).slice(-8192); });
    child.once('error', (error) => { this.startError = error; });
    const exited = new Promise((resolve) => {
      child.once('close', (code, signal) => {
        this.exit = { code, signal };
        resolve(this.exit);
      });
    });
    try {
      const result = await Promise.race([
        waitForHttp(this.options.healthUrl, this.options.timeoutMs),
        exited.then(({ code, signal }) => Promise.reject(new Error(
          `${this.options.binary} terminó antes de estar listo (${signal ? `señal ${signal}` : `código ${code}`}): ${stderr.trim()}`
        )))
      ]);
      return result;
    } catch (error) {
      await this.stop();
      throw this.startError ?? error;
    }
  }

  assertAlive() {
    if (!this.child || this.exit) throw new Error(`${this.options.binary} no está en ejecución.`);
  }

  async stop() {
    const child = this.child;
    if (!child || this.exit) return;
    const exited = new Promise((resolve) => child.once('close', resolve));
    child.kill('SIGTERM');
    const graceful = await Promise.race([exited.then(() => true), new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 3000);
      timer.unref();
    })]);
    if (!graceful) {
      child.kill('SIGKILL');
      await exited;
    }
  }
}