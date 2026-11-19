import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MOD_SKILL = fileURLToPath(new URL('./skills/matcha-mod-organizer/SKILL.md', import.meta.url));
export const DLL_SKILL = fileURLToPath(new URL('./skills/matcha-dll-organizer/SKILL.md', import.meta.url));
export const SERVER_SKILL = fileURLToPath(new URL('./skills/matcha-server-organizer/SKILL.md', import.meta.url));
export const CHECKUP_SKILL = fileURLToPath(new URL('./skills/matcha-checkup/SKILL.md', import.meta.url));
export async function readSkill({ path: file, offset = 1, limit }, cwd = process.cwd()) {
  const same = value => process.platform === 'win32' ? value.toLowerCase() : value;
  const selected = typeof file === 'string' ? [MOD_SKILL, DLL_SKILL, SERVER_SKILL, CHECKUP_SKILL].find(p => same(path.resolve(cwd, file)) === same(p)) : undefined;
  if (!selected) {
    throw Object.assign(new Error('请选择技能清单中 Matcha 内置 SKILL.md 的完整路径。'), { code: 'SKILL_SCOPE' });
  }
  if (!Number.isSafeInteger(offset) || offset < 1 || (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1))) throw new Error('行号和行数需要正整数。');
  const lines = (await fs.readFile(selected, 'utf8')).split('\n');
  return { content: [{ type: 'text', text: lines.slice(offset - 1, limit === undefined ? undefined : offset - 1 + limit).join('\n') }], details: { lines: lines.length } };
}
