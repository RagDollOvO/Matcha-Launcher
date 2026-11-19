import { platformPath, readBytes, relativePath } from './platforms/files.mjs';
import { PlatformError } from './core.mjs';

export function imagePath(value) {
  if (typeof value !== 'string' || value.includes('\\') || value.length > 240 || !/\.(png|jpe?g|webp|gif)$/i.test(value)) return null;
  try { return relativePath(value); } catch { return null; }
}
/** Same image slots the existing detail-page renderer reads. */
export function declaredPluginAssets(presentation) {
  const paths = new Set(), add = value => { const file = imagePath(value); if (file) paths.add(file); };
  const p = presentation;
  add(p?.cover); add(p?.hero?.image); add(p?.collection?.cover); add(p?.catalog?.cover);
  if (Array.isArray(p?.collections)) for (const c of p.collections) add(c?.cover);
  if (Array.isArray(p?.page)) for (const b of p.page) {
    add(b?.src); add(b?.poster); add(b?.image);
    add(typeof b?.before === 'string' ? b.before : b?.before?.src);
    add(typeof b?.after === 'string' ? b.after : b?.after?.src);
    if (Array.isArray(b?.items)) for (const item of b.items) {
      if (typeof item === 'string') add(item); else { add(item?.src); add(item?.image); }
    }
  }
  return paths;
}
export function imageMime(data) {
  return data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
    : data[0] === 255 && data[1] === 216 && data[2] === 255 ? 'image/jpeg'
    : data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp'
    : ['GIF87a', 'GIF89a'].includes(data.toString('ascii', 0, 6)) ? 'image/gif' : null;
}
export async function imageData(file) {
  const data = await readBytes(file, 4 * 1024 * 1024), mime = imageMime(data);
  if (!mime) throw new PlatformError('invalid_cover', '图片需要 PNG、JPEG、WebP 或 GIF 内容。');
  return { data, mime };
}
export async function packageImage(base, file) {
  const actual = await platformPath(base, file);
  if (!actual) return { dataUrl: null };
  const { data, mime } = await imageData(actual);
  return { dataUrl: `data:${mime};base64,${data.toString('base64')}` };
}
