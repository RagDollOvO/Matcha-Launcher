import fs from 'node:fs/promises';
import { validUpdateDeclaration } from './platforms/sdk-declaration.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile as callback } from 'node:child_process';
import { promisify } from 'node:util';
const execFile = promisify(callback);
const verifier = fileURLToPath(new URL('../native/build-x86/dist/tools/beacon_verify.exe', import.meta.url));
const fail = message => { throw Object.assign(new Error(message), { code: 'release_rejected' }); };
export async function verifyRelease(directory, policyPath, expected = '') {
  const entries = await fs.readdir(directory);
  const names = process.platform==='win32' ? entries.map(n=>n.toLowerCase()) : entries;
  if (!names.includes('release.json') && !names.includes('release.p7s') && !expected) {
    const marker = names.includes('.l4p-package.json') ? JSON.parse(await fs.readFile(path.join(directory, '.l4p-package.json'), 'utf8')) : {};
    if (marker.releaseSha256) fail('release_removed');
    return { state: 'unverified', channel: 'local', signature: 'absent', integrity: 'unverified', source: { visibility: 'unknown' }, build: { status: 'unverified' }, behaviorReview: { status: 'pending' } };
  }
  if (!policyPath) fail('release_trust_policy_required');
  let stdout;
  try { ({ stdout } = await execFile(verifier, [path.resolve(directory), path.resolve(policyPath), expected], { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 })); }
  catch (e) { if (!e.stdout) fail(`release_verifier_unavailable: ${e.message}`); stdout = e.stdout; }
  const result = JSON.parse(stdout);
  if (!result.ok) fail(result.error.message);
  return result.verification;
}

// Deterministic metadata and lexical checks. No source content is returned to Pi.
// Project files and build scripts never become instructions or host commands.
export async function checkProject(directory) {
  const root = path.resolve(directory), findings = [];
  const add = (rule, severity, field, message) => findings.push({ rule, severity, field, message });
  const file = path.join(root, 'manifest.json'), stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) fail('project_manifest_unsafe');
  const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
  const m = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  const { validateManifest } = await import('./core.mjs');
  try { validateManifest(m); } catch(e) { add('SDK001', 'error', 'manifest', e.message); }
  const d = m.developer;
  if(d?.updates!==undefined && !validUpdateDeclaration(d.updates))add('UPDATE001','warning','developer.updates','填写 github-release 来源、仓库 owner/name 和 ZIP 附件规则，以启用自动检查');
  if (!d || typeof d !== 'object') add('META001', 'error', 'developer', '补充作者、源码、许可证、兼容环境及能力声明');
  else {
    for (const name of ['author', 'purpose', 'license']) if (typeof d[name] !== 'string' || !d[name].trim()) add('META002','error',`developer.${name}`,'需要非空声明');
    if (!['public','private','closed'].includes(d.source?.visibility)) add('SOURCE001','error','developer.source.visibility','选择 public/private/closed');
    if (!/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(d.source?.commit ?? '')) add('SOURCE002','warning','developer.source.commit','发布前固定源码提交；本地快照可用于开发核验');
    if (d.source?.visibility === 'public' && !/^https:\/\//.test(d.source?.url ?? '')) add('SOURCE003','error','developer.source.url','公开源码需要 HTTPS 来源地址');
    for (const name of ['modes','gameBuilds']) if (!Array.isArray(d[name]) || !d[name].length) add('COMPAT001','error',`developer.${name}`,'列出适用模式与已验证游戏版本，未实测用 untested');
    for (const name of ['filesystem','network','externalPrograms','hooks','memoryModification']) if (!Array.isArray(d.capabilities?.[name])) add('CAP001','error',`developer.capabilities.${name}`,'显式列出用途与范围，无此能力使用空数组');
    for (const name of ['credentialTheft','hiddenDownloadExecution','crossProcessInjection','antiCheatBypass','unfairAdvantage']) {
      if (d.prohibited?.[name] !== false) add('POLICY001','error',`developer.prohibited.${name}`,'拒绝此类功能；声明需维护者结合源码审核');
    }
    if (Object.values(d.capabilities ?? {}).some(v => Array.isArray(v) && v.length)) add('REVIEW001','warning','developer.capabilities','敏感能力等待维护者逐项审核');
  }
  // Report locations and rule IDs, never snippets or author-authored messages.
  // Lexical hits are review leads; maintainers inspect data flow and intent.
  const sourcePath = path.join(root, 'plugin.cpp');
  const sourceStat = await fs.lstat(sourcePath).catch(() => null);
  if (!sourceStat?.isFile() || sourceStat.isSymbolicLink() || sourceStat.size > 2 * 1024 * 1024) add('SDK002','error','plugin.cpp','需要可读的常规 C++ 源文件（上限 2 MiB）');
  else {
    const source = await fs.readFile(sourcePath, 'utf8');
    const patterns = [
      ['RISK001', /\b(?:CreateRemoteThread|WriteProcessMemory|VirtualAllocEx)\s*\(/g, '跨进程操作需要人工确认用途；跨进程注入属于拒绝项'],
      ['RISK002', /\b(?:URLDownloadToFile\w*|WinHttp\w*|InternetOpen\w*|connect)\s*\(/g, '网络访问需要核对声明与数据流'],
      ['RISK003', /\b(?:CreateProcess\w*|ShellExecute\w*|system|LoadLibrary\w*)\s*\(/g, '外部执行或动态加载需要人工审核'],
      ['RISK004', /\b(?:VirtualProtect|Detour\w*|MH_CreateHook)\s*\(/g, '内存修改或 Hook 需要人工审核'],
    ];
    for (const [rule, pattern, message] of patterns) for (const hit of source.matchAll(pattern)) {
      if (findings.length >= 100) break;
      add(rule,'warning',`plugin.cpp:${source.slice(0,hit.index).split('\n').length}`,message);
    }
  }
  return { schemaVersion: 1, kind: 'beacon-project-check', rulesVersion: 1, id: /^[a-z0-9][a-z0-9._-]{0,63}$/.test(m.id ?? '') ? m.id : null,
    status: findings.some(f=>f.severity==='error') ? 'needs_changes' : 'ready-for-build', findings,
    sourceContentShared: false, sourceBehaviorReview: 'pending', scanScope: ['manifest.json', 'plugin.cpp'], buildExecution: 'not-run',
    publicRecommendation: 'pending-maintainer-and-independent-reproduction' };
}
