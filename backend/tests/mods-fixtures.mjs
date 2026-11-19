import fs from 'node:fs/promises';
import path from 'node:path';
import { crc32Update } from '../mods/vpk.mjs';

export async function vpkFixture(file, resources, { version = 1, preload = 3, split = false } = {}) {
  const groups = new Map(); let embeddedOffset = 0, externalOffset = 0;
  const embedded = [], external = [];
  for (const [name, content] of Object.entries(resources)) {
    const ext = path.posix.extname(name).slice(1) || ' ', dir = path.posix.dirname(name) === '.' ? ' ' : path.posix.dirname(name);
    const stem = path.posix.basename(name, ext === ' ' ? '' : '.' + ext), data = Buffer.from(content);
    const inline = data.subarray(0, preload), rest = data.subarray(preload), shard = split && name !== 'addoninfo.txt';
    const record = Buffer.alloc(18); record.writeUInt32LE((crc32Update(0xffffffff, data) ^ 0xffffffff) >>> 0, 0); record.writeUInt16LE(inline.length, 4);
    record.writeUInt16LE(shard ? 0 : 0x7fff, 6); record.writeUInt32LE(shard ? externalOffset : embeddedOffset, 8);
    record.writeUInt32LE(rest.length, 12); record.writeUInt16LE(0xffff, 16);
    if (shard) { external.push(rest); externalOffset += rest.length; } else { embedded.push(rest); embeddedOffset += rest.length; }
    if (!groups.has(ext)) groups.set(ext, new Map());
    const dirs = groups.get(ext); if (!dirs.has(dir)) dirs.set(dir, []);
    dirs.get(dir).push(Buffer.concat([Buffer.from(stem + '\0'), record, inline]));
  }
  const chunks = [];
  for (const [ext, dirs] of groups) {
    chunks.push(Buffer.from(ext + '\0'));
    for (const [dir, records] of dirs) chunks.push(Buffer.from(dir + '\0'), ...records, Buffer.from([0]));
    chunks.push(Buffer.from([0]));
  }
  chunks.push(Buffer.from([0])); const tree = Buffer.concat(chunks), header = Buffer.alloc(version === 1 ? 12 : 28);
  header.writeUInt32LE(0x55aa1234, 0); header.writeUInt32LE(version, 4); header.writeUInt32LE(tree.length, 8);
  if (version === 2) header.writeUInt32LE(embeddedOffset, 12);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, Buffer.concat([header, tree, ...embedded]));
  if (split) await fs.writeFile(file.replace(/_dir\.vpk$/, '_000.vpk'), Buffer.concat(external));
  return file;
}
export const addonInfo = title => `"AddonInfo" { "addontitle" "${title}" "addonauthor" "Flare 离线夹具" "addonversion" "1.0" }`;
