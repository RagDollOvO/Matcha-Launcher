import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { crc32 } from 'node:zlib';
import tls from 'node:tls';
import { randomUUID, X509Certificate } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import lockfile from 'proper-lockfile';
import { PlatformError } from '../core.mjs';
import manifest from './steampp-manifest.json' with { type: 'json' };
import imageRoute from './image-route.json' with { type: 'json' };

const root = fileURLToPath(new URL('../../', import.meta.url));
const exec = promisify(execFile);
const fail = (code, message) => { throw new PlatformError(code, message); };
const exists = file => fs.access(file).then(() => true, () => false);
export const steamHost = host => /(^|\.)(steamcommunity\.com|steampowered\.com|steamstatic\.com|steamusercontent\.com|st\.dl\.eccdnx\.com)$/.test(host)
  || ['steamcdn-a.akamaihd.net', 'steamuserimages-a.akamaihd.net', 'steamusercontent-a.akamaihd.net'].includes(host);
export function hostsSection(text) {
  return text.match(/^# Steam\+\+ Start\r?\n[\s\S]*?^# Steam\+\+ End\r?$/m)?.[0] ?? '';
}
const hasTags = text => /^# Steam\+\+ (?:Backup )?(?:Start|End)\s*$/mi.test(text);
const mappedSteam = section => /^127\.0\.0\.1[ \t]+steamcommunity\.com\r?$/m.test(section);
const mappedImages = section => section.split(/\r?\n/).some(line => line.trim().split(/[ \t]+/).join(' ') === `127.0.0.1 ${imageRoute.target}`);
const asText = bytes => bytes.toString('latin1');
// The CRC is part of Watt Toolkit's version-pinned named-pipe protocol.
export function enginePipe(executable) {
  return `\\\\.\\pipe\\net.steampp.app_v${manifest.version}_${crc32(Buffer.from(executable)).toString(16).padStart(8, '0')}`;
}
async function atomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temp, JSON.stringify(value, null, 2), { flag: 'wx' }); await fs.rename(temp, file); }
  finally { await fs.unlink(temp).catch(() => {}); }
}
export class CommunityAcceleration {
  constructor({ dataDir, emit = () => {}, bundle = path.join(root, 'vendor/steampp', manifest.version), supported = process.platform === 'win32' } = {}) {
    this.folder = path.resolve(dataDir, 'community');
    this.runtime = path.join(this.folder, `steampp-${manifest.version}`);
    this.plugin = path.join(this.runtime, 'AppData/Plugins/Accelerator');
    this.certFile = path.join(this.plugin, 'SteamTools.Certificate.cer');
    this.stateFile = path.join(this.folder, 'state.json');
    this.hostsBackup = path.join(this.folder, 'hosts-before.txt');
    this.hostsFile = path.join(process.env.WINDIR ?? 'C:/Windows', 'System32/drivers/etc/hosts');
    this.bundle = bundle; this.supported = supported; this.emit = emit;
    this.state = { version: 1, enabled: false, consent: 0, phase: 'off' };
    this.phase = 'off'; this.message = ''; this.ca = ''; this.active = false; this.queue = Promise.resolve();
    this.ready = this.load().catch(e => { this.configError = e; this.update('error', '社区加速配置读取失败，原文件已保留。'); });
  }
  async load() {
    try {
      const s = JSON.parse(await fs.readFile(this.stateFile, 'utf8'));
      if (s.version !== 1 || typeof s.enabled !== 'boolean' || !['off', 'starting', 'running'].includes(s.phase)) {
        fail('acceleration_config', '社区加速配置格式需要检查，原文件已保留。');
      }
      this.state = s;
      if (s.phase !== 'off') { this.phase = 'recovery'; this.message = '上次加速尚未正常关闭，请先恢复网络。'; }
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  serial(fn) {
    const next = this.queue.then(() => this.ready).then(() => {
      if (this.configError) fail('acceleration_config', '社区加速配置读取失败，原文件已保留。');
      if (!this.supported) fail('acceleration_platform', '请在 Matcha Windows 桌面版启用。');
      if (this.closing) fail('acceleration_closing', 'Matcha 正在退出。');
      return fn();
    });
    this.queue = next.catch(() => {});
    return next;
  }
  update(phase, message = '') { this.phase = phase; this.message = message; this.emit({ type: 'community_acceleration', status: this.view() }); }
  view() { return { supported: this.supported && !this.configError, version: manifest.version, enabled: this.state.enabled, active: this.active,
    phase: this.phase, message: this.message, consentRequired: this.state.consent !== 1,
    installed: !!this.installed, folder: this.folder, recoveryRequired: this.phase === 'recovery',
    sites: { steam: this.active ? 'accelerated' : 'normal', steamImages: this.active ? 'accelerated' : 'normal', gamemaps: 'normal' } }; }
  async status() { await this.ready; this.installed = await exists(path.join(this.runtime, 'flare-component.json')); return this.view(); }
  async windows(action, args = []) {
    const env = { ...process.env }; delete env.PSModulePath; // Do not load PowerShell 7 modules into Windows PowerShell 5.
    const shell = path.join(process.env.WINDIR ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    try {
      const { stdout } = await exec(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File',
        fileURLToPath(new URL('./windows.ps1', import.meta.url)), '-Action', action, '-Runtime', await this.runtimePath(), ...args],
        { env, windowsHide: true, timeout: action === 'launch' ? 0 : 12000, maxBuffer: 1024 * 1024 });
      return JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
    } catch (e) {
      console.error('Community acceleration:', action, e.stderr || e.message);
      if (action === 'repair') fail('acceleration_recovery', '请关闭 Matcha，再右键“恢复社区网络.cmd”选择“以管理员身份运行”。');
      if (action === 'verify') fail('acceleration_component', 'Steam++ 组件签名验证失败，请检查随包文件。');
      if (action === 'launch') fail('acceleration_launch', 'Windows 未能启动已签名的 Steam++。请查看桌面服务日志。');
      if (action === 'terminate') fail('acceleration_recovery', 'Steam++ 进程仍在运行。请退出内置 Steam++ 后再点「关闭并恢复网络」。');
      fail('acceleration_windows', '读取或管理 Steam++ 进程失败，请查看桌面服务日志。');
    }
  }
  async runtimePath() {
    return fs.realpath(this.runtime).catch(e=>{ if(e.code==='ENOENT')return this.runtime;throw e; });
  }
  async save(patch) {
    const state = { ...this.state, ...patch };
    await atomic(this.stateFile, state); this.state = state;
  }
  async acquire() {
    if (this.release) return;
    await fs.mkdir(this.folder, { recursive: true });
    const control = path.join(process.env.LOCALAPPDATA ?? this.folder, 'Matcha.community.control');
    try { this.release = await lockfile.lock(control, { realpath: false, stale: 10000, retries: 0,
      onCompromised: e => { this.active = false; this.update('recovery', `加速控制权已变化：${e.message}`); } }); }
    catch { fail('acceleration_busy', '另一 Matcha 窗口正在管理社区加速，请在该窗口操作。'); }
    try { await this.load(); } catch (e) { await this.unlock(); throw e; }
  }
  async unlock() { const release = this.release; this.release = null; await release?.(); }
  async prepare() {
    const marker = path.join(this.runtime, 'flare-component.json');
    if (await exists(marker)) { await this.windows('verify'); this.installed = true; return; }
    if (!await exists(path.join(this.bundle, 'Steam++.exe'))) fail('acceleration_component_missing', '随包的 Steam++ 组件缺失，请从完整的 Matcha 文件夹启动。');
    // Windows scanners can retain executable-directory handles. Publish a ready marker
    // after copying and signature validation; never rename a populated runtime directory.
    const stage = this.runtime;
    await fs.mkdir(stage, { recursive: true });
    // Copy only executable resources; each PC generates its own certificate and data.
    for (const name of ['Steam++.exe', 'Steam++.exe.config', 'assemblies', 'dotnet', 'native']) {
      await fs.cp(path.join(this.bundle, name), path.join(stage, name), { recursive: true, force: true });
    }
    await fs.cp(path.join(this.bundle, 'modules/Accelerator'), path.join(stage, 'modules/Accelerator'), { recursive: true, force: true });
    await fs.mkdir(path.join(stage, 'AppData/Settings'), { recursive: true });
    await this.windows('verify');
    await atomic(marker, { version: manifest.version });
    this.installed = true;
  }
  async configure() {
    const read = async file => { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; } };
    const generalFile = path.join(this.runtime, 'AppData/Settings/GeneralSettings.json');
    const general = await read(generalFile);
    const generalSettings = { ...general.GeneralSettings, AutoCheckAppUpdate: false, MinimizeOnStartup: true, WebProxyMode: 'NoProxy' };
    delete generalSettings.AutoRunOnStartup; // Keep upstream's default (off).
    await atomic(generalFile, { ...general, GeneralSettings: generalSettings });
    const file = path.join(this.plugin, 'Settings/ProxySettings.json'), saved = await read(file);
    await atomic(file, { ...saved, ProxySettings: { ...saved.ProxySettings, ProgramStartupRunProxy: false, ProxyMode: 'Hosts',
      SystemProxyIp: '127.0.0.1', TwoLevelAgentEnable: false, Socks5ProxyEnable: false, IsEnableScript: false,
      IsAutoCheckScriptUpdate: false, ProxyBeforeDNSCheck: false, SupportProxyServicesStatus: manifest.projects } });
  }
  async pipe(message) {
    if (!['proxy On', 'proxy Off', 'shutdown'].includes(message)) throw new Error('Invalid engine control message');
    const pipeName=enginePipe(path.join(await this.runtimePath(),'Steam++.exe'));
    for (let n = 0; ; n++) {
      let h;
      try { h = await fs.open(pipeName, 'w'); await h.writeFile(`${message}\n`); return; }
      catch (e) { if (n >= 24 || !['EBUSY', 'ENOENT'].includes(e.code)) throw e; await delay(200); }
      finally { await h?.close(); }
    }
  }
  async processes() { return (await this.windows('inspect')).processes; }
  engineAlive() {
    if (!this.pid) return false;
    try { process.kill(this.pid,0); return true; }
    catch (e) { if(e.code==='EPERM')return true;if(e.code==='ESRCH')return false;throw e; }
  }
  async startProcess(rows) {
    if (rows.some(p => !p.owned)) fail('acceleration_conflict', '另一个 Steam++ 正在运行，请先在它里面关闭加速并退出，再启用 Matcha 内置加速。');
    if (rows.length) fail('acceleration_conflict', '上次的内置加速组件仍在运行，请先恢复网络。');
    await this.configure();
    const result = await this.windows('launch');
    if (result.status==='cancelled') fail('acceleration_cancelled','已取消 Windows 授权，社区加速保持关闭。');
    if (result.status!=='started' || !Number.isSafeInteger(result.pid) || result.pid<=0)
      fail('acceleration_launch',`Windows 拒绝启动 Steam++${result.win32?'（错误 '+result.win32+'）':''}，请检查系统的应用运行策略。`);
    this.pid = result.pid;
    const started = Date.now();
    await this.save({ownerPid:this.pid});
    // Wait for rule initialization, not merely a process appearing.
    for (let n = 0; n < 140; n++) {
      if (this.closing) fail('acceleration_closing', 'Matcha 正在退出。');
      if (!this.engineAlive()) fail('acceleration_start', 'Steam++ 在初始化时退出了，请查看组件日志。');
      const cache = await fs.stat(path.join(this.plugin, 'LOCAL_ACCELERATE.json')).catch(() => null);
      if (cache && cache.size > 0 && (cache.mtimeMs >= started - 1000 || Date.now() - started >= 24000)) return;
      await delay(250);
    }
    fail('acceleration_start', 'Steam++ 初始化超时，请完成 Windows 授权后重试。');
  }
  async localHealth() {
    const raw = await fs.readFile(this.certFile), cert = new X509Certificate(raw);
    if (new Date(cert.validTo) <= new Date()) fail('acceleration_certificate', '加速证书已过期，请关闭后重新启用以更新。');
    const ca = cert.toString();
    await Promise.all(['steamcommunity.com', imageRoute.target].map(servername => new Promise((resolve, reject) => {
      const socket = tls.connect({ host: '127.0.0.1', port: 443, servername, ca, rejectUnauthorized: true }, () => { socket.end(); resolve(); });
      socket.setTimeout(1500, () => socket.destroy(new Error('本地加速服务尚未就绪。'))); socket.once('error', reject);
    })));
    return ca;
  }
  async setEnabled(enabled, { consent = false } = {}) {
    if (typeof enabled !== 'boolean') fail('invalid_argument', '社区加速开关需要布尔值。');
    return this.serial(async () => {
      await this.acquire();
      try {
        if (!enabled) { await this.save({ enabled: false }); await this.stop(); return this.view(); }
        if (this.state.consent !== 1 && !consent) fail('acceleration_consent', '首次启用请确认本机证书与 hosts 授权。');
        if (this.active) return this.view();
        if (this.state.phase !== 'off') fail('acceleration_recovery', '上次加速尚未正常关闭，请先恢复网络。');
        if ((await this.processes()).length || hasTags(asText(await fs.readFile(this.hostsFile)))) {
          fail('acceleration_conflict', '检测到已有 Steam++ 进程或加速记录，请先从原程序关闭加速。');
        }
        const preflight = await this.windows('preflight');
        if (preflight.startupTask) fail('acceleration_conflict', '独立版 Steam++ 已设置开机启动。要切换为内置版，请先在独立版关闭该选项。');
        if (preflight.portBusy) fail('acceleration_port', '本机 443 端口已被占用，释放端口后再启用。');
        this.update('starting', '正在准备 Steam++ 组件…');
        await this.prepare();
        const before = await fs.readFile(this.hostsFile);
        if (hasTags(asText(before))) fail('acceleration_conflict', '其他 Steam++ 已写入加速记录，请从原程序关闭。');
        if (this.closing) fail('acceleration_closing', 'Matcha 正在退出。');
        await fs.writeFile(this.hostsBackup, before);
        await this.save({ enabled: true, consent: 1, phase: 'starting', ownerPid: null, section: '' });
        try {
          this.update('starting', '正在启动。若出现 Windows 授权窗口，请确认…');
          await this.startProcess(await this.processes());
          if (this.closing) fail('acceleration_closing', 'Matcha 正在退出。');
          await this.pipe('proxy On');
          const deadline = Date.now() + 27000;
          while (Date.now() < deadline && !this.closing && this.engineAlive()) {
            const section = hostsSection(asText(await fs.readFile(this.hostsFile)));
            if (mappedSteam(section) && mappedImages(section)) {
              if (!this.state.section) await this.save({ section });
              const ca = await this.localHealth().catch(() => '');
              if (ca) {
                await this.save({ phase: 'running', section });
                this.ca = ca; this.active = true; this.update('running');
                this.monitor = setInterval(() => void this.monitorHealth(), 10000); this.monitor.unref();
                return this.view();
              }
            }
            await delay(250);
          }
          fail('acceleration_start', 'Steam++ 未就绪，请检查 Windows 授权或本地 443 端口后重试。');
        } catch (error) {
          try { await this.save({ enabled: false }); } finally { await this.stop(); }
          throw error;
        }
      } catch (error) {
        this.update(this.state.phase === 'off' ? (error.code==='acceleration_cancelled'?'off':'error') : 'recovery', error.message);
        throw error;
      } finally {
        if (!this.active) await this.unlock();
      }
    });
  }
  async monitorHealth() {
    if (!this.active || this.checking) return;
    this.checking = true;
    try {
      await this.localHealth();
      if (hostsSection(asText(await fs.readFile(this.hostsFile))) !== this.state.section) throw new Error('加速站点记录已变化。');
    }
    catch { if (this.active) { this.active = false; clearInterval(this.monitor); this.update('recovery', '加速连接已中断，请点“关闭并恢复网络”。'); } }
    finally { this.checking = false; }
  }
  async stop() {
    clearInterval(this.monitor); this.active = false; this.ca = '';
    if (this.state.phase === 'off') { this.update('off'); return; }
    this.update('stopping', '正在关闭并恢复网络…');
    const rows = await this.processes();
    if (rows.some(p => !p.owned)) fail('acceleration_conflict', '另一 Steam++ 正在运行，请先关闭它，再恢复 Matcha 的加速记录。');
    const owner = rows.find(p => p.main && p.pid === (this.state.ownerPid ?? this.pid)) ?? rows.find(p => p.main);
    if (owner) {
      const sent = await this.pipe('proxy Off').then(() => true, () => false);
      for (let n = 0; sent && n < 50 && hasTags(asText(await fs.readFile(this.hostsFile))); n++) await delay(100);
      if (hasTags(asText(await fs.readFile(this.hostsFile)))) {
        fail('acceleration_recovery', 'Steam++ 尚未恢复 hosts，组件保持运行。请重试“关闭并恢复网络”。');
      }
      // Ask the elevated component to exit itself through its own control pipe.
      // Keep the old scoped cleanup path for a stuck component.
      if (await this.pipe('shutdown').then(()=>true,()=>false)) {
        for (let n=0;n<10;n++){ if (!(await this.processes()).some(p=>p.owned)) break; await delay(150); }
      }
      if ((await this.processes()).some(p=>p.owned)) await this.windows('terminate', ['-OwnerPid', String(owner.pid)]);
    } else if (rows.length) {
      await this.windows('terminate', ['-OwnerPid', String(this.state.ownerPid ?? this.pid ?? 0)]);
    }
    const current = await fs.readFile(this.hostsFile);
    if (hasTags(asText(current))) {
      if ((await this.processes()).length) fail('acceleration_recovery', '加速组件仍在运行，请先退出再恢复 hosts。');
      await this.repairHosts(current);
      if (hasTags(asText(await fs.readFile(this.hostsFile)))) fail('acceleration_recovery', 'hosts 恢复尚未完成。');
    }
    this.pid = null;
    await this.save({ phase: 'off', ownerPid: null, section: '' });
    this.update('off');
  }
  async repairHosts(current) {
    const text = asText(current), section = hostsSection(text);
    const before = asText(await fs.readFile(this.hostsBackup));
    if (!section || hasTags(before) || section !== this.state.section ||
      !mappedSteam(section) || !section.split(/\r?\n/).slice(1, -1).every(line => /^127\.0\.0\.1[ \t]+[a-z0-9.-]+$/i.test(line))) {
      fail('acceleration_recovery', 'hosts 中的记录与加速日志不一致。请对照 community\\hosts-before.txt 手动核对，原文件已保留。');
    }
    const backup = text.match(/^# Steam\+\+ Backup Start\r?\n([\s\S]*?)^# Steam\+\+ Backup End\r?$/m);
    const originals = (backup?.[1].match(/[^\r\n]+/g) ?? []).map(line => line.replace(/^#\d+ /, ''));
    const originalLines = new Set(before.split(/\r?\n/));
    if (originals.some(line => !originalLines.has(line))) {
      fail('acceleration_recovery', 'hosts 中的原始记录需要手动核对，原文件已保留。');
    }
    const lineEnd = text.includes('\r\n') ? '\r\n' : '\n';
    let restored = text.replace(section + (text.includes(section + '\n') ? '\n' : ''), '');
    if (backup) restored = restored.replace(backup[0] + (restored.includes(backup[0] + '\n') ? '\n' : ''), '');
    if (hasTags(restored)) fail('acceleration_recovery', 'hosts 中的标记不完整，原文件已保留。');
    const restoredLines = new Set(restored.split(/\r?\n/));
    const missing = originals.filter(line => !restoredLines.has(line));
    if (missing.length) restored += (restored.endsWith('\n') ? '' : lineEnd) + missing.join(lineEnd) + lineEnd;
    // Compare input and write only under an exclusive handle. Don't overwrite the whole backup.
    const pair = path.join(this.folder, 'hosts-repair-' + randomUUID());
    try {
      await fs.writeFile(pair + '.before', current, { flag: 'wx' });
      await fs.writeFile(pair + '.after', Buffer.from(restored, 'latin1'), { flag: 'wx' });
      await this.windows('repair', ['-RepairPair', pair]);
    } finally { for (const suffix of ['.before', '.after']) await fs.unlink(pair + suffix).catch(() => {}); }
  }
  async recover() { return this.setEnabled(false); }
  async resume() {
    await this.ready;
    if (!this.closing && this.supported && !this.configError && this.state.phase === 'off' && this.state.enabled && this.state.consent === 1) {
      await this.setEnabled(true).catch(e => { if (!this.closing && e.code!=='acceleration_cancelled') this.update(this.phase === 'recovery' ? 'recovery' : 'error', e.message); });
    }
  }
  async close() {
    this.closing = true;
    await this.queue;
    if (this.release) {
      try { await this.stop(); } catch (e) { this.update('recovery', e.message); }
      finally { await this.unlock(); }
    }
  }
}
