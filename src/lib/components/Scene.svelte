<script lang="ts">
  // 末日主视觉（全部程序化绘制，不用任何游戏原图）：
  // 断顶废楼 + 塔吊 + 断裂高架与弃车 + 电线杆 / 楼后火光与三根烟柱 / 带探照灯的巡逻直升机 / 盘旋鸦群 / 飘灰火星 / 偶发闪电 / 颗粒暗角调色。
  // 「发射」= 一颗降落伞信号弹：拖尾升空 → 点燃闪光 → 挂伞缓降、洒火花、拖红色烟柱、照亮楼顶轮廓，直升机探照灯会转过来。
  // 静态几何在 resize 时预渲染进离屏画布，每帧只做贴图和少量动态元素。
  import { onMount } from 'svelte';
  import { reduceMotion } from '../motion';

  let { strike = 0 }: { strike?: number } = $props();

  let canvas: HTMLCanvasElement;
  let triggerLightning: (big?: boolean) => void = () => {};
  let triggerFlare: () => void = () => {};

  $effect(() => {
    if (strike > 0) triggerFlare();
  });

  onMount(() => {
    const ctx = canvas.getContext('2d')!;
    const reduce = reduceMotion();
    let W = 0, H = 0, dpr = 1;
    const PAD = 0.12; // 视差余量（占宽度比例）

    let seed = 4417;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const rr = (a: number, b: number) => a + rnd() * (b - a);
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    const smooth = (v: number) => { const x = clamp01(v); return x * x * (3 - 2 * x); };

    // ================= 几何（归一化） =================
    type Win = { x: number; y: number; kind: 'fire' | 'cold'; ph: number };
    type Bld = { x: number; w: number; h: number; top: number[]; holes: { x: number; y: number; w: number; h: number }[]; girder: boolean; wins: Win[] };
    type Layer = { depth: number; color: string; base: number; blds: Bld[]; img?: HTMLCanvasElement; extra?: (g: CanvasRenderingContext2D) => void };

    function genLayer(depth: number, color: string, base: number, minH: number, maxH: number, minW: number, maxW: number, brokenRate: number, winRate: number): Layer {
      const blds: Bld[] = [];
      let x = -PAD;
      while (x < 1 + PAD) {
        const w = rr(minW, maxW);
        const h = rr(minH, maxH);
        const broken = rnd() < brokenRate;
        const k = broken ? 3 + Math.floor(rnd() * 4) : 1;
        const top = Array.from({ length: k + 1 }, (_, i) => (broken ? (i === 0 || rnd() < 0.3 ? rr(0.85, 1) : rr(0.45, 0.95)) : 1));
        const holes = broken ? Array.from({ length: Math.floor(rr(0, 4)) }, () => ({ x: rr(0.1, 0.7), y: rr(0.15, 0.6), w: rr(0.08, 0.25), h: rr(0.03, 0.08) })) : [];
        const wins: Win[] = [];
        if (winRate > 0) {
          for (let wy = 0.2; wy < 0.92; wy += 0.1) for (let wx = 0.15; wx < 0.85; wx += 0.22) {
            if (rnd() < winRate) wins.push({ x: wx, y: wy, kind: rnd() < 0.82 ? 'fire' : 'cold', ph: rnd() * 100 });
          }
        }
        blds.push({ x, w, h, top, holes, girder: broken && rnd() < 0.45, wins });
        x += w + (rnd() < 0.25 ? rr(0.004, 0.02) : 0);
      }
      return { depth, color, base, blds };
    }

    const far = genLayer(0.12, '#141211', 0.64, 0.05, 0.2, 0.025, 0.06, 0.45, 0);
    const mid = genLayer(0.4, '#0e0c0b', 0.73, 0.08, 0.33, 0.04, 0.09, 0.6, 0.06);
    const overpass: Layer = { depth: 0.7, color: '#0a0909', base: 0.9, blds: [] };
    const near: Layer = { depth: 1, color: '#060606', base: 0.9, blds: [] };

    // 塔吊
    const crane = { x: 0.33, h: 0.42, jibL: 0.16, jibR: 0.05 };
    mid.extra = (g) => {
      const bx = crane.x * W, by = mid.base * H, top = by - crane.h * H;
      g.strokeStyle = mid.color;
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(bx, by); g.lineTo(bx, top);
      g.moveTo(bx + 6, by); g.lineTo(bx + 6, top);
      for (let y = by; y > top; y -= 10) { g.moveTo(bx, y); g.lineTo(bx + 6, y - 10); }
      g.moveTo(bx - crane.jibL * W, top + 4); g.lineTo(bx + crane.jibR * W, top);
      g.moveTo(bx - crane.jibL * W * 0.55, top + 2); g.lineTo(bx - crane.jibL * W * 0.62, top + 26);
      g.moveTo(bx + 3, top); g.lineTo(bx + 3, top - 14); g.lineTo(bx - crane.jibL * W * 0.7, top + 3);
      g.stroke();
      g.fillRect(bx + crane.jibR * W - 12, top - 2, 12, 9);
      g.lineWidth = 0.8;
      g.beginPath(); g.moveTo(bx - crane.jibL * W * 0.35, top + 3); g.lineTo(bx - crane.jibL * W * 0.33, top + crane.h * H * 0.45); g.stroke();
      g.fillRect(bx - crane.jibL * W * 0.33 - 3, top + crane.h * H * 0.45, 6, 7);
    };

    // 断裂高架 + 弃车
    const deckY = 0.785, deckH = 0.018, gapA = 0.54, gapB = 0.61;
    overpass.extra = (g) => {
      const y = deckY * H, dh = deckH * H;
      g.fillStyle = overpass.color;
      const seg = (a: number, b: number, jagA: boolean, jagB: boolean) => {
        const xa = a * W, xb = b * W;
        g.beginPath();
        g.moveTo(xa, y);
        g.lineTo(xb, y);
        if (jagB) { g.lineTo(xb - 6, y + dh * 0.4); g.lineTo(xb + 3, y + dh * 0.7); g.lineTo(xb - 10, y + dh); } else g.lineTo(xb, y + dh);
        g.lineTo(xa, y + dh);
        if (jagA) { g.lineTo(xa + 8, y + dh * 0.6); g.lineTo(xa - 4, y + dh * 0.3); }
        g.closePath();
        g.fill();
        g.fillRect(xa, y - 5, xb - xa, 1.2);
        for (let px = xa; px < xb; px += 9) g.fillRect(px, y - 5, 1, 5);
      };
      seg(-PAD, gapA, false, true);
      seg(gapB, 1 + PAD, true, false);
      for (let px = -PAD + 0.05; px < 1 + PAD; px += 0.13) if (px < gapA - 0.02 || px > gapB + 0.02) g.fillRect(px * W, y + dh, W * 0.012, H);
      g.strokeStyle = overpass.color;
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i < 4; i++) { g.moveTo(gapA * W - i * 3, y + dh); g.quadraticCurveTo(gapA * W + 4 - i * 3, y + dh + 14, gapA * W - 2 - i * 4, y + dh + 22 + i * 4); }
      g.stroke();
      const car = (cx: number, tilt = 0, truck = false) => {
        g.save();
        g.translate(cx * W, y);
        g.rotate(tilt);
        const L = truck ? 34 : 22;
        g.fillRect(-L / 2, -7, L, 5);
        if (truck) g.fillRect(-L / 2, -14, L * 0.62, 8); else g.fillRect(-L * 0.3, -11, L * 0.55, 5);
        g.beginPath(); g.arc(-L * 0.32, -2, 2.4, 0, 6.3); g.arc(L * 0.32, -2, 2.4, 0, 6.3); g.fill();
        g.restore();
      };
      car(0.12); car(0.2, 0, true); car(0.31); car(0.47); car(gapA - 0.012, 0.35); car(0.7, 0, true); car(0.83);
    };

    // 近景：瓦砾 + 电线杆与垂线
    const poles = [0.04, 0.3, 0.58, 0.9, 1.08];
    near.extra = (g) => {
      const base = near.base * H;
      g.fillStyle = near.color;
      g.beginPath();
      g.moveTo(-PAD * W, H);
      let px = -PAD * W;
      let s2 = 99;
      const r2 = () => (s2 = (s2 * 16807) % 2147483647) / 2147483647;
      while (px < (1 + PAD) * W) {
        g.lineTo(px, base - r2() * H * 0.035 - (r2() < 0.1 ? H * 0.04 : 0));
        px += 6 + r2() * 22;
      }
      g.lineTo((1 + PAD) * W, H);
      g.closePath();
      g.fill();
      g.strokeStyle = near.color;
      const tops: [number, number][] = [];
      poles.forEach((p, i) => {
        const lean = i === 2 ? 0.12 : 0;
        const x0 = p * W, y0 = base + 4, len = H * 0.36;
        const x1 = x0 + Math.sin(lean) * len, y1 = y0 - Math.cos(lean) * len;
        g.lineWidth = 3;
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
        g.lineWidth = 2;
        g.beginPath(); g.moveTo(x1 - 12, y1 + 8); g.lineTo(x1 + 12, y1 + 8 + lean * 20); g.stroke();
        tops.push([x1, y1 + 8]);
      });
      g.lineWidth = 0.8;
      for (let i = 0; i < tops.length - 1; i++) {
        const [ax, ay] = tops[i], [bx, by] = tops[i + 1];
        for (const o of [-10, 0, 10]) {
          g.beginPath();
          g.moveTo(ax + o, ay);
          if (i === 1 && o === 10) g.quadraticCurveTo(ax + 40, ay + 120, ax + 30, ay + 160);
          else g.quadraticCurveTo((ax + bx) / 2 + o, Math.max(ay, by) + 34, bx + o, by);
          g.stroke();
        }
      }
    };

    function renderLayer(L: Layer) {
      const c = L.img ?? document.createElement('canvas');
      c.width = Math.round(W * (1 + PAD * 2) * dpr);
      c.height = Math.round(H * dpr);
      const g = c.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, PAD * W * dpr, 0);
      g.clearRect(-PAD * W, 0, W * (1 + PAD * 2), H);
      g.fillStyle = L.color;
      g.strokeStyle = L.color;
      const baseY = L.base * H;
      let gs = 7;
      const gr = () => (gs = (gs * 16807) % 2147483647) / 2147483647;
      for (const b of L.blds) {
        const x = b.x * W, w = b.w * W, h = b.h * H;
        g.beginPath();
        g.moveTo(x, baseY);
        b.top.forEach((f, i) => g.lineTo(x + (w * i) / (b.top.length - 1), baseY - h * f));
        g.lineTo(x + w, baseY);
        g.closePath();
        g.fill();
        if (b.girder) {
          g.lineWidth = 1;
          g.beginPath();
          const gt = baseY - h * Math.min(...b.top);
          for (let i = 1; i < 4; i++) { const gx = x + (w * i) / 4; g.moveTo(gx, gt + 2); g.lineTo(gx + (gr() - 0.5) * 4, gt - h * (0.05 + gr() * 0.1)); }
          g.moveTo(x + w * 0.2, gt - h * 0.06); g.lineTo(x + w * 0.75, gt - h * 0.08);
          g.stroke();
        }
      }
      g.fillRect(-PAD * W, baseY - 1, W * (1 + PAD * 2), H - baseY + 1);
      g.globalCompositeOperation = 'destination-out';
      for (const b of L.blds) for (const hl of b.holes) g.fillRect(b.x * W + hl.x * b.w * W, L.base * H - b.h * H + hl.y * b.h * H, hl.w * b.w * W, hl.h * b.h * H);
      g.globalCompositeOperation = 'source-over';
      L.extra?.(g);
      L.img = c;
    }

    // ================= 精灵 =================
    function sprite(r: number, g: number, b: number, size = 128) {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const x = c.getContext('2d')!;
      const gr = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      gr.addColorStop(0, `rgba(${r},${g},${b},1)`);
      gr.addColorStop(0.45, `rgba(${r},${g},${b},0.55)`);
      gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
      x.fillStyle = gr;
      x.fillRect(0, 0, size, size);
      return c;
    }
    /** 不规则云团：十几个错位软圆叠成，避免烟雾像一串完美圆球 */
    function puff(r: number, g: number, b: number) {
      const size = 160;
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const x = c.getContext('2d')!;
      for (let i = 0; i < 16; i++) {
        const ang = rnd() * 6.283, dist = rnd() * size * 0.2;
        const px = size / 2 + Math.cos(ang) * dist, py = size / 2 + Math.sin(ang) * dist * 0.8;
        const rad = size * rr(0.14, 0.3);
        const gr = x.createRadialGradient(px, py, 0, px, py, rad);
        gr.addColorStop(0, `rgba(${r},${g},${b},${rr(0.22, 0.38)})`);
        gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
        x.fillStyle = gr;
        x.beginPath();
        x.arc(px, py, rad, 0, 6.283);
        x.fill();
      }
      return c;
    }
    const smokeDark = [0, 1, 2].map(() => puff(60, 56, 52));
    const smokeLit = [0, 1, 2].map(() => puff(200, 88, 32));
    const smokeRed = [0, 1, 2].map(() => puff(220, 48, 36));
    const glowSpr = sprite(210, 90, 30, 256);
    const fogSpr = sprite(120, 118, 115);
    const flareSpr = sprite(240, 56, 38, 256);
    const hotSpr = sprite(255, 214, 196, 64);

    // ================= 火与烟 =================
    const fires = [
      { x: 0.6, s: 1.0, ph: 0 },
      { x: 0.27, s: 0.7, ph: 2.1 },
      { x: 0.88, s: 0.6, ph: 4.2 },
    ];
    type Puff = { x: number; y: number; r: number; age: number; life: number; vx: number; vy: number; rot: number; spin: number; v: number };
    const plumes = fires.map((f) => ({ f, puffs: [] as Puff[], acc: 0 }));
    function stepSmoke(dt: number, t: number) {
      for (const pl of plumes) {
        pl.acc += dt * 3.2 * pl.f.s;
        while (pl.acc > 1) {
          pl.acc -= 1;
          pl.puffs.push({ x: pl.f.x + rr(-0.01, 0.01), y: mid.base - 0.05, r: 0.02 * pl.f.s, age: 0, life: rr(13, 19), vx: rr(0.003, 0.006), vy: -rr(0.016, 0.024) * (0.8 + pl.f.s * 0.3), rot: rnd() * 6.28, spin: rr(-0.15, 0.15), v: Math.floor(rnd() * 3) });
        }
        for (const p of pl.puffs) {
          p.age += dt;
          p.y += p.vy * dt;
          const lift = Math.max(0, mid.base - p.y);
          p.x += (p.vx + lift * 0.045 + Math.sin(t * 0.3 + p.rot) * 0.0015) * dt;
          p.r += dt * 0.0078 * pl.f.s;
          p.rot += p.spin * dt;
        }
        pl.puffs = pl.puffs.filter((p) => p.age < p.life);
      }
    }
    for (let i = 0; i < 18 * 20; i++) stepSmoke(0.05, i * 0.05);

    // ================= 粒子 =================
    type P = { x: number; y: number; vx: number; vy: number; r: number; a: number; ph: number; top: number };
    const ash: P[] = Array.from({ length: 150 }, () => ({ x: rnd(), y: rnd(), vx: rr(0.006, 0.02), vy: rr(0.012, 0.035), r: rr(0.5, 2.2), a: rr(0.12, 0.4), ph: rnd() * 6.28, top: 0 }));
    const embers: P[] = Array.from({ length: 34 }, () => spawnEmber({} as P, true));
    function spawnEmber(p: P, anywhere = false) {
      const f = fires[Math.floor(rnd() * fires.length)];
      p.x = f.x + rr(-0.04, 0.04);
      p.y = anywhere ? rr(0.35, mid.base) : mid.base - 0.03;
      p.vx = rr(0.004, 0.02);
      p.vy = -rr(0.025, 0.06);
      p.r = rr(0.6, 1.8);
      p.a = rr(0.5, 1);
      p.ph = rnd() * 6.28;
      p.top = rr(0.2, 0.45);
      return p;
    }

    // ================= 鸦群 =================
    const crows = Array.from({ length: 7 }, () => ({ cx: rr(0.4, 0.5), cy: rr(0.24, 0.32), rx: rr(0.03, 0.08), ry: rr(0.012, 0.03), sp: rr(0.25, 0.5) * (rnd() < 0.5 ? 1 : -1), ph: rnd() * 6.28, s: rr(3, 5) }));

    // ================= 颗粒 =================
    const grains = Array.from({ length: 4 }, () => {
      const g = document.createElement('canvas');
      g.width = g.height = 160;
      const gx = g.getContext('2d')!;
      const img = gx.createImageData(160, 160);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() * 255;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      gx.putImageData(img, 0, 0);
      return ctx.createPattern(g, 'repeat')!;
    });

    // ================= 闪电 =================
    let now = 0;
    let shake = 0;
    let lightT = -99, nextLight = 14 + rnd() * 10, lightBig = false;
    let bolt: [number, number][] = [];
    triggerLightning = (big = false) => {
      lightT = now;
      lightBig = big;
      bolt = [];
      let x = rr(0.3, 0.8), y = -0.02;
      while (y < far.base - 0.06) { bolt.push([x, y]); x += (Math.random() - 0.5) * 0.05; y += rr(0.02, 0.05); }
      nextLight = now + 22 + Math.random() * 20;
      if (big) shake = Math.max(shake, 0.8);
    };
    const pulse = (d: number, k: number) => (d < 0 ? 0 : Math.exp(-d * k));

    // ================= 信号弹 =================
    // 0 → RISE 升空；RISE 点燃；之后挂伞缓降；BURN 后开始熄灭；LIFE 后只剩烟慢慢散
    const RISE = 1.35, BURN = 13, LIFE = 15.5, GONE = 24;
    type Spark = { x: number; y: number; vx: number; vy: number; age: number; life: number };
    type SmokeP = { x: number; y: number; r: number; age: number; life: number; rot: number; v: number };
    let flare: { t0: number; x0: number; x1: number; drift: number; jit: number } | null = null;
    const fTrail: { x: number; y: number; t: number }[] = [];
    const fSparks: Spark[] = [];
    const fSmoke: SmokeP[] = [];
    let beamAng = Math.PI * 0.5;
    triggerFlare = () => {
      flare = { t0: now, x0: rr(0.4, 0.44), x1: rr(0.48, 0.54), drift: rr(0.003, 0.007), jit: 1 };
      fTrail.length = 0;
      fSparks.length = 0;
      fSmoke.length = 0;
      shake = Math.max(shake, 1);
    };
    function flareAt(t: number) {
      if (!flare) return null;
      const d = t - flare.t0;
      if (d > GONE) { flare = null; return null; }
      let x: number, y: number;
      if (d < RISE) {
        const p = d / RISE;
        const e = 1 - (1 - p) ** 2.4; // 出膛快、到顶慢
        x = flare.x0 + (flare.x1 - flare.x0) * p;
        y = 1.04 - e * (1.04 - 0.17);
      } else {
        const h = d - RISE;
        x = flare.x1 + h * flare.drift + Math.sin(h * 1.1) * 0.006; // 伞下摆动
        y = 0.17 + h * 0.0095;
      }
      // 亮度：升空时是小亮点；点燃瞬间爆亮；稳定燃烧带抖动；末段噼啪熄灭
      let base: number;
      if (d < RISE) base = 0.35;
      else if (d < BURN) base = 1;
      else if (d < LIFE) base = (1 - (d - BURN) / (LIFE - BURN)) * (Math.random() < 0.18 ? 0.25 : 1);
      else base = 0;
      const ignite = d < RISE ? 0 : pulse(d - RISE, 2.2);
      return { d, x, y, b: base * (0.82 + 0.18 * flare.jit), ignite, rising: d < RISE, burning: d < LIFE };
    }
    function stepFlare(dt: number, t: number, fl: NonNullable<ReturnType<typeof flareAt>>) {
      flare!.jit += (Math.random() - flare!.jit) * 0.5;
      if (fl.rising) {
        fTrail.push({ x: fl.x, y: fl.y, t });
        for (let i = 0; i < 3; i++) fSparks.push({ x: fl.x, y: fl.y, vx: rr(-0.03, 0.03), vy: rr(0.02, 0.08), age: 0, life: rr(0.25, 0.6) });
        if (rnd() < 0.7) fSmoke.push({ x: fl.x, y: fl.y, r: rr(0.006, 0.01), age: 0, life: rr(5, 8), rot: rnd() * 6.28, v: Math.floor(rnd() * 3) });
      } else if (fl.burning) {
        if (rnd() < 0.55 * fl.b + 0.1) fSparks.push({ x: fl.x + rr(-0.002, 0.002), y: fl.y + 0.004, vx: rr(-0.02, 0.02), vy: rr(0.0, 0.03), age: 0, life: rr(0.5, 1.3) });
        if (rnd() < 0.6) fSmoke.push({ x: fl.x, y: fl.y - 0.004, r: rr(0.006, 0.011), age: 0, life: rr(7, 11), rot: rnd() * 6.28, v: Math.floor(rnd() * 3) });
      }
      while (fTrail.length && t - fTrail[0].t > 0.45) fTrail.shift();
      for (const s of fSparks) { s.age += dt; s.vy += 0.18 * dt; s.x += s.vx * dt; s.y += s.vy * dt; }
      for (let i = fSparks.length - 1; i >= 0; i--) if (fSparks[i].age > fSparks[i].life) fSparks.splice(i, 1);
      for (const p of fSmoke) { p.age += dt; p.y -= dt * 0.006; p.x += dt * (0.008 + p.age * 0.0015); p.r += dt * 0.0055; p.rot += dt * 0.1; }
      for (let i = fSmoke.length - 1; i >= 0; i--) if (fSmoke[i].age > fSmoke[i].life) fSmoke.splice(i, 1);
    }

    // ================= 视差 =================
    let mx = 0, my = 0, tx = 0, ty = 0;
    const onMove = (e: PointerEvent) => { tx = (e.clientX / innerWidth) * 2 - 1; ty = (e.clientY / innerHeight) * 2 - 1; };
    addEventListener('pointermove', onMove);

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      dpr = Math.min(devicePixelRatio || 1, 2);
      W = r.width;
      H = r.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      for (const L of [far, mid, overpass, near]) renderLayer(L);
      if (reduce) draw(30, 0);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // ================= 绘制工具 =================
    const off = (L: Layer) => [-mx * L.depth * 26, -my * L.depth * 8] as const;
    function blit(L: Layer) {
      const [ox, oy] = off(L);
      ctx.drawImage(L.img!, -PAD * W + ox, oy, W * (1 + PAD * 2), H);
    }
    function fireFlicker(f: (typeof fires)[number], t: number) {
      return 0.75 + 0.15 * Math.sin(t * 7.3 + f.ph) + 0.1 * Math.sin(t * 13.1 + f.ph * 2);
    }
    /** 信号弹把楼顶边缘勾成红色轮廓光 */
    function rimLight(L: Layer, fx: number, fy: number, power: number) {
      if (power < 0.02) return;
      const [ox, oy] = off(L);
      const baseY = L.base * H + oy;
      const R = W * 0.55;
      ctx.lineWidth = 1.4;
      for (const b of L.blds) {
        const x = b.x * W + ox, w = b.w * W, h = b.h * H;
        const cx = x + w / 2, cy = baseY - h;
        const dist = Math.hypot(cx - fx, cy - fy);
        if (dist > R) continue;
        const a = power * (1 - dist / R) ** 1.6;
        ctx.strokeStyle = `rgba(255,86,58,${a})`;
        ctx.beginPath();
        b.top.forEach((f, i) => {
          const px = x + (w * i) / (b.top.length - 1), py = baseY - h * f;
          if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        });
        ctx.stroke();
        // 朝向信号弹的那一侧楼体边缘
        const sx = fx < cx ? x : x + w;
        const sy = baseY - h * (fx < cx ? b.top[0] : b.top[b.top.length - 1]);
        ctx.strokeStyle = `rgba(255,86,58,${a * 0.5})`;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx, sy + h * 0.35);
        ctx.stroke();
      }
    }

    // ================= 每帧 =================
    function draw(t: number, dt: number) {
      if (!W) return;
      mx += (tx - mx) * Math.min(1, dt * 2.5);
      my += (ty - my) * Math.min(1, dt * 2.5);
      if (dt) stepSmoke(dt, t);
      const fl = flareAt(t);
      if (fl && dt) stepFlare(dt, t, fl);
      shake *= Math.exp(-dt * 4.5);

      // 开场：从黑场淡入，同时镜头缓慢拉远
      const intro = reduce ? 1 : smooth(t / 3.2);
      const zoom = 1 + 0.07 * (1 - intro);
      const sx = (Math.random() - 0.5) * shake * 7, sy = (Math.random() - 0.5) * shake * 5;
      ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * (W * 0.5 * (1 - zoom) + sx), dpr * (H * 0.62 * (1 - zoom) + sy));

      const d = t - lightT;
      const flash = Math.max(pulse(d, 9), 0.7 * pulse(d - 0.16, 7), lightBig ? 0.5 * pulse(d - 0.4, 4) : 0);
      const flareLight = fl ? Math.min(1.4, fl.b + fl.ignite * 0.8) : 0;
      const [mox, moy] = off(mid);
      const fx = fl ? fl.x * W + mox * 0.5 : 0, fy = fl ? fl.y * H + moy * 0.5 : 0;

      // 天空
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#08090b');
      sky.addColorStop(0.3, '#121112');
      sky.addColorStop(0.5, '#221a16');
      sky.addColorStop(0.64, '#43281a');
      sky.addColorStop(0.74, '#2e1a11');
      sky.addColorStop(1, '#0a0706');
      ctx.fillStyle = sky;
      ctx.fillRect(-20, -20, W + 40, H + 40);

      if (flash > 0.01) {
        ctx.fillStyle = `rgba(185,195,210,${flash * (lightBig ? 0.26 : 0.16)})`;
        ctx.fillRect(-20, -20, W + 40, H + 40);
        if (d < 0.22) {
          ctx.strokeStyle = `rgba(235,240,255,${pulse(d, 12)})`;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          bolt.forEach(([bx, by], i) => (i ? ctx.lineTo(bx * W, by * H) : ctx.moveTo(bx * W, by * H)));
          ctx.stroke();
        }
      }

      // 信号弹染红天空（在建筑后面，形成大范围红色光晕）
      if (fl && flareLight > 0.01) {
        ctx.globalCompositeOperation = 'lighter';
        const R = W * (0.55 + fl.ignite * 0.3);
        ctx.globalAlpha = 0.38 * flareLight;
        ctx.drawImage(flareSpr, fx - R, fy - R * 0.85, R * 2, R * 1.7);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }

      // 地平线火光
      ctx.globalCompositeOperation = 'lighter';
      for (const f of fires) {
        const k = fireFlicker(f, t) * f.s;
        const [ox] = off(far);
        const R = W * 0.36 * f.s;
        ctx.globalAlpha = 0.32 * k;
        ctx.drawImage(glowSpr, f.x * W + ox - R, far.base * H - R * 0.6, R * 2, R * 1.2);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      blit(far);
      if (fl) rimLight(far, fx, fy, flareLight * 0.35);

      // 楼后火光
      ctx.globalCompositeOperation = 'lighter';
      for (const f of fires) {
        const k = fireFlicker(f, t) * f.s;
        const R = W * 0.2 * f.s;
        ctx.globalAlpha = 0.85 * k;
        ctx.drawImage(glowSpr, f.x * W + mox - R, mid.base * H - R * 0.9 + moy, R * 2, R * 1.4);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      // 烟柱（靠近信号弹的部分被染红）
      for (const pl of plumes) {
        for (const p of pl.puffs) {
          const life = p.age / p.life;
          const a = Math.min(1, p.age / 1.2) * (1 - life) ** 1.3;
          const lit = Math.max(0, 1 - p.age / 3.5) * fireFlicker(pl.f, t);
          const R = p.r * H * 2.4;
          const px = p.x * W + mox * 0.9, py = p.y * H + moy;
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(p.rot);
          ctx.globalAlpha = a * 0.95;
          ctx.drawImage(smokeDark[p.v], -R, -R, R * 2, R * 2);
          if (lit > 0.02) {
            ctx.globalAlpha = a * lit * 0.8;
            ctx.drawImage(smokeLit[p.v], -R * 0.85, -R * 0.85, R * 1.7, R * 1.7);
          }
          if (fl && flareLight > 0.02) {
            const k = flareLight * Math.max(0, 1 - Math.hypot(px - fx, py - fy) / (W * 0.4));
            if (k > 0.02) {
              ctx.globalAlpha = a * k * 0.7;
              ctx.drawImage(smokeRed[p.v], -R, -R, R * 2, R * 2);
            }
          }
          ctx.restore();
        }
      }
      ctx.globalAlpha = 1;

      // 巡逻直升机：看到信号弹后探照灯会转过去
      const cyc = (t * 0.011 + 0.35) % 1.7;
      const hx = (1.2 - cyc) * W - mx * 14, hy = (0.17 + 0.02 * Math.sin(t * 0.25)) * H - my * 5;
      if (cyc < 1.45) {
        let target = Math.PI * 0.5 + Math.sin(t * 0.45) * 0.38;
        if (fl && !fl.rising && fl.burning) {
          // 光束末端对准信号弹正下方的地面
          target = Math.atan2(mid.base * H - hy, fx - hx);
          target = Math.max(Math.PI * 0.12, Math.min(Math.PI * 0.88, target));
        }
        beamAng += (target - beamAng) * Math.min(1, dt * 1.4);
        const len = H * 0.95, spread = 0.07;
        const beam = ctx.createLinearGradient(hx, hy, hx + Math.cos(beamAng) * len, hy + Math.sin(beamAng) * len);
        beam.addColorStop(0, 'rgba(225,228,235,0.13)');
        beam.addColorStop(0.75, 'rgba(225,228,235,0.03)');
        beam.addColorStop(1, 'rgba(225,228,235,0)');
        ctx.fillStyle = beam;
        ctx.beginPath();
        ctx.moveTo(hx, hy + 3);
        ctx.lineTo(hx + Math.cos(beamAng - spread) * len, hy + Math.sin(beamAng - spread) * len);
        ctx.lineTo(hx + Math.cos(beamAng + spread) * len, hy + Math.sin(beamAng + spread) * len);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#050505';
        ctx.beginPath();
        ctx.ellipse(hx, hy, 11, 4.5, 0, 0, 6.29);
        ctx.fill();
        ctx.fillRect(hx + 6, hy - 1.5, 18, 2);
        ctx.fillRect(hx + 22, hy - 5, 2, 6);
        ctx.fillRect(hx - 8, hy + 6, 16, 1);
        ctx.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin(t * 40));
        ctx.fillRect(hx - 16, hy - 6, 32, 1);
        ctx.globalAlpha = 1;
        if ((t % 1.1) < 0.12) { ctx.fillStyle = '#d33'; ctx.fillRect(hx + 22, hy - 6, 2.5, 2.5); }
        if (((t + 0.5) % 1.1) < 0.08) { ctx.fillStyle = '#ddd'; ctx.fillRect(hx - 2, hy + 4, 2, 2); }
      } else {
        beamAng = Math.PI * 0.5;
      }

      blit(mid);
      if (fl) rimLight(mid, fx, fy, flareLight * 0.85);

      // 中景窗户
      {
        const baseY = mid.base * H + moy;
        for (const b of mid.blds) {
          if (!b.wins.length) continue;
          const x = b.x * W + mox, w = b.w * W, h = b.h * H;
          for (const wn of b.wins) {
            let a: number, col: string;
            if (wn.kind === 'fire') {
              a = 0.35 + 0.3 * Math.sin(t * 5 + wn.ph) * Math.sin(t * 2.3 + wn.ph * 1.7);
              col = '214,98,36';
            } else {
              a = Math.sin(t * 0.7 + wn.ph) > -0.85 ? 0.22 : 0.02;
              col = '170,180,190';
            }
            ctx.fillStyle = `rgba(${col},${Math.max(0, a) * (1 - flash * 0.7)})`;
            ctx.fillRect(x + wn.x * w, baseY - h + wn.y * h, Math.max(1.5, w * 0.09), Math.max(1.5, h * 0.03));
          }
        }
      }

      // 鸦群
      ctx.strokeStyle = '#040404';
      ctx.lineWidth = 1.3;
      for (const c of crows) {
        const a = t * c.sp + c.ph;
        const x = (c.cx + Math.cos(a) * c.rx) * W - mx * 8, y = (c.cy + Math.sin(a) * c.ry) * H - my * 3;
        const flap = Math.sin(t * 9 + c.ph * 3) * c.s * 0.7;
        ctx.beginPath();
        ctx.moveTo(x - c.s, y - flap);
        ctx.lineTo(x, y);
        ctx.lineTo(x + c.s, y - flap);
        ctx.stroke();
      }

      drawFog(t, 0.76, 0.05, 0.012, -mx * 18, 0.05);
      blit(overpass);
      drawFog(t, 0.86, 0.06, -0.008, -mx * 24, 0.06);
      blit(near);

      // 信号弹本体（最前景：从我们这边打上去）
      if (fl) drawFlare(fl, t);

      // 飘灰（被信号弹照到时偏红）
      for (const p of ash) {
        if (dt) {
          p.y += p.vy * dt;
          p.x += p.vx * dt + Math.sin(t * 0.9 + p.ph) * 0.0005;
          if (p.y > 1.02) { p.y = -0.02; p.x = Math.random() * 1.1 - 0.1; }
          if (p.x > 1.02) p.x = -0.02;
        }
        const px = p.x * W - mx * p.r * 7, py = p.y * H - my * p.r * 3;
        let rC = 178, gC = 170, bC = 160;
        if (fl && flareLight > 0.05) {
          const k = flareLight * Math.max(0, 1 - Math.hypot(px - fx, py - fy) / (W * 0.45));
          rC += (255 - rC) * k; gC -= gC * 0.6 * k; bC -= bC * 0.7 * k;
        }
        ctx.fillStyle = `rgba(${rC | 0},${gC | 0},${bC | 0},${p.a})`;
        ctx.beginPath();
        ctx.arc(px, py, p.r, 0, 6.283);
        ctx.fill();
      }
      // 火星
      ctx.globalCompositeOperation = 'lighter';
      for (const p of embers) {
        if (dt) {
          p.y += p.vy * dt;
          p.x += p.vx * dt + Math.sin(t * 2.2 + p.ph) * 0.0008;
          if (p.y < p.top) spawnEmber(p);
        }
        const fade = Math.min(1, (p.y - p.top) / 0.1);
        const a = p.a * fade * (0.55 + 0.45 * Math.sin(t * 11 + p.ph));
        ctx.fillStyle = `rgba(232,96,36,${Math.max(0, a)})`;
        ctx.beginPath();
        ctx.arc(p.x * W - mx * 12, p.y * H - my * 4, p.r, 0, 6.283);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';

      // 整体被信号弹映红
      if (fl && flareLight > 0.01) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(64,7,4,${0.2 * flareLight + 0.22 * fl.ignite})`;
        ctx.fillRect(-20, -20, W + 40, H + 40);
        ctx.globalCompositeOperation = 'source-over';
      }

      // 文字区压暗
      const shadeL = ctx.createLinearGradient(0, 0, W * 0.62, 0);
      shadeL.addColorStop(0, 'rgba(0,0,0,0.5)');
      shadeL.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = shadeL;
      ctx.fillRect(-20, -20, W + 40, H + 40);
      const shadeB = ctx.createLinearGradient(0, H * 0.5, 0, H);
      shadeB.addColorStop(0, 'rgba(0,0,0,0)');
      shadeB.addColorStop(1, 'rgba(0,0,0,0.7)');
      ctx.fillStyle = shadeB;
      ctx.fillRect(-20, H * 0.5, W + 40, H * 0.5 + 20);

      // 调色
      ctx.globalCompositeOperation = 'soft-light';
      ctx.fillStyle = 'rgba(90,50,25,0.22)';
      ctx.fillRect(-20, -20, W + 40, H + 40);
      ctx.globalCompositeOperation = 'source-over';

      // 屏幕空间：暗角、颗粒、开场黑场（不受镜头缩放影响）
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const vig = ctx.createRadialGradient(W * 0.5, H * 0.45, Math.min(W, H) * 0.3, W * 0.5, H * 0.45, Math.max(W, H) * 0.78);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, W, H);

      ctx.save();
      ctx.globalAlpha = 0.06;
      ctx.globalCompositeOperation = 'overlay';
      ctx.translate(Math.random() * 160, Math.random() * 160);
      ctx.fillStyle = grains[(Math.random() * grains.length) | 0];
      ctx.fillRect(-160, -160, W + 320, H + 320);
      ctx.restore();

      if (intro < 1) {
        ctx.fillStyle = `rgba(0,0,0,${1 - intro})`;
        ctx.fillRect(0, 0, W, H);
      }
    }

    function drawFlare(fl: NonNullable<ReturnType<typeof flareAt>>, t: number) {
      const px = (x: number) => x * W - mx * 10, py = (y: number) => y * H - my * 4;
      const x = px(fl.x), y = py(fl.y);

      // 烟尾（先画，在光之下）
      for (const p of fSmoke) {
        const R = p.r * H * 2.2;
        const sx = px(p.x), sy = py(p.y);
        const a = Math.min(1, p.age / 0.4) * (1 - p.age / p.life) ** 1.4;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(p.rot);
        ctx.globalAlpha = a * 0.75;
        ctx.drawImage(smokeDark[p.v], -R, -R, R * 2, R * 2);
        if (fl.burning) {
          const k = fl.b * Math.max(0, 1 - Math.hypot(sx - x, sy - y) / (H * 0.35));
          if (k > 0.02) {
            ctx.globalAlpha = a * k;
            ctx.drawImage(smokeRed[p.v], -R, -R, R * 2, R * 2);
          }
        }
        ctx.restore();
      }
      ctx.globalAlpha = 1;

      ctx.globalCompositeOperation = 'lighter';
      // 升空拖尾：越新越粗越亮
      if (fTrail.length > 1) {
        for (let i = 1; i < fTrail.length; i++) {
          const k = i / fTrail.length;
          ctx.strokeStyle = `rgba(255,${120 + 80 * k | 0},${80 + 60 * k | 0},${k * 0.9})`;
          ctx.lineWidth = 0.5 + k * 2.6;
          ctx.beginPath();
          ctx.moveTo(px(fTrail[i - 1].x), py(fTrail[i - 1].y));
          ctx.lineTo(px(fTrail[i].x), py(fTrail[i].y));
          ctx.stroke();
        }
      }
      // 火花：白热 → 橙 → 红，带一点拖影
      for (const s of fSparks) {
        const k = 1 - s.age / s.life;
        const sx = px(s.x), sy = py(s.y);
        ctx.strokeStyle = `rgba(255,${(140 + 100 * k) | 0},${(60 + 120 * k * k) | 0},${k})`;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx - s.vx * W * 0.03, sy - s.vy * H * 0.03);
        ctx.stroke();
      }

      if (fl.burning && fl.b > 0.01) {
        const L = Math.min(1.5, fl.b + fl.ignite);
        // 光晕三层：大范围红晕 / 中等橙红 / 白热核心
        const R1 = W * (0.12 + 0.1 * fl.ignite) * (0.7 + 0.3 * fl.b);
        ctx.globalAlpha = 0.55 * L;
        ctx.drawImage(flareSpr, x - R1, y - R1, R1 * 2, R1 * 2);
        ctx.globalAlpha = 0.9 * L;
        ctx.drawImage(flareSpr, x - 22, y - 22, 44, 44);
        ctx.globalAlpha = Math.min(1, 0.7 + 0.3 * fl.b);
        const hot = fl.rising ? 7 : 11 + fl.ignite * 10;
        ctx.drawImage(hotSpr, x - hot, y - hot, hot * 2, hot * 2);
        // 横向光条（变形宽银幕镜头的光斑）
        const streak = (fl.rising ? 0.25 : 0.55 + fl.ignite * 0.8) * fl.b;
        if (streak > 0.02) {
          const len = W * (0.18 + 0.35 * fl.ignite);
          const g = ctx.createLinearGradient(x - len, y, x + len, y);
          g.addColorStop(0, 'rgba(255,60,40,0)');
          g.addColorStop(0.5, `rgba(255,150,120,${Math.min(1, streak)})`);
          g.addColorStop(1, 'rgba(255,60,40,0)');
          ctx.globalAlpha = 1;
          ctx.fillStyle = g;
          ctx.fillRect(x - len, y - 0.8, len * 2, 1.6);
        }
        ctx.globalAlpha = 1;
      }
      ctx.globalCompositeOperation = 'source-over';

      // 降落伞：点燃后 0.3 秒张开，底边被火光照亮
      if (!fl.rising && fl.d > RISE + 0.3 && fl.d < LIFE + 2) {
        const open = smooth((fl.d - RISE - 0.3) / 0.5);
        const sway = Math.sin((fl.d - RISE) * 1.1) * 0.25;
        const cx = x - Math.sin(sway) * 18, cy = y - 18 * open;
        const wHalf = 8 * open;
        ctx.fillStyle = '#120707';
        ctx.beginPath();
        ctx.ellipse(cx, cy, wHalf, 5 * open, sway, Math.PI, 0);
        ctx.fill();
        ctx.strokeStyle = `rgba(255,90,60,${0.55 * fl.b})`;
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(cx - wHalf, cy); ctx.lineTo(x, y);
        ctx.moveTo(cx + wHalf, cy); ctx.lineTo(x, y);
        ctx.moveTo(cx, cy); ctx.lineTo(x, y);
        ctx.stroke();
        ctx.strokeStyle = `rgba(255,110,80,${0.7 * fl.b})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(cx, cy, wHalf, 1.2, sway, 0, Math.PI);
        ctx.stroke();
      }
    }

    function drawFog(t: number, y: number, th: number, speed: number, ox: number, alpha: number) {
      ctx.globalAlpha = alpha;
      for (let i = 0; i < 7; i++) {
        const cx = ((((i / 7 + t * speed) % 1) + 1) % 1) * W * 1.4 - W * 0.2 + ox;
        const R = th * H * (1.6 + (i % 3) * 0.5);
        ctx.drawImage(fogSpr, cx - R * 3.2, y * H - R, R * 6.4, R * 2);
      }
      ctx.globalAlpha = 1;
    }

    let last = performance.now(), raf = 0;
    const loop = (ms: number) => {
      const dt = Math.min(0.05, (ms - last) / 1000);
      last = ms;
      now += dt;
      if (now > nextLight && !flare) triggerLightning(false);
      draw(now, dt);
      raf = requestAnimationFrame(loop);
    };
    resize();
    if (!reduce) raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      removeEventListener('pointermove', onMove);
      triggerLightning = () => {};
      triggerFlare = () => {};
    };
  });
</script>

<canvas bind:this={canvas} aria-hidden="true"></canvas>

<style>
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
</style>
