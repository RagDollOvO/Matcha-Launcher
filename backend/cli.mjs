#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from './core.mjs';
import { checkProject, verifyRelease } from './releases.mjs';
import { platformLocation } from './platforms/launch.mjs';

const CONFIRMED = Object.freeze({ approved: true, source: 'user' });
const MAX_LINE = 1024 * 1024;
const backendRoot = path.dirname(fileURLToPath(import.meta.url));
const defaultDist = path.resolve(backendRoot, '../native/build-x86/dist');
const externalPlatforms = async root => (await platformLocation(root, core.inspectGame)).readOnly;

export async function dispatch(command, params = {}, confirmation) {
  switch (command) {
    case 'inspect': return core.inspectGame(params.gameRoot);
    case 'platforms': return (await externalPlatforms(params.gameRoot)).snapshot(params.gameRoot, await core.inspectGame(params.gameRoot));
    case 'platform-doc': {
      const game = await core.inspectGame(params.gameRoot);
      return (await externalPlatforms(game.gameRoot)).doc(game.gameRoot, params.id, params.path);
    }
    case 'discover': return core.discover(params);
    case 'validate-plugin': return core.validatePlugin(params.pluginDirectory, { policyPath: params.policyPath });
    case 'check-project': return checkProject(params.pluginDirectory);
    case 'verify-release': return verifyRelease(params.pluginDirectory, params.policyPath);
    case 'configure-release-trust': return core.configureReleaseTrust({ gameRoot: params.gameRoot, policyPath: params.policyPath, confirmation });
    case 'plan-install': return core.planInstall({ gameRoot: params.gameRoot, distRoot: params.distRoot ?? defaultDist });
    case 'apply-install': return core.applyInstall(params.plan, { confirmation });
    case 'restore': return core.restore(params.gameRoot, { confirmation });
    case 'resume-runtime': return core.resumeRuntime(params.gameRoot, { confirmation });
    case 'recover': return core.recover(params.gameRoot, { confirmation });
    case 'plugins': return core.listPlugins(params.gameRoot);
    case 'install-plugin': return core.installPlugin({ gameRoot: params.gameRoot, pluginDirectory: params.pluginDirectory, confirmation });
    case 'update-plugin': return core.updatePlugin({ gameRoot: params.gameRoot, pluginDirectory: params.pluginDirectory, confirmation });
    case 'enable-plugin': return core.setPluginEnabled({ gameRoot: params.gameRoot, pluginId: params.pluginId, enabled: true, confirmation });
    case 'disable-plugin': return core.setPluginEnabled({ gameRoot: params.gameRoot, pluginId: params.pluginId, enabled: false, confirmation });
    case 'runtime-status': return core.runtimeRequest(params.pid, { type: 'status' });
    case 'invoke': return core.invokePlugin({ gameRoot: params.gameRoot, pid: params.pid, pluginId: params.pluginId, actionId: params.actionId, args: params.args ?? {}, confirmation });
    case 'launch': return core.launch({ gameRoot: params.gameRoot, steamExe: params.steamExe, mode: params.mode, connect: params.connect, confirmation });
    default: throw new core.PlatformError('unknown_command', `Unknown command: ${command}`);
  }
}

function parseArgs(args) {
  const command = args.shift() ?? 'help', flags = {};
  while (args.length) {
    const flag = args.shift();
    if (!flag.startsWith('--')) throw new core.PlatformError('invalid_argument', `Expected a --flag, got ${flag}`);
    if (flag === '--confirm') { flags.confirm = true; continue; }
    if (!args.length || args[0].startsWith('--')) throw new core.PlatformError('invalid_argument', `Missing value for ${flag}`);
    const name = flag.slice(2); if (Object.hasOwn(flags, name)) throw new core.PlatformError('invalid_argument', `Duplicate ${flag}`);
    flags[name] = args.shift();
  }
  return { command, flags };
}

export async function serve(input = process.stdin, output = process.stdout) {
  // A single queue serializes mutations; JSON parsing is strictly LF-delimited.
  // It also preserves CR and Unicode line separators inside JSON strings.
  let buffer = Buffer.alloc(0), chain = Promise.resolve();
  const respond = (response) => output.write(`${JSON.stringify(response)}\n`);
  const accept = (line) => {
    chain = chain.then(async () => {
      let request;
      try {
        request = JSON.parse(line.toString('utf8'));
        if (!request || typeof request !== 'object' || Array.isArray(request) || typeof request.id !== 'string' || !request.id || typeof request.command !== 'string') throw new core.PlatformError('invalid_request', 'Expected {id,command,params,confirmation?}');
        const result = await dispatch(request.command, request.params ?? {}, request.confirmation);
        respond({ id: request.id, ok: true, result });
      } catch (e) { respond({ id: request?.id ?? null, ok: false, error: core.errorRecord(e) }); }
    });
  };
  for await (const chunk of input) {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    let index;
    while ((index = buffer.indexOf(10)) >= 0) {
      const line = buffer.subarray(0, index); buffer = buffer.subarray(index + 1);
      if (line.length > MAX_LINE) { respond({ id: null, ok: false, error: { code: 'request_too_large', message: 'JSONL request exceeds 1 MiB' } }); continue; }
      if (line.length) accept(line);
    }
    if (buffer.length > MAX_LINE) { respond({ id: null, ok: false, error: { code: 'request_too_large', message: 'JSONL request exceeds 1 MiB' } }); input.destroy(); break; }
  }
  if (buffer.length) respond({ id: null, ok: false, error: { code: 'incomplete_request', message: 'JSONL requests must end with LF' } });
  await chain;
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (command === 'help' || command === '--help') {
    process.stdout.write(`L4P platform core (Windows x86)\n\nRead-only:\n  inspect --game-root DIR\n  discover [--steam-root DIR] [--game-root DIR]\n  validate-plugin --plugin-dir DIR [--policy FILE]\n  check-project --plugin-dir DIR\n  verify-release --plugin-dir DIR --policy FILE\n  plan-install --game-root DIR [--dist DIR] [--out PLAN.json]\n  plugins --game-root DIR\n  platforms --game-root DIR\n  platform-doc --game-root DIR --id skeeto --path Skeeto/README.txt\n  runtime-status --pid PID\n\nExplicit user actions:\n  configure-release-trust --game-root DIR --policy FILE --confirm\n  apply-install --plan PLAN.json --confirm\n  restore --game-root DIR --confirm\n  resume-runtime --game-root DIR --confirm\n  recover --game-root DIR --confirm\n  install-plugin --game-root DIR --plugin-dir DIR --confirm\n  update-plugin --game-root DIR --plugin-dir DIR --confirm\n  enable-plugin|disable-plugin --game-root DIR --plugin-id ID --confirm\n  invoke --game-root DIR --pid PID --plugin-id ID --action-id ID [--args JSON] [--confirm]\n  launch --game-root DIR [--steam-exe FILE] [--mode modded|clean|direct|development] [--connect HOST:PORT] --confirm\n\n  serve  (JSONL {id,command,params,confirmation?}; no prompts on stdout)\n\n--confirm records approval by the local user. Game/Bridge must exit before deployment changes.\n`);
    return;
  }
  if (command === 'serve') { await serve(); return; }
  if (flags.out && command !== 'plan-install') throw new core.PlatformError('invalid_argument', '--out is only supported for plan-install');
  const allowed = new Set(['game-root', 'steam-root', 'plugin-dir', 'policy', 'dist', 'out', 'plan', 'plugin-id', 'pid', 'action-id', 'args', 'steam-exe', 'confirm', 'mode', 'connect', 'id', 'path']);
  for (const flag of Object.keys(flags)) if (!allowed.has(flag)) throw new core.PlatformError('invalid_argument', `Unknown flag --${flag}`);
  const params = {
    gameRoot: flags['game-root'], steamRoots: flags['steam-root'] ? [flags['steam-root']] : undefined,
    pluginDirectory: flags['plugin-dir'], distRoot: flags.dist, pluginId: flags['plugin-id'],
    pid: flags.pid === undefined ? undefined : Number(flags.pid), actionId: flags['action-id'], steamExe: flags['steam-exe'],
    mode: flags.mode, connect: flags.connect,
    policyPath: flags.policy,
    id: flags.id, path: flags.path,
  };
  if (flags.args) params.args = JSON.parse(flags.args);
  if (flags.plan) params.plan = JSON.parse((await fs.readFile(path.resolve(flags.plan), 'utf8')).replace(/^\uFEFF/, ''));
  const result = await dispatch(command, params, flags.confirm ? CONFIRMED : undefined);
  if (flags.out) {
    await fs.writeFile(path.resolve(flags.out), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  }
  process.stdout.write(`${JSON.stringify({ ok: true, result }, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { process.stdout.write(`${JSON.stringify({ ok: false, error: core.errorRecord(error) }, null, 2)}\n`); process.exitCode = 1; });
}
