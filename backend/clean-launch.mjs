import fs from 'node:fs/promises';
import path from 'node:path';
import { PlatformError } from './errors.mjs';
import { addonKey, readAddonList } from './mods/addonlist.mjs';

const proxies = ['d3d9.dll', 'dxgi.dll', 'wininet.dll', 'winmm.dll', 'version.dll',
  'dinput8.dll', 'dsound.dll', 'left4neko.dll', 'skeeto.dll'];
const present = file => fs.lstat(file).then(() => true, e => { if (e.code !== 'ENOENT') throw e; return false; });

export async function assertCleanGame(root, inspectPe, shimExport) {
  const stop = (file, hint = '请选择 Steam 原版目录，或退出游戏后手动处理。') => {
    throw new PlatformError('clean_game_modified',
      `纯净对抗检测到 ${file}。${hint}`, { file });
  };
  const entry = 'bin/dxvk_d3d9.dll';
  if (await fs.readFile(path.join(root, 'left4dead2.exe')).then(b => b.includes(Buffer.from('left4neko.dll'))))
    stop('L4N 启动入口', '纯净对抗需要 Steam 登记的原版游戏目录。L4N 启动开关只影响平台模式，当前游戏文件保持原样。');
  if (await present(path.join(root, 'left4dead2/bin/game_shader_generic_neko.dll')))
    stop('Neko 着色器入口', '退出游戏后停用 L4N 整包，或选择 Steam 原版目录。');
  if (await present(path.join(root, entry)) && (await inspectPe(path.join(root, entry))).exports.includes(shimExport))
    stop(entry, '这是 Matcha 的 DXVK 加载器。退出游戏后，在「DLL 模组 → 运行时」选择「恢复原入口」，或切换到 Steam 原版目录。');
  for (const base of ['', 'bin', 'left4dead2/bin']) {
    for (const name of proxies) {
      const rel = path.posix.join(base, name);
      if (await present(path.join(root, rel))) stop(rel);
    }
  }
  const content = path.join(root, 'left4dead2');
  const config = await readAddonList(path.join(content, 'addonlist.txt'));
  for (const [name, value] of config.values) if (value.enabled) stop(`已启用的附加内容 ${name}`);
  // Loose VPKs and Workshop entries missing from addonlist can be enabled
  // by the game on discovery. Leave the user's addon list and files alone.
  for (const base of ['addons', 'addons/workshop']) {
    const entries = await fs.readdir(path.join(content, base), { withFileTypes: true }).catch(e => {
      if (e.code === 'ENOENT') return []; throw e;
    });
    for (const item of entries) {
      if (base === 'addons' && item.name.toLowerCase() === 'workshop') continue;
      const rel = path.posix.join(base, item.name);
      if (item.isSymbolicLink() || item.name.endsWith('.vdf')) stop(rel);
      const addon = /\.vpk$/i.test(item.name) ||
        (item.isDirectory() && await present(path.join(content, rel, 'addoninfo.txt')));
      const key = addonKey(rel.slice('addons/'.length));
      if (addon && config.values.get(key)?.enabled !== false) stop(rel);
    }
  }
}
