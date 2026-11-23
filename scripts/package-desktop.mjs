// Produce a self-contained portable folder. Existing releases are kept intact.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import steampp from '../backend/community/steampp-manifest.json' with { type: 'json' };
import { portableDocs, writePortableDocs } from './portable-docs.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const config = JSON.parse(await fs.readFile(path.join(project, 'src-tauri/tauri.conf.json'), 'utf8'));
const args = process.argv.slice(2);
function valueOf(flag) {
  const index = args.indexOf(flag);
  if (index < 0) return;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a path`);
  return value;
}

const beta = args.includes('--beta');
const variant = beta ? JSON.parse(await fs.readFile(path.join(project, 'src-tauri/tauri.beta.conf.json'), 'utf8')) : config;
const appName = config.productName;
const exeName = `${config.mainBinaryName}.exe`;
// The beta has a separate Tauri identifier (including WebView2). Keep the public entry point Matcha.exe.
const buildDir = path.resolve(project, 'src-tauri', process.env.CARGO_TARGET_DIR ?? 'target', 'release');
const executable = path.join(buildDir, variant.mainBinaryName+'.exe');
const output = valueOf('--output');
const outputDir = output && path.resolve(output);
if (outputDir && (!beta || path.basename(outputDir) !== '内测版')) throw new Error('Use a new 内测版 directory for the beta output');
const resources = Object.entries(config.bundle.resources).map(([source, dest]) =>
  [dest, path.resolve(project, 'src-tauri', source)]);
const docs = await portableDocs(project, { appName, beta, notes: valueOf('--notes') });

if (args.includes('--check')) {
  const { checkPortableSources } = await import('./check-portable-sources.mjs');
  const checked = await checkPortableSources(new Map(resources), docs);
  console.log(JSON.stringify({ status: 'checked', channel: beta ? 'beta' : 'stable', ...checked }));
} else {
  await packageDesktop();
}

async function packageDesktop() {
  const nodeRoot = path.dirname(process.execPath);
  const piRoot = process.env.BEACON_PI_PACKAGE ?? path.join(nodeRoot, 'node_modules/@earendil-works/pi-coding-agent');
  const pi = JSON.parse(await fs.readFile(path.join(piRoot, 'package.json'), 'utf8'));
  const steamComponents = ['Steam++.exe', 'Steam++.exe.config', 'assemblies', 'dotnet', 'native', 'modules/Accelerator'];
  const steamSource = path.join(project, 'vendor/steampp', steampp.version);
  const licenses = [
    ['docs/licenses/Pi-LICENSE.txt', 'licenses/Pi-LICENSE.txt'],
    ['public/fonts/maiyuan/OFL.txt', 'licenses/Kingnam-Maiyuan-OFL.txt'],
    ['docs/licenses/DSH-Browser-LICENSE.txt', 'licenses/DSH-Browser-LICENSE.txt'],
    ['docs/licenses/SteamTools-LICENSE.txt', 'licenses/SteamTools-LICENSE.txt'],
    ['docs/licenses/SteamTools-SOURCE.md', 'licenses/SteamTools-SOURCE.md'],
    ['src/lib/browser/dsh/SOURCE.md', 'licenses/DSH-Browser-SOURCE.md'],
    ['native/vendor/dr_wav/SOURCE.txt', 'licenses/dr_wav-SOURCE.txt'],
    ['native/vendor/dr_wav/dr_wav.h', 'licenses/dr_wav.h'],
  ];
  const files = [
    [exeName, executable],
    ...(await fs.readdir(buildDir)).filter(name => name.endsWith('.dll')).map(name => [name, path.join(buildDir, name)]),
    ...resources,
    // Copy upstream binaries and dependencies; runtime certificates, AppData and cache are per-machine.
    ...steamComponents.map(name => [`vendor/steampp/${steampp.version}/${name}`, path.join(steamSource, name)]),
    ['runtime/node.exe', process.execPath],
    ['runtime/node_modules/@earendil-works/pi-coding-agent', piRoot],
    ...licenses.map(([source, dest]) => [dest, path.join(project, source)]),
    ['licenses/Node-LICENSE.txt', path.join(nodeRoot, 'LICENSE')],
  ];
  // Check all copy roots before creating a new release folder.
  for (const source of [
    ...files.map(([, source]) => source), ...docs.copies.values(),
    path.join(piRoot, 'dist/bundle/cli.js'), path.join(project, 'backend/servers/matcha-steam-friends.exe'),
  ]) await fs.access(source);

  // GitHub Actions supplies GITHUB_REPOSITORY; local builders can set the channel explicitly.
  const repository = process.env.MATCHA_UPDATE_REPOSITORY || process.env.GITHUB_REPOSITORY;
  if (repository && !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(repository)) throw new Error('Expected GitHub owner/repository');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const releases = path.join(project, 'release');
  const target = outputDir ?? path.join(releases, `${appName}-${config.version}-${stamp}`);
  if (!outputDir) await fs.mkdir(releases, { recursive: true });
  await fs.mkdir(target);
  const copy = async (source, dest) => {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.cp(source, dest, { recursive: true, force: false, errorOnExist: true,
      filter: p => p !== path.join(project, 'backend/node_modules/xmlrpc/tmp') });
  };
  for (const [dest, source] of files) await copy(source, path.join(target, dest));
  if (repository) await fs.writeFile(path.join(target, 'backend/desktop/release-channel.json'), JSON.stringify({ repository }));
  await writePortableDocs(target, docs);

  await fs.writeFile(path.join(target, '恢复社区网络.cmd'),
    '@echo off\r\nsetlocal\r\nchcp 65001 >nul\r\n' +
    (beta ? `set "BEACON_DATA_DIR=%LOCALAPPDATA%\\${variant.identifier}"\r\n` : '') +
    'set "NODE_OPTIONS="\r\nset "NODE_PATH="\r\n"%~dp0runtime\\node.exe" "%~dp0backend\\community\\recover.mjs"\r\npause\r\n');
  const readme = (beta ? [
    'Matcha 内测版 · Windows x64',
    '请先完整解压，再双击 Matcha.exe。',
    '首次测试与启停步骤：docs\\platform\\MATCHA_DESKTOP.md',
    '',
  ] : [
    appName, '',
    `双击 ${exeName} 启动。请将整个文件夹一起保存和移动。`,
    `页面已内置，随包提供 Node.js ${process.version} 与 Pi CLI ${pi.version}。`,
    '运行环境：Windows x64、Microsoft Edge WebView2 Runtime（本机已有）。', '',
    '设置、方案与 Pi 独立配置继续使用：%LOCALAPPDATA%\\com.matcha.launcher',
    '桌面服务日志：%LOCALAPPDATA%\\com.matcha.launcher\\logs\\desktop-service.log', '',
    'Mod：在 Mod 页编辑并设为启动方案，再回主页用 L4N 平台启动。',
    '导入和手动应用在游戏退出后执行；启动游戏由用户确认。',
    'Pi：启动后后台自动连接；内置 Mod、DLL 和服务器整理技能。首次使用请在设置中配置模型。',
    '',
  ]).join('\r\n');
  await fs.writeFile(path.join(target, 'README.txt'), readme + `\r\n使用说明：${appName}使用说明.md\r\n`);
  await fs.writeFile(path.join(target, 'release.json'), JSON.stringify({
    version: config.version, ...(beta && { channel: 'beta', identifier: variant.identifier }),
    builtAt: new Date().toISOString(), node: process.version, pi: pi.version, steampp: steampp.version,
    platform: process.platform, architecture: process.arch,
  }, null, 2));
  const result = { directory: target, executable: path.join(target, exeName) };
  if (!beta && !args.includes('--candidate')) await fs.writeFile(path.join(releases, 'latest.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
