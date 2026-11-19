import type { PiAssistantEvent, PiContent, PiImage, PiMessage, PiModel, PiRecord, PiSessionStats, PiState, PiTransport, PiUsage, ThinkingLevel } from './pi-protocol';
import { isMissing } from './pi-protocol';
import { errorText } from '../api/bridge';
import { prefs } from '../stores/prefs.svelte';

export type ToolStatus = 'pending' | 'running' | 'done' | 'error';
export interface Approval { id: string; title: string; message: string; state: 'waiting' | 'allowed' | 'denied' }
export interface Dialog extends Approval { method: string; options?: string[]; value: string; pending: boolean; attached: boolean }
export type Block =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string; startedAt: number; endedAt?: number }
  | { kind: 'tool'; id: string; name: string; args: Record<string, unknown>; status: ToolStatus; output: string; startedAt?: number; endedAt?: number; approval?: Approval };
export type AssistantMessage = { id: number; role: 'assistant'; blocks: Block[]; streaming: boolean; error?: string; aborted?: boolean; usage?: PiUsage; model?: string };
export type ChatMessage =
  | { id: number; role: 'user'; text: string; images?: number }
  | AssistantMessage
  | { id: number; role: 'notice'; text: string; level: 'info' | 'warning' | 'error'; action?: 'retry' | 'settings' }
  | { id: number; role: 'divider'; text: string };

/** 后端是否放行了这些 pi 命令（查一次，结果决定界面上对应控件是否可用） */
export interface Caps { thinking: boolean; compact: boolean; stats: boolean }
export const THINKING_LABEL: Record<ThinkingLevel, string> = { off: '关闭', minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最高' };

let sequence = 0;
const contentText = (content: PiMessage['content']) => typeof content === 'string' ? content : content.filter(c => c.type === 'text').map(c => c.text ?? '').join('\n');
const imageCount = (content: PiMessage['content']) => typeof content === 'string' ? 0 : content.filter(c => c.type === 'image').length;
const modelKey = (m?: { provider: string; id: string }) => m ? `${m.provider}/${m.id}` : '';

export class Chat {
  messages = $state<ChatMessage[]>([]);
  /** 别的页面交给 Agent 的指令；Agent 还不能发送时先填进输入框 */
  draft = $state('');
  dialogs = $state<Dialog[]>([]);
  running = $state(false);
  connected = $state(false);
  connecting = $state(false);
  /** 当前模型完整信息；没有可用模型时为 null */
  current = $state<PiModel | null>(null);
  models = $state<PiModel[]>([]);
  thinkingLevel = $state<ThinkingLevel>('medium');
  thinkingLevels = $state<ThinkingLevel[]>([]);
  caps = $state<Caps>({ thinking: false, compact: false, stats: false });
  stats = $state<PiSessionStats | null>(null);
  sessionName = $state('');
  sessionFile = $state('');
  autoCompaction = $state(true);
  queue = $state<{ steering: string[]; followUp: string[] }>({ steering: [], followUp: [] });
  retrying = $state<{ attempt: number; max: number; delayMs: number; error?: string; at: number } | null>(null);
  compacting = $state(false);
  configDir = $state('');
  loginCommand = $state('');
  connectionError = $state('');
  /** 模型 / 思考强度切换中 */
  switching = $state(false);

  get modelReady() { return !!this.current; }
  get modelKey() { return modelKey(this.current ?? undefined); }
  get model() { return this.current ? (this.current.name ?? this.current.id) : this.connected ? '待配置模型' : '未连接'; }
  /** 标题：会话名 > 第一句话 > 新对话 */
  get title() {
    if (this.sessionName) return this.sessionName;
    const first = this.messages.find(m => m.role === 'user');
    return first && first.role === 'user' ? first.text.slice(0, 40) : '新对话';
  }
  get lastPrompt() {
    for (let i = this.messages.length - 1; i >= 0; i--) { const m = this.messages[i]; if (m.role === 'user') return m.text; }
    return '';
  }

  private active: AssistantMessage | null = null;
  private byIndex = new Map<number, Block>();
  private decisions = new Map<string, boolean>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private unsubscribe: () => void;
  private titled = false;
  constructor(private transport: PiTransport) { this.unsubscribe = transport.subscribe(r => this.apply(r)); }

  connect() {
    if (this.connected || this.connecting) return;
    this.connecting = true; this.connectionError = '';
    this.transport.send({ type: 'get_state' });
  }
  /** A hidden window may have missed a model change made in main's settings. */
  async refreshAttached() {
    if (!this.connected) { this.connect(); return; }
    if (this.connecting || this.running) return;
    try {
      const state = await this.transport.query<PiState>('get_state');
      const models = await this.transport.query<{ models: PiModel[] }>('get_available_models');
      this.response({ type: 'response', command: 'get_state', success: true, data: state });
      this.response({ type: 'response', command: 'get_available_models', success: true, data: models });
      await this.loadThinkingLevels();
    } catch (e) { this.notice(errorText(e), 'error'); }
  }
  /** 直接调用 pi 命令（设置页用），失败抛错 */
  query<T = unknown>(type: string, params: Record<string, unknown> = {}) { return this.transport.query<T>(type, params); }
  reconnect() {
    if (this.running || this.connecting) return;
    this.connecting = true; this.connectionError = '';
    this.transport.send({ type: 'reconnect' });
  }

  async selectModel(key: string) {
    const model = this.models.find(m => modelKey(m) === key);
    if (!model || this.running || this.switching) return;
    this.switching = true;
    try { this.applyModel(await this.transport.query<PiModel>('set_model', { provider: model.provider, modelId: model.id })); await this.loadThinkingLevels(); }
    catch (e) { this.notice(errorText(e), 'error'); }
    finally { this.switching = false; }
  }
  async setThinking(level: ThinkingLevel) {
    if (!this.caps.thinking || this.switching) return;
    this.switching = true;
    try { await this.transport.query('set_thinking_level', { level }); this.thinkingLevel = level; }
    catch (e) { if (isMissing(e)) this.caps.thinking = false; else this.notice(errorText(e), 'error'); }
    finally { this.switching = false; }
  }
  /** 发送：空闲时开新一轮；运行中按偏好排队（followUp）或插话（steer） */
  send(text: string, images: PiImage[] = []) {
    const message = text.trim();
    if ((!message && !images.length) || !this.connected || !this.modelReady) return false;
    const extra = images.length ? { images } : {};
    if (this.running) {
      this.transport.send({ id: `queue-${++sequence}`, type: prefs.busySend === 'steer' ? 'steer' : 'follow_up', message, ...extra });
      return true;
    }
    this.running = true;
    this.transport.send({ id: `prompt-${++sequence}`, type: 'prompt', message, ...extra });
    if (prefs.autoTitle && !this.sessionName && !this.titled) {
      this.titled = true;
      const name = (message.split('附件（文件内容作为资料）：')[0].trim() || '文件对话').replace(/\s+/g, ' ').slice(0, 40);
      void this.transport.query('set_session_name', { name }).then(() => { this.sessionName = name; }).catch(() => {});
    }
    return true;
  }
  retry() { const last = this.lastPrompt; if (last && !this.running) this.send(last); }
  abort() { this.transport.send({ type: 'abort' }); }
  clearQueue() { this.transport.send({ type: 'clear_queue' }); }
  reset() { if (!this.running) this.transport.send({ type: 'new_session' }); }
  openSession(path: string) { if (!this.running && path !== this.sessionFile) this.transport.send({ type: 'switch_session', sessionPath: path }); }
  async rename(name: string) {
    const next = name.trim().slice(0, 60);
    if (!next) return;
    try { await this.transport.query('set_session_name', { name: next }); this.sessionName = next; this.titled = true; }
    catch (e) { this.notice(errorText(e), 'error'); }
  }
  async compact() {
    if (this.running || this.compacting) return;
    try { this.compacting = true; await this.transport.query('compact', {}); void this.refreshStats(); }
    catch (e) { if (isMissing(e)) { this.caps.compact = false; this.notice('压缩上下文需要后端放行 compact 命令。', 'warning'); } else this.notice(errorText(e), 'error'); }
    finally { this.compacting = false; }
  }
  async refreshStats() {
    if (!this.connected) return;
    try { this.stats = await this.transport.query<PiSessionStats>('get_session_stats'); this.caps.stats = true; }
    catch (e) { if (isMissing(e)) this.caps.stats = false; }
  }
  respond(id: string, allow: boolean) {
    const dialog = this.dialogs.find(d => d.id === id);
    if (!dialog || dialog.state !== 'waiting' || dialog.pending) return;
    dialog.pending = true; this.decisions.set(id, allow);
    this.transport.send({ type: 'extension_ui_response', id, ...(dialog.method === 'confirm' ? { confirmed: allow } : allow ? { value: dialog.value } : { cancelled: true }) });
  }
  dispose() { this.unsubscribe(); this.clearDialogs(); }

  // ---------------- 内部 ----------------
  private applyModel(model: PiState['model'] | null | undefined) {
    if (!model) { this.current = null; return; }
    if (typeof model === 'string') { this.current = model && model !== 'unknown' ? this.models.find(m => m.id === model) ?? { id: model, provider: '' } : null; return; }
    this.current = model.id && model.id !== 'unknown' ? model : null;
  }
  private async loadThinkingLevels() {
    try {
      const data = await this.transport.query<{ levels: ThinkingLevel[] }>('get_available_thinking_levels');
      this.thinkingLevels = data.levels ?? []; this.caps.thinking = true;
    } catch (e) { if (isMissing(e)) this.caps.thinking = false; }
  }
  /** 切换 / 新建会话后重新读状态（不走连接流程，避免面板闪「连接中」） */
  private async syncState(withMessages: boolean) {
    try {
      this.response({ type: 'response', command: 'get_state', success: true, data: await this.transport.query<PiState>('get_state') });
      if (withMessages) this.loadHistory((await this.transport.query<{ messages: PiMessage[] }>('get_messages')).messages ?? []);
    } catch (e) { this.notice(errorText(e), 'error'); }
    void this.refreshStats();
  }
  private afterConnect() {
    void this.loadThinkingLevels();
    void this.refreshStats();
    // compact 没有只读探测，先假定可用，失败时再关掉
    this.caps.compact = true;
  }
  private clearDialogs() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear(); this.decisions.clear();
    for (const dialog of this.dialogs) if (dialog.state === 'waiting') { dialog.state = 'denied'; dialog.pending = false; this.syncApproval(dialog); }
  }
  private syncApproval(dialog: Dialog) {
    for (const t of this.tools()) if (t.approval?.id === dialog.id) t.approval.state = dialog.state;
  }
  private begin() {
    this.messages.push({ id: ++sequence, role: 'assistant', blocks: [], streaming: true });
    this.active = this.messages[this.messages.length - 1] as AssistantMessage;
    this.byIndex.clear();
    return this.active;
  }
  private tool(id: string, name = '') {
    let tool = this.tools().find(t => t.id === id);
    if (!tool) {
      const message = this.active ?? this.begin();
      message.blocks.push({ kind: 'tool', id, name, args: {}, status: 'pending', output: '' });
      tool = message.blocks[message.blocks.length - 1] as Extract<Block, { kind: 'tool' }>;
    }
    if (name) tool.name = name;
    return tool;
  }
  private endThinking() {
    for (const b of this.active?.blocks ?? []) if (b.kind === 'thinking' && !b.endedAt) b.endedAt = Date.now();
  }
  private finalBlocks(content: PiContent[], live: boolean): Block[] {
    const existing = new Map(this.tools().map(t => [t.id, t]));
    const now = Date.now();
    return content.flatMap((c, i): Block[] => {
      const streamed = live ? this.byIndex.get(i) : undefined;
      if (c.type === 'text') return [{ kind: 'text', text: c.text ?? '' }];
      if (c.type === 'thinking') {
        const startedAt = streamed?.kind === 'thinking' ? streamed.startedAt : live ? now : 0;
        const endedAt = streamed?.kind === 'thinking' ? streamed.endedAt ?? now : live ? now : 0;
        return c.thinking ? [{ kind: 'thinking', text: c.thinking, startedAt, endedAt }] : [];
      }
      if (c.type === 'toolCall' && c.id) return [{ kind: 'tool', status: 'pending', output: '', ...existing.get(c.id), id: c.id, name: c.name ?? '', args: c.arguments ?? {} }];
      return [];
    });
  }
  private loadHistory(list: PiMessage[]) {
    this.messages = []; this.active = null;
    for (const message of list) {
      if (message.role === 'user') this.messages.push({ id: ++sequence, role: 'user', text: contentText(message.content), images: imageCount(message.content) || undefined });
      else if (message.role === 'assistant') { this.begin(); this.endAssistant(message, false); }
      else if (message.role === 'toolResult' && message.toolCallId) this.toolResult(message);
      else if (message.role === 'compactionSummary') this.messages.push({ id: ++sequence, role: 'divider', text: '更早的对话已压缩为摘要' });
    }
    this.titled = this.messages.some(m => m.role === 'user');
  }
  private endAssistant(message: PiMessage, live: boolean) {
    const msg = this.active ?? this.begin();
    msg.blocks = typeof message.content === 'string' ? [{ kind: 'text', text: message.content }] : this.finalBlocks(message.content, live);
    msg.streaming = false;
    msg.usage = message.usage;
    msg.model = message.model;
    msg.aborted = message.stopReason === 'aborted';
    if (message.errorMessage && message.stopReason !== 'aborted') msg.error = message.errorMessage;
    if (!msg.blocks.length && !msg.error && !msg.aborted) this.messages.splice(this.messages.indexOf(msg), 1);
    this.active = null; this.byIndex.clear();
  }
  private toolResult(message: PiMessage) {
    const tool = this.tool(message.toolCallId!, message.toolName);
    tool.output = contentText(message.content); tool.status = message.isError ? 'error' : 'done'; tool.endedAt ??= Date.now();
  }
  private apply(r: PiRecord) {
    switch (r.type) {
      case 'connection':
        this.connecting = r.status === 'connecting'; this.connected = r.status === 'connected';
        if (r.configDir) this.configDir = r.configDir;
        if (r.loginCommand) this.loginCommand = r.loginCommand;
        this.connectionError = r.message ?? '';
        if (r.status === 'connected') this.afterConnect();
        if (r.status === 'disconnected') { this.running = false; this.retrying = null; this.clearDialogs(); }
        break;
      case 'agent_start': this.running = true; break;
      case 'agent_settled':
        this.running = false; this.retrying = null; this.endThinking();
        if (this.active) { this.active.streaming = false; this.active = null; }
        for (const m of this.messages) if (m.role === 'assistant') m.streaming = false;
        this.clearDialogs();
        if (r.aborted) {
          for (const tool of this.tools()) if (tool.status === 'pending' || tool.status === 'running') { tool.status = 'error'; tool.output ||= '已中止'; tool.endedAt = Date.now(); }
          this.notice('已中止', 'warning', 'retry');
        }
        void this.refreshStats();
        break;
      case 'message_start':
        if (r.message.role === 'user') this.messages.push({ id: ++sequence, role: 'user', text: contentText(r.message.content), images: imageCount(r.message.content) || undefined });
        else if (r.message.role === 'assistant') this.begin();
        break;
      case 'message_update': this.delta(r.assistantMessageEvent); break;
      case 'message_end':
        if (r.message.role === 'assistant') this.endAssistant(r.message, true);
        else if (r.message.role === 'toolResult' && r.message.toolCallId) this.toolResult(r.message);
        break;
      case 'tool_execution_start': {
        const tool = this.tool(r.toolCallId, r.toolName); tool.status = 'running'; tool.args = r.args; tool.startedAt = Date.now(); break;
      }
      case 'tool_execution_update': this.tool(r.toolCallId, r.toolName).output = contentText(r.partialResult.content); break;
      case 'tool_execution_end': {
        const tool = this.tool(r.toolCallId, r.toolName); tool.output = contentText(r.result.content); tool.status = r.isError ? 'error' : 'done'; tool.endedAt = Date.now(); break;
      }
      case 'queue_update': this.queue = { steering: r.steering ?? [], followUp: r.followUp ?? [] }; break;
      case 'thinking_level_changed': this.thinkingLevel = r.level; break;
      case 'session_info_changed': this.sessionName = r.name ?? ''; break;
      case 'compaction_start': this.compacting = true; break;
      case 'compaction_end':
        this.compacting = false;
        if (r.result) this.messages.push({ id: ++sequence, role: 'divider', text: `上下文已压缩 · ${Math.round(r.result.tokensBefore / 1000)}k → ${Math.round(r.result.estimatedTokensAfter / 1000)}k tokens` });
        else if (r.errorMessage) this.notice(`压缩失败：${r.errorMessage}`, 'error');
        void this.refreshStats();
        break;
      case 'auto_retry_start': this.retrying = { attempt: r.attempt, max: r.maxAttempts, delayMs: r.delayMs, error: r.errorMessage, at: Date.now() }; break;
      case 'auto_retry_end':
        this.retrying = null;
        if (!r.success) this.notice(`重试 ${r.attempt} 次后仍失败：${r.finalError ?? '未知错误'}`, 'error', 'retry');
        break;
      case 'extension_ui_request':
        if (['confirm', 'select', 'input', 'editor'].includes(r.method)) {
          // 确认框挂到正在执行的工具上，和那一步放在一起
          const host = [...this.tools()].reverse().find(t => t.status === 'running' && !t.approval);
          const approval: Approval = { id: r.id, title: r.title ?? '茶茶请求确认', message: r.message ?? '', state: 'waiting' };
          if (host && r.method === 'confirm') host.approval = approval;
          this.dialogs.push({ ...approval, method: r.method, options: r.options, value: r.prefill ?? '', pending: false, attached: !!host && r.method === 'confirm' });
          if (r.timeout) this.timers.set(r.id, setTimeout(() => {
            const dialog = this.dialogs.find(d => d.id === r.id);
            if (dialog?.state === 'waiting') { dialog.state = 'denied'; dialog.pending = false; this.syncApproval(dialog); }
            this.timers.delete(r.id);
          }, r.timeout));
        } else if (r.method === 'notify') this.notice(r.message ?? '', r.notifyType ?? 'info');
        break;
      case 'response': this.response(r); break;
    }
  }
  private response(r: Extract<PiRecord, { type: 'response' }>) {
    if (r.command === 'extension_ui_response' && r.id) {
      const dialog = this.dialogs.find(d => d.id === r.id);
      if (dialog) { dialog.pending = false; if (r.success) { dialog.state = this.decisions.get(r.id) ? 'allowed' : 'denied'; this.syncApproval(dialog); } }
      this.decisions.delete(r.id);
      if (r.success) { clearTimeout(this.timers.get(r.id)); this.timers.delete(r.id); }
    }
    if (!r.success) {
      // Connection errors already have a dedicated retry entry in the panel.
      if (r.command === 'get_state' || r.command === 'reconnect') return;
      if (r.command === 'prompt') this.running = false;
      this.notice(r.error ?? `${r.command} 失败`, 'error', r.command === 'prompt' ? 'retry' : undefined);
      return;
    }
    const d = r.data;
    switch (r.command) {
      case 'get_state': {
        const state = d as PiState;
        this.applyModel(state?.model);
        if (state?.thinkingLevel) this.thinkingLevel = state.thinkingLevel;
        this.sessionName = state?.sessionName ?? '';
        this.sessionFile = state?.sessionFile ?? '';
        if (state?.autoCompactionEnabled !== undefined) this.autoCompaction = state.autoCompactionEnabled;
        this.running = !!state?.isStreaming;
        this.compacting = !!state?.isCompacting;
        break;
      }
      case 'set_model': this.applyModel(d); break;
      case 'get_available_models':
        this.models = ((d?.models ?? []) as PiModel[]).filter(m => m.id !== 'unknown');
        if (this.current && !this.current.provider) this.applyModel(this.current.id);
        break;
      case 'new_session': case 'switch_session':
        if (d?.cancelled) break;
        this.messages = []; this.dialogs = []; this.active = null; this.byIndex.clear();
        this.queue = { steering: [], followUp: [] }; this.sessionName = ''; this.titled = false; this.stats = null;
        void this.syncState(r.command === 'switch_session');
        break;
      case 'get_messages':
        if (Array.isArray(d?.messages)) this.loadHistory(d.messages as PiMessage[]);
        break;
    }
  }
  private delta(e: PiAssistantEvent) {
    const msg = this.active ?? this.begin();
    if (e.type === 'text_delta' || e.type === 'thinking_delta') {
      let block = this.byIndex.get(e.contentIndex);
      if (!block) {
        if (e.type === 'text_delta') this.endThinking();
        msg.blocks.push(e.type === 'text_delta' ? { kind: 'text', text: '' } : { kind: 'thinking', text: '', startedAt: Date.now() });
        block = msg.blocks[msg.blocks.length - 1]; this.byIndex.set(e.contentIndex, block);
      }
      if (block.kind !== 'tool') block.text += e.delta ?? '';
    } else if (e.type.startsWith('toolcall_')) {
      this.endThinking();
      const partial = Array.isArray(e.partial?.content) ? e.partial.content[e.contentIndex] : undefined;
      const call = e.toolCall ?? partial;
      const id = call?.id ?? e.id;
      if (!id) return;
      const tool = this.tool(id, call?.name ?? e.toolName);
      tool.args = call?.arguments ?? tool.args;
      this.byIndex.set(e.contentIndex, tool);
    }
  }
  private tools() { return this.messages.flatMap(m => m.role === 'assistant' ? m.blocks : []).filter((b): b is Extract<Block, { kind: 'tool' }> => b.kind === 'tool'); }
  private notice(text: string, level: 'info' | 'warning' | 'error', action?: 'retry' | 'settings') { this.messages.push({ id: ++sequence, role: 'notice', text, level, action }); }
}
