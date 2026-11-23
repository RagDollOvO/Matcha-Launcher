import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile as callback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(callback);
const verifier = fileURLToPath(new URL('../native/build-x86/dist/tools/beacon_verify.exe', import.meta.url));
const fail = message => { throw Object.assign(new Error(message), { code: 'release_rejected' }); };

export async function verifyRelease(directory, policyPath, expected = '') {
  const entries = await fs.readdir(directory);
  const names = process.platform === 'win32' ? entries.map(n => n.toLowerCase()) : entries;
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
