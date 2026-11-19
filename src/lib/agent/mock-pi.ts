// 开发预览用的假 pi（地址加 ?mockpi 才启用，只在 npm run dev 下打包）。
// 按真实 RPC 事件顺序回放：思考、Markdown 回复、工具调用、写操作确认、排队、用量。不碰任何后端状态。
import type { PiCommand, PiContent, PiMessage, PiModel, PiRecord, PiTransport, ThinkingLevel } from './pi-protocol';

type Listener = (r: PiRecord) => void;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
class Aborted extends Error {}

const MODELS: PiModel[] = [
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', provider: 'anthropic', reasoning: true, input: ['text', 'image'], contextWindow: 200000, cost: { input: 3, output: 15 } },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', provider: 'anthropic', reasoning: true, input: ['text', 'image'], contextWindow: 200000, cost: { input: 1, output: 5 } },
  { id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash', provider: 'deepseek', reasoning: true, input: ['text', 'image'], contextWindow: 1000000, cost: { input: 0.3, output: 1.2 } },
];
const LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high'];

export class MockPiTransport implements PiTransport {
  private listeners = new Set<Listener>();
  private aborted = false;
  private busy = false;
  private pendingUi = new Map<string, (confirmed: boolean) => void>();
  private seq = 0;
  private model = MODELS[0];
  private level: ThinkingLevel = 'medium';
  private name = '';
  private history: PiMessage[] = [];
  private followUp: string[] = [];
  private tokens = 0;

  subscribe(l: Listener) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
  private emit(r: PiRecord) { queueMicrotask(() => this.listeners.forEach((l) => l(r))); }
  private state() { return { model: this.model, thinkingLevel: this.level, isStreaming: this.busy, sessionName: this.name || undefined, sessionFile: 'C:/mock/sessions/current.jsonl', autoCompactionEnabled: true, messageCount: this.history.length }; }
  private stats() {
    return { userMessages: this.history.filter((m) => m.role === 'user').length, toolCalls: 2, tokens: { input: this.tokens * 0.8, output: this.tokens * 0.2, cacheRead: 1200, cacheWrite: 0, total: this.tokens }, cost: this.tokens * 0.000006, contextUsage: { tokens: this.tokens, contextWindow: this.model.contextWindow ?? 200000, percent: Math.round((this.tokens / (this.model.contextWindow ?? 200000)) * 100) } };
  }

  async query<T>(type: string, params: Record<string, unknown> = {}): Promise<T> {
    await sleep(80);
    const ok = (v: unknown) => v as T;
    switch (type) {
      case 'get_state': return ok(this.state());
      case 'get_messages': return ok({ messages: this.history });
      case 'get_session_stats': return ok(this.stats());
      case 'get_available_thinking_levels': return ok({ levels: this.model.reasoning ? LEVELS : ['off'] });
      case 'set_thinking_level': this.level = params.level as ThinkingLevel; this.emit({ type: 'thinking_level_changed', level: this.level }); return ok(undefined);
      case 'set_model': this.model = MODELS.find((m) => m.provider === params.provider && m.id === params.modelId) ?? this.model; return ok(this.model);
      case 'set_session_name': this.name = String(params.name ?? ''); this.emit({ type: 'session_info_changed', name: this.name }); return ok(undefined);
      case 'compact':
        this.emit({ type: 'compaction_start', reason: 'manual' });
        await sleep(900);
        this.emit({ type: 'compaction_end', reason: 'manual', result: { tokensBefore: this.tokens, estimatedTokensAfter: Math.round(this.tokens * 0.3) } });
        this.tokens = Math.round(this.tokens * 0.3);
        return ok({});
      case 'set_auto_compaction': return ok(undefined);
      default: throw Object.assign(new Error(`Unsupported platform Pi command: ${type}`), { code: 'COMMAND_SCOPE' });
    }
  }

  send(cmd: PiCommand) {
    const respond = (data?: unknown, command: string = cmd.type) => this.emit({ type: 'response', id: (cmd as { id?: string }).id, command, success: true, data });
    switch (cmd.type) {
      case 'get_state': case 'reconnect':
        this.emit({ type: 'connection', status: 'connecting' });
        setTimeout(() => {
          respond(this.state(), 'get_state');
          respond({ messages: this.history }, 'get_messages');
          respond({ models: MODELS }, 'get_available_models');
          this.emit({ type: 'connection', status: 'connected', configDir: 'C:/Users/me/AppData/Local/Flare/pi', loginCommand: "$env:PI_CODING_AGENT_DIR = 'C:/…/Flare/pi'\n& 'node.exe' 'pi/cli.js'" });
        }, 500);
        break;
      case 'prompt':
        respond({ disposition: 'started' });
        void this.run(cmd.message);
        break;
      case 'follow_up': case 'steer':
        this.followUp.push(cmd.message);
        this.emit({ type: 'queue_update', steering: [], followUp: [...this.followUp] });
        respond({ disposition: 'queued' });
        break;
      case 'clear_queue':
        this.followUp = [];
        this.emit({ type: 'queue_update', steering: [], followUp: [] });
        respond({});
        break;
      case 'abort':
        // 和真实后端 pi-cancel 一样：先清排队
        this.followUp = [];
        this.emit({ type: 'queue_update', steering: [], followUp: [] });
        this.aborted = true;
        this.pendingUi.forEach((resolve) => resolve(false));
        this.pendingUi.clear();
        respond();
        break;
      case 'new_session': this.history = []; this.name = ''; this.tokens = 0; respond({ cancelled: false }); break;
      case 'switch_session': this.history = SAMPLE_HISTORY; this.name = '检查冲突'; respond({ cancelled: false }); break;
      case 'extension_ui_response':
        this.pendingUi.get(cmd.id)?.(!!cmd.confirmed);
        this.pendingUi.delete(cmd.id);
        respond(undefined, 'extension_ui_response');
        break;
      default: respond();
    }
  }

  private async run(message: string) {
    this.busy = true; this.aborted = false;
    const check = () => { if (this.aborted) throw new Aborted(); };
    this.emit({ type: 'agent_start' });
    const user: PiMessage = { role: 'user', content: message };
    this.history.push(user);
    this.emit({ type: 'message_start', message: user });
    this.emit({ type: 'message_end', message: user });
    let aborted = false;
    try {
      await sleep(300);
      // 第一段：思考 → 说明 → 读工具
      const content: PiContent[] = [];
      this.emit({ type: 'message_start', message: { role: 'assistant', content: [] } });
      const stream = async (kind: 'thinking_delta' | 'text_delta', i: number, text: string, speed: number) => {
        for (let p = 0; p < text.length;) { check(); const n = 2 + Math.floor(Math.random() * 4); this.emit({ type: 'message_update', assistantMessageEvent: { type: kind, contentIndex: i, delta: text.slice(p, p + n) } }); p += n; await sleep(speed); }
      };
      const thought = '用户想检查 Mod 冲突。先用 mod_inventory 扫描已启用的 VPK，看资源路径有没有重叠；如果有，再决定建议停用哪一个。写操作需要用户确认。';
      if (this.level !== 'off' && this.model.reasoning) { await stream('thinking_delta', 0, thought, 22); content.push({ type: 'thinking', thinking: thought }); }
      const intro = '我先扫描一下当前启用的 **VPK**，看看有没有资源重叠。';
      const ti = content.length; await stream('text_delta', ti, intro, 18); content.push({ type: 'text', text: intro });
      const callId = `call_${++this.seq}`;
      const args = { scope: 'enabled', includeWorkshop: true };
      this.emit({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_start', contentIndex: content.length, id: callId, toolName: 'mod_inventory' } });
      await sleep(200);
      content.push({ type: 'toolCall', id: callId, name: 'mod_inventory', arguments: args });
      this.emit({ type: 'message_end', message: { role: 'assistant', content: [...content], usage: { input: 2100, output: 180, cost: { total: 0.0090 } } } });
      this.history.push({ role: 'assistant', content: [...content] });
      check();
      this.emit({ type: 'tool_execution_start', toolCallId: callId, toolName: 'mod_inventory', args });
      await sleep(900); check();
      const result = '扫描 3 个 VPK：\n- 2553133332.vpk 与 Whitaker 地图包共享 materials/water/*（12 个文件）\n- 其余无重叠';
      this.emit({ type: 'tool_execution_end', toolCallId: callId, toolName: 'mod_inventory', result: { content: [{ type: 'text', text: result }] }, isError: false });
      const tr: PiMessage = { role: 'toolResult', toolCallId: callId, toolName: 'mod_inventory', content: [{ type: 'text', text: result }] };
      this.history.push(tr);
      this.emit({ type: 'message_start', message: tr }); this.emit({ type: 'message_end', message: tr });

      // 第二段：写操作 + 确认
      this.emit({ type: 'message_start', message: { role: 'assistant', content: [] } });
      const say2 = '发现一处重叠。建议在当前方案里停用 `2553133332.vpk`，我来改：';
      await stream('text_delta', 0, say2, 16);
      const id2 = `call_${++this.seq}`;
      const args2 = { file: '2553133332.vpk', enabled: false };
      this.emit({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_start', contentIndex: 1, id: id2, toolName: 'mod_set_enabled' } });
      await sleep(200);
      this.emit({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: say2 }, { type: 'toolCall', id: id2, name: 'mod_set_enabled', arguments: args2 }], usage: { input: 2600, output: 90, cost: { total: 0.0092 } } } });
      this.emit({ type: 'tool_execution_start', toolCallId: id2, toolName: 'mod_set_enabled', args: args2 });
      const uiId = `ui_${id2}`;
      const ok = await new Promise<boolean>((resolve) => { this.pendingUi.set(uiId, resolve); this.emit({ type: 'extension_ui_request', id: uiId, method: 'confirm', title: '更新 Mod 启停', message: '在 addonlist.txt 中停用 2553133332.vpk\n会先备份原文件，下次启动生效。' }); });
      check();
      const out = ok ? '已停用 1 个 VPK，addonlist.txt 已备份并更新。' : '用户拒绝了此操作，未做任何修改。';
      this.emit({ type: 'tool_execution_end', toolCallId: id2, toolName: 'mod_set_enabled', result: { content: [{ type: 'text', text: out }] }, isError: !ok });

      // 第三段：总结（Markdown）
      this.emit({ type: 'message_start', message: { role: 'assistant', content: [] } });
      const summary = ok
        ? '改好了。\n\n| 项目 | 结果 |\n| --- | --- |\n| 扫描 | 3 个 VPK |\n| 重叠 | 1 处（水面材质） |\n| 处理 | 停用 `2553133332.vpk` |\n\n下次**完整启动**生效。想恢复的话，在 Mod 页重新打开它的开关即可。'
        : '好的，保持不变。之后想处理可以：\n\n1. 在 Mod 页打开冲突详情\n2. 在方案里选择保留哪一个\n3. 使用该方案从 Matcha 启动游戏';
      await stream('text_delta', 0, summary, 12);
      this.emit({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: summary }], usage: { input: 2800, output: 120, cost: { total: 0.0102 } } } });
      this.history.push({ role: 'assistant', content: [{ type: 'text', text: summary }] });
      this.tokens += 7600;
    } catch (e) {
      if (!(e instanceof Aborted)) throw e;
      aborted = true;
      this.emit({ type: 'message_end', message: { role: 'assistant', content: [], stopReason: 'aborted' } });
    }
    this.emit({ type: 'agent_end', willRetry: false });
    this.busy = false;
    this.emit({ type: 'agent_settled', aborted });
    const next = this.followUp.shift();
    if (next && !aborted) { this.emit({ type: 'queue_update', steering: [], followUp: [...this.followUp] }); setTimeout(() => void this.run(next), 200); }
  }
}

const SAMPLE_HISTORY: PiMessage[] = [
  { role: 'user', content: '检查一下 Mod 冲突' },
  { role: 'assistant', content: [{ type: 'thinking', thinking: '先扫描已启用的 VPK。' }, { type: 'text', text: '扫描完成，**没有发现冲突**。' }] },
];

/** 假的后端桥接命令：会话列表、服务商；pi-tools 故意不实现，演示「待接入」 */
export async function mockHostCall<T>(command: string, params: Record<string, unknown> = {}): Promise<T> {
  await sleep(120);
  const now = Date.now();
  switch (command) {
    case 'pi-sessions': return { sessions: [
      { path: 'C:/mock/sessions/current.jsonl', id: 'a', name: '', firstMessage: '当前会话', messageCount: 4, createdAt: new Date(now - 6e5).toISOString(), updatedAt: new Date(now).toISOString(), current: true },
      { path: 'C:/mock/sessions/b.jsonl', id: 'b', name: '检查冲突', messageCount: 6, createdAt: new Date(now - 9e7).toISOString(), updatedAt: new Date(now - 8.6e7).toISOString() },
      { path: 'C:/mock/sessions/c.jsonl', id: 'c', firstMessage: '列出已安装插件及可用动作', messageCount: 3, createdAt: new Date(now - 4e8).toISOString(), updatedAt: new Date(now - 3.9e8).toISOString() },
    ] } as T;
    case 'pi-session-delete': return { status: 'deleted' } as T;
    case 'pi-auth-status': return { providers: [
      { id: 'anthropic', name: 'Anthropic', configured: true, source: 'auth', kind: 'both', keyHint: 'x9Qa' },
      { id: 'openai', name: 'OpenAI', configured: false, kind: 'both' },
      { id: 'deepseek', name: 'DeepSeek', configured: true, source: 'env', kind: 'api_key' },
      { id: 'openrouter', name: 'OpenRouter', configured: false, kind: 'api_key' },
    ] } as T;
    case 'pi-auth-set': case 'pi-auth-remove': return { status: 'ok', params } as T;
    default: throw Object.assign(new Error('未知的 Pi 命令。 [unknown_command]'), { code: 'unknown_command' });
  }
}
