import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { inspectPe } from '../file-inspection.mjs';
import { PlatformReleases, digest } from './releases.mjs';
import { PlatformTransactions, approved, sameRoot, gameFile } from './transactions.mjs';
import { fail, platformPath } from './files.mjs';
import { modulePolicy, patchSettings } from './settings.mjs';

const defaultContext = { progress() {}, commit: fn => fn(), signal: new AbortController().signal };
export class PlatformLifecycle {
  constructor({ dataDir, readOnly, inspectGame, fetch, beforeWrite }) {
    this.readOnly = readOnly; this.store = new PlatformTransactions({ dataDir, inspectGame, beforeWrite });
    this.releases = new Map(); this.plans = new Map(); this.dataDir = dataDir; this.fetch = fetch;
  }
  release(id) {
    const adapter = this.readOnly.adapter(id);
    if (!this.releases.has(id)) this.releases.set(id, new PlatformReleases({ dataDir: this.cacheDir ?? this.dataDir, adapter, fetch: this.fetch }));
    const release=this.releases.get(id);release.legacyCaches=this.legacyCaches;return release;
  }
  async find(root, id) { this.readOnly.adapter(id); return this.store.read(root, id); }
  async checkUpdate(root, id) {
    const release = await this.release(id).release(), state = await this.find(root, id);
    const current = state?.version ?? (await this.readOnly.snapshot(root, await this.store.inspectGame(root))).find(p => p.id === id)?.version;
    const newer = current ? release.version.split('.').map(Number).reduce((cmp, n, i) => cmp || Math.sign(n - Number(current.split('.')[i])), 0) > 0 : true;
    return { ...release, installedVersion: current ?? null, updateAvailable: newer };
  }
  async cachedDoc(root, id, requestedPath) {
    const adapter = this.readOnly.adapter(id);
    if (!adapter.docs.some(d => d.path === requestedPath)) fail('platform_doc_denied', '请选择平台声明的说明文件。');
    const state = await this.find(root, id); if (!state || state.status !== 'installed') return null;
    const pkg = await this.release(id).cached(state.version);
    return pkg.files.get(requestedPath) ?? null;
  }
  async build(root, id, operation, params = {}) {
    const adapter = this.readOnly.adapter(id);
    if (adapter.distribution === 'source-ports' && (operation === 'install' || operation === 'set-enabled' && params.enabled)) fail('platform_retired', 'Skeeto 已改为源码拆分接入，请在 DLL 合集中选择独立模组。');
    const game = await this.store.idle(root);
    root = game.gameRoot;
    const dataRelative = path.relative(root, path.resolve(this.dataDir));
    if (!dataRelative || !dataRelative.startsWith('..') && !path.isAbsolute(dataRelative)) fail('platform_storage_inside_game', '请将 Matcha 数据目录放在游戏目录外，再管理平台。');
    const prior = await this.find(root, id);
    if (prior?.pending) fail('platform_recovery_required', '请先恢复上次中断的平台操作。');
    const initial = { schema: 1, id, storeId: randomUUID(), gameRoot: root, status: 'uninstalled', revision: null, files: [], createdDirs: [], enabled: false };
    const previous = prior ?? initial, next = structuredClone(previous), changes = [], warnings = [], effects = [];
    let loader;
    delete next.pending;
    const change = async (file, data, captureOriginal = false) => {
      const current = await gameFile(root, file); const after = data === null ? null : digest(data);
      if (after !== current.hash || captureOriginal) changes.push({ path: file, before: current.hash, data, after });
      return current;
    };
    const policySettings = async context => {
      const policy = modulePolicy(adapter, context);
      if (policy.unresolved.length) fail('platform_policy_unresolved', `以下模块的完整关闭方式待适配：${policy.unresolved.map(m => m.name).join('、')}。可先停用 Skeeto 再启动。`);
      const old = await gameFile(root, adapter.settings.file);
      for (const module of policy.modules) {
        const changes = {};
        for (const s of adapter.moduleSwitches[module.id].switches) for (const key of [s.key, ...(s.aliases ?? [])]) changes[key] = s.off;
        effects.push({ ...module, changed: !patchSettings(old.data, changes).equals(old.data ?? Buffer.alloc(0)) });
      }
      if (policy.unknownMode) warnings.push('A2S 未返回模式，本次同时关闭对抗受限情报模块。');
      await change(adapter.settings.file, patchSettings(old.data, policy.changes));
    };
    if (operation === 'install') {
      const pkg = await this.release(id).cached(params.version);
      const requested = pkg.manifest;
      const manual = requested.requires_manual_migrate;
      if (prior?.status === 'installed' && prior.version !== requested.semver && prior.version.split('.').map(Number).reduce((cmp, n, i) => cmp || Math.sign(n - Number(requested.semver.split('.')[i])), 0) > 0) fail('platform_downgrade', '此入口只支持同版本重装或升级，请保留当前版本。');
      // Manual migrations are visible in preview, and never accepted by execute().
      if (manual) warnings.push('作者要求手动迁移，请使用 Skeeto 自带安装器。');
      if (requested.semver !== adapter.evidence.version) warnings.push('此版本的模块开关映射待源码复核；安装后保持停用，完成适配后可启用。');
      next.version = requested.semver; next.manifest = requested; next.status = 'installed';
      next.enabled = prior?.status === 'installed' ? prior.enabled : true;
      if (requested.semver !== adapter.evidence.version) next.enabled = false;
      next.release = pkg.release; next.installedAt ??= new Date().toISOString();
      const deploy = requested.files.filter(f => ['core', 'proxy', 'plugin'].includes(f.role) || f.relative === 'Skeeto_更新日志.txt');
      for (const entry of deploy) {
        const data = pkg.files.get(entry.relative); if (!data) continue;
        const current = await gameFile(root, entry.relative), old = previous.files.find(f => f.path === entry.relative);
        if (old) {
          const expected = entry.role === 'proxy' && !previous.enabled ? disabledProxyHash(old) : old.hash;
          if (current.hash !== expected) fail('platform_external_change', `受管文件已被修改：${entry.relative}`);
        } else if (current.hash !== null) warnings.push(`将备份并替换已有文件：${entry.relative}${entry.role === 'proxy' ? '（已有代理，来源待确认）' : ''}`);
        const tracked = { ...old, path: entry.relative, role: entry.role, hash: digest(data) };
        if (entry.role === 'proxy') loader = { file: entry.relative, occupant: current.data ? old && previous.enabled ? 'skeeto' : 'foreign-unknown' : 'absent', replaced: current.hash !== null && current.hash !== digest(data) && next.enabled };
        if (!old && entry.role === 'proxy' && current.data) {
          const pe = await inspectPe(await platformPath(root, entry.relative)).catch(() => null);
          tracked.originalIsSkeeto = !!pe && pe.dll && pe.architecture === 'x86' && adapter.loader.exports.every(e => pe.exports.includes(e));
          if (tracked.originalIsSkeeto) loader.occupant = 'skeeto';
          if (tracked.originalIsSkeeto) warnings.push('接管已有 Skeeto 入口；停用时移除入口，卸载时恢复安装前的入口。');
        }
        next.files = next.files.filter(f => f.path !== entry.relative); next.files.push(tracked);
        // Disabled updates keep the original proxy in place; the new proxy remains in the verified cache.
        if (entry.role !== 'proxy' || next.enabled) await change(entry.relative, data, !old);
        else if (!old) {
          // Capture the original even when a new, unmapped version is installed disabled.
          await change(entry.relative, tracked.originalIsSkeeto ? null : current.data, true);
        } else if (previous.enabled) {
          await change(entry.relative, disabledProxyHash(old) === null ? null : await this.store.stored(previous.storeId, old.backup, old.original));
        }
      }
      // Removed runtime entries must be explicitly migrated, never silently abandoned.
      if (previous.files.some(f => !deploy.some(e => e.relative === f.path))) fail('platform_migration_required', '新版清单移除了已有受管文件，需要适配迁移。');
      await policySettings({ managed: true });
      changes.sort((a, b) => Number(a.path === adapter.loader.file) - Number(b.path === adapter.loader.file));
      return { previous, next, changes, warnings, effects, loader, requiresManualMigrate: manual, packageBytes: pkg.bytes };
    }
    if (!prior || prior.status !== 'installed') fail('platform_not_managed', '此操作需要 Matcha 安装账本；请先预览安装或接管。');
    for (const file of previous.files) {
      if (!adapter.packageFiles.some(f => f.path === file.path && f.role === file.role)) fail('platform_ledger_invalid', '账本中的受管文件超出适配布局。');
    }
    if (operation === 'set-enabled') {
      if (typeof params.enabled !== 'boolean') fail('invalid_argument', 'enabled 需要布尔值。');
      const proxy = previous.files.find(f => f.path === adapter.loader.file);
      if (!proxy) fail('platform_ledger_invalid', '安装账本缺少代理记录。');
      const current = await gameFile(root, proxy.path), expected = previous.enabled ? proxy.hash : disabledProxyHash(proxy);
      if (current.hash !== expected) fail('platform_external_change', '代理入口在安装后发生外部修改。');
      if (params.enabled) {
        if (previous.version !== adapter.evidence.version) fail('platform_policy_version', '此版本的模块开关键待复核，请保持停用。');
        for (const file of previous.files.filter(f => f.role !== 'proxy')) if ((await gameFile(root, file.path)).hash !== file.hash) fail('platform_external_change', `启用前发现受管文件变化：${file.path}`);
        const pkg = await this.release(id).cached(previous.version), data = pkg.files.get(proxy.path);
        if (!data || digest(data) !== proxy.hash) fail('platform_cache_invalid', '缓存代理与安装账本有差异。');
        await policySettings({ managed: true }); await change(proxy.path, data);
      } else {
        const data = disabledProxyHash(proxy) === null ? null : await this.store.stored(previous.storeId, proxy.backup, proxy.original);
        await change(proxy.path, data);
      }
      next.enabled = params.enabled;
    } else if (operation === 'uninstall') {
      for (const file of [...previous.files].sort((a, b) => Number(b.role === 'proxy') - Number(a.role === 'proxy'))) {
        const current = await gameFile(root, file.path), expected = file.role === 'proxy' && !previous.enabled ? disabledProxyHash(file) : file.hash;
        if (current.hash !== expected) fail('platform_external_change', `卸载前发现外部修改，已保留：${file.path}`);
        await change(file.path, file.original === null ? null : await this.store.stored(previous.storeId, file.backup, file.original));
      }
      next.status = 'uninstalled'; next.enabled = false; next.uninstalledAt = new Date().toISOString();
      warnings.push('保留 Skeeto 设置和自定义资源。若仍订阅工坊 3787239937，请在 Steam 中按需取消订阅。');
    } else if (operation === 'set-self-update') {
      if (typeof params.enabled !== 'boolean') fail('invalid_argument', 'enabled 需要布尔值。');
      if (params.enabled) fail('platform_update_managed', 'Matcha 管理期间使用手动确认更新，工坊自更新保持关闭。');
      await policySettings({ managed: true });
    } else if (operation === 'launch-policy') {
      for (const f of previous.files) {
        const expected = f.role === 'proxy' && !previous.enabled ? disabledProxyHash(f) : f.hash;
        if ((await gameFile(root, f.path)).hash !== expected) fail('platform_external_change', `启动前发现受管文件变化：${f.path}`);
      }
      if (!previous.enabled) return { previous, next, changes, warnings, effects };
      if (previous.version !== adapter.evidence.version) fail('platform_policy_version', '已安装版本的开关键待复核，请先停用 Skeeto 再启动。');
      await policySettings({ ...params, managed: true });
      warnings.push('规则作用于启动前保存的设置；游戏内手动开关和换服仍由 Skeeto 自己管理。');
    } else fail('invalid_argument', '未知平台操作。');
    return { previous, next, changes, warnings, effects };
  }
  view(built, operation, params) {
    return { id: built.previous.id, gameRoot: built.previous.gameRoot, operation, params, revision: built.previous.revision,
      version: built.next.version, enabled: built.next.enabled, requiresManualMigrate: built.requiresManualMigrate ?? false,
      files: built.changes.map(c => ({ path: c.path, action: c.before === c.after ? 'backup' : c.data === null ? 'remove' : c.before === null ? 'create' : 'replace', before: c.before, after: c.after, sizeBytes: c.data?.length ?? 0 })),
      sizeBytes: built.changes.reduce((n, c) => n + (c.data?.length ?? 0), 0), packageBytes: built.packageBytes,
      loader: built.loader, modules: built.effects, warnings: built.warnings, verification: { state: 'unverified' } };
  }
  async preview(root, id, operation, params = {}) {
    this.readOnly.adapter(id);
    const view = operation === 'recover'
      ? { id, gameRoot: root, operation, params, recovery: (await this.store.recovery(root)).view }
      : this.view(await this.build(root, id, operation, params), operation, params);
    const planId = randomUUID(); this.plans.set(planId, { view, created: Date.now() });
    if (this.plans.size > 100) this.plans.delete(this.plans.keys().next().value);
    return { ...view, planId };
  }
  async execute(root, id, operation, planId, params, confirmation, ctx = defaultContext) {
    approved(confirmation);
    const plan = this.plans.get(planId);
    if (!plan || Date.now() - plan.created > 15 * 60 * 1000 || plan.view.id !== id || plan.view.operation !== operation || !sameRoot(plan.view.gameRoot, root) || JSON.stringify(plan.view.params) !== JSON.stringify(params)) fail('platform_plan_required', '请先生成当前操作的预览计划，再确认执行。');
    if (plan.view.requiresManualMigrate) fail('platform_manual_migrate', '作者要求手动迁移，请使用 Skeeto 自带安装器。');
    if (operation === 'recover') return ctx.commit(async () => {
      const result = await this.store.recover(root, confirmation, plan.view.recovery);
      this.plans.delete(planId); return result;
    });
    return this.store.lock(async () => {
      const built = await this.build(root, id, operation, params);
      if (JSON.stringify(this.view(built, operation, params)) !== JSON.stringify(plan.view)) fail('platform_plan_stale', '文件、设置或安装账本已变化，请重新预览。');
      return ctx.commit(async () => {
        const result = await this.store.apply(built.previous, built.next, built.changes, ctx);
        this.plans.delete(planId); return { ...result, modules: built.effects, warnings: built.warnings };
      });
    });
  }
}

export const disabledProxyHash = file => file.originalIsSkeeto ? null : file.original;
