#!/usr/bin/env node
// 把下载好的音效自动改名放进 public/sfx/。
// 用法：npm run sfx:import -- <目录1> [目录2 ...]   （不传则扫描 ~/Downloads）
// - Kenney 素材按文件名匹配（如 click3.ogg、tick_001.ogg），压缩包请先解压
// - Freesound 素材按文件名开头的编号匹配（如 697057__inmotionaudio__xxx.wav）

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'sfx');
const EXTS = new Set(['.ogg', '.mp3', '.wav', '.flac']);

/** 目标 → 候选来源（按顺序取第一个找到的） */
const TARGETS = {
  'ui/hover': [{ kenney: 'tick_001' }],
  'ui/click': [{ kenney: 'click3' }],
  'ui/tab': [{ kenney: 'switch7' }],
  'ui/toggle-on': [{ kenney: 'toggle_001' }],
  'ui/toggle-off': [{ kenney: 'toggle_002' }],
  'ui/open': [{ kenney: 'open_001' }],
  'ui/close': [{ kenney: 'close_001' }],
  'ui/send': [{ kenney: 'drop_002' }],
  'ui/reply': [{ kenney: 'confirmation_002' }],
  'ui/approve': [{ kenney: 'confirmation_001' }],
  'ui/deny': [{ kenney: 'error_004' }],
  'ui/error': [{ kenney: 'error_006' }],
};

const dirs = process.argv.slice(2);
if (!dirs.length) dirs.push(join(homedir(), 'Downloads'));

const files = [];
function walk(dir, depth = 0) {
  if (depth > 6) return;
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, depth + 1);
    else if (EXTS.has(extname(name).toLowerCase())) files.push(p);
  }
}
for (const d of dirs) {
  if (!existsSync(d)) console.warn(`跳过不存在的目录：${d}`);
  else walk(resolve(d));
}

const stemOf = (p) => basename(p, extname(p)).toLowerCase();
// 同一素材有多种格式时，优先 ogg → mp3 → wav → flac
const rank = (p) => ['.ogg', '.mp3', '.wav', '.flac'].indexOf(extname(p).toLowerCase());
const byPref = (a, b) => rank(a) - rank(b);

function find(src) {
  if (src.kenney) return files.filter((f) => stemOf(f) === src.kenney).sort(byPref)[0];
  const re = new RegExp(`^${src.fs}(__|_|-)`);
  return files.filter((f) => re.test(basename(f))).sort(byPref)[0];
}

let ok = 0;
const missing = [];
for (const [target, sources] of Object.entries(TARGETS)) {
  const hit = sources.map(find).find(Boolean);
  if (!hit) { missing.push(target); continue; }
  const outDir = join(OUT, dirname(target));
  mkdirSync(outDir, { recursive: true });
  for (const e of EXTS) rmSync(join(OUT, target + e), { force: true });
  const dest = join(OUT, target + extname(hit).toLowerCase());
  copyFileSync(hit, dest);
  ok++;
  console.log(`✓ ${target.padEnd(16)} ← ${basename(hit)}`);
}

console.log(`\n已导入 ${ok}/${Object.keys(TARGETS).length}（扫描了 ${files.length} 个音频文件）`);
if (missing.length) {
  console.log('\n未找到：');
  for (const m of missing) console.log(`  - ${m}`);
  console.log('\n对照 public/sfx/SOURCES.md 补下载；Kenney 压缩包要先解压。');
}
