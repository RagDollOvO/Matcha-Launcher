// 界面音效和声音面板共用音量；背景音乐单独播放。
// 浏览器/WebView 要求首次用户手势后才能出声，所以第一次 pointerdown/keydown 时 unlock()。

import { UI_SAMPLES } from './manifest';
import { checkMusicFile, homeMusicUrl, localMusic } from './home-music';

const SFX_BASE = `${import.meta.env.BASE_URL}sfx/`;

export type SfxName =
  | 'hover' | 'click' | 'tab' | 'toggleOn' | 'toggleOff' | 'open' | 'close'
  | 'launch' | 'send' | 'reply' | 'approve' | 'deny' | 'error'
  | 'download' | 'done' | 'menuOn' | 'menuOff' | 'none';

export type CuteSfx = 'pop' | 'blip' | 'boing' | 'aww' | 'sparkle' | 'squeak' | 'whimper' | 'yay' | 'dizzy';

interface SoundSettings { muted: boolean; volume: number; ui: boolean; ambient: boolean }

const KEY = 'l4d2-launcher.sound';
const defaults: SoundSettings = { muted: false, volume: 0.6, ui: true, ambient: true };

function load(): SoundSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch { /* 无痕模式等场景读不到，用默认值 */ }
  return { ...defaults };
}

class SoundEngine {
  settings = $state<SoundSettings>(load());

  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private ui!: GainNode;
  private host = false;
  private hold = false;
  private unlocked = false;
  private music: HTMLAudioElement | null = null;
  musicName = $state('');
  private preparingMusic?: Promise<void>;
  private lastHover = 0;
  private buffers = new Map<string, AudioBuffer>();

  constructor() {
    $effect.root(() => {
      $effect(() => {
        const s = JSON.stringify(this.settings);
        try { localStorage.setItem(KEY, s); } catch { /* 忽略 */ }
        this.applyGains();
        this.syncMusic();
      });
    });
  }

  /** 首次用户手势时调用 */
  unlock() {
    this.unlocked = true;
    this.syncMusic();
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.ui = ctx.createGain();
      // 轻压缩，防止叠加时爆音
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.ui.connect(this.master);
      this.master.connect(comp).connect(ctx.destination);
      this.applyGains();
      void this.loadSamples();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** 只有主窗口放背景音乐，助手独立窗口不放，免得两份叠在一起 */
  setMusicHost(on: boolean) {
    this.host = on;
    if (on) void this.prepareMusic();
    this.syncMusic();
  }

  /** 游戏运行中、窗口收起或最小化时先停，回来接着放 */
  holdMusic(on: boolean) {
    if (this.hold === on) return;
    this.hold = on;
    this.syncMusic();
  }

  private async setTrack(file?: File) {
    const url = file ? URL.createObjectURL(file) : await homeMusicUrl();
    const audio = this.music ??= new Audio();
    const previous = audio.src;
    audio.pause();
    audio.preload = 'none';
    audio.loop = true;
    audio.src = url;
    this.musicName = file?.name ?? '';
    if (previous.startsWith('blob:')) URL.revokeObjectURL(previous);
    this.syncMusic();
  }

  private prepareMusic() {
    return this.preparingMusic ??= localMusic.load().catch(e => {
      console.warn('自选音乐读取失败', e);
      return undefined;
    }).then(file => this.setTrack(file)).catch(e => {
      this.preparingMusic = undefined;
      console.warn('背景音乐读取失败', e);
    });
  }

  async chooseMusic(file?: File) {
    await this.prepareMusic();
    if (file) { await checkMusicFile(file); await localMusic.save(file); }
    else await localMusic.clear();
    await this.setTrack(file);
  }

  // One media element keeps its playhead across pages, minimization and game sessions.
  private syncMusic() {
    const { ambient, muted, volume } = this.settings;
    if (!this.host || this.hold || !ambient || muted || volume <= 0) {
      this.music?.pause();
      return;
    }
    if (!this.music) { void this.prepareMusic(); return; }
    this.music.volume = Math.min(1, Math.max(0, volume)) * 0.6;
    if (this.unlocked && this.music.paused) {
      void this.music.play().catch((e: DOMException) => {
        // 浏览器尚未收到用户手势时，下次点击再播。
        if (e.name !== 'AbortError' && e.name !== 'NotAllowedError') console.warn('背景音乐播放失败', e);
      });
    }
  }

  play(name: SfxName) {
    const c = this.ctx;
    if (!c || name === 'none' || this.settings.muted || !this.settings.ui) return;
    if (name === 'hover') {
      const now = performance.now();
      if (now - this.lastHover < 40) return;
      this.lastHover = now;
    }
    if (name === 'launch') { this.launchChime(); return; }
    const def = UI_SAMPLES[name];
    if (def) {
      const buf = this.pick(def.files);
      if (buf) {
        const [lo, hi] = def.rate ?? [1, 1];
        this.playBuffer(buf, { gain: def.gain ?? 0.6, rate: lo + Math.random() * (hi - lo) });
        return;
      }
    }
    this.synth(name);
  }

  /** 点赞卡片小火苗的可爱音效：全是合成的，跟着静音 / 音量 / 界面音效开关走。pitch 是音高倍数（开心高、委屈低） */
  cute(kind: CuteSfx, pitch = 1) {
    const c = this.ctx;
    if (!c || this.settings.muted || !this.settings.ui) return;
    const t = c.currentTime + 0.005;
    switch (kind) {
      case 'pop': // 冒泡「啵」
        this.tone(t, 'sine', 240, 820, 0.09, 0.09);
        this.tone(t + 0.07, 'sine', 480, 1250, 0.08, 0.05);
        break;
      case 'blip': { // 说话的「哔」：短三角波，音高随机一点，像小动物说话
        const f = 540 * pitch * (0.9 + Math.random() * 0.2);
        this.tone(t, 'triangle', f, f * 0.84, 0.05, 0.03);
        break;
      }
      case 'boing': // 蹦一下
        this.glide(t, 'sine', [[0, 220], [0.08, 680], [0.24, 460]], 0.28, 0.07, 16);
        break;
      case 'aww': // 委屈的「呜～」
        this.glide(t, 'triangle', [[0, 560], [0.14, 520], [0.5, 320]], 0.56, 0.06, 9);
        break;
      case 'sparkle': // 叮叮叮
        [1568, 2093, 2637, 3136].forEach((f, i) => this.tone(t + i * 0.045, 'sine', f, f, 0.22, 0.035));
        break;
      case 'squeak': // 被戳了「吱」
        this.tone(t, 'sine', 900, 1750, 0.06, 0.06);
        this.tone(t + 0.05, 'sine', 1750, 1150, 0.08, 0.05);
        break;
      case 'whimper': // 告别的「呜呜」
        this.glide(t, 'triangle', [[0, 494], [0.18, 440]], 0.22, 0.055, 7);
        this.glide(t + 0.25, 'triangle', [[0, 440], [0.38, 311]], 0.44, 0.05, 7);
        break;
      case 'yay': // 道谢：大三和弦往上走 + 闪光
        [523, 659, 784, 1047].forEach((f, i) => this.tone(t + i * 0.07, 'triangle', f, f, 0.22, 0.06));
        [2093, 2637, 3136].forEach((f, i) => this.tone(t + 0.3 + i * 0.05, 'sine', f, f, 0.26, 0.03));
        break;
      case 'dizzy': // 被戳晕了：颤抖着往下滑
        this.glide(t, 'sine', [[0, 900], [0.7, 260]], 0.72, 0.05, 24);
        break;
    }
  }

  /**
   * 启动：轻轻「嗖」一声往上飘，接一串音乐盒似的 G 大九和弦琶音，底下垫一层暖音，尾巴带点回声。
   * 全程没有锯齿波和低频冲击，峰值压得比界面点击还低一点。
   */
  private launchChime() {
    const c = this.ctx!;
    const t = c.currentTime + 0.01;
    // 回声：干声直出，另分一路过「延迟 → 低通 → 反馈」，越往后越闷
    const bus = c.createGain();
    const send = c.createGain(), delay = c.createDelay(1), damp = c.createBiquadFilter(), fb = c.createGain();
    send.gain.value = 0.3;
    delay.delayTime.value = 0.16;
    damp.type = 'lowpass';
    damp.frequency.value = 2400;
    fb.gain.value = 0.32;
    bus.gain.value = 1.25;
    bus.connect(this.ui);
    bus.connect(send).connect(delay).connect(damp).connect(fb).connect(delay);
    damp.connect(this.ui);

    this.tone(t, 'sine', 150, 92, 0.22, 0.07, bus);       // 轻轻一托
    this.whoosh(t, 0.5, 0.05, 420, 3200, bus);             // 嗖～往上
    this.pad(t + 0.06, [196, 293.66], 1.25, 0.034, bus);   // G3 + D4 暖垫
    const arp = [392, 493.88, 587.33, 739.99, 880];        // G4 B4 D5 F#5 A5
    arp.forEach((f, i) => this.bell(t + 0.13 + i * 0.065, f, 1.15 - i * 0.08, 0.066 - i * 0.006, bus));
    [1975.53, 2349.32, 2959.96].forEach((f, i) => this.tone(t + 0.5 + i * 0.06, 'sine', f, f, 0.32, 0.014, bus)); // 末尾一点星光

    setTimeout(() => [bus, send, delay, damp, fb].forEach((n) => n.disconnect()), 4200);
  }

  /** 柔和的钟片音：正弦基音 + 很快衰掉的八度泛音，起音放慢一点免得「咔」 */
  private bell(t: number, f: number, dur: number, peak: number, dest: AudioNode) {
    const c = this.ctx!;
    for (const [mul, level, len] of [[1, 1, 1], [2, 0.2, 0.4], [3, 0.05, 0.18]] as const) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * mul;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak * level, t + 0.014);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur * len);
      o.connect(g).connect(dest);
      o.start(t);
      o.stop(t + dur * len + 0.03);
    }
  }

  /** 慢起慢收的垫音，两层微微失谐，听着更暖 */
  private pad(t: number, freqs: number[], dur: number, peak: number, dest: AudioNode) {
    const c = this.ctx!;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(dest);
    for (const f of freqs) for (const detune of [-5, 5]) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.detune.value = detune;
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  /** 气声：噪声过带通，中心频率一路往上扫 */
  private whoosh(t: number, dur: number, peak: number, from: number, to: number, dest: AudioNode) {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noise();
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(from, t);
    bp.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(dest);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  private noiseBuf: AudioBuffer | null = null;
  private noise() {
    if (this.noiseBuf) return this.noiseBuf;
    const c = this.ctx!;
    const buf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return (this.noiseBuf = buf);
  }

  /** 按折线滑音，可带颤音 */
  private glide(t: number, type: OscillatorType, points: [number, number][], dur: number, peak: number, vibrato = 0) {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(points[0][1], t);
    for (const [dt, f] of points.slice(1)) o.frequency.exponentialRampToValueAtTime(f, t + dt);
    if (vibrato) {
      const lfo = c.createOscillator();
      lfo.frequency.value = 7;
      const depth = c.createGain();
      depth.gain.value = vibrato;
      lfo.connect(depth).connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
    }
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.02);
    g.gain.setValueAtTime(peak, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.ui);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private synth(name: SfxName) {
    const c = this.ctx!;
    const t = c.currentTime + 0.005;
    switch (name) {
      case 'hover': {
        this.burst(t, 0.025, 0.035, 'highpass', 4200, 4200, 0.7);
        this.tone(t, 'sine', 3100, 2900, 0.02, 0.01);
        break;
      }
      case 'click':
        this.tone(t, 'triangle', 540, 300, 0.07, 0.09);
        this.burst(t, 0.02, 0.05, 'bandpass', 2600, 2600, 2);
        break;
      case 'tab':
        this.tone(t, 'sine', 420, 420, 0.05, 0.06);
        this.tone(t + 0.045, 'sine', 640, 640, 0.07, 0.05);
        break;
      case 'toggleOn':
        this.tone(t, 'sine', 500, 920, 0.09, 0.08);
        break;
      case 'toggleOff':
        this.tone(t, 'sine', 820, 420, 0.09, 0.07);
        break;
      case 'open':
        // 展开：两声上行的柔和正弦，像轻轻「啵」一下，没有噪声
        this.tone(t, 'sine', 523, 659, 0.12, 0.05);
        this.tone(t + 0.06, 'sine', 784, 880, 0.16, 0.035);
        break;
      case 'close':
        // 收起：同样两声，往下走
        this.tone(t, 'sine', 784, 659, 0.12, 0.04);
        this.tone(t + 0.06, 'sine', 587, 523, 0.14, 0.03);
        break;
      case 'send':
        this.burst(t, 0.18, 0.06, 'bandpass', 2000, 500, 1.2);
        this.tone(t, 'sine', 700, 1050, 0.08, 0.04);
        break;
      case 'reply':
        this.tone(t, 'sine', 880, 880, 0.35, 0.045);
        this.tone(t + 0.09, 'sine', 1320, 1320, 0.45, 0.03);
        break;
      case 'approve':
        this.tone(t, 'triangle', 660, 660, 0.08, 0.07);
        this.tone(t + 0.08, 'triangle', 990, 990, 0.14, 0.06);
        break;
      case 'deny':
        this.tone(t, 'triangle', 440, 440, 0.08, 0.07);
        this.tone(t + 0.08, 'triangle', 330, 330, 0.16, 0.06);
        break;
      case 'error':
        this.tone(t, 'sawtooth', 150, 120, 0.18, 0.03);
        break;
      case 'menuOn':
      case 'menuOff':
        this.menuTap(name === 'menuOn');
        break;
      case 'download':
        // 加入下载：一声向下滑的轻“嗖”+ 低音落点
        this.burst(t, 0.16, 0.045, 'bandpass', 3200, 900, 1.4);
        this.tone(t + 0.04, 'sine', 760, 520, 0.12, 0.05);
        break;
      case 'done':
        // 下载完成：三音上行的清亮提示，最后一音带一点泛音
        this.tone(t, 'sine', 784, 784, 0.16, 0.055);
        this.tone(t + 0.09, 'sine', 988, 988, 0.18, 0.05);
        this.tone(t + 0.18, 'sine', 1319, 1319, 0.42, 0.05);
        this.tone(t + 0.18, 'triangle', 2638, 2638, 0.25, 0.012);
        break;
    }
  }

  private burst(t: number, dur: number, peak: number, type: BiquadFilterType, f0: number, f1: number, q = 1, dest: AudioNode = this.ui) {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noise();
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.01, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * (src.buffer.duration - dur));
    src.stop(t + dur + 0.02);
  }

  // 声音面板第一次操作时，采样可能还在解码。
  private menuTap(on: boolean) {
    const t = this.ctx!.currentTime + 0.005;
    const notes = on ? [[0,286,.65],[.063,382,.78]] : [[0,307,.88]];
    const rate = on ? 1 : .86, gain = on ? 1 : .92;
    for (const [at,hz,level] of notes) {
      const f = hz * rate, peak = .21 * level * gain;
      this.tone(t+at,'sine',f*1.025,f,.19,peak);
      this.tone(t+at,'sine',f*1.62,f*1.62,.103,peak*.4);
    }
  }

  // ---------------- 内部 ----------------

  private applyGains() {
    const c = this.ctx;
    if (!c) return;
    const s = this.settings;
    const now = c.currentTime;
    this.master.gain.setTargetAtTime(s.muted ? 0 : s.volume, now, 0.05);
    this.ui.gain.setTargetAtTime(s.ui ? 1 : 0, now, 0.05);
  }

  // ---------------- 采样 ----------------

  private async loadSamples() {
    const c = this.ctx!;
    const files = new Set(Object.values(UI_SAMPLES).flatMap(d => d!.files));
    // 先读清单指定的格式，替换素材时也支持其他格式。
    const stem = (f: string) => f.replace(/\.[a-z0-9]+$/i, '');
    await Promise.all([...files].map(async (f) => {
      for (const ext of [f.slice(f.lastIndexOf('.') + 1), ...['ogg', 'mp3', 'wav', 'flac'].filter(ext => !f.endsWith('.'+ext))]) {
        try {
          const res = await fetch(`${SFX_BASE}${stem(f)}.${ext}`);
          if (!res.ok) continue;
          const type = res.headers.get('content-type') ?? '';
          if (type.includes('text/html')) continue; // 开发服务器对缺失文件回退成 index.html
          this.buffers.set(f, await c.decodeAudioData(await res.arrayBuffer()));
          return;
        } catch { /* 解码失败就试下一个扩展名，全失败则保持合成音 */ }
      }
    }));
  }

  private pick(files: string[]) {
    const have = files.filter((f) => this.buffers.has(f));
    return have.length ? this.buffers.get(have[Math.floor(Math.random() * have.length)])! : null;
  }

  private playBuffer(buf: AudioBuffer, o: { gain: number; rate: number }) {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = o.rate;
    const gain = c.createGain();
    gain.gain.value = o.gain;
    src.connect(gain).connect(this.ui);
    src.start();
  }

  private tone(t: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number, dest: AudioNode = this.ui) {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.008, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }


}

export const sfx = new SoundEngine();
