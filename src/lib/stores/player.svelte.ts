import { api } from '../api';
import { errorText } from '../api/bridge';
import { app } from './app.svelte';
import { sfx } from '../sound/sfx.svelte';
import type { Mod, ModSound } from '../types';

const keyOf = (modId: string, path: string) => `${modId}\n${path}`;
/** 枪声试听用：开火声加分，换弹、拔枪之类的减分 */
const FIRE = /fire|shoot|shot|single|gunfire|blast/;
const NOT_FIRE = /reload|deploy|draw|clip|mag|empty|bolt|cock|slide|pump|foley|holster|click|dry|melee|swing/;
export function bestShot(list: ModSound[]): ModSound | undefined {
  const score = (s: ModSound) => {
    const p = s.path.toLowerCase(), name = p.split('/').pop() ?? p;
    return (p.startsWith('sound/weapons/') ? 4 : 0) + (FIRE.test(name) ? 3 : 0) - (NOT_FIRE.test(name) ? 3 : 0);
  };
  return [...list].sort((a, b) => score(b) - score(a) || a.path.localeCompare(b.path))[0];
}
export const hasGunSounds = (m: Mod) => !!m.soundCount && m.dirs.includes('sound/weapons');

/** 全局只放一个声音；换声、停播时释放 Blob URL */
class Player {
  /** 正在加载或播放的声音 */
  key = $state<string | null>(null);
  modId = $state<string | null>(null);
  loading = $state(false);
  /** 播过的声音时长（毫秒），列表里显示 */
  durations = $state<Record<string, number>>({});
  private audio: HTMLAudioElement | null = null;
  private url: string | null = null;
  private seq = 0;
  private lists = new Map<string, Promise<ModSound[]>>();

  constructor() {
    $effect.root(() => {
      $effect(() => this.syncVolume(this.audio, sfx.settings.volume, sfx.settings.muted));
    });
  }
  private syncVolume(audio: HTMLAudioElement | null, volume: number, muted: boolean) {
    if (audio) { audio.volume = Math.min(1, Math.max(0, volume)); audio.muted = muted; }
  }

  /** 声音列表按 Mod 版本缓存 */
  sounds(m: Mod): Promise<ModSound[]> {
    const k = `${m.id}@${m.updatedAt}`;
    let p = this.lists.get(k);
    if (!p) {
      p = api.modSounds(m.id);
      p.catch(() => this.lists.delete(k));
      this.lists.set(k, p);
    }
    return p;
  }
  isOn(modId: string, path: string) { return this.key === keyOf(modId, path); }
  duration(modId: string, path: string): number | undefined { return this.durations[keyOf(modId, path)]; }

  async play(modId: string, path: string) {
    const key = keyOf(modId, path);
    if (this.key === key) return this.stop();
    this.stop();
    const seq = this.seq;
    this.key = key; this.modId = modId; this.loading = true;
    try {
      const r = await api.modSound(modId, path);
      if (seq !== this.seq) return;
      const raw = atob(r.base64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      // CSP 只允许 blob: 音频
      this.url = URL.createObjectURL(new Blob([bytes], { type: r.mime }));
      const a = new Audio(this.url);
      this.syncVolume(a, sfx.settings.volume, sfx.settings.muted);
      this.audio = a;
      if (r.durationMs) this.durations[key] = r.durationMs;
      a.onloadedmetadata = () => { if (!this.durations[key] && Number.isFinite(a.duration)) this.durations[key] = Math.round(a.duration * 1000); };
      a.onended = () => { if (seq === this.seq) this.stop(); };
      await a.play();
      if (seq === this.seq) this.loading = false;
    } catch (e) {
      if (seq !== this.seq) return;
      this.stop();
      app.toast(`无法播放：${errorText(e)}`);
    }
  }
  /** 试听「最像开火声」的那个文件；再点一次停止 */
  async preview(m: Mod) {
    if (this.modId === m.id) return this.stop();
    try {
      const best = bestShot(await this.sounds(m));
      if (best) await this.play(m.id, best.path);
      else app.toast('这个 Mod 里没有可试听的声音');
    } catch (e) { app.toast(errorText(e)); }
  }
  stop() {
    this.seq++;
    if (this.audio) { this.audio.onended = null; this.audio.pause(); this.audio.removeAttribute('src'); this.audio = null; }
    if (this.url) { URL.revokeObjectURL(this.url); this.url = null; }
    this.key = null; this.modId = null; this.loading = false;
  }
}

export const player = new Player();
