import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { delimiter, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platformToolCatalog } from './platform-extension.mjs';
import { COMPACT_TIMEOUT_MS, MAX_BRIDGE_BYTES } from './limits.mjs';
import { sessionPath } from './session-files.mjs';
import { THINKING_LEVELS } from './config-files.mjs';
import { MOD_SKILL, DLL_SKILL, SERVER_SKILL, CHECKUP_SKILL } from './skill-files.mjs';

export const PLATFORM_TOOLS = Object.freeze(platformToolCatalog().map(tool => tool.name));
const EXTENSION = fileURLToPath(new URL('./platform-extension.mjs', import.meta.url));
const LOCAL_EXTENSION = fileURLToPath(new URL('./local-extension.mjs', import.meta.url));
const COMMANDS = new Set([
  'prompt', 'steer', 'follow_up', 'abort', 'clear_queue', 'get_state',
  'get_messages', 'get_session_stats', 'get_available_models', 'get_commands', 'set_model',
  'get_last_assistant_text', 'new_session', 'set_session_name', 'switch_session',
  'set_thinking_level', 'get_available_thinking_levels', 'compact',
  'set_auto_compaction', 'set_auto_retry', 'abort_retry', 'get_fork_messages', 'fork', 'clone',
]);
const DIALOGS = new Set(['confirm', 'select', 'input', 'editor']);
const MAX_RECORD_BYTES = MAX_BRIDGE_BYTES;

function absolute(value, name) {
  if (typeof value !== 'string' || !isAbsolute(value)) {
    throw new TypeError(`${name} must be an absolute filesystem path`);
  }
  return resolve(value);
}

function failure(message, code, details) {
  return Object.assign(new Error(message), { code, details });
}

/** Pi CLI adapter. Events: record, event, diagnostic, fault, exit. */
export class PiTransport extends EventEmitter {
  #child;
  #pending = new Map();
  #dialogs = new Map();
  #buffer = '';
  #nextId = 0;
  #startPromise;
  #closePromise;
  #resolveClose;
  #closing = false;
  #lastExit;
  #modPending = new Map();

  constructor(options) {
    super();
    this.modRequest = options.modRequest;
    const configDir = absolute(options.configDir, 'configDir');
    this.options = Object.freeze({
      nodePath: absolute(options.nodePath ?? process.execPath, 'nodePath'),
      piEntry: absolute(options.piEntry, 'piEntry'),
      configDir,
      cwd: absolute(options.cwd ?? join(configDir, 'workspace'), 'cwd'),
      sessionDir: absolute(options.sessionDir ?? join(configDir, 'sessions'), 'sessionDir'),
      gameRoot: options.gameRoot ? absolute(options.gameRoot, 'gameRoot') : undefined,
      session: options.session ? absolute(options.session, 'session') : undefined,
      ephemeral: options.ephemeral === true,
      requestTimeoutMs: options.requestTimeoutMs ?? 15_000,
      compactTimeoutMs: options.compactTimeoutMs ?? COMPACT_TIMEOUT_MS,
      shutdownTimeoutMs: options.shutdownTimeoutMs ?? 5_000,
    });
    if (this.options.session && this.options.ephemeral) {
      throw new TypeError('session and ephemeral are mutually exclusive');
    }
    if (this.options.session) this.#checkSessionPath(this.options.session);
  }

  get running() { return Boolean(this.#child && !this.#closing); }
  get pid() { return this.#child?.pid; }

  #checkSessionPath(path) {
    const full = absolute(path, 'sessionPath');
    const tail = relative(this.options.sessionDir, full);
    if (!tail || tail === '..' || tail.startsWith(`..\\`) || tail.startsWith('../') || isAbsolute(tail)) {
      throw failure('Session must be a file inside the platform session directory', 'SESSION_SCOPE');
    }
    return full;
  }

  /** Returns an argv array; no shell interpolation is used. */
  buildArgs() {
    const args = [this.options.piEntry, '--mode', 'rpc', '--no-extensions', '--no-mcp',
      '--no-skills', '--no-prompt-templates', '--no-context-files', '--no-themes',
      '--no-approve', '--offline', '--extension', EXTENSION, '--extension', LOCAL_EXTENSION,
      '--skill', MOD_SKILL,
      '--skill', DLL_SKILL,
      '--skill', SERVER_SKILL,
      '--skill', CHECKUP_SKILL,
      '--tools', PLATFORM_TOOLS.join(','), '--session-dir', this.options.sessionDir];
    if (this.options.ephemeral) args.push('--no-session');
    if (this.options.session) args.push('--session', this.options.session);
    return args;
  }

  async start() {
    if (this.#startPromise) return this.#startPromise;
    this.#startPromise = this.#start().catch(error => {
      this.#startPromise = undefined;
      throw error;
    });
    return this.#startPromise;
  }

  async #start() {
    if (this.#child) throw failure('Pi is already running', 'ALREADY_RUNNING');
    for (const dir of [this.options.configDir, this.options.cwd, this.options.sessionDir]) {
      await mkdir(dir, { recursive: true });
    }
    if (this.options.session) await sessionPath(this.options.sessionDir, this.options.session);
    this.#closing = false;
    this.#lastExit = undefined;
    this.#buffer = '';
    const env = { ...process.env,
      PI_CODING_AGENT_DIR: this.options.configDir,
      PI_CODING_AGENT_SESSION_DIR: this.options.sessionDir,
      PI_SKIP_VERSION_CHECK: '1', PI_TELEMETRY: '0',
    };
    if (this.options.gameRoot) env.L4P_GAME_ROOT = this.options.gameRoot;
    else delete env.L4P_GAME_ROOT;
    if (process.platform === 'win32' && process.arch === 'x64') {
      const rgBin = fileURLToPath(new URL('../node_modules/@vscode/ripgrep-win32-x64/bin/', import.meta.url));
      const key = Object.keys(env).find(k => k.toUpperCase() === 'PATH') ?? 'PATH';
      env[key] = rgBin + delimiter + (env[key] ?? '');
    }
    delete env.NODE_OPTIONS;
    delete env.NODE_PATH;
    if (this.modRequest) env.FLARE_MOD_HOST = '1'; else delete env.FLARE_MOD_HOST;
    this.#closePromise = new Promise(resolveClose => { this.#resolveClose = resolveClose; });
    const child = spawn(this.options.nodePath, this.buildArgs(), {
      cwd: this.options.cwd, env, shell: false, windowsHide: true,
      stdio: this.modRequest ? ['pipe', 'pipe', 'pipe', 'ipc'] : ['pipe', 'pipe', 'pipe'],
    });
    this.#child = child;
    if (this.modRequest) child.on('message', message => { void this.#modMessage(child, message); });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => this.#consume(chunk));
    child.stderr.on('data', text => this.emit('diagnostic', { source: 'pi-stderr', text }));
    child.stdin.on('error', error => this.#failPending(error));
    child.on('error', error => {
      this.#failPending(error);
      this.emit('fault', { code: error.code ?? 'PI_SPAWN', message: error.message });
    });
    child.on('close', (code, signal) => {
      this.#cancelMods();
      const expected = this.#closing;
      this.#lastExit = { code, signal, expected };
      this.#failPending(failure(`Pi exited (${code ?? signal ?? 'unknown'})`, 'PI_EXIT', this.#lastExit));
      this.#dialogs.clear();
      this.#child = undefined;
      this.#startPromise = undefined;
      this.#resolveClose(this.#lastExit);
      this.emit('exit', this.#lastExit);
    });
    try {
      await new Promise((resolveSpawn, reject) => {
        child.once('spawn', resolveSpawn);
        child.once('error', reject);
      });
      return await this.request('get_state');
    } catch (error) {
      await this.close();
      this.#startPromise = undefined;
      throw error;
    }
  }

  #cancelMods() { for (const controller of this.#modPending.values()) controller.abort(); }

  async #modMessage(child, message) {
    if (child !== this.#child || !message || typeof message.id !== 'string') return;
    if (message.type === 'flare_mod_cancel') { this.#modPending.get(message.id)?.abort(); return; }
    if (message.type !== 'flare_mod_request' || this.#closing || this.#modPending.has(message.id)) return;
    const controller = new AbortController(); this.#modPending.set(message.id, controller);
    let reply;
    try {
      const result = await this.modRequest(message.operation, message.params, message.confirmation, controller.signal);
      reply = { ok: true, result };
    } catch (error) { reply = { ok: false, error: { code: error.code ?? 'MOD_OPERATION', message: error.message,
      ...(error.details !== undefined ? { details: error.details } : {}) } }; }
    finally { this.#modPending.delete(message.id); }
    if (child.connected) child.send({ type: 'flare_mod_reply', id: message.id, ...reply }, () => {});
  }

  #consume(chunk) {
    this.#buffer += chunk;
    let newline;
    while ((newline = this.#buffer.indexOf('\n')) !== -1) {
      const line = this.#buffer.slice(0, newline).replace(/\r$/, '');
      this.#buffer = this.#buffer.slice(newline + 1);
      if (!line) continue;
      if (Buffer.byteLength(line) > MAX_RECORD_BYTES) return this.#protocolError('Pi record exceeds 32 MiB');
      let record;
      try { record = JSON.parse(line); }
      catch { return this.#protocolError('Pi emitted invalid JSONL on stdout'); }
      if (!record || typeof record !== 'object' || typeof record.type !== 'string') {
        return this.#protocolError('Pi emitted a record without a type');
      }
      if (record.type === 'extension_ui_request' && DIALOGS.has(record.method)) {
        this.#dialogs.set(record.id, record);
      }
      if (record.type === 'response' && this.#pending.has(record.id)) {
        const pending = this.#pending.get(record.id);
        clearTimeout(pending.timer);
        this.#pending.delete(record.id);
        if (record.success) pending.resolve(record.data);
        else pending.reject(failure(record.error ?? `Pi rejected ${pending.type}`, 'PI_COMMAND', record));
      }
      this.emit('record', record);
      if (record.type !== 'response') this.emit('event', record);
    }
    if (Buffer.byteLength(this.#buffer) > MAX_RECORD_BYTES) this.#protocolError('Pi JSONL record exceeds 32 MiB');
  }

  #protocolError(message) {
    const error = failure(message, 'PI_PROTOCOL');
    this.#failPending(error);
    this.emit('fault', { code: error.code, message });
    this.#child?.kill();
  }

  #failPending(error) {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }

  #write(record) {
    if (!this.#child || this.#closing || this.#child.stdin.destroyed) {
      return Promise.reject(failure('Pi is not available', 'PI_UNAVAILABLE'));
    }
    return new Promise((resolveWrite, reject) => {
      this.#child.stdin.write(`${JSON.stringify(record)}\n`, 'utf8', error => error ? reject(error) : resolveWrite());
    });
  }

  /** Approved host commands only. Tool calls happen inside the trusted extension. */
  async request(type, params = {}, { timeoutMs = type === 'compact' ? this.options.compactTimeoutMs : this.options.requestTimeoutMs } = {}) {
    if (!COMMANDS.has(type)) return Promise.reject(failure(`Unsupported platform Pi command: ${type}`, 'COMMAND_SCOPE'));
    if (type === 'switch_session') params = { ...params, sessionPath: await sessionPath(this.options.sessionDir, this.#checkSessionPath(params.sessionPath)) };
    if (type === 'set_thinking_level' && !THINKING_LEVELS.includes(params.level)) throw failure('Invalid thinking level', 'PI_ARGUMENT');
    if (['set_auto_compaction', 'set_auto_retry'].includes(type) && typeof params.enabled !== 'boolean') throw failure('enabled must be a boolean', 'PI_ARGUMENT');
    const id = `l4p-${++this.#nextId}`;
    return new Promise((resolveRequest, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(failure(`Pi ${type} response timed out`, 'PI_TIMEOUT'));
      }, timeoutMs);
      this.#pending.set(id, { resolve: resolveRequest, reject, timer, type });
      this.#write({ ...params, id, type }).catch(error => {
        const pending = this.#pending.get(id);
        if (pending) {
          clearTimeout(pending.timer);
          this.#pending.delete(id);
          pending.reject(error);
        }
      });
    });
  }

  prompt(message, { streamingBehavior } = {}) {
    if (typeof message !== 'string' || !message.trim()) return Promise.reject(new TypeError('message must contain text'));
    return this.request('prompt', { message, ...(streamingBehavior ? { streamingBehavior } : {}) });
  }

  /** Called only from the user's dialog action, never from model tool parameters. */
  async answerUi(id, answer) {
    const dialog = this.#dialogs.get(id);
    if (!dialog) throw failure('Pi dialog is no longer pending', 'DIALOG_EXPIRED');
    let response;
    if (answer?.cancelled === true) response = { cancelled: true };
    else if (dialog.method === 'confirm' && typeof answer?.confirmed === 'boolean') response = { confirmed: answer.confirmed };
    else if (dialog.method !== 'confirm' && typeof answer?.value === 'string') response = { value: answer.value };
    else throw new TypeError(`Invalid answer for ${dialog.method}`);
    await this.#write({ ...response, type: 'extension_ui_response', id });
    this.#dialogs.delete(id);
  }

  async cancel() {
    this.#cancelMods();
    const queue = await this.request('clear_queue');
    for (const id of [...this.#dialogs.keys()]) await this.answerUi(id, { cancelled: true });
    await this.request('abort');
    return queue;
  }

  /** EOF allows Pi to flush its session; terminate only this owned child on deadline. */
  async close() {
    this.#cancelMods();
    if (!this.#child) return this.#lastExit;
    if (this.#closing) return this.#closePromise;
    this.#closing = true;
    this.#child.stdin.end();
    const child = this.#child;
    const timer = setTimeout(() => child.kill(), this.options.shutdownTimeoutMs);
    try { return await this.#closePromise; }
    finally { clearTimeout(timer); }
  }
}
