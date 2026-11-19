// Produce a self-contained portable folder. Existing releases are kept intact.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import steampp from '../backend/community/steampp-manifest.json' with { type: 'json' };

const project = fileURLToPath(new URL('../', import.meta.url));
const config = JSON.parse(await fs.readFile(path.join(project, 'src-tauri/tauri.conf.json'), 'utf8'));
const beta=process.argv.includes('--beta');
const variant=beta ? JSON.parse(await fs.readFile(path.join(project,'src-tauri/tauri.beta.conf.json'),'utf8')) : config;
const nodeRoot = path.dirname(process.execPath);
const piRoot = process.env.BEACON_PI_PACKAGE ?? path.join(nodeRoot, 'node_modules/@earendil-works/pi-coding-agent');
const pi = JSON.parse(await fs.readFile(path.join(piRoot, 'package.json'), 'utf8'));
const appName = config.productName;
const exeName = `${config.mainBinaryName}.exe`;
// The beta has a separate Tauri identifier (including WebView2). Keep the public entry point Matcha.exe.
const executable = path.join(project, 'src-tauri/target/release', variant.mainBinaryName+'.exe');
await fs.access(executable);
await fs.access(path.join(piRoot, 'dist/bundle/cli.js'));
const steamComponents = ['Steam++.exe', 'Steam++.exe.config', 'assemblies', 'dotnet', 'native', 'modules/Accelerator'];
const steamSource = path.join(project, 'vendor/steampp', steampp.version);
for (const name of steamComponents) await fs.access(path.join(steamSource, name));
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const releases = path.join(project, 'release');
const desktopOut=process.argv.indexOf('--output');
await fs.mkdir(releases, { recursive: true });
const target = desktopOut<0 ? path.join(releases, `${appName}-${config.version}-${stamp}`) : path.resolve(process.argv[desktopOut+1]);
if(desktopOut>=0 && (!beta || path.basename(target)!=='内测版'))throw new Error('Use a new 内测版 directory for the beta output');
await fs.mkdir(target);
const copy = async (source, dest) => {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.cp(source, dest, { recursive: true, force: false, errorOnExist: true,
    filter: p=>p!==path.join(project,'backend/node_modules/xmlrpc/tmp') });
};
await copy(executable, path.join(target, exeName));
for (const name of await fs.readdir(path.dirname(executable))) {
  if (name.endsWith('.dll')) await copy(path.join(path.dirname(executable), name), path.join(target, name));
}
for (const [source, dest] of Object.entries(config.bundle.resources)) {
  await copy(path.resolve(project, 'src-tauri', source), path.join(target, dest));
}
// Only upstream binaries and dependencies. Never distribute the runtime's private AppData, certificates or cache.
// GitHub Actions supplies GITHUB_REPOSITORY; local release builders may set the same channel explicitly.
const repository = process.env.MATCHA_UPDATE_REPOSITORY || process.env.GITHUB_REPOSITORY;
if (repository) {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_\-][A-Za-z0-9_.-]*$/.test(repository)) throw new Error('Expected GitHub owner/repository');
  await fs.writeFile(path.join(target, 'backend/desktop/release-channel.json'), JSON.stringify({ repository }));
}
for (const name of steamComponents) await copy(path.join(steamSource, name), path.join(target, 'vendor/steampp', steampp.version, name));
await copy(process.execPath, path.join(target, 'runtime/node.exe'));
await copy(piRoot, path.join(target, 'runtime/node_modules/@earendil-works/pi-coding-agent'));
await copy(path.join(project, 'docs/licenses/Pi-LICENSE.txt'), path.join(target, 'licenses/Pi-LICENSE.txt'));
await copy(path.join(project, 'public/fonts/maiyuan/OFL.txt'), path.join(target, 'licenses/Kingnam-Maiyuan-OFL.txt'));
await copy(path.join(project, 'docs/licenses/DSH-Browser-LICENSE.txt'), path.join(target, 'licenses/DSH-Browser-LICENSE.txt'));
await copy(path.join(project, 'docs/licenses/SteamTools-LICENSE.txt'), path.join(target, 'licenses/SteamTools-LICENSE.txt'));
await copy(path.join(project, 'docs/licenses/SteamTools-SOURCE.md'), path.join(target, 'licenses/SteamTools-SOURCE.md'));
await copy(path.join(project, 'src/lib/browser/dsh/SOURCE.md'), path.join(target, 'licenses/DSH-Browser-SOURCE.md'));
await copy(path.join(project, 'native/vendor/dr_wav/SOURCE.txt'), path.join(target, 'licenses/dr_wav-SOURCE.txt'));
await copy(path.join(project, 'native/vendor/dr_wav/dr_wav.h'), path.join(target, 'licenses/dr_wav.h'));
await copy(path.join(nodeRoot, 'LICENSE'), path.join(target, 'licenses/Node-LICENSE.txt'));
await copy(path.join(project, 'docs/platform/MODS.md'), path.join(target, 'Mod使用说明.md'));
await copy(path.join(project, 'docs/platform/SERVERS.md'), path.join(target, '服务器使用说明.md'));
// Preserve documentation-relative links alongside the adapter catalog already bundled above.
if(beta){
  for(const name of ['DLL_SPEC.md','MODS.md','SERVERS.md','COMMUNITY_ACCELERATION.md','GAME_SETTINGS.md','LIGHTWEIGHT_MODS.md','NATIVE_LIBRARIES.md'])
    await copy(path.join(project,'docs/platform',name),path.join(target,'docs/platform',name));
  await copy(path.join(project,'docs/platform/BETA_START.md'),path.join(target,'docs/platform/MATCHA_DESKTOP.md'));
  await copy(path.join(project,'docs/licenses'),path.join(target,'docs/licenses'));
  // MODS.md links to an internal development plan in the source tree.
  for(const f of ['Mod使用说明.md','docs/platform/MODS.md']){
    const dest=path.join(target,f);const text=await fs.readFile(dest,'utf8');
    await fs.writeFile(dest,text.replaceAll(/[，。]详见 ?\[接入契约\]\(\.\.\/mod-library-plan\.md\)/g,''));
  }
  const nativeDoc=path.join(target,'docs/platform/NATIVE_LIBRARIES.md');
  await fs.writeFile(nativeDoc,(await fs.readFile(nativeDoc,'utf8')).replace(/(?:后端与 Agent 工具已就绪，前端对接见|前端对接见) ?\[[^\]]+\]\(\.\.\/dll-[^)]+\)。/g,''));
}else await fs.cp(path.join(project, 'docs'), path.join(target, 'docs'), { recursive: true, force: false });
await fs.writeFile(path.join(target, '恢复社区网络.cmd'),
  '@echo off\r\nsetlocal\r\nchcp 65001 >nul\r\n'+(beta?`set "BEACON_DATA_DIR=%LOCALAPPDATA%\\${variant.identifier}"\r\n`:'')+'set "NODE_OPTIONS="\r\nset "NODE_PATH="\r\n"%~dp0runtime\\node.exe" "%~dp0backend\\community\\recover.mjs"\r\npause\r\n');
await fs.writeFile(path.join(target, `${appName}使用说明.md`), '# Matcha 使用说明\n\n[打开使用手册](docs/platform/MATCHA_DESKTOP.md) · [社区加速](docs/platform/COMMUNITY_ACCELERATION.md) · [Mod](docs/platform/MODS.md) · [服务器](docs/platform/SERVERS.md) · [本次更新](本次更新.md)\n');
const notesIndex = process.argv.indexOf('--notes');
const notes = notesIndex > 0 ? process.argv[notesIndex + 1] : 'docs/platform/MATCHA_DESKTOP_UPDATE.md';
if (!notes) throw new Error('--notes requires a Markdown path');
const updateNotes = await fs.readFile(path.resolve(project, notes), 'utf8');
await fs.writeFile(path.join(target, '本次更新.md'), updateNotes
  .replace(/\]\((DLL_COLLECTIONS|SKEETO_PORT|COMMUNITY_ACCELERATION|DEVELOPER_GUIDE|MATCHA_DESKTOP|MODS|SERVERS|NATIVE_LIBRARIES|LIGHTWEIGHT_MODS)\.md\)/g, ']\(docs/platform/$1.md)')
  .replace(/\]\(\.\.\/([a-z-]+\.md)\)/g, '](docs/$1)'));
await fs.writeFile(path.join(target, 'README.txt'), `${appName}\r\n\r\n双击 ${exeName} 启动。请将整个文件夹一起保存和移动。\r\n页面已内置，随包提供 Node.js ${process.version} 与 Pi CLI ${pi.version}。\r\n运行环境：Windows x64、Microsoft Edge WebView2 Runtime（本机已有）。\r\n\r\n设置、方案与 Pi 独立配置继续使用：%LOCALAPPDATA%\\com.matcha.launcher\r\n桌面服务日志：%LOCALAPPDATA%\\com.matcha.launcher\\logs\\desktop-service.log\r\n\r\nMod：在 Mod 页编辑并设为启动方案，再回主页用 L4N 平台启动。\r\n导入和手动应用在游戏退出后执行；启动游戏由用户确认。\r\nPi：启动后后台自动连接；内置 Mod、DLL 和服务器整理技能。首次使用请在设置中配置模型。\r\n`);
await fs.writeFile(path.join(target, 'release.json'), JSON.stringify({ version: config.version, ...(beta && {channel:'beta',identifier:variant.identifier}), builtAt: new Date().toISOString(), node: process.version, pi: pi.version, steampp: steampp.version, platform: process.platform, architecture: process.arch }, null, 2));
if(beta)await fs.writeFile(path.join(target,'README.txt'),'Matcha 内测版 · Windows x64\r\n请先完整解压，再双击 Matcha.exe。\r\n首次测试与启停步骤：docs\\platform\\MATCHA_DESKTOP.md\r\n');
if (!beta && !process.argv.includes('--candidate')) await fs.writeFile(path.join(releases, 'latest.json'), JSON.stringify({ directory: target, executable: path.join(target, exeName) }, null, 2));
console.log(JSON.stringify({ directory: target, executable: path.join(target, exeName) }));
