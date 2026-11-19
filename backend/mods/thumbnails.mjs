import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { regular } from './vpk.mjs';

/** Publish a complete sidecar beside an existing VPK, preserving any supplied cover. */
export async function cacheModThumbnail(file, body) {
  await regular(file);
  const target = file.replace(/\.vpk$/i, '.jpg');
  const temp = path.join(path.dirname(file), `.cover-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temp, body, { flag: 'wx' });
    await fs.link(temp, target).catch(e => { if (e.code !== 'EEXIST') throw e; });
  } finally { await fs.unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}
