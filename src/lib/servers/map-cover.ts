// 服务器地图横幅按战役 ID 生成矢量剪影；三方地图按代码选取配色和场景。

type Scene = 'city' | 'carnival' | 'swamp' | 'mill' | 'forest' | 'peaks' | 'coast' | 'port' | 'airfield';
interface Look { sky: [string, string]; scene: Scene; orb: string; rain?: boolean; snow?: boolean }

const OFFICIAL: Record<string, Look> = {
  c1: { sky: ['#2a1426', '#e2733b'], scene: 'city', orb: '#ffb15c' },
  c2: { sky: ['#191338', '#7a4bb0'], scene: 'carnival', orb: '#ffd36e' },
  c3: { sky: ['#14231d', '#5f8150'], scene: 'swamp', orb: '#e9f0b8' },
  c4: { sky: ['#151d28', '#56697b'], scene: 'mill', orb: '#cfd9e3', rain: true },
  c5: { sky: ['#152338', '#d58a5c'], scene: 'city', orb: '#ffcf8a' },
  c6: { sky: ['#2a1d17', '#e2a65a'], scene: 'forest', orb: '#ffe2a0' },
  c7: { sky: ['#0e1a2c', '#3d5a80'], scene: 'port', orb: '#dfe8f5' },
  c8: { sky: ['#0b0f1f', '#5c2a3c'], scene: 'city', orb: '#ff8c8c' },
  c9: { sky: ['#0d191e', '#2f5d62'], scene: 'peaks', orb: '#d8f0ea' },
  c10: { sky: ['#141924', '#7a6f8a'], scene: 'forest', orb: '#efe3ff' },
  c11: { sky: ['#0a1223', '#2b4c7e'], scene: 'airfield', orb: '#cfe0ff' },
  c12: { sky: ['#291613', '#b2563a'], scene: 'forest', orb: '#ffb08a' },
  c13: { sky: ['#0f232b', '#82b6c2'], scene: 'peaks', orb: '#f4fbff', snow: true },
  c14: { sky: ['#1b2040', '#e5916c'], scene: 'coast', orb: '#ffd2a8' },
};
const SCENES: Scene[] = ['city', 'forest', 'peaks', 'coast', 'swamp', 'port', 'airfield', 'mill'];
const SKIES: [string, string, string][] = [
  ['#1a1830', '#6d5aa8', '#ffe0a0'], ['#10202a', '#3f7f86', '#e8fff6'], ['#24161c', '#c0605a', '#ffc79a'],
  ['#0f1626', '#476a9c', '#e6eeff'], ['#1c2418', '#7c9a58', '#f6f3c2'], ['#211a2e', '#a0618c', '#ffd6ec'],
];

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 320, H = 180, GROUND = 150;
const f = (n: number) => Math.round(n * 10) / 10;

/** 起伏的远山 / 近丘：从左到右随机高度，二次曲线连起来 */
function ridge(r: () => number, base: number, amp: number, step: number, jag = false) {
  let d = `M0 ${H} L0 ${f(base - r() * amp)}`;
  for (let x = step; x <= W + step; x += step) {
    const y = base - r() * amp;
    d += jag ? ` L${f(x - step / 2)} ${f(y - amp * 0.5 * r())} L${f(x)} ${f(y)}` : ` Q${f(x - step / 2)} ${f(base - r() * amp * 1.2)} ${f(x)} ${f(y)}`;
  }
  return `${d} L${W} ${H} Z`;
}

function scene(kind: Scene, r: () => number, orb: string) {
  const dark = '#0a0c11';
  let s = '';
  const lit = (x: number, y: number) => (r() < 0.32 ? `<rect x="${f(x)}" y="${f(y)}" width="2.2" height="2.6" fill="${orb}" opacity=".8"/>` : '');
  switch (kind) {
    case 'city': {
      for (let x = -6; x < W; ) {
        const w = 14 + r() * 22, h = 30 + r() * (x > 90 && x < 200 ? 80 : 55);
        s += `<rect x="${f(x)}" y="${f(GROUND - h)}" width="${f(w)}" height="${f(h + 30)}" fill="${dark}"/>`;
        for (let wy = GROUND - h + 6; wy < GROUND - 6; wy += 7) for (let wx = x + 3; wx < x + w - 4; wx += 5) s += lit(wx, wy);
        x += w + r() * 3;
      }
      break;
    }
    case 'carnival': {
      const cx = 228, cy = 92, R = 46;
      s += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${dark}" stroke-width="3"/>`;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2, x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
        s += `<line x1="${cx}" y1="${cy}" x2="${f(x)}" y2="${f(y)}" stroke="${dark}" stroke-width="1.2"/><rect x="${f(x - 3)}" y="${f(y)}" width="6" height="5" rx="1" fill="${dark}"/>`;
        if (r() < 0.5) s += `<circle cx="${f(x)}" cy="${f(y)}" r="1.4" fill="${orb}"/>`;
      }
      s += `<path d="M${cx - 30} ${GROUND} L${cx} ${cy} L${cx + 30} ${GROUND}" fill="none" stroke="${dark}" stroke-width="3"/>`;
      let d = 'M0 128';
      for (let x = 0; x <= 170; x += 10) d += ` L${x} ${f(112 + Math.sin(x / 22) * 18)}`;
      s += `<path d="${d}" fill="none" stroke="${dark}" stroke-width="3"/>`;
      for (let x = 10; x <= 170; x += 20) s += `<line x1="${x}" y1="${f(112 + Math.sin(x / 22) * 18)}" x2="${x}" y2="${GROUND}" stroke="${dark}" stroke-width="1.5"/>`;
      s += `<rect x="0" y="${GROUND - 4}" width="${W}" height="40" fill="${dark}"/>`;
      break;
    }
    case 'swamp': {
      s += `<path d="${ridge(r, GROUND - 4, 10, 40)}" fill="${dark}"/>`;
      for (let i = 0; i < 9; i++) {
        const x = 10 + r() * 300, h = 40 + r() * 60, y = GROUND - 2;
        s += `<path d="M${f(x)} ${y} L${f(x + 1)} ${f(y - h)} M${f(x + 1)} ${f(y - h * 0.6)} L${f(x + 12 * (r() - 0.3))} ${f(y - h * 0.8)} M${f(x)} ${f(y - h * 0.4)} L${f(x - 10 * r())} ${f(y - h * 0.55)}" stroke="${dark}" stroke-width="${f(2 + r() * 2)}" fill="none" stroke-linecap="round"/>`;
      }
      s += `<rect x="0" y="${GROUND + 6}" width="${W}" height="30" fill="${dark}" opacity=".85"/>`;
      for (let i = 0; i < 6; i++) s += `<rect x="${f(r() * 280)}" y="${f(GROUND + 10 + r() * 16)}" width="${f(20 + r() * 40)}" height="1" fill="${orb}" opacity=".25"/>`;
      break;
    }
    case 'mill': {
      for (let i = 0; i < 4; i++) {
        const x = 30 + i * 26, h = 62 + r() * 22;
        s += `<rect x="${x}" y="${f(GROUND - h)}" width="22" height="${f(h + 30)}" rx="10" fill="${dark}"/>`;
      }
      s += `<rect x="140" y="${GROUND - 48}" width="90" height="80" fill="${dark}"/><rect x="200" y="${GROUND - 90}" width="10" height="50" fill="${dark}"/>`;
      s += `<path d="${ridge(r, GROUND, 8, 30)}" fill="${dark}"/>`;
      break;
    }
    case 'forest': {
      s += `<path d="${ridge(r, GROUND - 6, 14, 40)}" fill="${dark}"/>`;
      for (let i = 0; i < 26; i++) {
        const x = r() * W, h = 26 + r() * 52, w = h * 0.36, y = GROUND + 2;
        s += `<path d="M${f(x)} ${f(y - h)} L${f(x + w)} ${y} L${f(x - w)} ${y} Z" fill="${dark}"/>`;
      }
      if (r() < 0.6) {
        const x = 200 + r() * 70;
        s += `<rect x="${f(x)}" y="${GROUND - 34}" width="30" height="40" fill="${dark}"/><path d="M${f(x - 4)} ${GROUND - 34} L${f(x + 15)} ${GROUND - 52} L${f(x + 34)} ${GROUND - 34} Z" fill="${dark}"/><rect x="${f(x + 12)}" y="${GROUND - 24}" width="5" height="6" fill="${orb}" opacity=".85"/>`;
      }
      break;
    }
    case 'peaks': {
      s += `<path d="${ridge(r, GROUND - 22, 50, 46, true)}" fill="${dark}" opacity=".8"/>`;
      s += `<path d="${ridge(r, GROUND, 22, 34)}" fill="${dark}"/>`;
      for (let i = 0; i < 14; i++) {
        const x = r() * W, h = 18 + r() * 26, w = h * 0.34;
        s += `<path d="M${f(x)} ${f(GROUND + 4 - h)} L${f(x + w)} ${GROUND + 6} L${f(x - w)} ${GROUND + 6} Z" fill="${dark}"/>`;
      }
      break;
    }
    case 'coast': {
      s += `<rect x="0" y="${GROUND - 14}" width="${W}" height="60" fill="${dark}" opacity=".55"/>`;
      for (let i = 0; i < 7; i++) s += `<rect x="${f(150 + (r() - 0.5) * 80)}" y="${f(GROUND - 10 + i * 4)}" width="${f(30 + r() * 40)}" height="1.2" fill="${orb}" opacity=".45"/>`;
      s += `<path d="M0 ${GROUND - 26} Q60 ${GROUND - 40} 110 ${GROUND - 20} L120 ${H} L0 ${H} Z" fill="${dark}"/>`;
      s += `<path d="M60 ${GROUND - 34} L64 ${GROUND - 92} L74 ${GROUND - 92} L78 ${GROUND - 34} Z" fill="${dark}"/><rect x="61" y="${GROUND - 104}" width="16" height="12" fill="${dark}"/><path d="M77 ${GROUND - 98} L170 ${GROUND - 112} L170 ${GROUND - 84} Z" fill="${orb}" opacity=".22"/><circle cx="69" cy="${GROUND - 98}" r="3" fill="${orb}"/>`;
      break;
    }
    case 'port': {
      s += `<rect x="0" y="${GROUND - 6}" width="${W}" height="60" fill="${dark}" opacity=".6"/>`;
      for (let i = 0; i < 3; i++) {
        const x = 150 + i * 52, h = 74 + r() * 20;
        s += `<path d="M${x} ${GROUND} L${x + 4} ${f(GROUND - h)} L${x + 8} ${GROUND} M${x + 4} ${f(GROUND - h)} L${x - 26} ${f(GROUND - h + 8)} M${x + 4} ${f(GROUND - h)} L${x + 38} ${f(GROUND - h + 4)}" stroke="${dark}" stroke-width="3" fill="none"/>`;
      }
      for (let x = 0; x < 140; x += 18) {
        const rows = 1 + Math.floor(r() * 3);
        for (let k = 0; k < rows; k++) s += `<rect x="${x}" y="${GROUND - 8 - k * 9}" width="16" height="8" fill="${dark}"/>`;
      }
      break;
    }
    case 'airfield': {
      s += `<path d="${ridge(r, GROUND - 2, 10, 50)}" fill="${dark}"/>`;
      s += `<rect x="20" y="${GROUND - 26}" width="70" height="30" fill="${dark}"/><path d="M20 ${GROUND - 26} Q55 ${GROUND - 48} 90 ${GROUND - 26} Z" fill="${dark}"/><rect x="230" y="${GROUND - 62}" width="8" height="64" fill="${dark}"/><rect x="222" y="${GROUND - 70}" width="24" height="10" fill="${dark}"/>`;
      s += `<path d="M140 ${GROUND - 40} L210 ${GROUND - 44} L216 ${GROUND - 40} L210 ${GROUND - 36} Z M168 ${GROUND - 42} L182 ${GROUND - 58} L188 ${GROUND - 58} L182 ${GROUND - 41} Z" fill="${dark}"/>`;
      for (let x = 6; x < W; x += 14) s += `<circle cx="${x}" cy="${GROUND + 8}" r="1.3" fill="${orb}" opacity=".9"/>`;
      break;
    }
  }
  return s;
}

const cache = new Map<string, string>();

/** 按战役 id 画封面，返回 data: 地址，可以直接当 img src */
export function coverArt(id: string): string {
  const hit = cache.get(id);
  if (hit) return hit;
  const h = hash(id), r = rng(h);
  const sky = SKIES[h % SKIES.length];
  const look: Look = OFFICIAL[id] ?? { sky: [sky[0], sky[1]], orb: sky[2], scene: SCENES[(h >>> 4) % SCENES.length] };
  const ox = f(60 + r() * 200), oy = f(34 + r() * 36), or = f(12 + r() * 10);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">`
    + `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${look.sky[0]}"/><stop offset="1" stop-color="${look.sky[1]}"/></linearGradient>`
    + `<radialGradient id="g"><stop offset="0" stop-color="${look.orb}" stop-opacity=".55"/><stop offset="1" stop-color="${look.orb}" stop-opacity="0"/></radialGradient>`
    + `<linearGradient id="m" x1="0" y1="0" x2="0" y2="1"><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".1"/></linearGradient></defs>`
    + `<rect width="${W}" height="${H}" fill="url(#s)"/>`
    + `<circle cx="${ox}" cy="${oy}" r="${f(or * 4)}" fill="url(#g)"/><circle cx="${ox}" cy="${oy}" r="${or}" fill="${look.orb}" opacity=".92"/>`;
  for (let i = 0; i < 18; i++) svg += `<circle cx="${f(r() * W)}" cy="${f(r() * 70)}" r="${f(0.4 + r() * 0.7)}" fill="#fff" opacity="${f(0.2 + r() * 0.5)}"/>`;
  svg += `<path d="${ridge(r, 118, 34, 52)}" fill="${look.sky[1]}" opacity=".45"/><path d="${ridge(r, 128, 26, 40)}" fill="#0a0c11" opacity=".35"/>`;
  svg += `<rect width="${W}" height="${H}" fill="url(#m)"/>`;
  svg += scene(look.scene, r, look.orb);
  svg += `<rect x="0" y="${GROUND + 4}" width="${W}" height="${H - GROUND}" fill="#07090c"/>`;
  if (look.rain) for (let i = 0; i < 60; i++) { const x = r() * (W + 40), y = r() * H; svg += `<line x1="${f(x)}" y1="${f(y)}" x2="${f(x - 6)}" y2="${f(y + 16)}" stroke="#dfe8f2" stroke-width=".6" opacity=".35"/>`; }
  if (look.snow) for (let i = 0; i < 50; i++) svg += `<circle cx="${f(r() * W)}" cy="${f(r() * H)}" r="${f(0.5 + r())}" fill="#fff" opacity=".6"/>`;
  svg += '</svg>';
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  cache.set(id, url);
  return url;
}
