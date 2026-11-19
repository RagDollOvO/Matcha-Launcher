// 没有封面的 VPK 用生成纹样当封面：按内容类型画一张小插画，mod id 当随机种子，标题里的颜色词定色相。
// 只产出 SVG 文本，颜色全部走 ModThumb 里的 .f*/.s*/.g* 类（随亮暗主题切换），动效也在那边、只在悬停时跑。
// 渐变 id 里的 § 由每个实例替换成唯一后缀，同一个 mod 出现在多处时互不干扰。
import type { Mod } from './types';

export type ArtKind = 'particle' | 'sound' | 'music' | 'weapon' | 'survivor' | 'infected' | 'map' | 'ui' | 'script' | 'texture' | 'model' | 'misc';
export interface ModArt { kind: ArtKind; hue: number; sat: number; svg: string }

const TAU = Math.PI * 2;
const n = (x: number) => Math.round(x * 10) / 10;

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
type Rand = () => number;
function rng(seed: number): Rand {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** 近似正态，落在 -1..1 */
const gauss = (r: Rand) => (r() + r() + r() - 1.5) / 1.5;

// ---------- 类型 ----------
const TAG = /^\s*[[【(（]([^\]】)）]{1,16})[\]】)）]/;
const WORDS: [RegExp, ArtKind][] = [
  [/粒子|特效|光效|particle|\bfx\b/i, 'particle'],
  [/音乐|bgm|music/i, 'music'],
  [/音效|语音|声音|配音|sound|voice|audio/i, 'sound'],
  [/地图|三方图|战役|\bmaps?\b|campaign/i, 'map'],
  [/准星|界面|\bhud\b|\bui\b|菜单|字体|crosshair|menu/i, 'ui'],
  [/脚本|vscript|script/i, 'script'],
  [/感染者|特感|僵尸|丧尸|infected|zombie|\btank\b|witch|hunter|smoker|boomer|charger|jockey|spitter/i, 'infected'],
  [/生还者|人物|角色|survivor|\b(bill|zoey|louis|francis|coach|ellis|nick|rochelle)\b/i, 'survivor'],
  [/武器|枪|刀|近战|weapon|\bgun\b|rifle|pistol|knife|melee/i, 'weapon'],
  [/材质|贴图|纹理|texture/i, 'texture'],
  [/模型|\bmodel/i, 'model'],
];
const byWords = (s: string) => WORDS.find(([re]) => re.test(s))?.[1] ?? null;

function byDirs(dirs: string[]): ArtKind | null {
  const has = (re: RegExp) => dirs.some((d) => re.test(d));
  if (has(/^maps(\/|$)/i)) return 'map';
  if (has(/^models\/survivors?(\/|$)/i)) return 'survivor';
  if (has(/^models\/infected(\/|$)/i)) return 'infected';
  if (has(/^models\/(v_models|w_models|weapons)(\/|$)/i)) return 'weapon';
  if (has(/^particles(\/|$)|^materials\/particles?(\/|$)/i)) return 'particle';
  if (has(/^sound(\/|$)/i)) return dirs.filter((d) => /^sound(\/|$)/i.test(d)).every((d) => /^sound\/music/i.test(d)) ? 'music' : 'sound';
  if (has(/^(resource|materials\/vgui|materials\/hud|scripts\/hud)/i)) return 'ui';
  if (has(/^(scripts|addons)(\/|$)/i)) return 'script';
  if (has(/^materials(\/|$)/i)) return 'texture';
  if (has(/^models(\/|$)/i)) return 'model';
  return null;
}

/** 标题里的 [标签] 最准，其次看 VPK 目录，最后看标题字眼 */
export function artKind(mod: Pick<Mod, 'title' | 'dirs'>): ArtKind {
  const tag = mod.title.match(TAG)?.[1];
  return (tag && byWords(tag)) || byDirs(mod.dirs ?? []) || byWords(mod.title) || 'misc';
}

// ---------- 颜色 ----------
// oklch 色相；-1 彩虹，-2 白/银，-3 黑
const HUES: [RegExp, number][] = [
  [/彩虹|七彩|炫彩|幻彩|rainbow|\brgb\b/i, -1],
  [/蓝绿|青|碧|cyan|teal|aqua/i, 195],
  [/粉|樱|桃|pink/i, 355],
  [/紫|violet|purple/i, 305],
  [/胆汁|bile/i, 118],
  [/火|炎|焰|熔岩|flame|fire|lava/i, 45],
  [/红|赤|血|\bred\b|blood/i, 25],
  [/橙|orange/i, 60],
  [/金|黄|gold|yellow/i, 90],
  [/绿|毒|green|toxic/i, 145],
  [/冰|雪|霜|\bice\b|frost|snow/i, 225],
  [/蓝|电|雷|blue|electric|lightning/i, 258],
  [/白|银|white|silver/i, -2],
  [/黑|black/i, -3],
];
/** 没有颜色词时从这里挑，避开偏土的黄绿段 */
const PALETTE = [355, 18, 45, 72, 150, 175, 198, 225, 255, 282, 305, 330];

interface Opt { rainbow: boolean }

// ---------- 小工具 ----------
const DEFS = '<defs>'
  + '<linearGradient id="§b" x1="0" y1="0" x2=".6" y2="1"><stop offset="0" class="g0"/><stop offset="1" class="g1"/></linearGradient>'
  + '<radialGradient id="§g"><stop offset="0" class="g3" stop-opacity=".62"/><stop offset=".42" class="g3" stop-opacity=".2"/><stop offset="1" class="g3" stop-opacity="0"/></radialGradient>'
  + '<radialGradient id="§w"><stop offset="0" class="g4" stop-opacity=".95"/><stop offset="1" class="g4" stop-opacity="0"/></radialGradient>'
  + '<radialGradient id="§v" cx=".5" cy=".45" r=".75"><stop offset=".55" class="g1" stop-opacity="0"/><stop offset="1" class="g1" stop-opacity=".55"/></radialGradient>'
  + '</defs><rect width="100" height="100" fill="url(#§b)"/>';
const VIGNETTE = '<rect width="100" height="100" fill="url(#§v)"/>';
const glow = (x: number, y: number, r: number) => `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="url(#§g)"/>`;
const shine = (x: number, y: number, r: number) => `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="url(#§w)"/>`;
/** 四角星，悬停时一闪一闪 */
function sparkle(x: number, y: number, s: number, i: number) {
  const [a, b] = [n(x), n(y)];
  return `<path class="f4 tw" style="--i:${i}" d="M${a} ${n(y - s)}Q${a} ${b} ${n(x + s)} ${b}Q${a} ${b} ${a} ${n(y + s)}Q${a} ${b} ${n(x - s)} ${b}Q${a} ${b} ${a} ${n(y - s)}Z"/>`;
}
function sparkles(r: Rand, count: number, from = 0) {
  let s = '';
  for (let i = 0; i < count; i++) s += sparkle(12 + r() * 76, 14 + r() * 72, 2 + r() * 3.8, from + i);
  return s;
}
/** 色相偏移：普通模式在主色附近摆动，彩虹模式随便取 */
const hd = (r: Rand, o: Opt, spread: number) => (o.rainbow ? n(r() * 360) : n((r() - 0.5) * spread));
const grid = (step: number, op: number) => {
  let s = `<g class="s2 dt" stroke-width=".3" opacity="${op}">`;
  for (let v = step; v < 100; v += step) s += `<line x1="${v}" y1="0" x2="${v}" y2="100"/><line x1="0" y1="${v}" x2="100" y2="${v}"/>`;
  return s + '</g>';
};
const arc = (cx: number, cy: number, r: number, a0: number, a1: number) =>
  `M${n(cx + Math.cos(a0) * r)} ${n(cy + Math.sin(a0) * r)}A${n(r)} ${n(r)} 0 0 1 ${n(cx + Math.cos(a1) * r)} ${n(cy + Math.sin(a1) * r)}`;

// ---------- 各类型插画（坐标都在 0..100 的方块里） ----------
function particle(r: Rand, o: Opt) {
  let s = '';
  const mode = Math.floor(r() * 3);
  if (mode === 0) {
    // 绽放：光核 + 放射线 + 火花
    const cx = 36 + r() * 28, cy = 36 + r() * 28;
    s += glow(cx, cy, 48) + `<g class="burst" style="transform-origin:${n(cx)}px ${n(cy)}px">`;
    const rays = 6 + Math.floor(r() * 7);
    for (let i = 0; i < rays; i++) {
      const a = r() * TAU, l = 16 + r() * 34;
      s += `<line class="s3" x1="${n(cx + Math.cos(a) * 5)}" y1="${n(cy + Math.sin(a) * 5)}" x2="${n(cx + Math.cos(a) * l)}" y2="${n(cy + Math.sin(a) * l)}" stroke-width="${n(0.5 + r() * 0.8)}" opacity="${n(0.25 + r() * 0.4)}" style="--d:${hd(r, o, 40)}"/>`;
    }
    for (let i = 0; i < 48; i++) {
      const a = r() * TAU, d = Math.abs(gauss(r)) * 46 + 3, big = r() < 0.1;
      s += `<circle class="${r() < 0.22 ? 'f4' : 'f3'}" cx="${n(cx + Math.cos(a) * d)}" cy="${n(cy + Math.sin(a) * d)}" r="${n(big ? 1.3 + r() * 1.3 : 0.35 + r() * 0.85)}" opacity="${n(0.4 + r() * 0.6)}" style="--d:${hd(r, o, 50)}"/>`;
    }
    s += '</g>' + shine(cx, cy, 10) + `<circle class="f4" cx="${n(cx)}" cy="${n(cy)}" r="2.2"/>`;
  } else if (mode === 1) {
    // 彗星：右上一颗亮核，拖着一串火花往左下
    const hx = 64 + r() * 16, hy = 20 + r() * 16, a = Math.PI * (0.7 + r() * 0.14);
    const dx = Math.cos(a), dy = Math.sin(a), px = -dy, py = dx;
    s += glow(hx, hy, 36);
    s += `<path class="f3" opacity=".16" d="M${n(hx + px * 5)} ${n(hy + py * 5)}L${n(hx + dx * 92)} ${n(hy + dy * 92)}L${n(hx - px * 5)} ${n(hy - py * 5)}Z"/>`;
    s += `<path class="f3" opacity=".22" d="M${n(hx + px * 2.4)} ${n(hy + py * 2.4)}L${n(hx + dx * 70)} ${n(hy + dy * 70)}L${n(hx - px * 2.4)} ${n(hy - py * 2.4)}Z"/>`;
    s += '<g class="drift">';
    for (let i = 0; i < 46; i++) {
      const t = r() ** 1.3, w = gauss(r) * (1.5 + t * 16);
      s += `<circle class="${r() < 0.25 ? 'f4' : 'f3'}" cx="${n(hx + dx * t * 88 + px * w)}" cy="${n(hy + dy * t * 88 + py * w)}" r="${n((1 - t) * 1.7 + 0.3 + r() * 0.4)}" opacity="${n(1 - t * 0.75)}" style="--d:${hd(r, o, 60)}"/>`;
    }
    s += '</g>' + shine(hx, hy, 9) + `<circle class="f4" cx="${n(hx)}" cy="${n(hy)}" r="2.6"/>`;
  } else {
    // 冲击波：一圈火花 + 光环
    const cx = 42 + r() * 16, cy = 42 + r() * 16, R = 22 + r() * 8;
    s += glow(cx, cy, 42) + `<g class="ripple" style="transform-origin:${n(cx)}px ${n(cy)}px">`;
    s += `<circle class="s3" cx="${n(cx)}" cy="${n(cy)}" r="${n(R)}" stroke-width="1.3" opacity=".7"/>`;
    s += `<circle class="s3" cx="${n(cx)}" cy="${n(cy)}" r="${n(R * 1.4)}" stroke-width=".5" opacity=".3"/>`;
    s += `<circle class="s3 dt" cx="${n(cx)}" cy="${n(cy)}" r="${n(R * 0.62)}" stroke-width=".45" opacity=".35" stroke-dasharray="1 2.2"/>`;
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * TAU + r() * 0.12, d = R + gauss(r) * 5;
      s += `<circle class="${r() < 0.25 ? 'f4' : 'f3'}" cx="${n(cx + Math.cos(a) * d)}" cy="${n(cy + Math.sin(a) * d)}" r="${n(r() < 0.12 ? 1.3 + r() : 0.35 + r() * 0.8)}" opacity="${n(0.45 + r() * 0.55)}" style="--d:${hd(r, o, 50)}"/>`;
    }
    s += '</g>' + shine(cx, cy, 12) + `<circle class="f4" cx="${n(cx)}" cy="${n(cy)}" r="2.4"/>`;
  }
  return s + sparkles(r, 3 + Math.floor(r() * 3));
}

function sound(r: Rand, o: Opt) {
  const ph = r() * 6;
  let s = '';
  if (r() < 0.55) {
    // 波形条
    const N = 23, w = 2.3, gap = (84 - N * w) / (N - 1);
    s += '<ellipse cx="50" cy="50" rx="50" ry="30" fill="url(#§g)"/><line class="s2 dt" x1="5" y1="50" x2="95" y2="50" stroke-width=".4" opacity=".5"/>';
    for (let i = 0; i < N; i++) {
      const env = Math.sin((Math.PI * (i + 0.5)) / N) ** 0.7;
      const h = 5 + env * (0.3 + 0.7 * Math.abs(Math.sin(i * 0.62 + ph))) * (0.65 + 0.35 * r()) * 58;
      s += `<rect class="f3 bar" x="${n(8 + i * (w + gap))}" y="${n(50 - h / 2)}" width="${w}" height="${n(h)}" rx="${w / 2}" style="--i:${i};--d:${o.rainbow ? n((i / N) * 320) : n((i / N - 0.5) * 50)}"/>`;
    }
  } else {
    // 喇叭 + 一圈放射条
    const N = 40, R = 17;
    s += glow(50, 50, 46);
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU - Math.PI / 2, l = 3 + (0.25 + 0.75 * Math.abs(Math.sin(i * 0.5 + ph)) * (0.6 + 0.4 * r())) * 19;
      s += `<line class="s3 ray" x1="${n(50 + Math.cos(a) * (R + 2))}" y1="${n(50 + Math.sin(a) * (R + 2))}" x2="${n(50 + Math.cos(a) * (R + 2 + l))}" y2="${n(50 + Math.sin(a) * (R + 2 + l))}" stroke-width="1.7" style="--i:${i};--d:${o.rainbow ? n((i / N) * 360) : hd(r, o, 30)}"/>`;
    }
    s += `<g class="cone"><circle class="f2" cx="50" cy="50" r="${R - 1}" opacity=".9"/><circle class="s3" cx="50" cy="50" r="${R - 4}" stroke-width=".8" opacity=".7"/><circle class="f3" cx="50" cy="50" r="5.5"/><circle class="f4" cx="48.4" cy="48.4" r="1.6" opacity=".8"/></g>`;
  }
  return s;
}

function note(x: number, y: number, sc: number, i: number, cls: string) {
  return `<g class="note" style="--i:${i}"><g transform="translate(${n(x)} ${n(y)}) scale(${n(sc)})"><ellipse class="${cls}" cx="0" cy="0" rx="2.7" ry="2" transform="rotate(-22)"/><rect class="${cls}" x="1.75" y="-11" width="1" height="11"/><path class="${cls}" d="M2.75 -11c3 1 4.5 3 3.3 6.2c-.2-2.3-1.4-3.4-3.3-3.6z"/></g></g>`;
}
function music(r: Rand) {
  const cx = 50, cy = 50, R = 32;
  let s = glow(cx, cy, 50) + `<g class="spin" style="transform-origin:${cx}px ${cy}px">`;
  s += `<circle class="vin" cx="${cx}" cy="${cy}" r="${R}"/>`;
  for (let k = 0; k < 6; k++) s += `<circle class="s2 dt" cx="${cx}" cy="${cy}" r="${n(R * (0.47 + k * 0.088))}" stroke-width=".3" opacity=".55"/>`;
  s += `<path class="s4" d="${arc(cx, cy, R * 0.8, -2.65, -1.85)}" stroke-width="2.2" opacity=".2"/>`;
  s += `<path class="s4" d="${arc(cx, cy, R * 0.8, 0.5, 1.2)}" stroke-width="1.6" opacity=".14"/>`;
  s += `<circle class="f3" cx="${cx}" cy="${cy}" r="${n(R * 0.34)}"/><circle class="s4" cx="${cx}" cy="${cy}" r="${n(R * 0.25)}" stroke-width=".4" opacity=".4"/>`;
  s += `<rect class="f4" x="${cx - 5}" y="${cy - 6.2}" width="10" height="1.6" rx=".8" opacity=".55"/><rect class="f4" x="${cx - 3.2}" y="${cy + 4}" width="6.4" height="1.3" rx=".65" opacity=".4"/>`;
  s += `<circle class="hole" cx="${cx}" cy="${cy}" r="1.4"/></g>`;
  const left = r() < 0.5;
  s += note(left ? 14 + r() * 6 : 78 + r() * 6, 30 + r() * 10, 1 + r() * 0.3, 0, 'f4');
  s += note(left ? 82 + r() * 4 : 14 + r() * 4, 72 + r() * 10, 0.8 + r() * 0.3, 1, 'f3');
  return s + sparkles(r, 2, 2);
}

function bullets(r: Rand) {
  // 一排斜立的子弹，弹头是主色，弹壳黄铜
  const k = 3 + Math.floor(r() * 3), tilt = -14 - r() * 10;
  let s = grid(10, 0.16) + glow(50, 50, 46);
  for (let i = 0; i < k; i++) {
    const x = 50 + (i - (k - 1) / 2) * 13.5, y = 50 + (i % 2 ? 3 : -1) + (r() - 0.5) * 2;
    s += `<g class="hop" style="--i:${i}"><g transform="translate(${n(x)} ${n(y)}) rotate(${n(tilt)})">`
      + '<ellipse class="hole" cx="0" cy="18.6" rx="5" ry="1.4" opacity=".35"/>'
      + '<path class="f3" d="M-3.5 -2C-3.5 -9 -1.6 -14 0 -16.5C1.6 -14 3.5 -9 3.5 -2Z"/>'
      + '<path class="f4" d="M-2.2 -3C-2.2 -8 -1.2 -11.5 0 -13.8C-.6 -10 -.9 -6 -.9 -3Z" opacity=".45"/>'
      + '<rect class="brass" x="-3.6" y="-2.2" width="7.2" height="18" rx=".8"/>'
      + '<rect class="brass" x="-4.1" y="14.6" width="8.2" height="2.6" rx=".6"/>'
      + '<rect class="hole" x="-3.6" y="13.2" width="7.2" height=".8" opacity=".35"/>'
      + '<rect class="f4" x="-2.4" y="0" width="1.1" height="12.5" rx=".55" opacity=".4"/>'
      + '</g></g>';
  }
  return s + sparkles(r, 2);
}

function weapon(r: Rand) {
  if (r() < 0.34) return bullets(r);
  const cx = 44 + r() * 12, cy = 44 + r() * 12, R = 24 + r() * 6;
  let s = grid(10, 0.18) + glow(cx, cy, 38);
  // 弹孔
  for (let i = 0, k = 2 + Math.floor(r() * 2); i < k; i++) {
    let x = 0, y = 0;
    do { x = 12 + r() * 76; y = 12 + r() * 76; } while (Math.hypot(x - cx, y - cy) < R + 6);
    s += `<circle class="s4" cx="${n(x)}" cy="${n(y)}" r="2.6" stroke-width=".5" opacity=".3"/><circle class="hole" cx="${n(x)}" cy="${n(y)}" r="1.5"/>`;
    for (let j = 0; j < 3; j++) { const a = r() * TAU, l = 3.5 + r() * 3; s += `<line class="s4 dt" x1="${n(x + Math.cos(a) * 2.6)}" y1="${n(y + Math.sin(a) * 2.6)}" x2="${n(x + Math.cos(a) * l)}" y2="${n(y + Math.sin(a) * l)}" stroke-width=".3" opacity=".35"/>`; }
  }
  s += '<g class="aim">';
  if (r() < 0.55) {
    // 狙击镜
    s += `<circle class="s3" cx="${n(cx)}" cy="${n(cy)}" r="${n(R)}" stroke-width="1.3"/><circle class="s3" cx="${n(cx)}" cy="${n(cy)}" r="${n(R * 0.55)}" stroke-width=".45" opacity=".55"/>`;
    for (let q = 0; q < 4; q++) {
      const a = (q * Math.PI) / 2, c = Math.cos(a), si = Math.sin(a);
      s += `<line class="s3" x1="${n(cx + c * R * 0.18)}" y1="${n(cy + si * R * 0.18)}" x2="${n(cx + c * R * 0.75)}" y2="${n(cy + si * R * 0.75)}" stroke-width=".5"/>`;
      s += `<line class="s3" x1="${n(cx + c * R * 0.75)}" y1="${n(cy + si * R * 0.75)}" x2="${n(cx + c * R * 1.3)}" y2="${n(cy + si * R * 1.3)}" stroke-width="1.6"/>`;
      for (let k = 2; k <= 4; k++) {
        const d = R * 0.15 * k;
        s += `<line class="s3 dt" x1="${n(cx + c * d - si * 1)}" y1="${n(cy + si * d - c * 1)}" x2="${n(cx + c * d + si * 1)}" y2="${n(cy + si * d + c * 1)}" stroke-width=".4"/>`;
      }
    }
  } else {
    // 全息瞄具
    s += `<circle class="s3" cx="${n(cx)}" cy="${n(cy)}" r="${n(R * 0.62)}" stroke-width="1.2"/><circle class="s3" cx="${n(cx)}" cy="${n(cy)}" r="${n(R * 1.12)}" stroke-width=".45" opacity=".4" stroke-dasharray="1.5 3"/>`;
    for (let q = 0; q < 4; q++) {
      const a = (q * Math.PI) / 2, c = Math.cos(a), si = Math.sin(a);
      s += `<line class="s3" x1="${n(cx + c * R * 0.62)}" y1="${n(cy + si * R * 0.62)}" x2="${n(cx + c * R * 0.86)}" y2="${n(cy + si * R * 0.86)}" stroke-width="1.2"/>`;
    }
    s += `<path class="s3" d="M${n(cx - 4)} ${n(cy + 6)}L${n(cx)} ${n(cy + 3)}L${n(cx + 4)} ${n(cy + 6)}" stroke-width=".7" opacity=".7"/>`;
  }
  return s + `<circle class="dot" cx="${n(cx)}" cy="${n(cy)}" r="1.6"/></g>`;
}

function bust(r: Rand) {
  // 人像剪影：头 + 肩，戴一条发光面罩，背后一圈光环
  const cx = 50 + (r() - 0.5) * 10, hy = 40 + r() * 5;
  let s = glow(cx, hy + 6, 50);
  s += `<g class="halo" style="transform-origin:${n(cx)}px ${n(hy)}px"><circle class="s3" cx="${n(cx)}" cy="${n(hy)}" r="22" stroke-width=".7" opacity=".5" stroke-dasharray="2.5 3.5"/><circle class="s3 dt" cx="${n(cx)}" cy="${n(hy)}" r="29" stroke-width=".35" opacity=".28"/></g>`;
  const t = hy + 21;
  const body = `M${n(cx - 31)} 104C${n(cx - 31)} ${n(t + 14)} ${n(cx - 22)} ${n(t + 2)} ${n(cx - 9)} ${n(t)}L${n(cx + 9)} ${n(t)}C${n(cx + 22)} ${n(t + 2)} ${n(cx + 31)} ${n(t + 14)} ${n(cx + 31)} 104Z`;
  s += `<rect class="f2" x="${n(cx - 5)}" y="${n(hy + 8)}" width="10" height="${n(t - hy - 6)}"/>`;
  s += `<path class="f2" d="${body}"/><path class="s3" d="${body}" stroke-width=".8" opacity=".55"/>`;
  s += `<circle class="f2" cx="${n(cx)}" cy="${n(hy)}" r="12.5"/><circle class="s3" cx="${n(cx)}" cy="${n(hy)}" r="12.5" stroke-width=".8" opacity=".6"/>`;
  s += `<g class="visor"><rect class="f3" x="${n(cx - 9.5)}" y="${n(hy - 1.8)}" width="19" height="3.8" rx="1.9"/>${shine(cx + 4, hy, 7)}</g>`;
  s += `<path class="s4" d="${arc(cx, hy, 10.5, -1.25, -0.35)}" stroke-width="1.1" opacity=".35"/>`;
  return s + sparkles(r, 3);
}

function survivor(r: Rand) {
  if (r() < 0.45) return bust(r);
  const y0 = 54 + r() * 8, beats = r() < 0.5 ? 2 : 3, L = 108 / beats;
  const cx = 46 + r() * 8;
  let s = grid(8, 0.2) + glow(50, y0 - 6, 46);
  s += `<g class="cross" style="transform-origin:${n(cx)}px 46px"><rect class="f2" x="${n(cx - 4.8)}" y="30" width="9.6" height="32" rx="2.4" opacity=".4"/><rect class="f2" x="${n(cx - 16)}" y="41.2" width="32" height="9.6" rx="2.4" opacity=".4"/></g>`;
  // 每段记下终点 x，亮线只取到 headX 为止
  const segs: [string, number][] = [];
  for (let b = 0; b < beats; b++) {
    const x = -4 + b * L, spike = 22 + r() * 9, X = (f: number) => n(x + L * f);
    const put = (f: number, cmd: string) => segs.push([cmd, x + L * f]);
    put(0.16, `L${X(0.16)} ${n(y0)}`);
    put(0.28, `Q${X(0.22)} ${n(y0 - 5)} ${X(0.28)} ${n(y0)}`);
    put(0.34, `L${X(0.34)} ${n(y0)}`);
    put(0.37, `L${X(0.37)} ${n(y0 + 3)}`);
    put(0.42, `L${X(0.42)} ${n(y0 - spike)}`);
    put(0.47, `L${X(0.47)} ${n(y0 + 9)}`);
    put(0.51, `L${X(0.51)} ${n(y0)}`);
    put(0.62, `L${X(0.62)} ${n(y0)}`);
    put(0.8, `Q${X(0.71)} ${n(y0 - 8)} ${X(0.8)} ${n(y0)}`);
    put(1, `L${X(1)} ${n(y0)}`);
  }
  const d = `M-4 ${n(y0)}` + segs.map((g) => g[0]).join('');
  // 亮线画到最后一拍的平段（像监护仪正在走的那一笔），后面留暗线
  const headX = -4 + (beats - 1) * L + L * 0.58;
  const lit = `M-4 ${n(y0)}` + segs.filter((g) => g[1] <= headX).map((g) => g[0]).join('') + `L${n(headX)} ${n(y0)}`;
  s += `<path class="s3" d="${d}" stroke-width="1" opacity=".22" stroke-linejoin="round"/>`;
  s += `<path class="s3" d="${lit}" stroke-width="4.2" opacity=".2" stroke-linejoin="round"/>`;
  s += `<path class="s3 ecg" d="${lit}" pathLength="100" stroke-width="1.5" stroke-linejoin="round"/>`;
  s += `<g class="beep">${shine(headX, y0, 7)}<circle class="f4" cx="${n(headX)}" cy="${n(y0)}" r="1.8"/></g>`;
  return s;
}

function infected(r: Rand, o: Opt) {
  let s = glow(50, 62, 50);
  const splat = (x: number, y: number, R: number, i: number) => {
    let g = `<g class="wob" style="--i:${i}"><circle class="f3" cx="${n(x)}" cy="${n(y)}" r="${n(R)}"/>`;
    for (let k = 0; k < 10; k++) {
      const a = r() * TAU, dd = R * (0.95 + r() * 0.75), rr = R * (0.12 + r() * 0.3);
      g += `<circle class="f3" cx="${n(x + Math.cos(a) * dd)}" cy="${n(y + Math.sin(a) * dd)}" r="${n(rr)}"/>`;
    }
    for (let k = 0; k < 6; k++) {
      const a = r() * TAU, dd = R * (1.8 + r() * 1.2);
      g += `<circle class="f3" cx="${n(x + Math.cos(a) * dd)}" cy="${n(y + Math.sin(a) * dd)}" r="${n(0.5 + r() * 1.1)}" opacity=".8"/>`;
    }
    return g + `<circle class="f4" cx="${n(x - R * 0.35)}" cy="${n(y - R * 0.35)}" r="${n(R * 0.28)}" opacity=".3"/></g>`;
  };
  if (r() < 0.55) {
    // 黏液：顶部滴落 + 一两滩
    let top = 'M0 0H100V5';
    for (let x = 100; x > 0; x -= 12.5) top += `Q${n(x - 6)} ${n(5 + r() * 5)} ${n(x - 12.5)} ${n(4 + r() * 3)}`;
    s += `<path class="f3" d="${top}Z" style="--d:${hd(r, o, 20)}"/>`;
    const k = 5 + Math.floor(r() * 3);
    for (let i = 0; i < k; i++) {
      const x = 8 + ((i + r() * 0.7) / k) * 84, w = 1.4 + r() * 2.4, len = 10 + r() * 32;
      s += `<path class="f3 drip" style="--i:${i}" d="M${n(x - w)} 0V${n(len)}a${n(w)} ${n(w)} 0 0 0 ${n(w * 2)} 0V0Z"/>`;
      s += `<circle class="f4" cx="${n(x - w * 0.35)}" cy="${n(len - 1)}" r="${n(w * 0.32)}" opacity=".45"/>`;
      if (r() < 0.5) s += `<circle class="f3 drop" style="--i:${i}" cx="${n(x)}" cy="${n(len + w + 3 + r() * 6)}" r="${n(w * 0.75)}"/>`;
    }
    s += splat(28 + r() * 44, 64 + r() * 14, 8 + r() * 5, 0);
  } else {
    // 抓痕：三道斜爪印
    const a = Math.PI * (0.3 + r() * 0.12), dx = Math.cos(a), dy = Math.sin(a), px = -dy, py = dx;
    const cx = 50 + r() * 8 - 4, cy = 50 + r() * 8 - 4;
    s += splat(cx + px * 22 + dx * 18, cy + py * 22 + dy * 18, 4 + r() * 3, 1);
    for (let i = -1; i <= 1; i++) {
      const ox = cx + px * i * 10, oy = cy + py * i * 10, l = 34 - Math.abs(i) * 6 + r() * 6, w = 3.2 - Math.abs(i) * 0.6;
      const x0 = ox - dx * l, y0 = oy - dy * l, x1 = ox + dx * l, y1 = oy + dy * l;
      s += `<g class="slash" style="--i:${i + 1}"><path class="f3" d="M${n(x0)} ${n(y0)}Q${n(ox + px * w * 2)} ${n(oy + py * w * 2)} ${n(x1)} ${n(y1)}Q${n(ox - px * w * 2)} ${n(oy - py * w * 2)} ${n(x0)} ${n(y0)}Z"/>`;
      s += `<path class="hole" opacity=".55" d="M${n(x0 + dx * 6)} ${n(y0 + dy * 6)}Q${n(ox + px * w * 0.7)} ${n(oy + py * w * 0.7)} ${n(x1 - dx * 6)} ${n(y1 - dy * 6)}Q${n(ox - px * w * 0.7)} ${n(oy - py * w * 0.7)} ${n(x0 + dx * 6)} ${n(y0 + dy * 6)}Z"/></g>`;
    }
  }
  return s;
}

function map(r: Rand) {
  let s = '';
  const peaks = r() < 0.6 ? 1 : 2;
  const P: [number, number][] = [];
  for (let p = 0; p < peaks; p++) {
    const px = peaks === 1 ? 38 + r() * 24 : p === 0 ? 30 + r() * 12 : 62 + r() * 12;
    const py = peaks === 1 ? 40 + r() * 20 : p === 0 ? 34 + r() * 14 : 56 + r() * 14;
    P.push([px, py]);
    const a1 = 0.08 + r() * 0.1, a2 = 0.05 + r() * 0.08, p1 = r() * TAU, p2 = r() * TAU, rings = peaks === 1 ? 8 : 5;
    for (let k = rings; k >= 1; k--) {
      const base = k * (peaks === 1 ? 6.2 : 6.8) + r() * 1.5;
      let d = '';
      for (let i = 0; i <= 40; i++) {
        const t = (i / 40) * TAU, rad = base * (1 + a1 * Math.sin(2 * t + p1) + a2 * Math.sin(3 * t + p2));
        d += `${i ? 'L' : 'M'}${n(px + Math.cos(t) * rad)} ${n(py + Math.sin(t) * rad * 0.82)}`;
      }
      const idx = k % 3 === 0;
      s += `<path class="f3" d="${d}Z" opacity=".07"/><path class="${idx ? 's3' : 's2'}" d="${d}Z" stroke-width="${idx ? 0.75 : 0.45}" opacity="${idx ? 0.7 : 0.6}"/>`;
    }
  }
  const [x, y] = P[0];
  s += `<path class="s4 route" d="M6 ${n(90 + r() * 6)}Q${n(10 + r() * 30)} ${n(40 + r() * 30)} ${n(x)} ${n(y)}" stroke-width=".9" stroke-dasharray="2.2 2" opacity=".75"/>`;
  s += `<ellipse class="hole" cx="${n(x)}" cy="${n(y)}" rx="2.6" ry="1" opacity=".4"/><circle class="s3 rip" cx="${n(x)}" cy="${n(y)}" r="3.2" stroke-width=".7" opacity=".55"/>`;
  s += `<g class="pin"><path class="f3" d="M${n(x)} ${n(y)}C${n(x - 1.5)} ${n(y - 3)} ${n(x - 4.4)} ${n(y - 4.8)} ${n(x - 4.4)} ${n(y - 7.8)}a4.4 4.4 0 1 1 8.8 0c0 3-2.9 4.8-4.4 7.8z"/><circle class="f4" cx="${n(x)}" cy="${n(y - 7.8)}" r="1.7"/></g>`;
  return s;
}

function ui(r: Rand) {
  let s = glow(50, 48, 44);
  s += '<g class="s3" stroke-width="1.1" opacity=".8"><path d="M11 21V11H21"/><path d="M79 11H89V21"/><path d="M89 79V89H79"/><path d="M21 89H11V79"/></g>';
  // 顶部罗盘刻度
  s += '<g class="s2 dt" stroke-width=".45" opacity=".8">';
  for (let x = 34; x <= 66; x += 4) s += `<line x1="${x}" y1="${x % 8 === 2 ? 13 : 14.5}" x2="${x}" y2="17"/>`;
  s += '</g><path class="f3" d="M48.6 19.6L50 17.8L51.4 19.6Z"/>';
  s += '<g class="xh" style="transform-origin:50px 48px"><g class="s4" stroke-width="1"><line x1="50" y1="40.5" x2="50" y2="44.5"/><line x1="50" y1="51.5" x2="50" y2="55.5"/><line x1="42.5" y1="48" x2="46.5" y2="48"/><line x1="53.5" y1="48" x2="57.5" y2="48"/></g></g><circle class="f4" cx="50" cy="48" r=".8"/>';
  const p = 0.45 + r() * 0.5;
  s += '<rect class="f3" x="13.2" y="77.6" width="5.6" height="1.8" rx=".5"/><rect class="f3" x="15.1" y="75.7" width="1.8" height="5.6" rx=".5"/>';
  s += `<rect class="f2" x="22" y="76.3" width="40" height="4.4" rx="2.2" opacity=".6"/><rect class="f3 fill" x="22" y="76.3" width="${n(40 * p)}" height="4.4" rx="2.2"/>`;
  const spent = Math.floor(r() * 4);
  for (let i = 0; i < 7; i++) s += `<rect class="${i < 7 - spent ? 'f3' : 'f2'}" x="${n(66 + i * 3.2)}" y="74.5" width="1.8" height="7" rx=".9" opacity="${i < 7 - spent ? 0.9 : 0.5}"/>`;
  s += '<rect class="f4" x="16" y="25" width="18" height="2" rx="1" opacity=".5"/><rect class="f2" x="16" y="29" width="11" height="1.6" rx=".8" opacity=".8"/>';
  return s;
}

function script(r: Rand, o: Opt) {
  let s = glow(30, 28, 56);
  s += '<rect class="f1 s2" x="12" y="14" width="76" height="72" rx="6" stroke-width=".4" opacity=".92"/>';
  s += '<circle class="tl1" cx="18.5" cy="20.5" r="1.3"/><circle class="tl2" cx="23" cy="20.5" r="1.3"/><circle class="tl3" cx="27.5" cy="20.5" r="1.3"/>';
  s += '<line class="s2 dt" x1="12" y1="25" x2="88" y2="25" stroke-width=".3" opacity=".6"/>';
  const syn = [0, 70, 150, 220, 300];
  let ind = 0, endX = 17, endY = 31;
  const lines = 8;
  for (let l = 0; l < lines; l++) {
    const y = 30 + l * 6.4;
    ind = Math.max(0, Math.min(3, ind + [-1, 0, 0, 1][Math.floor(r() * 4)]));
    let x = 17 + ind * 4.5;
    const last = l === lines - 1;
    let row = '';
    for (let t = 0, k = 1 + Math.floor(r() * 3); t < k && x < 74; t++) {
      const w = Math.min(4 + r() * 13, 80 - x);
      const plain = r() < 0.3;
      row += `<rect class="${plain ? 'f4' : 'f3'}" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="2.4" rx="1.2" opacity="${plain ? 0.45 : 0.85}" style="--d:${o.rainbow ? n(r() * 360) : syn[Math.floor(r() * syn.length)]}"/>`;
      x += w + 2;
    }
    s += last ? `<g class="type">${row}</g>` : row;
    endX = x; endY = y;
  }
  return s + `<rect class="f4 cur" x="${n(endX - 1)}" y="${n(endY - 1)}" width="1.1" height="4.4"/>`;
}

function texture(r: Rand, o: Opt) {
  let s = '';
  if (r() < 0.5) {
    // 三角马赛克，左上受光
    const N = 6, c = 100 / N;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const x0 = x * c, y0 = y * c, x1 = x0 + c, y1 = y0 + c, flip = r() < 0.5;
      const tri = flip ? [[x0, y0, x1, y0, x0, y1], [x1, y0, x1, y1, x0, y1]] : [[x0, y0, x1, y0, x1, y1], [x0, y0, x1, y1, x0, y1]];
      for (const t of tri) {
        const lightness = 1 - (x + y) / (2 * N) + (r() - 0.5) * 0.5;
        s += `<path class="${lightness > 0.55 ? 'f3' : 'f2'}" d="M${n(t[0])} ${n(t[1])}L${n(t[2])} ${n(t[3])}L${n(t[4])} ${n(t[5])}Z" opacity="${n(0.2 + Math.max(0, Math.min(1, lightness)) * 0.6)}" style="--d:${hd(r, o, 26)}"/>`;
      }
    }
  } else {
    // 色卡格子
    s += glow(40, 36, 60);
    const N = 5, gap = 2.6, c = (84 - gap * (N - 1)) / N;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const v = 1 - (x + y) / (2 * N) + (r() - 0.5) * 0.4;
      s += `<rect class="${v > 0.5 ? 'f3' : 'f2'}" x="${n(8 + x * (c + gap))}" y="${n(8 + y * (c + gap))}" width="${n(c)}" height="${n(c)}" rx="2.4" opacity="${n(0.3 + Math.max(0, Math.min(1, v)) * 0.65)}" style="--d:${hd(r, o, 60)}"/>`;
    }
  }
  return s + '<g class="sheen"><rect class="f4" x="14" y="-30" width="16" height="160" opacity=".13" transform="rotate(24 50 50)"/><rect class="f4" x="33" y="-30" width="5" height="160" opacity=".1" transform="rotate(24 50 50)"/></g>';
}

function model(r: Rand) {
  const cx = 50, cy = 45, R = 25 + r() * 3, rot = (r() - 0.5) * 0.3;
  const P = Array.from({ length: 6 }, (_, i) => { const a = -Math.PI / 2 + (i * TAU) / 6 + rot, k = 0.92 + r() * 0.14; return [cx + Math.cos(a) * R * k, cy + Math.sin(a) * R * k * 1.08]; });
  const Q = Array.from({ length: 6 }, (_, i) => { const a = -Math.PI / 2 + ((i + 0.5) * TAU) / 6 + rot; return [cx - 2 + Math.cos(a) * R * 0.42, cy - 4 + Math.sin(a) * R * 0.38]; });
  const light = -2.3;
  const face = (pts: number[][]) => {
    const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length - cx, my = pts.reduce((a, p) => a + p[1], 0) / pts.length - cy;
    const b = 0.5 + 0.5 * Math.cos(Math.atan2(my, mx) - light) * Math.min(1, Math.hypot(mx, my) / 12);
    const d = 'M' + pts.map((p) => `${n(p[0])} ${n(p[1])}`).join('L') + 'Z';
    return b > 0.5 ? `<path class="f4" d="${d}" opacity="${n((b - 0.5) * 1.1)}"/>` : `<path class="hole" d="${d}" opacity="${n((0.5 - b) * 0.9)}"/>`;
  };
  let s = glow(cx, cy, 46) + `<ellipse class="hole shadow" cx="${cx}" cy="${n(cy + R + 12)}" rx="${n(R * 0.7)}" ry="2.8" opacity=".4"/>`;
  s += '<g class="float">' + `<path class="f3" d="M${P.map((p) => `${n(p[0])} ${n(p[1])}`).join('L')}Z"/>`;
  for (let i = 0; i < 6; i++) { const j = (i + 1) % 6; s += face([P[i], P[j], Q[i]]) + face([Q[i], P[j], Q[j]]); }
  s += `<path class="f4" d="M${Q.map((p) => `${n(p[0])} ${n(p[1])}`).join('L')}Z" opacity=".22"/>`;
  s += `<path class="s4 dt" d="M${P.map((p) => `${n(p[0])} ${n(p[1])}`).join('L')}Z" stroke-width=".35" opacity=".45" stroke-linejoin="round"/></g>`;
  return s + sparkles(r, 2);
}

function misc(r: Rand, o: Opt) {
  let s = glow(50, 50, 46);
  // 中间一个小包裹
  s += '<g class="pkg" style="transform-origin:50px 50px"><path class="f2" d="M50 38L61 44V57L50 63L39 57V44Z" opacity=".9"/><path class="f4" d="M50 38L61 44L50 50L39 44Z" opacity=".3"/><path class="s3" d="M50 38L61 44V57L50 63L39 57V44ZM39 44L50 50L61 44M50 50V63" stroke-width="1.1" stroke-linejoin="round"/></g>';
  for (let i = 0; i < 16; i++) {
    let x = 0, y = 0;
    do { x = 8 + r() * 84; y = 8 + r() * 84; } while (Math.hypot(x - 50, y - 50) < 19);
    const kind = Math.floor(r() * 5), sz = 1.6 + r() * 2.2, d = hd(r, o, 140);
    const shape = kind === 0 ? `<circle class="f3" r="${n(sz)}"/>`
      : kind === 1 ? `<circle class="s3" r="${n(sz + 0.6)}" stroke-width="1"/>`
      : kind === 2 ? `<path class="f3" d="M0 ${n(-sz * 1.2)}L${n(sz * 1.1)} ${n(sz * 0.8)}L${n(-sz * 1.1)} ${n(sz * 0.8)}Z"/>`
      : kind === 3 ? `<path class="s3" d="M${n(-sz * 2)} 0q${n(sz / 2)} ${n(-sz)} ${n(sz)} 0t${n(sz)} 0t${n(sz)} 0t${n(sz)} 0" stroke-width="1"/>`
      : `<path class="s3" d="M${n(-sz)} 0H${n(sz)}M0 ${n(-sz)}V${n(sz)}" stroke-width="1.1"/>`;
    s += `<g class="cf" style="--i:${i};--d:${d}"><g transform="translate(${n(x)} ${n(y)}) rotate(${Math.floor(r() * 360)})">${shape}</g></g>`;
  }
  return s;
}

const DRAW: Record<ArtKind, (r: Rand, o: Opt) => string> = { particle, sound, music, weapon, survivor, infected, map, ui, script, texture, model, misc };

// ---------- 入口 ----------
const cache = new Map<string, ModArt>();
const CACHE_MAX = 800;

export function modArt(mod: Pick<Mod, 'id' | 'title' | 'dirs'>): ModArt {
  const key = `${mod.id}\u0000${mod.title}\u0000${(mod.dirs ?? []).join('|')}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const seed = hash(mod.id || mod.title);
  const kind = artKind(mod);
  const word = HUES.find(([re]) => re.test(mod.title))?.[1];
  const base = PALETTE[seed % PALETTE.length] + ((seed >>> 8) % 13) - 6;
  const hue = word === undefined || word < 0 ? base : word;
  const sat = word === -2 || word === -3 ? 0.14 : 1;
  const svg = '<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">'
    + DEFS + DRAW[kind](rng(seed), { rainbow: word === -1 }) + VIGNETTE + '</svg>';
  const art = { kind, hue, sat, svg };
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, art);
  return art;
}

let uid = 0;
/** 每个缩略图实例一个，替换 SVG 里渐变 id 的 § */
export const artUid = () => `ma${(uid++).toString(36)}`;
