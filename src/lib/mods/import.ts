import { api, type LocalModInput } from '../api';
import { errorText } from '../api/bridge';
import { mib } from '../format-size';
import type { ConfirmExtra } from '../feedback';
import type { Category, Mod } from '../types';

interface ModImportHost {
  readonly game: { root: string };
  readonly categories: readonly Category[];
  mod(id: string): Mod | undefined;
  categoryLabel(id: string): string;
  moveToCategory(ids: string[], categoryId: string): void;
  perform<T>(label: string, run: () => Promise<T>): Promise<T | undefined>;
  confirm(title: string, message: string, action: string, preview: ConfirmExtra): Promise<boolean>;
  notify(options: { kind: 'ok' | 'error'; text: string; modId?: string; actions?: { label: string; run: () => void }[]; ms?: number }): void;
  showMod(id: string): void;
}

/** 一次确认：现成 VPK 直接导入，散装素材交给后台打包。分类在松手时确定。 */
export async function importLocalMods(host: ModImportHost, paths: string[], categoryId: string) {
  const root = host.game.root;
  const imported = await host.perform('准备导入 Mod', async () => {
    const inputs: LocalModInput[] = [], notes: string[] = [];
    let shards = 0;
    for (const file of new Set(paths)) {
      const name = file.split(/[\\/]/).pop() || file;
      try {
        const item = await api.previewModInput(file);
        if (item.kind === 'vpk' || item.kind === 'folder') inputs.push(item);
        else if (item.kind === 'shard') shards++;
        else notes.push(`${name}：请选择 VPK 或素材文件夹。`);
      } catch (e) { notes.push(`${name}：${errorText(e)}`); }
    }
    if (shards) notes.push(`已跳过 ${shards} 个分卷数据文件；分卷包请选择 _dir.vpk。`);
    if (!inputs.length) throw new Error(notes.join('\n') || '请选择 VPK 或素材文件夹。');
    const names = new Set<string>();
    for (const item of inputs) {
      const key = item.name.toLowerCase();
      if (names.has(key)) throw new Error(`选中的素材会生成同一个文件「${item.name}」。请一次只导入其中一份。`);
      names.add(key);
    }
    const only = inputs.length === 1 ? inputs[0] : null;
    const conflicts = inputs.filter(item => item.targetExists);
    const title = conflicts.length ? (only ? '替换同名 Mod？' : `有 ${conflicts.length} 个同名 Mod，确认替换？`) : only?.kind === 'folder' ? '打包并导入文件夹' : only ? '导入 VPK Mod' : `导入 ${inputs.length} 个 Mod`;
    const target = root + '\\left4dead2\\addons';
    const facts = only ? [
      { label: '来源', value: only.file },
      ...(only.kind === 'folder' ? [
        { label: '生成', value: only.name },
        { label: '包内', value: only.prefix ? `保留 ${only.prefix}/ 目录` : '保留文件夹内的目录结构' },
      ] : [{ label: 'VPK', value: `${only.title} · ${mib(only.sizeMB * 1048576)} · ${only.fileCount} 个资源 · 复制 ${only.files.length} 个文件` }]),
    ] : [];
    facts.push({ label: '目标', value: target });
    const category = host.categories.find(c => !c.builtin && c.id === categoryId);
    const previous = only?.targetExists ? host.mod(only.name.toLowerCase()) : undefined;
    if (category || previous) facts.push({ label: '导入后分类', value: host.categoryLabel(category?.id ?? previous!.categoryId) });
    const rows = inputs.map(item => ({
      k: item.name, v: conflicts.length ? (item.targetExists ? '替换旧包' : '新增') : item.kind === 'folder' ? '文件夹 → VPK' : `${mib(item.sizeMB * 1048576)} · ${item.fileCount} 个资源`,
    }));
    for (const item of inputs) if (item.kind === 'vpk' && item.warning) notes.push(`${item.name}：${item.warning}`);
    const explanation = conflicts.length
      ? `${only ? `目标目录已有「${only.name}」。` : ''}确认后，Matcha 会先备份同名旧包及其分卷，再用新包替换。导入的 Mod 会在当前启动方案中启用，下次启动游戏时生效。`
      : '导入后在当前启动方案中启用，下次启动游戏时生效。';
    const action = conflicts.length ? (only?.kind === 'folder' ? '打包并替换' : only ? '确认替换' : '确认导入并替换') : only?.kind === 'folder' ? '打包并导入' : '导入';
    if (!await host.confirm(title, explanation, action, {
      layout: 'import', facts, lists: only ? [] : [{ title: '导入内容', rows }], ...(notes.length ? { warn: { title: '导入提示', text: notes.join('\n') } } : {}),
    })) return [];
    const ids: string[] = [], failed: string[] = [], swapped: string[] = []; let queued = 0, replaced = 0;
    for (const item of inputs) {
      try {
        if (item.kind === 'folder') { await api.packModFolder(item, root, categoryId); queued++; }
        else {
          const r = await api.importMod(item, root); ids.push(r.id); if (r.replaced) { replaced++; swapped.push(r.id); }
          if (!r.enabled) failed.push(`${item.name} 已导入，尚未加入当前启动方案。请检查方案的游戏目录和 Mod 状态。`);
        }
      } catch (e) { failed.push(`${item.name}：${errorText(e)}`); }
    }
    const message = [ids.length > replaced && `已导入 ${ids.length - replaced} 个 VPK`, replaced && `已替换 ${replaced} 个同名 Mod`, queued && `${queued} 个文件夹已加入打包队列`, ...failed].filter(Boolean).join('；');
    // 替换后给「去查看」：定位到被替换的那个（多个时定位第一个）
    if (ids.length || failed.length) host.notify({
      kind: failed.length ? 'error' : 'ok', text: message, modId: swapped[0],
      ...(swapped.length ? { actions: [{ label: '去查看', run: () => host.showMod(swapped[0]) }], ms: 8000 } : {}),
    });
    return ids;
  });
  if (imported?.length && host.game.root === root && host.categories.some(c => c.id === categoryId && !c.builtin))
    host.moveToCategory(imported, categoryId);
}
