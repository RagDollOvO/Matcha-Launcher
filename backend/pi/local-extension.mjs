import path from 'node:path';
import { access, glob, realpath, lstat, stat } from 'node:fs/promises';
import {
  createLsToolDefinition, createFindToolDefinition, createGrepToolDefinition, createReadToolDefinition,
  createWriteToolDefinition, createEditToolDefinition, createPowerShellToolDefinition, createBashToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { localToolCatalog } from './local-catalog.mjs';
import { confirmAction, fileRisk, shellRisk } from './autonomy.mjs';

const factories = {
  local_ls: createLsToolDefinition, local_find: createFindToolDefinition, local_grep: createGrepToolDefinition,
  local_read: createReadToolDefinition, local_write: createWriteToolDefinition, local_edit: createEditToolDefinition,
  local_powershell: createPowerShellToolDefinition, local_bash: createBashToolDefinition,
};

// The portable launcher runs offline. Use the bundled Node glob instead of downloading fd.
function findOptions(signal) {
  return { operations: {
    exists: async dir => { await access(dir); return true; },
    async glob(pattern, cwd, { ignore, limit }) {
      const matches = [];
      const normalized = pattern.replaceAll('\\', '/');
      for await (const file of glob(normalized.includes('/') ? normalized : '**/' + normalized, { cwd, exclude: ignore })) {
        signal?.throwIfAborted();
        matches.push(file);
        if (matches.length >= limit) break;
      }
      return matches;
    },
  } };
}

// Resolve existing junctions even for a file whose parent is about to be created.
async function physical(file) {
  try { return await realpath(file); }
  catch (e) {
    const parent = path.dirname(file);
    if (e.code !== 'ENOENT' || parent === file) throw e;
    // A dangling link is not an ordinary new file.
    if (await lstat(file).catch(err => { if (err.code !== 'ENOENT') throw err; })) throw e;
    return path.join(await physical(parent), path.basename(file));
  }
}
async function unrelatedFile(file, gameRoot) {
  if (!file || !gameRoot) return false;
  const relative = path.relative(await realpath(gameRoot), await physical(file));
  const info = await stat(file).catch(e => { if (e.code !== 'ENOENT') throw e; });
  return (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) && (!info || info.nlink === 1);
}

export default function localExtension(pi) {
  for (const { name, label, description, write } of localToolCatalog()) {
    const shell = name === 'local_powershell' || name === 'local_bash';
    const native = factories[name](process.cwd(), { exposeSessionEnvironment: false });
    pi.registerTool({
      name, label, description: description + ' 有风险的操作（执行脚本或程序、删除、联网、改系统设置、写到游戏和下载目录以外）执行前由玩家确认。',
      promptSnippet: description,
      ...(name === 'local_powershell' ? { promptGuidelines: [
        '本机操作优先使用对应的 Matcha 专用工具。需要处理作者的整包或安装脚本时，先读说明与脚本、核对来源和目标、备份受影响文件，再申请执行。沿用 DLL 安全检查结果。',
        '命令在非交互终端运行。菜单脚本先核对作者提供的无人值守参数或可验证的输入方式；确实需要玩家交互时明确指出那一步。由玩家启动和退出游戏。',
        '只访问本次任务涉及的文件；保留草稿、配置和已发布路线。只读调查时使用读取和搜索工具。用户拒绝后停止对应操作。',
      ] } : {}),
      parameters: shell ? { ...native.parameters, properties: { ...native.parameters.properties,
        cwd: { type: 'string', description: '命令的工作目录（绝对路径）；省略时使用会话工作目录。' } } } : native.parameters,
      async execute(id, args, signal, onUpdate, ctx) {
        signal?.throwIfAborted();
        const cwd = shell && args.cwd !== undefined ? args.cwd : ctx.cwd;
        if (!path.isAbsolute(cwd) || (write && !shell && !path.isAbsolute(args.path))) throw new Error('请提供完整的绝对路径。');
        if (!ctx.hasUI) throw new Error('请在 Matcha 的茶茶窗口中确认本机操作。');
        const message = '工作目录：' + cwd + '\n\n' + (shell ? args.command + (args.timeout ? '\n\n超时：' + args.timeout + ' 秒' : '') : JSON.stringify(args, null, 2));
        // 自主模式下，只读和低风险的直接做；判断规则见 autonomy.mjs
        const target = path.resolve(cwd, args.path ?? '.');
        const classify = file => fileRisk(file, { write, gameRoot: process.env.L4P_GAME_ROOT, workspace: ctx.cwd }).risk;
        let risk = shell ? shellRisk(args.command).risk : classify(target);
        if (write && !shell && risk !== 'ask') {
          const resolved = classify(await physical(target));
          if (resolved === 'ask' || (resolved === 'managed' && risk === 'routine')) risk = resolved;
          if (risk === 'managed' && (await stat(target).catch(e=>{if(e.code!=='ENOENT')throw e;}))?.nlink > 1) risk = 'ask';
        }
        if (await confirmAction(ctx, label, message, { signal, risk }) !== true) throw new Error('玩家已取消本次本机操作。');
        signal?.throwIfAborted();
        if (write && process.platform === 'win32') {
          const { windowsProcesses } = await import('../core.mjs');
          if ((await windowsProcesses()).length && (shell || !await unrelatedFile(args.path, process.env.L4P_GAME_ROOT)))
            throw new Error('游戏或 Bridge 正在运行。请退出后再执行终端命令或写入游戏文件；仍可读取和搜索。');
        }
        signal?.throwIfAborted();
        const impl = name === 'local_find' ? factories[name](cwd, findOptions(signal)) : native;
        return impl.execute(id, args, signal, onUpdate, Object.create(ctx, { cwd: { value: cwd } }));
      },
    });
  }
}
