// 启动项和 Matcha 管理的 CFG 草稿；接口契约见 docs/game-settings-backend.md。
import { call, errorText } from '../api/bridge';
import type { LaunchMode } from '../types';
import { baseLaunchArgv, buildLaunchArgv, setL4nLaunch, type LaunchPreferences } from '../../../backend/launch-argv.mjs';
export type { DisplayMode } from '../../../backend/launch-argv.mjs';

export interface GameSettings extends LaunchPreferences {
  /** autoexec.cfg 里由 Matcha 管理的一段；values 为空串的项不写 */
  autoexec: { enabled: boolean; values: Record<string, string>; extra: string };
}
export interface GameSettingsReply extends GameSettings {
  /** 后端合并后的最终启动参数，每种启动方式各一份 */
  effective?: Record<LaunchMode, string[]>;
  autoexecPath?: string;
}

export const launchFlags = { novid: '-novid', console: '-console', lowViolence: '-lv' } as const;
type LaunchFlag = keyof typeof launchFlags;
const structuredCfg = (values: Record<string, string>) => Object.entries(values)
  .filter(([, v]) => v !== '').map(([k, v]) => `${k} "${v}"`).join('\n');

const LOCAL = 'flare.game-settings.draft';
const defaults = (): GameSettings => ({ display: { mode: 'default', width: null, height: null, refreshHz: null }, fpsMax: null, novid: true, console: false, lowViolence: false, consoleLog: false, highPriority: false, extraArgs: '', autoexec: { enabled: false, values: {}, extra: '' } });
const missing = (e: unknown) => ['unsupported_capability', 'unknown_command'].includes((e as { code?: string })?.code ?? '');
const readLocal = (): GameSettings => { try { const v = JSON.parse(localStorage.getItem(LOCAL) || 'null'); return v ? { ...defaults(), ...v, display: { ...defaults().display, ...v.display }, autoexec: { ...defaults().autoexec, ...v.autoexec } } : defaults(); } catch { return defaults(); } };

class GameSettingsStore {
  value = $state<GameSettings>(defaults());
  effective = $state<Record<LaunchMode, string[]> | null>(null);
  autoexecPath = $state('');
  status = $state<'idle' | 'loading' | 'ready' | 'missing' | 'error'>('idle');
  error = $state('');
  saving = $state(false);
  savedAt = $state(0);
  loaded = $state(false);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: Promise<void> | null = null;
  private loading: Promise<void> | null = null;
  private revision = 0;
  private savedRevision = 0;

  async load() {
    if (this.loading) return this.loading;
    if (this.timer || this.pending) return;
    if (this.revision !== this.savedRevision) {
      if (this.status === 'error') await this.save().catch(() => {});
      return;
    }
    const revision = this.revision;
    this.status = 'loading'; this.error = '';
    this.loading = (async () => {
      try {
        const reply = await call<GameSettingsReply>('game-settings-get');
        if (this.revision === revision) this.apply(reply);
        this.status = 'ready'; this.loaded = true;
      } catch (e) {
        if (missing(e)) { if (this.revision === revision) this.value = readLocal(); this.status = 'missing'; this.loaded = true; }
        else { this.status = 'error'; this.error = errorText(e); }
      }
    })();
    try { await this.loading; } finally { this.loading = null; }
  }
  /** 改动后 400ms 自动保存 */
  change() {
    this.revision++; this.effective = null; this.savedAt = 0;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.save().catch(() => {}), 400);
  }
  /** 启动前调用：把还没落盘的改动先保存 */
  async flush() {
    if (this.status === 'idle') await this.load();
    if (this.loading) await this.loading;
    do {
      if (this.timer || this.revision !== this.savedRevision) { clearTimeout(this.timer); this.timer = undefined; await this.save(); }
      else if (this.pending) await this.pending;
      else break;
    } while (this.timer || this.pending || this.revision !== this.savedRevision);
    if (this.status === 'error') throw new Error(this.error || '请先保存游戏设置。');
  }
  async setL4nLaunch(enabled:boolean, gameRoot:string) {
    await this.flush();
    const revision=this.revision;
    const reply=await call<GameSettingsReply>('game-settings-l4n-launch',{enabled,gameRoot});
    if(this.revision===revision) this.apply(reply);
    else {this.value.extraArgs=setL4nLaunch(this.value.extraArgs,enabled);this.change();await this.flush();}
  }
  resetLaunch() { this.value = { ...defaults(), autoexec: this.value.autoexec }; this.change(); }

  private async save() {
    this.timer = undefined;
    if (this.loading) await this.loading;
    const snapshot = $state.snapshot(this.value) as GameSettings;
    const revision = this.revision;
    if (this.status === 'missing' || this.status === 'idle') {
      try { localStorage.setItem(LOCAL, JSON.stringify(snapshot)); } catch { /* 忽略 */ }
      this.savedAt = Date.now();
      this.savedRevision = revision;
      return;
    }
    this.saving = true;
    const run = (this.pending ?? Promise.resolve()).catch(() => {}).then(async () => {
      if (revision <= this.savedRevision) return;
      try {
        const reply = await call<GameSettingsReply>('game-settings-set', snapshot as unknown as Record<string, unknown>);
        if (revision === this.revision) this.apply(reply, false);
        this.savedRevision = revision; this.savedAt = Date.now(); this.error = ''; this.status = 'ready';
      } catch (e) { this.status = 'error'; this.error = errorText(e); throw e; }
    });
    this.pending = run;
    try { await run; }
    finally { if (this.pending === run) { this.pending = null; this.saving = false; } }
  }
  private apply(r: GameSettingsReply, replace = true) {
    const { effective, autoexecPath, ...rest } = r;
    if (replace) this.value = { ...defaults(), ...rest, display: { ...defaults().display, ...rest.display }, autoexec: { ...defaults().autoexec, ...rest.autoexec } };
    this.effective = effective ?? null;
    this.autoexecPath = autoexecPath ?? '';
  }

  /** 最终启动参数：后端给了就用后端的，否则按同样规则在本地预览 */
  args(mode: LaunchMode): string[] {
    if (this.effective?.[mode]) return this.effective[mode];
    const base = baseLaunchArgv(mode);
    if (mode === 'clean') return base;
    return buildLaunchArgv(base, this.value, this.value.extraArgs.trim().split(/\s+/).filter(Boolean));
  }
  flagOn(key: LaunchFlag) {
    return !!this.value[key] || this.value.extraArgs.toLowerCase().split(/\s+/).includes(launchFlags[key]);
  }
  toggleFlag(key: LaunchFlag) {
    const on = !this.flagOn(key);
    this.value[key] = on;
    if (!on) {
      // An old hand-entered copy would otherwise immediately turn the switch back on.
      const raw = this.value.extraArgs;
      const without = raw.replace(new RegExp('(^|\\s)' + launchFlags[key] + '(?=\\s|$)', 'gi'), '');
      if (without !== raw) this.value.extraArgs = without.trim();
    }
    this.change();
  }
  /** Same execution order as the managed block: saved preferences first, handwritten CFG last. */
  cfgText(): string {
    const { values, extra } = this.value.autoexec;
    const structured = structuredCfg(values);
    return structured && extra ? structured + '\n' + extra : structured || extra;
  }
  setCfgText(text: string) {
    if (text === this.cfgText()) return;
    // Keep earlier structured settings for old clients if only the handwritten tail changed.
    const cfg = this.value.autoexec;
    const head = structuredCfg(cfg.values);
    if (head && text === head) cfg.extra = '';
    else if (head && text.startsWith(head + '\n') && text.length > head.length + 1) cfg.extra = text.slice(head.length + 1);
    else { cfg.values = {}; cfg.extra = text; }
    this.change();
  }
  /** 首页一行摘要：只列和默认不同的项 */
  summary(): string {
    const v = this.value, parts: string[] = [];
    if (v.display.mode !== 'default') parts.push({ fullscreen: '全屏', windowed: '窗口', noborder: '无边框' }[v.display.mode]);
    if (v.display.width && v.display.height) parts.push(`${v.display.width}×${v.display.height}`);
    if (v.display.mode === 'fullscreen' && v.display.refreshHz != null) parts.push(`${v.display.refreshHz} Hz`);
    if (v.fpsMax !== null) parts.push(v.fpsMax === 0 ? '帧率不限' : `帧率 ${v.fpsMax}`);
    if (this.flagOn('lowViolence')) parts.push('低血腥度');
    if (v.autoexec.enabled) parts.push('autoexec');
    return parts.join(' · ');
  }
}

export const gameSettings = new GameSettingsStore();
