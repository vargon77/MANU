// @ts-check
import { randomUUID } from 'node:crypto';

export class SessionManager {
  /** @param {{ maxSessions: number, maxHistoryMessages?: number }} options */
  constructor(options) {
    this.maxSessions = options.maxSessions;
    this.maxHistoryMessages = options.maxHistoryMessages ?? 40;
    /** @type {Map<string, object>} */
    this.sessions = new Map();
  }

  /** @param {{ sendJson: (value: object) => void, sendBinary: (value: Uint8Array) => void }} client */
  create(client) {
    if (this.sessions.size >= this.maxSessions) throw new Error('Límite de sesiones alcanzado.');
    const id = randomUUID();
    const session = {
      id,
      client,
      status: 'listening',
      history: /** @type {Array<{ role: 'system' | 'user' | 'assistant', content: string }>} */ ([]),
      turnId: 0,
      turnController: new AbortController(),
      audioQueue: Promise.resolve(),
      lastActivityAt: Date.now(),
      disposed: false
    };
    this.sessions.set(id, session);
    return session;
  }

  /** @param {object} session @param {'system' | 'user' | 'assistant'} role @param {string} content */
  addMessage(session, role, content) {
    const target = /** @type {{ history: Array<{ role: 'system' | 'user' | 'assistant', content: string }> }} */ (session);
    target.history.push({ role, content });
    if (target.history.length > this.maxHistoryMessages) {
      const firstUser = target.history.findIndex((message) => message.role === 'user');
      target.history.splice(firstUser > 0 ? 1 : 0, target.history.length - this.maxHistoryMessages);
    }
  }

  /** @param {object} session */
  beginTurn(session) {
    const target = /** @type {{ turnId: number, turnController: AbortController }} */ (session);
    target.turnController.abort(new Error('Turno reemplazado.'));
    target.turnController = new AbortController();
    target.turnId = (target.turnId + 1) >>> 0;
    return { turnId: target.turnId, signal: target.turnController.signal };
  }

  /** @param {object} session @param {string} reason */
  cancelTurn(session, reason = 'Interrumpido') {
    const target = /** @type {{ turnController: AbortController, status: string, client: { sendJson: (value: object) => void } }} */ (session);
    if (!target.turnController.signal.aborted) target.turnController.abort(new Error(reason));
    target.status = 'listening';
    target.client.sendJson({ type: 'turn_cancelled', reason });
  }

  /** @param {object} session */
  dispose(session) {
    const target = /** @type {{ id: string, turnController: AbortController, disposed: boolean }} */ (session);
    if (target.disposed) return;
    target.disposed = true;
    target.turnController.abort(new Error('Sesión cerrada.'));
    this.sessions.delete(target.id);
  }

  closeAll() {
    for (const session of this.sessions.values()) this.dispose(session);
  }
}