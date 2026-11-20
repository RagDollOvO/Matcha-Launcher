import { spawn } from 'node:child_process';
import { readVpk, readResource, assertVpkUnchanged } from './vpk.mjs';
import { fail } from './files.mjs';

function wavInfo(body) {
  if (body.toString('ascii', 0, 4) !== 'RIFF' || body.toString('ascii', 8, 12) !== 'WAVE') return null;
  let fmt, data;
  for (let n = 12; n + 8 <= body.length;) {
    const key = body.toString('ascii', n, n + 4), size = body.readUInt32LE(n + 4), at = n + 8;
    if (at + size > body.length) fail('invalid_audio', 'WAV 数据被截断。');
    if (key === 'fmt ' && size >= 16) fmt = { tag: body.readUInt16LE(at), channels: body.readUInt16LE(at + 2), rate: body.readUInt32LE(at + 4), bytesPerSecond: body.readUInt32LE(at + 8), bits: body.readUInt16LE(at + 14) };
    if (key === 'data') data = size;
    n = at + size + size % 2;
  }
  return fmt && data !== undefined ? { ...fmt, durationMs: fmt.bytesPerSecond ? Math.round(data * 1000 / fmt.bytesPerSecond) : undefined } : null;
}
async function decode(executable, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const chunks = []; let bytes = 0, fault;
    const timer = setTimeout(() => { fault = new Error('声音解码超时。'); child.kill(); }, 10000);
    child.on('error', e => { clearTimeout(timer); reject(e.code === 'ENOENT' ? Object.assign(new Error('声音解码器尚未构建，请运行 npm run audio:build。'), { code: 'audio_decoder_missing' }) : e); });
    child.stdout.on('data', b => { bytes += b.length; if (bytes > 64 * 1024 * 1024 + 44) { fault = new Error('解码输出超过 64 MiB。'); child.kill(); } else chunks.push(b); });
    child.stderr.resume(); child.stdin.on('error', () => {});
    child.on('close', code => { clearTimeout(timer); if (code === 0 && !fault) resolve(Buffer.concat(chunks)); else reject(Object.assign(fault ?? new Error('声音格式损坏，或超过双声道、5 分钟预览限制。'), { code: 'invalid_audio' })); });
    child.stdin.end(input);
  });
}
export class ModAudio {
  constructor(manager, executable) { this.manager = manager; this.executable = executable; this.cache = new Map(); this.bytes = 0; }
  async list(root, id, source) {
    return this.manager.reading(root, async () => {
      const vpk = await readVpk(source ?? await this.manager.resolve(root, id), { includeEntries: true });
      return [...vpk.entries].filter(([p]) => /^sound\/.+\.(wav|mp3)$/.test(p)).map(([path, e]) => ({ path, bytes: e.size })).sort((a, b) => a.path.localeCompare(b.path));
    });
  }
  async sound(root, id, resource, source) {
    if (typeof resource !== 'string' || !/^sound\/.+\.(wav|mp3)$/i.test(resource)) fail('invalid_argument', '请选择包内 WAV / MP3 声音。');
    return this.manager.reading(root, async () => {
      const file = source ?? await this.manager.resolve(root, id), vpk = await readVpk(file, { includeEntries: true });
      const entry = vpk.entries.get(resource.toLowerCase());
      if (!entry) fail('sound_missing', '包内声音已不存在。');
      const key = `${file}|${vpk.files.map(f => f.identity).join('|')}|${resource.toLowerCase()}`;
      if (this.cache.has(key)) { const hit = this.cache.get(key); this.cache.delete(key); this.cache.set(key, hit); return hit.value; }
      let body = await readResource(entry, 32 * 1024 * 1024), mime = 'audio/mpeg', durationMs;
      if (/\.wav$/i.test(resource)) {
        const info = wavInfo(body);
        if (!info || info.tag !== 1 || ![8, 16].includes(info.bits) || !info.channels || info.channels > 2) body = await decode(this.executable, body);
        const decoded = wavInfo(body); durationMs = decoded?.durationMs; mime = 'audio/wav';
        if (!decoded || !decoded.rate || durationMs > 300000) fail('invalid_audio', '声音超过 5 分钟预览限制，或 WAV 格式需要检查。');
      }
      await assertVpkUnchanged(vpk);
      const value = { mime, base64: body.toString('base64'), ...(durationMs !== undefined ? { durationMs } : {}) }, size = value.base64.length;
      while (this.bytes + size > 64 * 1024 * 1024 && this.cache.size) { const [k, old] = this.cache.entries().next().value; this.bytes -= old.size; this.cache.delete(k); }
      if (size <= 64 * 1024 * 1024) { this.cache.set(key, { value, size }); this.bytes += size; }
      return value;
    });
  }
}
