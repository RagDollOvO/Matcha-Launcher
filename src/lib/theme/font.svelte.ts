import { assetStore } from './asset-store';

export type FontMode = 'maiyuan' | 'system' | 'custom';
interface FontPrefs { mode: FontMode; name: string; revision: number }
const KEY = 'matcha.ui-font';
const FAMILY = 'Matcha Imported';
const fonts = assetStore<Blob>('matcha-ui-font', 'font');
function prefs(raw?: string | null): FontPrefs {
  const d: FontPrefs = { mode: 'maiyuan', name: '', revision: 0 };
  try {
    const p = JSON.parse((raw === undefined ? localStorage.getItem(KEY) : raw) ?? 'null');
    if (p && ['maiyuan', 'system', 'custom'].includes(p.mode)) return { ...d, ...p };
  } catch { /* 首次运行采用默认字体。 */ }
  return d;
}
export const uiFont = $state({ ...prefs(), busy: false, error: '' });
let face: FontFace | undefined;
let revision = -1;
let sequence = 0;
let started = false;

function save() {
  const { mode, name, revision } = uiFont;
  localStorage.setItem(KEY, JSON.stringify({ mode, name, revision } satisfies FontPrefs));
}
function apply(mode: FontMode, next?: FontFace) {
  if (face && face !== next) document.fonts.delete(face);
  if (next && face !== next) document.fonts.add(next);
  face = next;
  revision = next ? uiFont.revision : -1;
  document.documentElement.dataset.uiFont = mode;
}
async function loadFace(blob: Blob) {
  return new FontFace(FAMILY, await blob.arrayBuffer()).load();
}
async function restore() {
  const token = ++sequence;
  uiFont.error = '';
  if (uiFont.mode !== 'custom') { apply(uiFont.mode); return; }
  if (face && revision === uiFont.revision) { apply('custom', face); return; }
  try {
    const blob = await fonts.load();
    if (token !== sequence) return;
    if (!blob) throw Error();
    const f = await loadFace(blob);
    if (token === sequence) apply('custom', f);
  } catch {
    if (token === sequence) {
      apply('maiyuan');
      uiFont.error = '保存的字体读取失败，已显示荆南麦圆体。可以重新导入字体文件。';
    }
  }
}
export function initFont() {
  if (started) return;
  started = true;
  window.addEventListener('storage', e => {
    if (e.key !== KEY) return;
    Object.assign(uiFont, prefs(e.newValue));
    void restore();
  });
  void restore();
}
export async function setFont(mode: FontMode) {
  if (mode === 'custom' && !uiFont.name) return;
  uiFont.mode = mode;
  save();
  await restore();
}
export async function importFont(file: File) {
  if (!/\.(ttf|otf|woff2?)$/i.test(file.name)) throw Error('请选择 TTF、OTF、WOFF 或 WOFF2 字体。');
  if (file.size > 48 * 1024 * 1024) throw Error('单个字体限 48 MB；可以使用较小的常规字重或 WOFF2 版本。');
  uiFont.busy = true;
  try {
    // Decode before replacing the saved font. Invalid files leave the current font intact.
    const f = await loadFace(file).catch(() => { throw Error('读不出这个字体，请重新选择字体文件。'); });
    await fonts.save(file);
    ++sequence;
    uiFont.revision = Math.max(Date.now(), uiFont.revision + 1);
    uiFont.name = file.name.replace(/\.(ttf|otf|woff2?)$/i, '');
    uiFont.mode = 'custom'; uiFont.error = '';
    apply('custom', f); save();
  } finally { uiFont.busy = false; }
}
