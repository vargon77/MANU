// @ts-check
import { LocalHttpService } from '../../utils/process.js';

export class GemmaClient {
  /** @param {{ binary: string, model: string, host: string, port: number, timeoutMs: number, maxTokens?: number }} options */
  constructor(options) {
    this.options = { ...options, maxTokens: options.maxTokens ?? 512 };
    this.endpoint = `http://${options.host}:${options.port}`;
    this.service = new LocalHttpService({
      binary: options.binary,
      args: ['-m', options.model, '--host', options.host, '--port', String(options.port), '--jinja'],
      healthUrl: `${this.endpoint}/health`,
      timeoutMs: options.timeoutMs
    });
  }

  start() {
    return this.service.start();
  }

  /** @param {Array<{ role: 'system' | 'user' | 'assistant', content: string }>} messages @param {{ signal?: AbortSignal, maxTokens?: number, temperature?: number }} [options] */
  async *generate(messages, options = {}) {
    this.service.assertAlive();
    if (!Array.isArray(messages) || messages.length === 0 || messages.some((message) => !message.content.trim())) {
      throw new TypeError('Gemma requiere una lista no vacía de mensajes con contenido.');
    }
    const response = await fetch(`${this.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({
        model: 'local-gemma',
        messages,
        stream: true,
        max_tokens: options.maxTokens ?? this.options.maxTokens,
        temperature: options.temperature ?? 0.7
      }),
      signal: AbortSignal.any([
        AbortSignal.timeout(this.options.timeoutMs),
        ...(options.signal ? [options.signal] : [])
      ])
    });
    if (!response.ok || !response.body) {
      const detail = (await response.text()).slice(0, 2000);
      throw new Error(`llama-server respondió HTTP ${response.status}: ${detail}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        const lines = pending.split(/\r?\n/);
        pending = done ? '' : (lines.pop() ?? '');
        if (done && lines.length === 0 && pending.length > 0) lines.push(pending);
        else if (done && pending.length > 0) lines.push(pending);
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') return;
          let event;
          try {
            event = JSON.parse(data);
          } catch {
            throw new Error('llama-server envió un evento SSE JSON inválido.');
          }
          const text = event.choices?.[0]?.delta?.content;
          if (typeof text === 'string' && text) yield text;
        }
        if (done) break;
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  }

  stop() {
    return this.service.stop();
  }
}