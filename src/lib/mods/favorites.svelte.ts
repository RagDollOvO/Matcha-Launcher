import { api, type Snapshot } from '../api';
import { errorText, pickDirectory, pickVpk } from '../api/bridge';
import type { ActionFeedback, ConfirmExtra } from '../feedback';
import { mib } from '../format-size';
import type { Mod, ModMeta, Profile, TrashEntry } from '../types';

interface FavoriteHost extends ActionFeedback {
  readonly game: { root: string; running: boolean };
  readonly mods: readonly Mod[];
  readonly busy: string;
  mod(id: string): Mod | undefined;
  profile(id: string): Profile | undefined;
  notify(options: { text: string; kind: 'info' | 'ok' }): void;
  refresh(): Promise<void>;
}

interface FavoriteView {
  pendingRefresh(): Promise<void> | null;
  openTrash(): void;
}

export class ModFavoritesStore {
  /** 收藏等跨方案标记；后端未接入 modMeta 前存在本机 */
  modMeta = $state<Record<string, ModMeta>>({});
  favoriteCollections = $state<NonNullable<Snapshot['favoriteCollections']>>([]);
  favoriteRefs = $state<NonNullable<Snapshot['favoriteRefs']>>({});
  favoriteEntries = $derived.by(() => [
    ...this.host.mods.filter(m => !!this.modMeta[m.id]?.favorite && !this.favoriteRefs[m.id]),
    ...Object.values(this.favoriteRefs),
  ]);
  private metaRemote = false;
  private metaLoaded = false;
  /** Matcha 回收站 */
  trash = $state<TrashEntry[]>([]);

  constructor(private readonly host: FavoriteHost, private readonly view: FavoriteView) {}

  acceptSnapshot(s: Pick<Snapshot, 'modMeta' | 'favoriteCollections' | 'favoriteRefs' | 'trash'>) {
    this.acceptMeta(s.modMeta);
    this.favoriteCollections = s.favoriteCollections ?? [];
    this.favoriteRefs = s.favoriteRefs ?? {};
    this.trash = s.trash ?? [];
  }

  // ---------- 收藏（modMeta） ----------
  isFavorite(id: string) {
    return !!this.modMeta[id]?.favorite || !!this.favoriteRefs[id] || Object.values(this.favoriteRefs).some(ref =>
      ref.library?.modId === id && ref.library.gameRoot.toLowerCase() === this.host.game.root.toLowerCase());
  }
  favoriteIds(): string[] { return this.favoriteEntries.map(m => m.id); }
  favoriteMod(id: string) {
    const ref = this.favoriteRefs[id];
    if (!ref) return this.host.mod(id);
    const link = ref.library;
    const mod = link?.gameRoot.toLowerCase() === this.host.game.root.toLowerCase() ? this.host.mod(link.modId) : undefined;
    return mod && (!link?.version || mod.packageVersion === link.version) ? mod : undefined;
  }
  async repairFavorite(id: string, selected?: string) {
    const ref = this.favoriteRefs[id];
    if (!ref?.missingSource) return;
    try {
      const file = selected || (ref.referenceKind === 'folder'
        ? await pickDirectory(`重新选择「${ref.title}」的素材文件夹`)
        : await pickVpk(`重新选择「${ref.title}」的 VPK`));
      if (file) return this.bookmarkFiles([file], undefined, id);
    } catch (e) { this.host.toast(errorText(e)); }
  }
  importFavoriteSources(ids: string[]) {
    return this.host.perform('导入收藏副本', async () => {
      const root = this.host.game.root;
      for (const id of new Set(ids)) if (!this.favoriteMod(id)) await api.importFavorite(id, root);
      return true;
    });
  }
  applyFavorites(ids: string[], profiles: string[]) {
    return this.host.perform('保存方案成员', () => api.favoriteToProfiles(ids, profiles, this.host.game.root));
  }
  async bookmarkFiles(paths: string[], collectionId?: string, repairId?: string) {
    if (!paths.length) return;
    try {
      const plan = await api.previewBookmarks(paths, collectionId, repairId);
      if (!await this.confirmShelfDuplicates(plan.duplicates)) return;
      const result = await this.host.perform('保存到收藏夹', () => api.bookmarkFiles(paths, collectionId, plan.expected, repairId));
      if (result) {
        const action = repairId ? '已找回收藏' : plan.duplicates.length ? '已更新收藏' : '已收藏';
        const skipped = result.skipped.length ? '；' + result.skipped.join('；') : '';
        this.host.notify({ kind: skipped ? 'info' : 'ok', text: `${action} · ${result.count} 项${skipped}` });
      }
      return result;
    } catch (e) { this.host.toast(errorText(e)); }
  }
  private confirmShelfDuplicates(duplicates: { name: string; file: string; previous: string; incoming: string }[]) {
    return !duplicates.length || this.host.confirm('收藏夹中有同名文件', '替换会更新收藏副本，保留所在合集。方案和原文件保持原样。', '替换', {
      lists: duplicates.map((d, i) => ({
        title: duplicates.length === 1 ? d.file : (i + 1) + '. ' + d.file,
        rows: [{ k: '已有收藏', v: d.name + ' · ' + d.previous }, { k: '替换来源', v: d.incoming }],
      })),
    });
  }
  async editFavoriteCollection(edit: Parameters<typeof api.editFavoriteCollection>[0]) {
    try {
      const plan = await api.previewFavoriteCollection(edit);
      if (!await this.confirmShelfDuplicates(plan.duplicates)) return;
      return this.host.perform('保存收藏合集', () => api.editFavoriteCollection(edit, plan.expected));
    } catch (e) { this.host.toast(errorText(e)); }
  }
  /** 拖动排序：先在本地换好位置（卡片立刻滑到位），再保存；保存失败时重新读取 */
  async moveFavoriteCollection(id: string, targetId: string, after: boolean) {
    const list = this.favoriteCollections, source = list.find(c => c.id === id);
    if (!source || id === targetId || !list.some(c => c.id === targetId) || this.host.busy) return;
    const next = list.filter(c => c.id !== id);
    next.splice(next.findIndex(c => c.id === targetId) + Number(after), 0, source);
    if (next.every((c, i) => c.id === list[i].id)) return;
    this.favoriteCollections = next;
    const saved = await this.host.perform('保存合集顺序',
      () => api.editFavoriteCollection({ action: 'move', collectionId: id, targetId, after }), undefined, { rescan: false });
    if (saved) this.favoriteCollections = saved.favoriteCollections;
    else void this.host.refresh();
  }
  collectMods(ids: string[], group?: string) {
    return this.bookmarkFiles(ids.map(id => this.host.mod(id)?.absolutePath).filter((p): p is string => !!p), group);
  }
  async setFavorite(ids: string[], favorite: boolean) {
    if (favorite) return this.collectMods(ids);
    const removed = new Set(ids);
    return this.host.perform('移到回收站', async () => {
      const saved = await api.trashFavorites([...removed]);
      // 一份回执同时更新收藏夹、合集和回收站；先接完写入前开始的快照。
      await this.view.pendingRefresh();
      for (const id of removed) {
        delete this.favoriteRefs[id];
        if (this.modMeta[id]?.favorite) delete this.modMeta[id].favorite;
      }
      this.favoriteCollections = this.favoriteCollections.map(c => ({ ...c, modIds: c.modIds.filter(id => !removed.has(id)) }));
      const moved = new Set(saved.trashed.map(t => t.trashId));
      this.trash = [...saved.trashed, ...this.trash.filter(t => !moved.has(t.trashId))].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
      if (saved.count) this.host.toast(
        saved.count === 1 ? `「${saved.trashed[0].title}」已移到 Matcha 回收站` : `${saved.count} 项收藏已移到 Matcha 回收站`,
        { label: '查看回收站', run: this.view.openTrash });
      return saved;
    }, undefined, { rescan: false });
  }

  // ---------- 新下载（modMeta.inbox）：下载完成、还没整理 ----------
  isInbox(id: string) { return !!this.modMeta[id]?.inbox; }
  inboxIds(): string[] { return this.host.mods.filter((m) => this.isInbox(m.id)).map((m) => m.id); }
  /** 「标记已整理」：离开新下载，其余标记不变 */
  markSorted(ids: string[]) {
    const list = ids.filter((id) => this.isInbox(id));
    if (!list.length) return;
    this.patchMeta(list, (m) => { delete m.inbox; });
    if (list.length > 1) this.host.toast(`${list.length} 个 Mod 已标记为整理过`);
  }
  /** 改分类、加入方案后后端会自动清掉 inbox；这里先在本地同步，不用等下一次快照 */
  dropInbox(ids: string[]) {
    const list = ids.filter((id) => this.isInbox(id));
    if (!list.length) return;
    if (this.metaRemote) for (const id of list) { const next = { ...this.modMeta[id] }; delete next.inbox; this.modMeta[id] = next; }
    else this.patchMeta(list, (m) => { delete m.inbox; });
  }
  /** 按 id 改标记；改完为空的记录发 null 删除 */
  private patchMeta(ids: string[], edit: (m: ModMeta) => void) {
    const patch: Record<string, ModMeta | null> = {};
    for (const id of ids) {
      const next: ModMeta = { ...this.modMeta[id] };
      edit(next);
      for (const k of Object.keys(next) as (keyof ModMeta)[]) if (next[k] === undefined || next[k] === false) delete next[k];
      if (Object.keys(next).length) { this.modMeta[id] = next; patch[id] = next; }
      else { delete this.modMeta[id]; patch[id] = null; }
    }
    this.persistMeta(patch);
  }
  private acceptMeta(remote: Snapshot['modMeta']) {
    if (remote) {
      this.metaRemote = true;
      const local = readLocalMeta();
      if (Object.keys(local).length) {
        // 后端接入后，把之前暂存在本机的标记合并上去一次
        this.modMeta = { ...remote, ...local };
        void api.saveModMeta(local).then(() => clearLocalMeta()).catch(e => this.host.toast(errorText(e)));
      } else this.modMeta = remote;
    } else if (!this.metaLoaded) {
      this.modMeta = readLocalMeta();
    }
    this.metaLoaded = true;
  }
  private persistMeta(patch: Record<string, ModMeta | null>) {
    if (this.metaRemote) void api.saveModMeta(patch, 'inbox').catch(e => { this.host.toast(errorText(e)); void this.host.refresh(); });
    else writeLocalMeta($state.snapshot(this.modMeta));
  }

  // ---------- 删除 → Matcha 回收站 ----------
  /** 返回是否真的删除了（用户取消、失败时为 false） */
  async deleteMods(ids: string[]): Promise<boolean> {
    if (!ids.length) return false;
    if (this.host.game.running) { this.host.toast('游戏运行中，退出后再删除'); return false; }
    let done = false;
    await this.host.perform('删除 Mod', async () => {
      const { mods: list, sizeBytes } = await api.previewDeleteMods(ids);
      if (!list.length) return;
      const one = list.length === 1 ? list[0] : null;
      const files = list.flatMap((t) => t.files);
      const names = [...new Set(list.flatMap((t) => t.profileIds))].map((id) => this.host.profile(id)?.name).filter(Boolean);
      const subscribed = list.filter((t) => t.files.some((f) => f.file.startsWith('workshop/')));
      const extra: ConfirmExtra = {
        items: list.slice(0, 12).map((t) => ({ modId: t.modId, title: t.title, files: t.files, sizeBytes: t.sizeBytes })),
        more: Math.max(0, list.length - 12),
        facts: [
          { label: '文件', value: `${files.length} 个 · ${mib(sizeBytes)}` },
          { label: '方案', value: names.length ? `从 ${names.join('、')} 中移除` : '不在任何方案里' },
          { label: '去向', value: 'Matcha 回收站，可以还原或永久删除' },
        ],
        warn: subscribed.length ? {
          title: one ? '这是 Steam 创意工坊订阅项' : `其中 ${subscribed.length} 个是 Steam 创意工坊订阅项`,
          text: '只删文件的话，Steam 会重新下载。请先在 Steam 里取消订阅。',
          links: subscribed.map((t) => workshopLink(t.workshopId ?? '')),
        } : undefined,
      };
      if (!await this.host.confirm(one ? `删除「${one.title}」` : `删除 ${list.length} 个 Mod`, '', '移到回收站', extra)) return;
      const { trashed } = await api.deleteMods(list.map((t) => t.modId));
      done = true;
      const trashIds = trashed.map((t) => t.trashId);
      this.host.toast(one ? `「${one.title}」已移到回收站` : `${trashed.length} 个 Mod 已移到回收站`, { label: '撤销', run: () => void this.restoreTrash(trashIds) });
    });
    return done;
  }
  async restoreTrash(trashIds: string[]) {
    if (!trashIds.length) return;
    const list = this.trash.filter((t) => trashIds.includes(t.trashId));
    if (this.host.game.running && list.some(t => !t.favorite)) return this.host.toast('游戏运行中，退出后再还原库里的 Mod');
    await this.host.perform('还原回收条目', async () => {
      const { restored, conflicts } = await api.restoreMods(trashIds);
      const drafts = list.some((t) => restored.includes(t.modId) && t.profileIds.length);
      const what = restored.length === 1 ? `「${list.find((t) => t.modId === restored[0])?.title ?? restored[0]}」` : ` ${restored.length} 项`;
      if (conflicts.length) this.host.toast(`${restored.length ? `已还原${what}；` : ''}${conflicts.length} 个没有还原：${conflicts[0].reason}`, undefined, 6000);
      else this.host.toast(`已还原${what}${list.every(t => t.favorite) ? '到收藏夹' : drafts ? '，已恢复方案里的勾选' : ''}`, undefined, drafts ? 5000 : undefined);
    });
  }
  /** 永久删除，不可撤销；'all' = 清空回收站 */
  async purgeTrash(trashIds: string[] | 'all') {
    const list = trashIds === 'all' ? this.trash : this.trash.filter((t) => trashIds.includes(t.trashId));
    if (!list.length || this.host.busy) return;
    if (this.host.game.running && list.some(t => !t.favorite)) return this.host.toast('游戏运行中，退出后再删除库里的 Mod');
    const files = list.flatMap(t => t.files), size = files.reduce((n, f) => n + f.size, 0);
    const title = trashIds === 'all' ? '清空回收站' : list.length === 1 ? `永久删除「${list[0].title}」` : `永久删除 ${list.length} 项`;
    const extra: ConfirmExtra = {
      layout: 'destructive',
      items: list.slice(0, 12).map(t => ({ trashId: t.trashId, title: t.title, files: t.files, sizeBytes: t.sizeBytes })),
      more: Math.max(0, list.length - 12),
      facts: [
        { label: '文件', value: `${files.length} 个 · ${mib(size)}` },
        { label: '结果', value: files.length ? '永久删除这些回收条目和其中的文件，无法还原' : '永久删除这些收藏记录，无法还原', danger: true },
      ],
    };
    if (!await this.host.confirm(title, '', '永久删除', extra)) return;
    await this.host.perform('永久删除', async () => {
      const { purged } = await api.purgeTrash(list.map((t) => t.trashId));
      this.host.toast(purged.length === 1 && list.length === 1 ? `已永久删除「${list[0].title}」` : `已永久删除 ${purged.length} 项`);
    });
  }
}

export const workshopLink = (id: string) => `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`;

// 后端接入 modMeta 之前的本机暂存；接入后 acceptMeta 会合并上去并清掉
const META_KEY = 'flare.modMeta.pending';
function readLocalMeta(): Record<string, ModMeta> {
  try { return JSON.parse(localStorage.getItem(META_KEY) ?? '{}') ?? {}; } catch { return {}; }
}
function writeLocalMeta(meta: Record<string, ModMeta>) {
  try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch { /* 无本机存储时只在本次会话有效 */ }
}
function clearLocalMeta() {
  try { localStorage.removeItem(META_KEY); } catch { /* 同上 */ }
}
