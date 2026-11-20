<script lang="ts">
  import Plus from '@lucide/svelte/icons/plus';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Trash from '@lucide/svelte/icons/trash';
  import Copy from '@lucide/svelte/icons/copy';
  import Search from '@lucide/svelte/icons/search';
  import X from '@lucide/svelte/icons/x';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import LayoutGrid from '@lucide/svelte/icons/layout-grid';
  import List from '@lucide/svelte/icons/list';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Upload from '@lucide/svelte/icons/upload';
  import Folder from '@lucide/svelte/icons/folder';
  import FolderPlus from '@lucide/svelte/icons/folder-plus';
  import Layers from '@lucide/svelte/icons/layers';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import FolderInput from '@lucide/svelte/icons/folder-input';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Star from '@lucide/svelte/icons/star';
  import ListChecks from '@lucide/svelte/icons/list-checks';
  import PanelRight from '@lucide/svelte/icons/panel-right';
  import ToggleLeft from '@lucide/svelte/icons/toggle-left';
  import ToggleRight from '@lucide/svelte/icons/toggle-right';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import Download from '@lucide/svelte/icons/download';
  import PackageOpen from '@lucide/svelte/icons/package-open';
  import FolderSearch from '@lucide/svelte/icons/folder-search';
  import Volume2 from '@lucide/svelte/icons/volume-2';
  import Play from '@lucide/svelte/icons/play';
  import Square from '@lucide/svelte/icons/square';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import Inbox from '@lucide/svelte/icons/inbox';
  import CheckCheck from '@lucide/svelte/icons/check-check';
  import Link from '@lucide/svelte/icons/link';
  import { SvelteSet } from 'svelte/reactivity';
  import Toggle from '../components/Toggle.svelte';
  import ModThumb from '../components/ModThumb.svelte';
  import Menu from '../components/Menu.svelte';
  import SoundList from '../components/SoundList.svelte';
  import TrashView from '../components/TrashView.svelte';
  import WorkshopDialog from '../components/WorkshopDialog.svelte';
  import FavoriteLibrary from '../components/FavoriteLibrary.svelte';
  import { favoriteMenu, setFavoriteMembers } from '../components/favorite-menus';
  import FavoriteCollectionDialog from '../components/FavoriteCollectionDialog.svelte';
  import QuickTest from '../components/QuickTest.svelte';
  import type { MenuItem, MenuState } from '../components/menu';
  import { app, ROOT, FAV, INBOX, TRASH, workshopLink, mib } from '../stores/app.svelte';
  import { player, hasGunSounds } from '../stores/player.svelte';
  import { looksLikeWorkshop } from '../workshop';
  import { browser } from '../browser/browser.svelte';
  import { CREATOR_LABEL } from '../browser/trail';
  import type { FavoriteCollection, Mod, Profile } from '../types';
  import { desktop, pickVpk, pickDirectory, errorText, onFileDrop } from '../api/bridge';

  type Edit = { kind: 'profile' | 'new-profile' | 'category'; id?: string; where?: 'side' | 'main' } | null;
  let edit = $state<Edit>(null);
  /** 编辑框里的文字单独存，提交时清空 edit 不会让绑定读到 null */
  let editValue = $state('');
  function startEdit(next: NonNullable<Edit>, value: string) { edit = next; editValue = value; }
  let selected = $state<string[]>([]);
  let anchor: string | null = null;
  let detailId = $state<string | null>(null);
  let sort = $state<'name' | 'size' | 'updated'>('name');
  let importOpen = $state(false);
  let importPath = $state('');
  let quickTest = $state<{seed?: string[]} | null>(null);
  function openTest(ids?: string[]) { player.stop(); quickTest = {seed:ids}; }

  // ---------- 本机记忆：视图、侧栏展开 ----------
  const read = <T,>(key: string, fallback: T): T => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
  const write = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 无存储时只在本次会话生效 */ } };
  let view = $state<'grid' | 'list'>(read('flare.mods.view.v2', 'grid'));
  const expanded = new SvelteSet<string>(read<string[]>('flare.mods.expanded', []));
  $effect(() => write('flare.mods.view.v2', view));
  $effect(() => write('flare.mods.expanded', [...expanded]));

  const prof = $derived(app.editingProfile!);
  const f = app.modFilter;

  // ---------- 当前位置：某个分类，或侧栏「库」里的收藏 / 新下载 / 回收站 ----------
  const inFav = $derived(f.category === FAV);
  let collectionId = $state('');
  let collectionDialog = $state<{ mode: 'create' | 'add' | 'rename'; group?: FavoriteCollection; seed?: string[] } | null>(null);
  const inInbox = $derived(f.category === INBOX);
  const inTrash = $derived(f.category === TRASH);
  /** 收藏、新下载这类跨分类的视图 */
  const smart = $derived(inFav || inInbox);
  /** 库视图（收藏、新下载、回收站）独立于方案：不显示方案标题、启停筛选和开关 */
  const lib = $derived(smart || inTrash);
  /** 方案相关的计算只在分类视图里用；库视图里没有“当前方案” */
  const scoped = $derived(lib ? undefined : prof);
  /** 库视图忽略按方案状态的筛选，回到分类后筛选还在 */
  const fstatus = $derived(lib ? 'all' : f.status);
  /** 离开库视图时回到的分类 */
  let lastPlace = ROOT;
  const cur = $derived(!lib && app.categories.some((c) => c.id === f.category && !c.builtin) ? f.category : ROOT);
  const curPath = $derived(app.categoryPath(cur));
  /** 收藏、新下载、搜索、按状态筛选时，平铺显示（不分文件夹） */
  const flat = $derived(smart || !!f.q.trim() || fstatus !== 'all');
  const scope = $derived(app.subtree(cur));
  const scopeMods = $derived(
    inInbox ? app.mods.filter((m) => app.isInbox(m.id))
    : app.mods.filter((m) => scope.has(app.folderOf(m))),
  );
  const favCount = $derived(app.favoriteEntries.length);
  const inboxCount = $derived(app.mods.filter((m) => app.isInbox(m.id)).length);
  const downloading = $derived(app.tasks.filter((t) => t.kind === 'download' && !['done', 'failed', 'canceled'].includes(t.state)).length);
  const packing = $derived(app.tasks.filter(t => t.kind === 'pack' && t.gameRoot.toLowerCase() === app.game.root.toLowerCase() && !['done', 'failed', 'canceled'].includes(t.state)));
  const trashSize = $derived(app.trash.reduce((n, t) => n + t.sizeBytes, 0));
  /** 某个 Mod 在哪些方案里；库视图用 */
  const profilesOf = (id: string) => app.profiles.filter((p) => p.modIds.includes(id));
  const conflictIds = $derived(new Set(app.activeConflicts(scoped).flatMap((c) => [c.a, c.b])));
  const counts = $derived({
    all: scopeMods.length,
    on: scopeMods.filter((m) => prof.modIds.includes(m.id)).length,
    off: scopeMods.filter((m) => !prof.modIds.includes(m.id) && !isPkg(m)).length,
    conflict: scopeMods.filter((m) => conflictIds.has(m.id)).length,
  });
  const filters = [['all', '全部'], ['on', '启用'], ['off', '停用'], ['conflict', '重叠']] as const;

  const folders = $derived(flat ? [] : app.childCategories(cur));
  const rows = $derived.by(() => {
    const q = f.q.trim().toLowerCase();
    const base = flat ? scopeMods : app.mods.filter((m) => app.folderOf(m) === cur);
    const list = base.filter((m) => {
      const on = prof.modIds.includes(m.id);
      if (isPkg(m) && (fstatus === 'on' || fstatus === 'off')) return false;
      if (fstatus === 'on' && !on) return false;
      if (fstatus === 'off' && on) return false;
      if (fstatus === 'conflict' && !conflictIds.has(m.id)) return false;
      return !q || m.title.toLowerCase().includes(q) || m.sourceTitle?.toLowerCase().includes(q) || m.file.toLowerCase().includes(q) || m.author.toLowerCase().includes(q);
    });
    const by: Record<typeof sort, (a: Mod, b: Mod) => number> = {
      name: (a, b) => a.title.localeCompare(b.title, 'zh'),
      size: (a, b) => b.sizeMB - a.sizeMB,
      updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    };
    return list.sort(by[sort]);
  });

  /** 每个分类（含子分类）里的 Mod 数，给侧栏用 */
  const deep = $derived.by(() => {
    const total = new Map<string, number>();
    for (const m of app.mods) {
      let id = app.folderOf(m);
      for (let guard = 0; guard < 64; guard++) {
        total.set(id, (total.get(id) ?? 0) + 1);
        if (id === ROOT) break;
        const c = app.categories.find((x) => x.id === id);
        id = c ? app.parentOf(c) : ROOT;
      }
    }
    return total;
  });
  function folderStat(id: string) {
    const sub = app.subtree(id);
    const mods = app.mods.filter((m) => sub.has(app.folderOf(m)));
    const covers = [...mods].sort((a, b) => Number(!!b.hasThumbnail) - Number(!!a.hasThumbnail) || a.title.localeCompare(b.title, 'zh')).slice(0, 4);
    return {
      mods, covers, total: mods.length, subs: app.childCategories(id).length,
      on: mods.filter((m) => prof.modIds.includes(m.id)).length,
      sizeMB: mods.reduce((s, m) => s + m.sizeMB, 0),
    };
  }
  type Stat = ReturnType<typeof folderStat>;
  const stats = $derived(new Map(folders.map((c) => [c.id, folderStat(c.id)])));
  function toggleFolder(st: Stat) {
    const all = st.total > 0 && st.on === st.total;
    setInProfile(st.mods.map((m) => m.id), prof.id, !all);
  }

  const allChecked = $derived(rows.length > 0 && rows.every((r) => selected.includes(r.id)));
  const selAllFav = $derived(selected.length > 0 && selected.every((id) => app.isFavorite(id)));
  const detail = $derived(detailId ? app.mod(detailId) : undefined);
  const catName = (id: string) => (id === ROOT ? '最外层' : app.categories.find((c) => c.id === id)?.name ?? '最外层');
  /** 方案草稿与游戏 addonlist 不一致 → 应用后才生效 */
  const pending = (m: Mod, on: boolean) => !isPkg(m) && (m.enabled === null || m.enabled !== on);
  /** 外部平台（Skeeto）的创意工坊更新包：不进方案、不参与启停，在插件页管理 */
  const isPkg = (m: Mod | undefined) => m?.kind === 'platform-package';
  const platformName = (m: Mod) => app.platforms.find((p) => p.id === m.platformId)?.name ?? '外部平台';
  function openPlatform(m: Mod) { app.platformOpen = m.platformId ?? null; app.route = 'plugins'; }
  const gameState = (m: Mod) => (m.enabled === null ? '未登记' : m.enabled ? '游戏已启用' : '游戏已停用');
  const workshopUrl = (m: Mod) => workshopLink(m.workshopId ?? '');
  async function copyText(text: string, ok: string) {
    try { await navigator.clipboard.writeText(text); app.toast(ok); } catch { app.toast('复制失败'); }
  }

  const importBlock = $derived(
    !app.game.installed ? '未找到游戏目录，先在 DLL 模组页选择游戏'
    : app.game.running ? '游戏运行中，退出后再导入'
    : app.busy ? `正在${app.busy}，稍后再试` : '',
  );
  const busyReason = $derived(app.busy ? `正在${app.busy}` : '');
  const deleteBlock = $derived(app.game.running ? '游戏运行中，退出后再删除' : busyReason);
  const notices = $derived([
    ...app.issues.map((i) => ({ text: i.message, danger: true })),
    ...(!lib && prof.modIds.some((id) => !app.mod(id)) ? [{ text: '方案包含已移除的 Mod。可右键左侧方案名，选择「从游戏同步」。', danger: true }] : []),
    ...(!lib && app.lastModBackup ? [{ text: `已备份原 addonlist：${app.lastModBackup}`, danger: false }] : []),
  ]);
  /** 库视图的标题副行 */
  const libSub = $derived(
    inInbox ? `${f.q.trim() ? `搜索结果 ${rows.length} 项 · ` : ''}${inboxCount} 个待整理${downloading ? ` · ${downloading} 个正在下载` : ''} · 归类或标记已整理后离开这里`
    : `${app.trash.length} 项${app.trash.length ? ` · ${mib(trashSize)}` : ''} · 放在 left4dead2\\.matcha-trash，不参与扫描和方案应用`,
  );

  // ---------- 导航 ----------
  function go(id: string) {
    if (id !== f.category) { selected = []; anchor = null; importOpen = false; dropping = null; if (edit?.kind === 'category') edit = null; }
    f.category = id;
    if (id === FAV) { collectionId = ''; selected = []; anchor = null; detailId = null; }
    if (id !== FAV && id !== INBOX && id !== TRASH) lastPlace = id;
    for (const c of app.categoryPath(id)) expanded.add(c.id);
  }
  function openCollection(id: string) {
    go(FAV); collectionId = id; f.q = '';
  }
  const collectionItems = (ids: string[]) => favoriteMenu(ids, seed => collectionDialog = { mode: 'create', seed });
  function up() { go(curPath.at(-2)?.id ?? ROOT); }
  /** 侧栏点方案：编辑这个方案；在库视图里时回到之前的分类 */
  function openProfile(id: string) {
    app.editingProfileId = id;
    selected = [];
    if (lib) go(lastPlace);
  }
  /** 任务托盘里「查看」下载好的 Mod：去新下载，打开详情 */
  function show(modId: string) {
    const mod = app.mod(modId);
    go(app.isInbox(modId) ? INBOX : mod ? app.folderOf(mod) : ROOT);
    f.q = ''; f.status = 'all';
    if (app.mod(modId)) detailId = modId;
  }
  // 下载页点「查看」跳过来时定位到那个 Mod
  $effect(() => {
    const id = app.focusMod;
    if (id && app.mod(id)) { app.focusMod = null; show(id); }
  });
  function toggleExpand(id: string) { if (expanded.has(id)) expanded.delete(id); else expanded.add(id); }

  // ---------- 导入：落在当前分类里 ----------
  async function chooseSource(folder = false) {
    if (!desktop) { importOpen = !importOpen; return; }
    const here = cur;
    try { const file = folder ? await pickDirectory('选择要打包的 Mod 素材文件夹') : await pickVpk(); if (file) await app.importMods([file], here); }
    catch (e) { app.toast(errorText(e)); }
  }
  /** 创意工坊下载对话框；text = Ctrl+V 粘贴进来的链接 */
  let workshop = $state<{ text: string } | null>(null);
  const workshopBlock = $derived(!app.game.installed ? '未找到游戏目录，先在 DLL 模组页选择游戏' : '');
  function openWorkshop(text = '') {
    if (workshopBlock) return app.toast(workshopBlock);
    workshop = { text };
  }
  function addItems(): MenuItem[] {
    return [
      { label: '本地 VPK 文件…', icon: Upload, hint: '可直接拖入', disabled: importBlock || false, run: () => void chooseSource() },
      { label: '打包素材文件夹…', icon: FolderInput, hint: '生成 VPK', disabled: importBlock || false, run: () => void chooseSource(true) },
      { label: '创意工坊链接…', icon: Link, hint: 'Ctrl+V', disabled: workshopBlock || false, run: () => openWorkshop() },
    ];
  }
  /** 在 Mod 页按 Ctrl+V：剪贴板里是工坊链接就直接打开下载对话框 */
  function onPaste(e: ClipboardEvent) {
    if (inFav || quickTest || workshop || collectionDialog || menu || app.confirmation || edit || (e.target as Element).closest?.('input, textarea, select, [contenteditable]')) return;
    const text = e.clipboardData?.getData('text') ?? '';
    if (!looksLikeWorkshop(text)) return;
    e.preventDefault();
    openWorkshop(text);
  }
  /** 删除后把已经不在的 Mod 移出选择和详情 */
  async function removeMods(ids: string[]) {
    if (!await app.deleteMods(ids)) return;
    selected = selected.filter((id) => !ids.includes(id));
    if (detailId && ids.includes(detailId)) detailId = null;
  }

  // ---------- 选择 ----------
  function toggleSel(id: string) {
    selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    anchor = id;
  }
  function toggleAll() { selected = allChecked ? [] : rows.map((r) => r.id); }
  function rangeTo(id: string) {
    const ids = rows.map((r) => r.id);
    const a = anchor ? ids.indexOf(anchor) : -1;
    const b = ids.indexOf(id);
    if (a < 0 || b < 0) return toggleSel(id);
    selected = [...new Set([...selected, ...ids.slice(Math.min(a, b), Math.max(a, b) + 1)])];
  }
  function activate(e: MouseEvent, id: string) {
    if (suppressClick) return;
    if (e.ctrlKey || e.metaKey) return toggleSel(id);
    if (e.shiftKey) return rangeTo(id);
    detailId = detailId === id ? null : id;
    anchor = id;
  }
  function onItemKey(e: KeyboardEvent, id: string) {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter') detailId = id;
    if (e.key === ' ') { e.preventDefault(); if (player.key) player.stop(); else toggleSel(id); }
  }
  function openFolder(id: string) { if (!suppressClick) go(id); }
  function onFolderKey(e: KeyboardEvent, id: string) { if (e.target === e.currentTarget && e.key === 'Enter') go(id); }

  // ---------- 方案 / 分类编辑 ----------
  function newFolder(parentId: string, where: 'side' | 'main') {
    const c = app.createCategory(app.freshCategoryName(parentId), parentId);
    if (!c) return;
    if (parentId !== ROOT) expanded.add(parentId);
    startEdit({ kind: 'category', id: c.id, where }, c.name);
  }
  function renameFolder(id: string, where: 'side' | 'main') {
    startEdit({ kind: 'category', id, where }, catName(id));
  }
  const editing = (id: string, where: 'side' | 'main') => edit?.kind === 'category' && edit.id === id && edit.where === where;
  function commit() {
    if (!edit) return;
    const v = editValue.trim();
    if (v) {
      if (edit.kind === 'profile' && edit.id) app.renameProfile(edit.id, v);
      if (edit.kind === 'category' && edit.id) app.renameCategory(edit.id, v);
      if (edit.kind === 'new-profile') app.createProfile(v, prof.id);
    }
    edit = null;
  }
  function onEditKey(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') edit = null;
  }
  function focus(node: HTMLInputElement) { node.focus(); node.select(); }
  function moveTo(ids: string[], catId: string) {
    app.moveToCategory(ids, catId);
    app.toast(`${ids.length} 个 Mod 移到${catId === ROOT ? '最外层' : `「${catName(catId)}」`}`);
  }
  const stop = (e: Event) => e.stopPropagation();

  /** 加入 / 移出任意方案；只提交真正有变化的 Mod */
  function setInProfile(ids: string[], profileId: string, on: boolean) {
    const p = app.profile(profileId);
    if (!p) return;
    const list = on ? ids.filter((id) => !p.modIds.includes(id) && !app.mod(id)?.error && !isPkg(app.mod(id))) : ids.filter((id) => p.modIds.includes(id));
    if (!list.length) return app.toast(on ? `都已在「${p.name}」里，或无法启用` : `都不在「${p.name}」里`);
    const msg = p.id === prof.id ? undefined : `${list.length} 个 Mod ${on ? '加入' : '移出'}「${p.name}」`;
    void app.setModsEnabled(list, on, p, msg);
  }
  function newProfileWith(ids: string[]) {
    const list = ids.filter((id) => !app.mod(id)?.error && !isPkg(app.mod(id)));
    const p = app.createProfile(app.freshProfileName(), undefined, { modIds: list, open: false });
    startEdit({ kind: 'profile', id: p.id }, p.name);
    app.toast(`已新建「${p.name}」，包含 ${list.length} 个 Mod`);
  }
  function newFolderWith(ids: string[]) {
    const parent = smart ? ROOT : cur;
    const c = app.createCategory(app.freshCategoryName(parent), parent);
    if (!c) return;
    app.moveToCategory(ids, c.id);
    if (parent !== ROOT) expanded.add(parent);
    startEdit({ kind: 'category', id: c.id, where: flat ? 'side' : 'main' }, c.name);
  }

  // ---------- 菜单：右键、批量栏、详情共用同一份条目 ----------
  let menu = $state<MenuState>(null);
  const closeMenu = () => (menu = null);
  function menuAt(e: MouseEvent, items: MenuItem[]) {
    e.preventDefault(); e.stopPropagation();
    if (items.length) menu = { x: e.clientX, y: e.clientY, items };
  }
  function menuBelow(el: HTMLElement, items: MenuItem[]) {
    const r = el.getBoundingClientRect();
    menu = { x: r.left, y: r.bottom + 4, items };
  }
  /** 右键点在已选中的项上 → 作用于整个选择；否则只作用于这一项 */
  const targets = (id: string) => (selected.includes(id) ? [...selected] : [id]);

  function profileActions(profile: Profile): MenuItem[] {
    const unavailable = busyReason || (!app.modState.writable ? '游戏 Mod 设置暂不可用' : false);
    return [
      { label: '从游戏同步…', icon: Download, disabled: unavailable, run: () => void app.syncMods(profile) },
      { label: '应用到游戏…', icon: Upload, disabled: unavailable || (app.game.running ? '游戏运行中，退出后再应用' : false), run: () => void app.applyMods(profile) },
    ];
  }

  function profileItems(ids: string[]): MenuItem[] {
    return [
      ...app.profiles.map((p): MenuItem => {
        const has = ids.filter((id) => p.modIds.includes(id)).length;
        const all = has === ids.length;
        return {
          label: p.name, hint: p.id === app.activeProfileId ? '启动' : p.id === prof.id ? '编辑中' : undefined,
          checked: has === 0 ? false : all ? true : 'mixed', disabled: busyReason || false,
          run: () => setInProfile(ids, p.id, !all),
        };
      }),
      { kind: 'sep' },
      { label: '新方案…', icon: Plus, disabled: busyReason || false, run: () => newProfileWith(ids) },
    ];
  }
  function categoryItems(ids: string[]): MenuItem[] {
    const where = new Set(ids.map((id) => { const m = app.mod(id); return m ? app.folderOf(m) : ROOT; }));
    const only = where.size === 1 ? [...where][0] : null;
    return [
      { label: '最外层（不分类）', current: only === ROOT, run: () => moveTo(ids, ROOT) },
      ...app.categoryTree().map(({ c, depth: d }): MenuItem => ({ label: c.name, indent: d, icon: Folder, current: only === c.id, run: () => moveTo(ids, c.id) })),
      { kind: 'sep' },
      { label: '新建分类并移入', icon: FolderPlus, run: () => newFolderWith(ids) },
    ];
  }
  function modItems(ids: string[]): MenuItem[] {
    const mods = ids.map((id) => app.mod(id)).filter((m): m is Mod => !!m);
    if (!mods.length) return [];
    const one = mods.length === 1 ? mods[0] : null;
    const allOn = mods.every((m) => prof.modIds.includes(m.id));
    const allFav = mods.every((m) => app.isFavorite(m.id));
    const ws = mods.filter((m) => m.workshopId);
    const items: MenuItem[] = one
      ? [{ label: '查看详情', icon: PanelRight, hint: 'Enter', run: () => (detailId = one.id) }]
      : [{ kind: 'label', label: `已选 ${mods.length} 个 Mod` }];
    // 库视图不属于任何方案：只给「加入方案」子菜单，不给当前方案的启停
    if (!lib) items.push({
      label: allOn ? `在「${prof.name}」中停用` : `在「${prof.name}」中启用`, icon: allOn ? ToggleLeft : ToggleRight,
      disabled: busyReason || (!allOn && mods.every((m) => m.error) ? '解析失败的 Mod 不能启用' : !allOn && mods.every(isPkg) ? '平台更新包在 DLL 模组页管理' : false),
      run: () => setInProfile(ids, prof.id, !allOn),
    });
    items.push(
      { label: '快速实测', icon: Play, disabled: app.game.installed ? false : '请先选择游戏目录', run: () => openTest(ids) },
      { label: allFav ? '取消收藏' : '收藏', icon: Star, hint: 'F', run: () => app.setFavorite(ids, !allFav) },
      { label: '收藏合集', icon: Layers, items: collectionItems(ids) },
      { kind: 'sep' },
      { label: '加入方案', icon: ListChecks, disabled: mods.every(isPkg) ? '平台更新包不进方案' : false, items: mods.every(isPkg) ? undefined : profileItems(ids) },
      { label: '移到分类', icon: FolderInput, items: categoryItems(ids) },
    );
    if (one && isPkg(one)) items.push({ label: `在 DLL 模组页查看 ${platformName(one)}`, icon: PanelRight, run: () => openPlatform(one) });
    const unsorted = mods.filter((m) => app.isInbox(m.id));
    if (unsorted.length) items.push({ label: unsorted.length > 1 ? `标记已整理（${unsorted.length}）` : '标记已整理', icon: CheckCheck, run: () => app.markSorted(unsorted.map((m) => m.id)) });
    items.push({ kind: 'sep' });
    if (one?.soundCount) {
      const playing = player.modId === one.id;
      items.push({ label: playing ? '停止试听' : hasGunSounds(one) ? '试听枪声' : '试听声音', icon: playing ? Square : Volume2, run: () => void player.preview(one) });
    }
    const readable = mods.filter((m) => !m.error);
    items.push({
      label: readable.length > 1 ? `解包到桌面（${readable.length}）` : '解包到桌面', icon: PackageOpen,
      disabled: readable.length ? false : '解析失败的 Mod 不能解包',
      run: () => void app.extractMods(readable.map((m) => m.id)),
    });
    if (one?.absolutePath) { const path = one.absolutePath; items.push({ label: '在资源管理器中显示', icon: FolderSearch, run: () => app.reveal(path) }); }
    if (one) items.push({ label: '复制完整路径', icon: Copy, run: () => copyText(one.absolutePath || one.file, '已复制完整路径') });
    if (ws.length) items.push({
      label: ws.length > 1 ? `复制创意工坊链接（${ws.length}）` : '复制创意工坊链接', icon: ExternalLink,
      run: () => copyText(ws.map(workshopUrl).join('\n'), ws.length > 1 ? `已复制 ${ws.length} 个工坊链接` : '已复制创意工坊链接'),
    });
    items.push(
      { kind: 'sep' },
      { label: mods.length > 1 ? `删除 ${mods.length} 个…` : '删除…', icon: Trash, danger: true, hint: 'Del', disabled: deleteBlock || false, run: () => void removeMods(mods.map((m) => m.id)) },
    );
    return items;
  }
  function folderItems(id: string, where: 'side' | 'main'): MenuItem[] {
    const st = folderStat(id);
    const ids = st.mods.map((m) => m.id);
    const empty = st.total ? false : '分类是空的';
    const allOn = st.total > 0 && st.on === st.total;
    const allFav = st.total > 0 && st.mods.every((m) => app.isFavorite(m.id));
    const c = app.categories.find((x) => x.id === id);
    const parent = c ? app.parentOf(c) : ROOT;
    const blocked = app.subtree(id);
    return [
      { label: '打开', icon: FolderOpen, hint: 'Enter', run: () => go(id) },
      { label: allOn ? `在「${prof.name}」中停用全部` : `在「${prof.name}」中启用全部`, icon: allOn ? ToggleLeft : ToggleRight, disabled: empty || busyReason || false, run: () => toggleFolder(st) },
      { label: allFav ? '取消收藏全部' : '收藏全部', icon: Star, disabled: empty, run: () => app.setFavorite(ids, !allFav) },
      { kind: 'sep' },
      { label: '把里面的 Mod 加入方案', icon: ListChecks, disabled: empty, items: st.total ? profileItems(ids) : undefined },
      {
        label: '移到', icon: FolderInput, items: [
          { label: '最外层', current: parent === ROOT, run: () => app.moveCategory(id, ROOT) },
          ...app.categoryTree().filter(({ c: k }) => !blocked.has(k.id))
            .map(({ c: k, depth: d }): MenuItem => ({ label: k.name, indent: d, icon: Folder, current: parent === k.id, run: () => app.moveCategory(id, k.id) })),
        ],
      },
      { kind: 'sep' },
      { label: '新建子分类', icon: FolderPlus, run: () => newFolder(id, 'side') },
      { label: '重命名', icon: Pencil, run: () => renameFolder(id, where) },
      { kind: 'sep' },
      { label: '删除分类', icon: Trash, danger: true, hint: '内容移到上一级', run: () => app.deleteCategory(id) },
    ];
  }
  function areaItems(): MenuItem[] {
    const items: MenuItem[] = [];
    if (!flat) items.push({ label: cur === ROOT ? '新建分类' : '新建子分类', icon: FolderPlus, run: () => newFolder(cur, 'main') });
    items.push(
      ...addItems(),
      { kind: 'sep' },
      { label: '全选', hint: 'Ctrl+A', disabled: rows.length ? false : '没有可选的 Mod', run: () => (selected = rows.map((r) => r.id)) },
      { label: view === 'grid' ? '切换到列表' : '切换到图标', icon: view === 'grid' ? List : LayoutGrid, run: () => (view = view === 'grid' ? 'list' : 'grid') },
    );
    return items;
  }

  // ---------- 拖拽：Mod 或分类拖到分类、方案、收藏上（指针实现，Tauri 在 Windows 上会拦截 HTML5 拖拽） ----------
  /** 放置目标的键：c:分类 id、p:方案 id、fav */
  const kCat = (id: string) => `c:${id}`;
  const kProf = (id: string) => `p:${id}`;
  const isSortDrop = (key: string) => key.startsWith('<:') || key.startsWith('>:');
  let drag = $state<{ ids: string[]; folder: string | null; x: number; y: number; over: string | null } | null>(null);
  let press: { id: string; folder: boolean; x: number; y: number } | null = null;
  let suppressClick = false;

  function canDrop(key: string): boolean {
    if (!drag || (inFav && !key.startsWith('g:'))) return false;
    if (key === FAV) return !drag.folder && drag.ids.some((id) => !app.isFavorite(id));
    const id = key.slice(2);
    if (isSortDrop(key)) {
      const source = app.categories.find(c => c.id === drag!.folder);
      const target = app.categories.find(c => c.id === id);
      return !app.busy && !!source && !!target && source !== target && !target.builtin && app.parentOf(source) === app.parentOf(target);
    }
    if (key.startsWith('g:')) return !drag.folder && !app.busy && app.favoriteCollections.some(c => c.id === id && drag!.ids.some(m => !c.modIds.includes(m)));
    if (key.startsWith('p:')) {
      const p = app.profile(id);
      return !!p && drag.ids.some((m) => !p.modIds.includes(m) && !app.mod(m)?.error && !isPkg(app.mod(m)));
    }
    if (drag.folder) {
      const c = app.categories.find((x) => x.id === drag!.folder);
      return !!c && !app.subtree(drag.folder).has(id) && app.parentOf(c) !== id;
    }
    return drag.ids.some((m) => { const mod = app.mod(m); return !!mod && app.folderOf(mod) !== id; });
  }
  function onPress(e: PointerEvent, id: string, folder = false) {
    if (e.button !== 0 || edit || (e.target as Element).closest('button, input, select, a')) return;
    press = { id, folder, x: e.clientX, y: e.clientY };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onRelease, { once: true });
    window.addEventListener('pointercancel', endDrag, { once: true });
  }
  function onMove(e: PointerEvent) {
    if (!press) return;
    if (!drag) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < 6) return;
      drag = press.folder
        ? { ids: folderStat(press.id).mods.map((m) => m.id), folder: press.id, x: 0, y: 0, over: null }
        : { ids: selected.includes(press.id) ? [...selected] : [press.id], folder: null, x: 0, y: 0, over: null };
      document.documentElement.classList.add('dragging-mods');
    }
    drag.x = e.clientX; drag.y = e.clientY;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-drop]');
    let key = el?.dataset.drop ?? null;
    if (el?.matches('.item,.tile,.row') && key?.startsWith('c:') && drag.folder) {
      const rect = el.getBoundingClientRect();
      const fraction = el.classList.contains('tile') ? (e.clientX - rect.left) / rect.width : (e.clientY - rect.top) / rect.height;
      const edge = fraction < .28 ? '<:' : fraction > .72 ? '>:' : null;
      if (edge && canDrop(edge + key.slice(2))) key = edge + key.slice(2);
    }
    drag.over = key && canDrop(key) ? key : null;
  }
  function onRelease() {
    if (drag) {
      suppressClick = true;
      setTimeout(() => (suppressClick = false));
      const key = drag.over && canDrop(drag.over) ? drag.over : null;
      if (key === FAV) app.setFavorite(drag.ids.filter((id) => !app.isFavorite(id)), true);
      else if (key?.startsWith('g:')) { const c = app.favoriteCollections.find(c => c.id === key.slice(2)); if (c) void setFavoriteMembers(c, drag.ids, true); }
      else if (key?.startsWith('p:')) setInProfile(drag.ids, key.slice(2), true);
      else if (key && drag.folder && isSortDrop(key)) void app.reorderCategory(drag.folder, key.slice(2), key.startsWith('>'));
      else if (key) {
        if (drag.folder) app.moveCategory(drag.folder, key.slice(2));
        else moveTo(drag.ids, key.slice(2));
      }
    }
    endDrag();
  }
  function endDrag() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onRelease);
    window.removeEventListener('pointercancel', endDrag);
    document.documentElement.classList.remove('dragging-mods');
    press = null; drag = null;
  }
  $effect(() => endDrag);
  $effect(() => () => player.stop());
  const dragLabel = $derived.by(() => {
    if (!drag) return '';
    const what = drag.folder ? `「${catName(drag.folder)}」` : `${drag.ids.length} 个 Mod`;
    const k = drag.over;
    if (!k && inFav) return what + ' · 拖到收藏合集上';
    if (!k) return drag.folder ? `${what} · 同级边缘排序，中央移入` : `${what} · 拖到分类、方案或收藏上`;
    if (isSortDrop(k)) return `${what} 排在「${catName(k.slice(2))}」${k.startsWith('>') ? '后面' : '前面'}`;
    if (k === FAV) return `${what} 加入收藏`;
    if (k.startsWith('g:')) return what + ' 加入合集「' + app.favoriteCollections.find(c => c.id === k.slice(2))?.name + '」';
    if (k.startsWith('p:')) {
      const name = app.profile(k.slice(2))?.name;
      return drag.folder ? `把${what}里的 Mod 加入「${name}」` : `${what} 加入方案「${name}」`;
    }
    const id = k.slice(2);
    const where = id === ROOT ? '最外层' : `「${catName(id)}」`;
    return drag.folder ? `把${what}移到${where}` : `${what} 移到${where}`;
  });

  // 系统拖入既可能是目录，也可能是现成的 VPK；由后端按文件类型辨别。
  let dropping = $state<number | null>(null);
  let fileOver = $state<string | null>(null);
  function fileTarget(hit?: Element | null) {
    if (hit?.closest('[data-drop]')?.getAttribute('data-drop') === FAV) return FAV;
    const id = hit?.closest<HTMLElement>('[data-favorite-folder]')?.dataset.favoriteFolder;
    return id ? 'g:' + id : null;
  }
  function bookmarkTarget(hit?: Element | null) {
    const key = fileTarget(hit);
    if (key === FAV) return '';
    return inFav ? (key?.slice(2) ?? collectionId) : null;
  }
  function receive(paths: string[], hit?: Element | null) {
    const target = bookmarkTarget(hit);
    if (target !== null) {
      if (app.busy) return app.toast(`正在${app.busy}，稍后再试`);
      void app.bookmarkFiles(paths, target || undefined);
      return;
    }
    if (importBlock) return app.toast(importBlock);
    void app.importMods(paths, cur);
  }
  $effect(() => {
    let off: (() => void) | undefined, dead = false;
    void onFileDrop((e, hit) => {
      if (dead) return;
      fileOver = e.type === 'leave' || e.type === 'drop' ? null : fileTarget(hit);
      if (e.type === 'enter') dropping = e.paths.length;
      else if (e.type === 'leave') dropping = null;
      else if (e.type === 'drop') { dropping = null; receive(e.paths, hit); }
      else dropping ??= 0;
    }, () => document.querySelector('section.mods')).then((fn) => { if (dead) fn(); else off = fn; });
    return () => { dead = true; off?.(); };
  });
  // 浏览器预览：能看到拖入动作，但拿不到完整路径
  let depth = 0;
  const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
  function onDragEnter(e: DragEvent) { if (desktop || !hasFiles(e)) return; e.preventDefault(); depth++; dropping = 0; }
  function onDragOver(e: DragEvent) { if (desktop || !hasFiles(e)) return; e.preventDefault(); fileOver = fileTarget(e.target as Element); e.dataTransfer!.dropEffect = 'copy'; }
  function onDragLeave(e: DragEvent) { if (desktop || !hasFiles(e)) return; if (--depth <= 0) { depth = 0; dropping = null; fileOver = null; } }
  function onDropFiles(e: DragEvent) {
    if (desktop || !hasFiles(e)) return;
    e.preventDefault(); depth = 0; dropping = null; fileOver = null;
    const target = bookmarkTarget(e.target as Element);
    if (target !== null) {
      openCollection(target);
      importOpen = true; app.toast('粘贴原文件路径即可收藏');
      return;
    }
    importOpen = true;
    app.toast('请粘贴 VPK 或素材文件夹的完整路径；桌面版支持直接拖入');
  }

  function onKey(e: KeyboardEvent) {
    if (inFav || quickTest || menu || workshop || collectionDialog || app.confirmation || edit || (e.target as Element).closest?.('input, select, textarea')) return;
    if (e.key === 'Escape') {
      if (drag) endDrag();
      else if (player.key) player.stop();
      else if (selected.length) selected = [];
      else if (detailId) detailId = null;
    }
    // 空格停播；聚焦在卡片上时由卡片自己处理
    if (e.key === ' ' && player.key && !(e.target as Element).closest?.('.tile, .row, button')) { e.preventDefault(); player.stop(); }
    if (e.key === 'Backspace' && (lib || cur !== ROOT)) { e.preventDefault(); if (lib) go(lastPlace); else up(); }
    if (inTrash) return;
    if (e.key === 'Delete') {
      const ids = selected.length ? selected : detailId ? [detailId] : [];
      if (ids.length) { e.preventDefault(); if (deleteBlock) app.toast(deleteBlock); else void removeMods([...ids]); }
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && rows.length) {
      e.preventDefault();
      selected = rows.map((r) => r.id);
    }
    if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const ids = selected.length ? selected : detailId ? [detailId] : [];
      if (ids.length) { e.preventDefault(); app.setFavorite(ids, !ids.every((id) => app.isFavorite(id))); }
    }
  }
</script>

<svelte:window onkeydown={onKey} onpaste={onPaste} />

{#snippet tree(parent: string, level: number)}
  {#each app.childCategories(parent) as c (c.id)}
    {@const kids = app.childCategories(c.id).length > 0}
    {@const open = expanded.has(c.id)}
    {#if editing(c.id, 'side')}
      <input class="inline" style:margin-left="{level * 12}px" style:width="calc(100% - {level * 12}px)" bind:value={editValue} onkeydown={onEditKey} onblur={commit} use:focus />
    {:else}
      <div class="item" class:on={!lib && cur === c.id} class:target={!!drag && canDrop(kCat(c.id))} class:drop={drag?.over === kCat(c.id)} class:moving={drag?.folder === c.id} class:sort-before={drag?.over === "<:" + c.id} class:sort-after={drag?.over === ">:" + c.id}
           data-drop={kCat(c.id)} style:padding-left="{2 + (level - 1) * 12}px" role="button" tabindex="0"
           onpointerdown={(e) => { if (!inFav) onPress(e, c.id, true); }} onclick={() => openFolder(c.id)} onkeydown={(e) => onFolderKey(e, c.id)}
           oncontextmenu={(e) => inFav ? e.preventDefault() : menuAt(e, folderItems(c.id, 'side'))}>
        <button class="caret" class:open class:none={!kids} tabindex="-1" aria-label={open ? '收起' : '展开'} onclick={(e) => { e.stopPropagation(); toggleExpand(c.id); }}><ChevronRight size={12} /></button>
        <span class="nm">{c.name}</span>
        {#if !inFav}<span class="ops">
          <button class="icon-btn" title="新建子分类" onclick={(e) => { e.stopPropagation(); newFolder(c.id, 'side'); }}><FolderPlus size={12} /></button>
          <button class="icon-btn" title="重命名" onclick={(e) => { e.stopPropagation(); renameFolder(c.id, 'side'); }}><Pencil size={12} /></button>
          <button class="icon-btn" title="删除分类（里面的内容移到上一级）" onclick={(e) => { e.stopPropagation(); app.deleteCategory(c.id); }}><Trash size={12} /></button>
        </span>{/if}
        <span class="mono n">{deep.get(c.id) ?? 0}</span>
      </div>
    {/if}
    {#if kids && open}{@render tree(c.id, level + 1)}{/if}
  {/each}
{/snippet}

{#snippet folderToggle(st: Stat, name: string)}
  <Toggle on={st.total > 0 && st.on === st.total} mixed={st.on > 0 && st.on < st.total} disabled={!!app.busy || !st.total}
          onchange={() => toggleFolder(st)} label={`启用「${name}」里的全部 Mod`} />
{/snippet}

{#snippet play(m: Mod)}
  {@const on = player.modId === m.id}
  <button class="play" class:on type="button" tabindex="-1" title={on ? '停止（空格）' : '试听枪声'} aria-label={on ? `停止试听 ${m.title}` : `试听 ${m.title} 的枪声`}
          onclick={(e) => { e.stopPropagation(); void player.preview(m); }}>
    {#if on && player.loading}<LoaderCircle size={12} class="spin" />{:else if on}<Square size={10} fill="currentColor" />{:else}<Play size={11} fill="currentColor" />{/if}
  </button>
{/snippet}

{#snippet inProfiles(m: Mod, cls: string)}
  {@const ps = profilesOf(m.id)}
  <button class={cls} class:has={ps.length > 0} type="button" tabindex="-1"
          title={ps.length ? `在 ${ps.map((p) => p.name).join('、')} · 点击加入或移出方案` : '不在任何方案 · 点击加入方案'}
          onclick={(e) => { e.stopPropagation(); menuBelow(e.currentTarget, profileItems([m.id])); }}>
    <ListChecks size={12} />{ps.length ? (cls === 'inp' ? ps.length : ps.map((p) => p.name).join('、')) : cls === 'inp' ? '加入' : '加入方案'}
  </button>
{/snippet}

{#snippet star(m: Mod, cls: string)}
  {@const fav = app.isFavorite(m.id)}
  <button class={cls} class:on={fav} type="button" tabindex="-1" aria-pressed={fav}
          title={fav ? '取消收藏（F）' : '收藏（F）'} aria-label={fav ? `取消收藏 ${m.title}` : `收藏 ${m.title}`}
          onclick={(e) => { e.stopPropagation(); app.setFavorite([m.id], !fav); }}><Star size={13} fill={fav ? 'currentColor' : 'none'} /></button>
{/snippet}

<section class="mods" aria-label="Mod 管理" ondragenter={onDragEnter} ondragover={onDragOver} ondragleave={onDragLeave} ondrop={onDropFiles}>
  <aside class="side">
    <div class="group">
      <div class="gh"><span class="section-label">Mod 方案</span>
        {#if !inFav}<button class="icon-btn" title="复制当前方案为新方案" onclick={() => startEdit({ kind: 'new-profile' }, `${prof.name} 副本`)}><Plus size={14} /></button>{/if}
      </div>
      {#each app.profiles as p (p.id)}
        {#if edit?.kind === 'profile' && edit.id === p.id}
          <input class="inline" bind:value={editValue} onkeydown={onEditKey} onblur={commit} use:focus />
        {:else}
          <div class="item" class:on={!lib && p.id === prof.id} class:target={!!drag && canDrop(kProf(p.id))} class:drop={drag?.over === kProf(p.id)}
               data-drop={kProf(p.id)} role="button" tabindex="0"
               onclick={() => openProfile(p.id)} oncontextmenu={(e) => inFav ? e.preventDefault() : menuAt(e, profileActions(p))}
               onkeydown={(e) => e.key === 'Enter' && openProfile(p.id)}>
            <span class="nm">{p.name}</span>
            {#if p.id === app.activeProfileId}<span class="dot" title="启动方案"></span>{/if}
            {#if !inFav}<span class="ops">
              <button class="icon-btn" title="重命名" onclick={(e) => { e.stopPropagation(); startEdit({ kind: 'profile', id: p.id }, p.name); }}><Pencil size={12} /></button>
              <button class="icon-btn" title="删除" onclick={(e) => { e.stopPropagation(); app.deleteProfile(p.id); }}><Trash size={12} /></button>
            </span>{/if}
            <span class="mono n">{p.modIds.length}</span>
          </div>
        {/if}
      {/each}
      <div class="item" class:on={inFav} class:target={!!drag && canDrop(FAV)} class:drop={drag?.over === FAV || fileOver === FAV} data-drop={FAV} role="button" tabindex="0"
           onclick={() => go(FAV)} onkeydown={(e) => e.key === 'Enter' && go(FAV)}>
        <span class="lic"><Star size={13} /></span><span class="nm">收藏夹</span><span class="mono n">{favCount}</span>
      </div>
      {#if edit?.kind === 'new-profile'}
        <input class="inline" bind:value={editValue} onkeydown={onEditKey} onblur={commit} use:focus />
      {/if}
    </div>

    <div class="group">
      <div class="gh"><span class="section-label">库</span></div>
      <div class="item" class:on={inInbox} role="button" tabindex="0" title="下载完成、还没整理的 Mod；不在任何方案里"
           onclick={() => go(INBOX)} onkeydown={(e) => e.key === 'Enter' && go(INBOX)}>
        <span class="lic">{#if downloading}<LoaderCircle size={13} class="spin" />{:else}<Inbox size={13} />{/if}</span><span class="nm">新下载</span>
        {#if inboxCount}<span class="mono badge-n">{inboxCount}</span>{:else}<span class="mono n">0</span>{/if}
      </div>
      <div class="item" class:on={inTrash} role="button" tabindex="0"
           onclick={() => go(TRASH)} onkeydown={(e) => e.key === 'Enter' && go(TRASH)}>
        <span class="lic"><Trash size={13} /></span><span class="nm">回收站</span><span class="mono n">{app.trash.length}</span>
      </div>
    </div>

    <div class="group">
      <div class="gh"><span class="section-label">分类</span>
        {#if !inFav}<button class="icon-btn" title="在最外层新建分类" onclick={() => newFolder(ROOT, 'side')}><FolderPlus size={14} /></button>{/if}
      </div>
      <div class="item" class:on={!lib && cur === ROOT} class:target={!!drag && canDrop(kCat(ROOT))} class:drop={drag?.over === kCat(ROOT)} data-drop={kCat(ROOT)} role="button" tabindex="0"
           onclick={() => go(ROOT)} onkeydown={(e) => e.key === 'Enter' && go(ROOT)}>
        <span class="nm">全部 Mod</span><span class="mono n">{app.mods.length}</span>
      </div>
      {@render tree(ROOT, 1)}
    </div>
  </aside>

  {#if inFav}
    <FavoriteLibrary bind:folderId={collectionId} bind:view bind:selected bind:pathOpen={importOpen}
      {dropping} over={fileOver ?? drag?.over} press={onPress} clickable={() => !suppressClick} locate={show} />
  {:else}
  <div class="main" class:at-root={!lib && cur === ROOT}>
    <header class="head">
      {#if lib}
      <div class="ttl">
        <div class="name">
          <span class="hic">{#if inInbox}<Inbox size={16} />{:else}<Trash size={16} />{/if}</span>
          <h2>{inInbox ? '新下载' : '回收站'}</h2>
          <span class="tag">独立于方案</span>
        </div>
        <p class="sub" role="status">{libSub}</p>
      </div>
      <div class="acts">
        <button class="icon-btn" title="重新扫描 addons 目录" aria-label="重新扫描" disabled={!!app.busy || app.refreshing} onclick={() => app.refresh()}><RefreshCw size={15} class={app.refreshing ? 'spin' : ''} /></button>
        {#if inInbox}
          <button class="btn ghost" disabled={!inboxCount} onclick={() => app.markSorted(app.inboxIds())}><CheckCheck size={14} />全部标记已整理</button>
          <button class="btn" disabled={!!workshopBlock} title={workshopBlock || '粘贴创意工坊链接下载（Ctrl+V）'} onclick={() => openWorkshop()}><Link size={14} />工坊链接</button>
        {:else}
          <button class="btn ghost danger-text" disabled={!app.trash.length || !!deleteBlock} title={deleteBlock || '永久删除回收站里的全部文件'} onclick={() => app.purgeTrash('all')}><Trash size={14} />清空回收站</button>
        {/if}
      </div>
      {:else}
      <div class="ttl">
        <h2>{prof.name}</h2>
        <p class="sub" role="status">共 {app.mods.length} 个 VPK，启用 {prof.modIds.filter((id) => app.mod(id)).length} 个</p>
      </div>
      <div class="acts">
        <button class="icon-btn" title="重新扫描 Mod" aria-label="重新扫描 Mod" disabled={!!app.busy || app.refreshing} onclick={() => app.refresh()}><RefreshCw size={15} class={app.refreshing ? 'spin' : ''} /></button>
        {#if prof.id === app.activeProfileId}
          <span class="startup-state">当前启动方案</span>
        {:else}
          <button class="btn primary" onclick={() => app.setActiveProfile(prof.id)}>设为启动方案</button>
        {/if}
      </div>
      {/if}
    </header>

    {#if inTrash}
      <TrashView />
    {:else}
    {#if selected.length}
      <div class="toolbar bulk">
        <span class="picked">已选 <b class="mono">{selected.length}</b> 项</span>
        {#if !lib}
          <button class="btn" disabled={!!app.busy} onclick={() => setInProfile(selected, prof.id, true)}>启用</button>
          <button class="btn" disabled={!!app.busy} onclick={() => setInProfile(selected, prof.id, false)}>停用</button>
        {/if}
        {#if inInbox}<button class="btn" onclick={() => app.markSorted(selected)}><CheckCheck size={14} />标记已整理</button>{/if}
        <button class="btn" onclick={() => app.setFavorite(selected, !selAllFav)}><Star size={14} fill={selAllFav ? 'currentColor' : 'none'} />{selAllFav ? '取消收藏' : '收藏'}</button>
        <button class="btn" onclick={(e) => menuBelow(e.currentTarget, profileItems(selected))}><ListChecks size={14} />加入方案<ChevronDown size={13} /></button>
        <button class="btn" onclick={(e) => menuBelow(e.currentTarget, categoryItems(selected))}><FolderInput size={14} />移到分类<ChevronDown size={13} /></button>        <button class="icon-btn del" title={deleteBlock || '删除（移到回收站）'} aria-label="删除" disabled={!!deleteBlock} onclick={() => void removeMods([...selected])}><Trash size={15} /></button>
        <span class="grow"></span>
        {#if !allChecked}<button class="btn ghost" onclick={() => (selected = rows.map((r) => r.id))}>全选 {rows.length}</button>{/if}
        <button class="btn ghost" onclick={() => (selected = [])}><X size={14} />取消选择</button>
      </div>
    {:else}
      <div class="toolbar" class:lib>
        {#if !lib}
          <div class="seg" role="radiogroup" aria-label="按方案状态筛选">
            {#each filters as [k, label] (k)}
              <button role="radio" aria-checked={f.status === k} class:on={f.status === k} class:danger={k === 'conflict' && counts.conflict > 0}
                      onclick={() => (f.status = k)}>{label}<span class="mono n">{counts[k]}</span></button>
            {/each}
          </div>
        {/if}
        <span class="grow"></span>
        <label class="search">
          <Search size={14} />
          <input placeholder={inInbox ? '在新下载里搜索' : cur === ROOT ? '搜索名称、文件名、作者' : `在「${catName(cur)}」里搜索`} bind:value={f.q} />
          {#if f.q}<button class="clear" aria-label="清空搜索" onclick={() => (f.q = '')}><X size={13} /></button>{/if}
        </label>
        <span class="sort">
          <select bind:value={sort} aria-label="排序">
            <option value="name">按名称</option>
            <option value="size">按大小</option>
            <option value="updated">按更新时间</option>
          </select>
          <ChevronDown size={13} />
        </span>
        <div class="seg icons" role="radiogroup" aria-label="显示方式">
          <button role="radio" aria-checked={view === 'grid'} class:on={view === 'grid'} title="图标" onclick={() => (view = 'grid')}><LayoutGrid size={15} /></button>
          <button role="radio" aria-checked={view === 'list'} class:on={view === 'list'} title="列表" onclick={() => (view = 'list')}><List size={15} /></button>
        </div>
        {#if !lib}<button class="btn" title="导入 VPK、打包素材文件夹或添加工坊链接" onclick={(e) => menuBelow(e.currentTarget, addItems())}><Plus size={14} />添加<ChevronDown size={13} /></button>{/if}
      </div>
    {/if}

    {#if packing.length}
      <button class="pack-progress" onclick={() => (app.route = 'downloads')} title="查看打包任务">
        <LoaderCircle size={14} class="spin" /><span>正在处理 {packing.length === 1 ? packing[0].title : packing.length + ' 个素材包'}</span><ChevronRight size={14}/>
      </button>
    {/if}
    {#if importOpen && !desktop}
      <form class="import-row" onsubmit={(e) => { e.preventDefault(); const p = importPath.trim().replace(/^"|"$/g, ''); if (p) receive([p]); }}>
        <input aria-label="VPK 或素材文件夹完整路径" placeholder="粘贴 VPK 或素材文件夹的完整路径" bind:value={importPath} />
        <button class="btn" disabled={!!importBlock || !importPath.trim()}>检查并导入</button>
        <button class="icon-btn" type="button" aria-label="收起" onclick={() => (importOpen = false)}><X size={14} /></button>
      </form>
    {/if}

    {#each notices as n (n.text)}<p class="notice" class:danger={n.danger}>{n.text}</p>{/each}

    {#if !lib && cur !== ROOT}
    <nav class="crumbs" aria-label="当前位置">
      <button class="crumb" class:target={!!drag && canDrop(kCat(ROOT))} class:drop={drag?.over === kCat(ROOT)} data-drop={kCat(ROOT)} onclick={() => go(ROOT)}>全部 Mod</button>
      {#each curPath as c (c.id)}
        <span class="sep"><ChevronRight size={13} /></span>
        <button class="crumb" class:cur={c.id === cur} class:target={!!drag && canDrop(kCat(c.id))} class:drop={drag?.over === kCat(c.id)} data-drop={kCat(c.id)} onclick={() => go(c.id)}>{c.name}</button>
      {/each}
      {#if flat}<span class="scope">· {f.q.trim() ? '搜索' : '筛选'}结果 {rows.length} 项，含子分类</span>{/if}
      <span class="grow"></span>
      {#if !flat}<button class="btn ghost" title={`在「${catName(cur)}」里新建子分类`} onclick={() => newFolder(cur, 'main')}><FolderPlus size={14} />新建子分类</button>{/if}
    </nav>
    {/if}

    <div class="content" class:lib role="presentation" oncontextmenu={(e) => { if (!(e.target as Element).closest('.tile, .row')) menuAt(e, areaItems()); }}>
      {#if !rows.length && !folders.length}
        <div class="empty">
          {#if inInbox && !f.q.trim()}
            <Download size={28} strokeWidth={1.25} />
            <p>没有待整理的新下载</p>
            <span>从创意工坊链接下载的 Mod 会先放在这里，不加入任何方案。在 Mod 页按 Ctrl+V 也能粘贴链接</span>
            <button class="btn" disabled={!!workshopBlock} onclick={() => openWorkshop()}><Link size={14} />添加工坊链接</button>
          {:else if flat}
            <p>没有符合条件的 Mod</p>
            <button class="btn ghost" onclick={() => { f.q = ''; f.status = 'all'; }}>清除筛选</button>
          {:else if cur !== ROOT}
            <Folder size={30} strokeWidth={1.25} />
            <p>「{catName(cur)}」还是空的</p>
            <span>拖入 VPK 或素材文件夹，导入到这个分类</span>
            <button class="btn" onclick={() => newFolder(cur, 'main')}><FolderPlus size={14} />新建子分类</button>
          {:else}
            <Upload size={28} />
            <p>拖入文件夹打包，或拖入现成的 VPK</p>
            <button class="btn" disabled={!!importBlock} onclick={() => chooseSource()}>选择 VPK</button>
          {/if}
        </div>
      {:else if view === 'grid'}
        <div class="tiles">
          {#each folders as c (c.id)}
            {@const st = stats.get(c.id)!}
            <div class="tile folder" class:drop={drag?.over === kCat(c.id)} class:moving={drag?.folder === c.id} class:sort-before={drag?.over === "<:" + c.id} class:sort-after={drag?.over === ">:" + c.id} data-drop={kCat(c.id)}
                 role="button" tabindex="0" aria-label={`打开分类 ${c.name}`}
                 onpointerdown={(e) => onPress(e, c.id, true)} onclick={() => openFolder(c.id)} onkeydown={(e) => onFolderKey(e, c.id)}
                 oncontextmenu={(e) => menuAt(e, folderItems(c.id, 'main'))}>
              <div class="stack">
                <div class="cover">
                  {#if st.covers.length}
                    <div class="mosaic">
                      {#each st.covers as m (m.id)}<span class="cell" class:off={!prof.modIds.includes(m.id)}><ModThumb mod={m} /></span>{/each}
                      {#each Array(4 - st.covers.length) as _, i (i)}<span class="cell blank"></span>{/each}
                    </div>
                  {:else}
                    <span class="hollow"><Folder size={34} strokeWidth={1.25} /></span>
                  {/if}
                  <span class="fops">
                    <button class="icon-btn" title="重命名" onclick={(e) => { e.stopPropagation(); renameFolder(c.id, 'main'); }}><Pencil size={13} /></button>
                    <button class="icon-btn" title="删除分类（里面的内容移到上一级）" onclick={(e) => { e.stopPropagation(); app.deleteCategory(c.id); }}><Trash size={13} /></button>
                  </span>
                </div>
              </div>
              {#if editing(c.id, 'main')}
                <input class="rename" aria-label="分类名" bind:value={editValue} onkeydown={onEditKey} onblur={commit} onclick={stop} use:focus />
              {:else}
                <span class="t" title={c.name}><span class="ficon"><Folder size={13} /></span>{c.name}</span>
              {/if}
              <div class="meta">
                <span>{st.total} 个 Mod{st.subs ? ` · ${st.subs} 个子类` : ''}</span>
                <span class="grow"></span>
                {@render folderToggle(st, c.name)}
              </div>
            </div>
          {/each}
          {#each rows as m (m.id)}
            {@const on = prof.modIds.includes(m.id)}
            {@const cs = app.conflictsOf(m.id, scoped)}
            {@const picked = selected.includes(m.id)}
            <div class="tile" class:off={!on && !lib && !isPkg(m)} class:open={detailId === m.id} class:picked class:moving={!drag?.folder && drag?.ids.includes(m.id)}
                 role="button" tabindex="0" aria-label={m.title}
                 onpointerdown={(e) => onPress(e, m.id)} onclick={(e) => activate(e, m.id)} onkeydown={(e) => onItemKey(e, m.id)}
                 oncontextmenu={(e) => menuAt(e, modItems(targets(m.id)))}>
              <div class="cover">
                <ModThumb mod={m} />
                <input type="checkbox" class="pick" class:show={selected.length > 0} checked={picked} tabindex="-1"
                       onclick={stop} onchange={() => toggleSel(m.id)} aria-label={`选择 ${m.title}`} />
                {@render star(m, 'star')}
                {#if hasGunSounds(m)}{@render play(m)}{/if}
                {#if flat && app.folderOf(m) !== ROOT}<span class="where" title={app.categoryLabel(m.categoryId)}><Folder size={11} />{catName(m.categoryId)}</span>{/if}
                {#if m.error}<span class="badge" title={m.error}>解析失败</span>
                {:else if isPkg(m)}<span class="badge new" title={m.warning || `${platformName(m)} 的创意工坊更新包`}>平台更新包</span>
                {:else if cs.length}<span class="badge">重叠 ×{cs.length}</span>
                {:else if !inInbox && app.isInbox(m.id)}<span class="badge new" title="新下载，还没整理">新</span>{/if}
              </div>
              <span class="t" title={m.title}>{m.title}</span>
              <div class="meta">
                <span class="mono">{m.sizeMB.toFixed(1)} MiB</span>
                {#if isPkg(m)}
                  <span class="grow"></span>
                  <button class="inp" type="button" tabindex="-1" title="在 DLL 模组页查看" onclick={(e) => { e.stopPropagation(); openPlatform(m); }}>{platformName(m)}</button>
                {:else if lib}
                  <span class="grow"></span>
                  {@render inProfiles(m, 'inp')}
                {:else}
                  {#if pending(m, on)}<span class="pend" title="本方案的勾选与游戏当前设置不同，使用本方案启动时生效">待应用</span>{/if}
                  <span class="grow"></span>
                  <Toggle {on} disabled={!!app.busy || (!!m.error && !on)} onchange={() => app.toggleMod(m.id)} label={`方案启用 ${m.title}`} />
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <div class="list" class:flat>
          <div class="row head">
            <input type="checkbox" checked={allChecked} disabled={!rows.length} onchange={toggleAll} aria-label="全选" />
            <span></span><span>名称</span>{#if flat}<span class="cat">分类</span>{/if}<span>{lib ? '所在方案' : '状态'}</span><span class="r">大小</span><span></span><span class="r">{lib ? '' : '启用'}</span>
          </div>
          {#each folders as c (c.id)}
            {@const st = stats.get(c.id)!}
            <div class="row folder" class:drop={drag?.over === kCat(c.id)} class:moving={drag?.folder === c.id} class:sort-before={drag?.over === "<:" + c.id} class:sort-after={drag?.over === ">:" + c.id} data-drop={kCat(c.id)}
                 role="button" tabindex="0" aria-label={`打开分类 ${c.name}`}
                 onpointerdown={(e) => onPress(e, c.id, true)} onclick={() => openFolder(c.id)} onkeydown={(e) => onFolderKey(e, c.id)}
                 oncontextmenu={(e) => menuAt(e, folderItems(c.id, 'main'))}>
              <span></span>
              <span class="mini fold"><Folder size={18} strokeWidth={1.5} /></span>
              <div class="nm">
                {#if editing(c.id, 'main')}
                  <input class="rename" aria-label="分类名" bind:value={editValue} onkeydown={onEditKey} onblur={commit} onclick={stop} use:focus />
                {:else}
                  <span class="t">{c.name}</span>
                {/if}
                <span class="f">{st.total} 个 Mod{st.subs ? ` · ${st.subs} 个子类` : ''}</span>
              </div>
              <span class="st">
                <span class="txt">启用 {st.on} / {st.total}</span>
                <span class="rops">
                  <button class="icon-btn" title="重命名" onclick={(e) => { e.stopPropagation(); renameFolder(c.id, 'main'); }}><Pencil size={13} /></button>
                  <button class="icon-btn" title="删除分类（里面的内容移到上一级）" onclick={(e) => { e.stopPropagation(); app.deleteCategory(c.id); }}><Trash size={13} /></button>
                </span>
              </span>
              <span class="mono r sz">{st.sizeMB.toFixed(1)} MiB</span>
              <span></span>
              <span class="r">{@render folderToggle(st, c.name)}</span>
            </div>
          {/each}
          {#each rows as m (m.id)}
            {@const on = prof.modIds.includes(m.id)}
            {@const cs = app.conflictsOf(m.id, scoped)}
            <div class="row" class:off={!on && !lib && !isPkg(m)} class:open={detailId === m.id} class:picked={selected.includes(m.id)} class:moving={!drag?.folder && drag?.ids.includes(m.id)}
                 role="button" tabindex="0"
                 onpointerdown={(e) => onPress(e, m.id)} onclick={(e) => activate(e, m.id)} onkeydown={(e) => onItemKey(e, m.id)}
                 oncontextmenu={(e) => menuAt(e, modItems(targets(m.id)))}>
              <input type="checkbox" checked={selected.includes(m.id)} tabindex="-1" onclick={stop} onchange={() => toggleSel(m.id)} aria-label={`选择 ${m.title}`} />
              <span class="mini"><ModThumb mod={m} /></span>
              <div class="nm">
                <span class="t">{m.title}</span>
                <span class="mono f">{m.file}</span>
              </div>
              {#if flat}<span class="cat" title={app.categoryLabel(m.categoryId)}>{app.folderOf(m) === ROOT ? '—' : app.categoryLabel(m.categoryId)}</span>{/if}
              <span class="st">
                {#if m.error}<span class="tag danger" title={m.error}>解析失败</span>{/if}
                {#if isPkg(m)}
                  <span class="tag">平台更新包</span>
                  <button class="rinp" type="button" tabindex="-1" onclick={(e) => { e.stopPropagation(); openPlatform(m); }}>在 DLL 模组页管理 {platformName(m)}</button>
                {:else if lib}
                  {@render inProfiles(m, 'rinp')}
                {:else}
                  {#if !m.error}<span class="g">{gameState(m)}</span>{/if}
                  {#if pending(m, on) && !m.error}<span class="pend">待应用</span>{/if}
                  {#if cs.length}<span class="tag danger">重叠 ×{cs.length}</span>{/if}
                {/if}
                {#if !inInbox && app.isInbox(m.id)}<span class="tag">新下载</span>{/if}
              </span>
              <span class="mono r sz">{m.sizeMB.toFixed(1)} MiB</span>
              <span class="r">{@render star(m, 'rstar')}</span>
              <span class="r">{#if !lib && !isPkg(m)}<Toggle {on} disabled={!!app.busy || (!!m.error && !on)} onchange={() => app.toggleMod(m.id)} label={`方案启用 ${m.title}`} />{/if}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
    {/if}

    {#if dropping !== null}
      <div class="dropzone" class:bad={fileOver !== FAV && !!importBlock}>
        {#if fileOver === FAV}<Star size={30}/><strong>松开以收藏</strong><span>只记录原位置</span>
        {:else}<Upload size={30} />
          <strong>{importBlock || (desktop ? `松开导入${dropping > 1 ? ' ' + dropping + ' 项' : ''}${cur !== ROOT ? '到「' + catName(cur) + '」' : '到 Mod 库'}` : '松开后粘贴本机路径')}</strong>
          <span>文件夹打成 VPK · 现成的 VPK 直接导入</span>{/if}
      </div>
    {/if}
  </div>

  {/if}

  {#if !inFav && detail}
    {@const cs = app.conflictsOf(detail.id, scoped)}
    {@const fav = app.isFavorite(detail.id)}
    {@const inProfiles = app.profiles.filter((p) => p.modIds.includes(detail.id))}
    <aside class="detail fade-in">
      <div class="dh">
        <span class="section-label">{detail.source === 'workshop' ? '创意工坊' : '本地'}</span>
        <span class="grow"></span>
        <button class="icon-btn" class:faved={fav} title={fav ? '取消收藏（F）' : '收藏（F）'} aria-pressed={fav} aria-label="收藏" onclick={() => app.setFavorite([detail.id], !fav)}><Star size={14} fill={fav ? 'currentColor' : 'none'} /></button>
        <button class="icon-btn" title="更多操作" aria-label="更多操作" onclick={(e) => menuBelow(e.currentTarget, modItems([detail.id]))}><Ellipsis size={14} /></button>
        <button class="icon-btn" aria-label="关闭" onclick={() => (detailId = null)}><X size={14} /></button>
      </div>
      <div class="hero"><ModThumb mod={detail} fit="contain" /></div>
      <h3>{detail.title}</h3>
      {#if detail.sourceTitle && detail.sourceTitle !== detail.title}<p class="meta">原名：{detail.sourceTitle}</p>{/if}
      <p class="meta">{detail.author || '作者未填写'}{detail.version ? ` · v${detail.version}` : ''}{detail.updatedAt ? ` · ${detail.updatedAt.slice(0, 10)}` : ''}</p>
      {#if detail.error}<p class="warn">{detail.error}</p>{/if}
      {#if detail.warning}<p class="warn">{detail.warning}</p>{/if}
      {#if detail.description}<p class="desc">{detail.description}</p>{/if}
      {#if detail.origin?.creators?.length}
        <!-- 作者页（B站视频、爱发电作品…）在前，下载页（网盘等）在后 -->
        <div class="origins">
          {#each detail.origin.creators as c (c.url)}
            <button class="btn sm ghost" title={c.url} onclick={() => { browser.open(c.url); app.route = 'browser'; }}><Link size={13} />来源：{CREATOR_LABEL[c.source]} · {c.title}{c.author ? `（${c.author}）` : ''}</button>
          {/each}
          {#if detail.origin.pageUrl}<button class="btn sm ghost dl" title={detail.origin.pageUrl} onclick={() => { browser.open(detail!.origin!.pageUrl); app.route = 'browser'; }}>下载页</button>{/if}
        </div>
      {:else if detail.origin?.pageUrl}
        <button class="btn sm ghost" title={detail.origin.pageUrl} onclick={() => { browser.open(detail!.origin!.pageUrl); app.route = 'browser'; }}><Link size={13} />来源：{detail.origin.title}</button>
      {/if}

      <div class="kv">
        {#if isPkg(detail)}
          <span class="muted">用途</span>
          <span>{platformName(detail)} 的创意工坊更新包，不进方案，也不在这里启停</span>
          <span class="muted">管理</span>
          <button class="pick-btn" onclick={() => openPlatform(detail)}><span>在 DLL 模组页查看 {platformName(detail)}</span><ChevronRight size={13} /></button>
        {:else}
          {#if !lib}
            <span class="muted">在本方案</span>
            <Toggle on={prof.modIds.includes(detail.id)} onchange={() => app.toggleMod(detail.id)} label="在方案中启用" disabled={!!app.busy || (!!detail.error && !prof.modIds.includes(detail.id))} />
          {/if}
          <span class="muted">所在方案</span>
          <button class="pick-btn" title="加入或移出方案" onclick={(e) => menuBelow(e.currentTarget, profileItems([detail.id]))}>
            <span>{inProfiles.length ? inProfiles.map((p) => p.name).join('、') : '不在任何方案'}</span><ChevronDown size={13} />
          </button>
          <span class="muted">游戏配置</span>
          <span>{gameState(detail)}{!lib && pending(detail, prof.modIds.includes(detail.id)) ? ' · 待应用' : ''}</span>
        {/if}
        <span class="muted">分类</span>
        <select value={app.folderOf(detail)} onchange={(e) => app.moveToCategory([detail.id], e.currentTarget.value)}>
          <option value={ROOT}>最外层（不分类）</option>
          {#each app.categoryTree() as { c, depth: d } (c.id)}<option value={c.id}>{'　'.repeat(d + 1)}{c.name}</option>{/each}
        </select>
        <span class="muted">文件</span>
        <span class="mono small path">{detail.absolutePath || detail.file}</span>
        <span class="muted">大小</span>
        <span class="mono small">{detail.sizeMB.toFixed(1)} MiB · {detail.fileCount} 个文件</span>
      </div>

      <div class="block">
        <span class="section-label">覆盖目录</span>
        {#each detail.dirs as d (d)}<div class="mono small path">{d}/</div>{/each}
      </div>

      {#if detail.soundCount}
        <div class="block">
          <div class="bh">
            <span class="section-label">声音 · {detail.soundCount}</span>
            {#if player.modId === detail.id}<button class="btn sm ghost" onclick={() => player.stop()}><Square size={10} fill="currentColor" />停止</button>{/if}
          </div>
          <SoundList mod={detail} />
        </div>
      {/if}

      {#if cs.length}
        <div class="block">
          <span class="section-label danger">资源路径重叠</span>
          <p class="muted">以下资源路径同时存在于两个 VPK 中。可在方案中停用其中一个，然后用该方案启动游戏。</p>
          {#each cs as c (c.id)}
            {@const other = app.mod(c.a === detail.id ? c.b : c.a)!}
            <div class="conflict">
              <div class="ch">
                <span>与「{other.title}」</span>
                <span class="mono muted">{c.pathCount ?? c.paths.length} 个文件</span>
              </div>
              {#each c.paths as path (path)}
                {#if /^sound\/.+\.(wav|mp3)$/i.test(path)}
                  <div class="cpath">
                    <span class="mono small path">{path}</span>
                    <button class="cmp" class:on={player.isOn(detail.id, path)} title="试听本项的这个声音" onclick={() => player.play(detail!.id, path)}>本项</button>
                    <button class="cmp" class:on={player.isOn(other.id, path)} title="试听对方的这个声音" onclick={() => player.play(other.id, path)}>对方</button>
                  </div>
                {:else}
                  <div class="mono small path">{path}</div>
                {/if}
              {/each}
              {#if (c.pathCount ?? 0) > c.paths.length}<p class="muted">展示前 {c.paths.length} 个路径</p>{/if}
              <div class="cw">
                <button class="btn sm ghost" disabled={!!app.busy} onclick={() => app.setModsEnabled([other.id], false)}>方案停用对方</button>
                <button class="btn sm ghost" disabled={!!app.busy} onclick={() => app.setModsEnabled([detail!.id], false)}>方案停用本项</button>
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <div class="actions">
        {#if app.isInbox(detail.id)}
          <button class="btn sm ghost" onclick={() => app.markSorted([detail!.id])}><CheckCheck size={13} />标记已整理</button>
        {/if}
        <button class="btn sm ghost" disabled={!!detail.error} title={detail.error ? '解析失败的 Mod 不能解包' : '每个 Mod 解包到桌面上一个同名文件夹'} onclick={() => void app.extractMods([detail!.id])}><PackageOpen size={13} />解包到桌面</button>
        {#if detail.absolutePath}
          {@const path = detail.absolutePath}
          <button class="btn sm ghost" onclick={() => app.reveal(path)}><FolderSearch size={13} />在资源管理器中显示</button>
        {/if}
        <button class="btn sm ghost" onclick={() => copyText(detail.absolutePath || detail.file, '已复制完整路径')}><Copy size={13} />复制完整路径</button>
        {#if detail.workshopId}
          <button class="btn sm ghost" onclick={() => copyText(workshopUrl(detail), '已复制创意工坊链接')}><ExternalLink size={13} />复制工坊链接</button>
        {/if}
        <span class="grow"></span>
        <button class="btn sm ghost del" disabled={!!deleteBlock} title={deleteBlock || '移到 Matcha 回收站（Del）'} onclick={() => void removeMods([detail!.id])}><Trash size={13} />删除…</button>
      </div>
    </aside>
  {/if}
</section>

{#if drag}
  <div class="drag-chip" style:left="{drag.x + 14}px" style:top="{drag.y + 14}px">{dragLabel}</div>
{/if}
{#key menu}
  {#if menu}<Menu items={menu.items} x={menu.x} y={menu.y} onclose={closeMenu} />{/if}
{/key}
{#if workshop}<WorkshopDialog initial={workshop.text} onclose={() => (workshop = null)} />{/if}
{#if collectionDialog}<FavoriteCollectionDialog {...collectionDialog} onclose={() => collectionDialog = null} onsaved={id => { collectionDialog = null; openCollection(id); }} />{/if}
{#if quickTest}<QuickTest seed={quickTest.seed} onclose={()=>quickTest=null}/>{/if}

<style>
  .mods { position: absolute; inset: 0; display: flex; }
  .btn:disabled, .icon-btn:disabled { opacity: .4; cursor: default; pointer-events: none; }
  .grow { flex: 1; }
  input[type='checkbox'] { width: 14px; height: 14px; padding: 0; margin: 0; accent-color: var(--md-primary); cursor: pointer; }
  select { height: 30px; padding: 0 8px; font-size: 13px; }

  /* ---------- 左栏：方案 + 库 + 分类树 ---------- */
  .side { width: 200px; flex: none; border-right: 1px solid var(--line-soft); padding: 16px 10px; overflow-y: auto; display: flex; flex-direction: column; gap: 20px; }
  .gh { display: flex; align-items: center; justify-content: space-between; min-height: 32px; padding: 0 6px 6px; }
  .item { display: flex; align-items: center; gap: 4px; height: 32px; padding: 0 8px; border-radius: var(--r); color: var(--fg-2); cursor: pointer; transition: background var(--dur), color var(--dur), outline-color var(--dur), opacity var(--dur); outline: 1px dashed transparent; outline-offset: -1px; }
  .item:hover { background: var(--hover); color: var(--fg); }
  /* 选中项：M3 导航的「活动指示」——次级容器色 */
  .item.on { background: var(--md-secondary-container); color: var(--md-on-secondary-container); }
  .item.on .n { color: inherit; opacity: .7; }
  .item.target { outline-color: var(--line-strong); }
  .item.sort-before, .row.sort-before { box-shadow: inset 0 3px var(--md-primary); }
  .item.sort-after, .row.sort-after { box-shadow: inset 0 -3px var(--md-primary); }
  .tile.sort-before { box-shadow: inset 3px 0 var(--md-primary); }
  .tile.sort-after { box-shadow: inset -3px 0 var(--md-primary); }
  .item.drop { outline: 1px solid var(--md-primary); background: var(--md-secondary-container); color: var(--md-on-secondary-container); }
  .item.moving { opacity: .45; }
  .item .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .item .n { font-size: 12px; color: var(--fg-3); }
  .item .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--md-primary); flex: none; }
  .item .lic { display: grid; place-items: center; width: 16px; flex: none; color: var(--fg-3); }
  .item .badge-n { display: inline-grid; place-items: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: var(--md-primary); color: var(--md-on-primary); font-size: 11px; }
  .item.on .lic { color: inherit; }
  .item .ops { display: none; flex: none; }
  .item .ops .icon-btn { width: 22px; height: 22px; }
  .item:hover .ops { display: flex; }
  .item:has(.ops):hover .n { display: none; }
  .caret { display: grid; place-items: center; width: 16px; height: 16px; flex: none; border-radius: 3px; color: var(--fg-3); transition: transform var(--dur), color var(--dur); }
  .caret:hover { color: var(--fg); }
  .caret.open { transform: rotate(90deg); }
  .caret.none { visibility: hidden; }
  .inline { width: 100%; height: 32px; }

  /* ---------- 主区：标题 + 工具条 ---------- */
  .main { flex: 1; min-width: 0; display: flex; flex-direction: column; position: relative; container: modmain / inline-size; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 20px 14px; }
  .ttl { min-width: 0; }
  .name { display: flex; align-items: center; gap: 10px; }
  h2 { margin: 0; font-size: 20px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .name .tag { height: 20px; padding: 0 8px; border: 0; border-radius: 10px; background: var(--md-primary-container); color: var(--md-on-primary-container); }
  .acts .btn, .startup-state { height: 32px; padding: 0 14px; border-radius: 12px; }
  .startup-state { display: inline-flex; align-items: center; border: 1px solid transparent; white-space: nowrap; background: var(--md-primary-container); color: var(--md-on-primary-container); }
  .sub { margin: 4px 0 0; font-size: 12px; color: var(--fg-3); }
  .acts { display: flex; align-items: center; gap: 6px; flex: none; }
  /* 库视图（收藏 / 新下载 / 回收站）：标题换成库名，不显示方案 */
  .hic { display: grid; place-items: center; width: 30px; height: 30px; flex: none; border-radius: 10px; color: var(--md-on-secondary-container); background: var(--md-secondary-container); }
  .head .danger-text:hover { color: var(--danger); }
  .toolbar.lib .search { order: -1; flex-basis: 280px; }
  .content.lib { border-top-color: var(--line-soft); }
  .inp, .rinp { display: inline-flex; align-items: center; gap: 4px; min-width: 0; height: 22px; padding: 0 6px; border: 1px solid var(--line-strong); border-radius: var(--r-sm); font-size: 12px; color: var(--fg-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: color var(--dur), border-color var(--dur); }
  .inp.has, .rinp.has { color: var(--fg-2); }
  .inp:hover, .rinp:hover { color: var(--fg); border-color: var(--fg-4); }
  .inp :global(svg), .rinp :global(svg) { flex: none; }
  .rinp { max-width: 100%; border-color: transparent; padding: 0 6px 0 0; }
  .rinp:hover { border-color: transparent; }

  /* 工具条：和主页一样用填充胶囊，不用描边 */
  .toolbar { display: flex; align-items: center; gap: 8px; padding: 0 20px 14px; min-height: 46px; }
  .at-root .toolbar { min-height: 0; padding-bottom: 8px; }
  .toolbar .btn { height: 32px; flex: none; border-radius: 12px; border-color: transparent; background: color-mix(in srgb, var(--md-surface-container-high) 80%, transparent); }
  .toolbar .btn:hover { border-color: transparent; background: var(--md-surface-container-highest); }
  .toolbar .btn.ghost { background: none; }
  .toolbar .btn.ghost:hover { background: var(--hover); }
  .sort { position: relative; display: inline-flex; align-items: center; flex: none; color: var(--fg-3); }
  .sort select { appearance: none; height: 32px; padding: 0 28px 0 12px; border: 1px solid transparent; border-radius: 12px; background: color-mix(in srgb, var(--md-surface-container-high) 80%, transparent); color: var(--fg); font-size: 13px; cursor: pointer; transition: background var(--dur), border-color var(--dur); }
  .sort select:hover { background: var(--md-surface-container-highest); }
  .sort select:focus-visible { border-color: color-mix(in srgb, var(--md-primary) 60%, transparent); }
  .sort :global(svg) { position: absolute; right: 10px; pointer-events: none; }
  .bulk .picked { font-size: 13px; color: var(--fg-2); margin-right: 4px; white-space: nowrap; }
  .bulk .picked b { color: var(--fg); font-weight: 500; }
  .seg { display: inline-flex; flex: none; gap: 2px; padding: 3px; border-radius: 12px; background: color-mix(in srgb, var(--md-surface-container-high) 80%, transparent); }
  .seg button { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; height: 26px; padding: 0 10px; border-radius: 9px; color: var(--fg-2); font-size: 13px; transition: background var(--dur), color var(--dur); }
  .seg button:hover { color: var(--fg); }
  .seg button.on { background: var(--md-secondary-container); color: var(--md-on-secondary-container); }
  .seg .n { font-size: 12px; color: var(--fg-3); }
  .seg button.on .n { color: inherit; opacity: .7; }
  .seg button.danger, .seg button.danger .n { color: var(--danger); }
  .seg.icons button { padding: 0 7px; }
  .search { display: flex; align-items: center; gap: 6px; height: 32px; flex: 0 1 220px; min-width: 110px; padding: 0 8px 0 12px; background: color-mix(in srgb, var(--md-surface-container-high) 80%, transparent); border: 1px solid transparent; border-radius: 12px; color: var(--fg-4); transition: border-color var(--dur), background var(--dur); }
  .search:focus-within { border-color: color-mix(in srgb, var(--md-primary) 60%, transparent); background: color-mix(in srgb, var(--md-surface-bright) 85%, transparent); }
  .search input { border: 0; background: none; padding: 0; flex: 1; min-width: 0; height: 100%; }
  .search .clear { display: grid; place-items: center; color: var(--fg-3); }
  .search .clear:hover { color: var(--fg); }

  .import-row { display: flex; gap: 8px; padding: 0 20px 12px; }
  .pack-progress { display: flex; align-items: center; align-self: flex-start; gap: 6px; max-width: calc(100% - 40px); margin: 0 20px 10px; color: var(--md-primary); font-size: 13px; }
  .pack-progress span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .import-row input { flex: 1; min-width: 0; }
  .notice { margin: 0 20px 10px; font-size: 12px; line-height: 1.6; color: var(--fg-3); overflow-wrap: anywhere; }
  .notice.danger { padding: 8px 12px; border: 1px solid color-mix(in srgb, var(--md-error) 35%, transparent); border-radius: 12px; background: color-mix(in srgb, var(--md-error-container) 60%, transparent); color: var(--md-on-error-container); }

  /* ---------- 路径栏 ---------- */
  /* 路径栏和下面的卡片算一块：只在它上面留一条线 */
  .crumbs { display: flex; align-items: center; gap: 2px; min-height: 44px; padding: 0 14px; border-top: 1px solid var(--line-soft); }
  .crumb { height: 28px; max-width: 220px; padding: 0 8px; border-radius: var(--r); color: var(--fg-2); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; outline: 1px dashed transparent; outline-offset: -1px; transition: background var(--dur), color var(--dur), outline-color var(--dur); }
  button.crumb:hover { background: var(--hover); color: var(--fg); }
  .crumb.cur { color: var(--fg); font-weight: 500; }
  .crumb.fav { display: inline-flex; align-items: center; gap: 6px; line-height: 28px; }
  .crumb.target { outline-color: var(--line-strong); }
  .crumb.drop { outline: 1px solid var(--md-primary); background: var(--md-secondary-container); color: var(--md-on-secondary-container); }
  .sep { display: inline-flex; color: var(--fg-4); }
  .scope { margin-left: 6px; font-size: 12px; color: var(--fg-3); white-space: nowrap; }
  .crumbs .btn { flex: none; }

  .content { flex: 1; min-height: 0; overflow-y: auto; border-top: 1px solid transparent; }
  .empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 72px 20px; color: var(--fg-3); text-align: center; }
  .empty p { margin: 0; font-size: 14px; color: var(--fg-2); }
  .empty span { font-size: 13px; }

  /* ---------- 图标视图 ---------- */
  /* 最窄 176px：实测「283.9 MiB · 待应用 + 开关」要内容宽约 153px，卡片内边距 + 描边 18px，再留几像素余量 */
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(176px, 1fr)); gap: 12px; padding: 16px 20px 28px; }
  .at-root .tiles { padding-top: 10px; }
  /* 卡片是内容岛上的小浮岛：surface-bright 半透明底（亮暗两套都比岛面亮一档）+ 岛描边，悬停微微抬起 */
  .tile {
    display: flex; flex-direction: column; gap: 7px; min-width: 0; padding: 8px 8px 10px;
    border: 1px solid var(--island-line); border-radius: 16px; background: color-mix(in srgb, var(--md-surface-bright) 62%, transparent); outline: none;
    transition: background var(--dur), border-color var(--dur), opacity var(--dur), transform 240ms var(--ease-out), box-shadow 240ms var(--ease-out);
  }
  .tile.open { background: color-mix(in srgb, var(--md-surface-bright) 90%, transparent); border-color: color-mix(in srgb, var(--md-primary) 55%, transparent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--md-primary) 55%, transparent); }
  .tile:focus-visible { box-shadow: 0 0 0 2px var(--md-primary); }
  .tile.moving { opacity: .45; }
  .cover { position: relative; aspect-ratio: 1; border: 1px solid var(--line-soft); border-radius: 11px; overflow: hidden; transition: border-color var(--dur), box-shadow var(--dur); }
  .tile:hover .cover { border-color: var(--line); }
  .cover :global(img) { transition: transform 360ms var(--ease-out); }
  @media (hover: hover) and (pointer: fine) {
    .tile:hover { background: color-mix(in srgb, var(--md-surface-bright) 88%, transparent); transform: translateY(-2px); box-shadow: 0 14px 28px -18px rgb(0 0 0 / .45); }
    .tile:hover .cover :global(img) { transform: scale(1.04); }
  }
  @media (prefers-reduced-motion: reduce) { .cover :global(img) { transition: none; } .tile:hover { transform: none; } }
  .tile.picked .cover { border-color: var(--md-primary); box-shadow: 0 0 0 1px var(--md-primary); }
  .tile.off .cover :global(.thumb) { opacity: .35; filter: grayscale(1); }
  .pick { position: absolute; top: 8px; left: 8px; opacity: 0; transition: opacity var(--dur); }
  .tile:hover .pick, .pick.show { opacity: 1; }
  .star { position: absolute; top: 6px; right: 6px; display: grid; place-items: center; width: 24px; height: 24px; border-radius: 8px; background: color-mix(in srgb, var(--md-surface) 88%, transparent); color: var(--fg-2); opacity: 0; box-shadow: 0 2px 6px -2px rgb(0 0 0 / .3); transition: opacity var(--dur), color var(--dur); }
  .tile:hover .star, .star.on { opacity: 1; }
  .star:hover { color: var(--fg); }
  .star.on { color: var(--md-primary); }
  .play { position: absolute; top: 6px; right: 34px; display: grid; place-items: center; width: 24px; height: 24px; border-radius: 8px; background: color-mix(in srgb, var(--md-surface) 88%, transparent); color: var(--fg-2); opacity: 0; box-shadow: 0 2px 6px -2px rgb(0 0 0 / .3); transition: opacity var(--dur), color var(--dur); }
  .tile:hover .play, .play.on { opacity: 1; }
  .play:hover { color: var(--fg); }
  .play.on { color: var(--md-primary); }
  /* 封面角标：实色小胶囊，错误用 error-container，「新 / 平台更新包」用主色容器 */
  .badge { position: absolute; left: 6px; bottom: 6px; display: inline-flex; align-items: center; height: 20px; padding: 0 7px; border-radius: 7px; background: var(--md-error-container); color: var(--md-on-error-container); font-size: 12px; box-shadow: 0 2px 6px -2px rgb(0 0 0 / .3); }
  .badge.new { background: var(--md-primary-container); color: var(--md-on-primary-container); }
  .where { position: absolute; right: 6px; bottom: 6px; display: inline-flex; align-items: center; gap: 4px; max-width: 60%; height: 20px; padding: 0 7px; border-radius: 7px; background: color-mix(in srgb, var(--md-surface) 88%, transparent); color: var(--fg-2); font-size: 12px; white-space: nowrap; overflow: hidden; box-shadow: 0 2px 6px -2px rgb(0 0 0 / .3); }
  .tile .t { font-size: 13px; line-height: 18px; height: 36px; padding: 0 2px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
  .tile.off .t { color: var(--fg-3); }
  .meta { display: flex; align-items: center; gap: 6px; padding: 0 2px; font-size: 12px; color: var(--fg-3); white-space: nowrap; min-width: 0; }
  /* 大小可以被截短，开关永远留在卡片里 */
  .meta > .mono { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .pend { display: inline-flex; align-items: center; gap: 5px; flex: none; font-size: 12px; color: var(--md-primary); white-space: nowrap; }
  .pend::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: currentColor; flex: none; }

  /* 分类卡片：叠放的卡片边 + 2×2 预览 */
  .stack { position: relative; isolation: isolate; }
  .stack::before, .stack::after { content: ''; position: absolute; height: 10px; border: 1px solid var(--line-strong); border-bottom: 0; border-radius: 5px 5px 0 0; transition: border-color var(--dur); }
  .stack::before { left: 7px; right: 7px; top: -4px; background: var(--bg-2); z-index: 1; }
  .stack::after { left: 15px; right: 15px; top: -7px; background: var(--bg-1); border-color: var(--line); z-index: 0; }
  .tile.folder .cover { z-index: 2; background: var(--bg-1); }
  .tile.folder.drop { background: color-mix(in srgb, var(--md-secondary-container) 70%, transparent); }
  .tile.folder.drop .cover, .tile.folder.drop .stack::before { border-color: var(--md-primary); }
  .mosaic { position: absolute; inset: 0; display: grid; grid-template: 1fr 1fr / 1fr 1fr; gap: 2px; padding: 2px; background: var(--bg); }
  .cell { position: relative; overflow: hidden; border-radius: 2px; }
  .cell.blank { background: var(--bg-1); }
  .cell.off :global(.thumb) { opacity: .35; filter: grayscale(1); }
  .hollow { position: absolute; inset: 0; display: grid; place-items: center; color: var(--fg-4); }
  .fops { position: absolute; top: 6px; right: 6px; display: flex; gap: 4px; opacity: 0; transition: opacity var(--dur); }
  .tile:hover .fops, .fops:focus-within { opacity: 1; }
  .fops .icon-btn { width: 24px; height: 24px; border-radius: 8px; background: color-mix(in srgb, var(--md-surface) 88%, transparent); box-shadow: 0 2px 6px -2px rgb(0 0 0 / .3); }
  .ficon { display: inline-block; margin-right: 5px; vertical-align: -2px; color: var(--fg-3); }
  .rename { width: 100%; height: 28px; margin: 4px 0; padding: 0 6px; font-size: 13px; }

  /* ---------- 列表视图 ---------- */
  .row { display: grid; grid-template-columns: 14px 36px minmax(140px, 1fr) minmax(130px, 180px) 72px 26px 34px; gap: 12px; align-items: center; min-height: 54px; padding: 8px 20px; border-bottom: 1px solid var(--line-soft); transition: background var(--dur), opacity var(--dur); outline: none; }
  .list.flat .row { grid-template-columns: 14px 36px minmax(140px, 1fr) minmax(80px, 140px) minmax(130px, 180px) 72px 26px 34px; }
  .row:not(.head):hover { background: var(--hover); }
  .row.open, .row.picked { background: color-mix(in srgb, var(--md-secondary-container) 65%, transparent); }
  .row:focus-visible { box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--md-primary) 70%, transparent); }
  .row.moving { opacity: .45; }
  .row.head { min-height: 0; padding-top: 8px; padding-bottom: 8px; font-size: 12px; color: var(--fg-3); position: sticky; top: 0; background: var(--bg); z-index: 1; }
  .row.folder.drop { background: var(--bg-2); box-shadow: inset 0 0 0 1px var(--fg-2); }
  .mini { position: relative; width: 36px; height: 36px; border: 1px solid var(--line); border-radius: var(--r-sm); overflow: hidden; }
  .mini.fold { display: grid; place-items: center; background: var(--bg-1); color: var(--fg-2); }
  .row.off .mini :global(.thumb) { opacity: .35; filter: grayscale(1); }
  .nm { display: flex; flex-direction: column; min-width: 0; }
  .nm .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row.off .nm .t { color: var(--fg-3); }
  .nm .f { font-size: 12px; color: var(--fg-4); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row.folder .nm .f { color: var(--fg-3); }
  .nm .rename { margin: 0 0 2px; }
  .cat { font-size: 12px; color: var(--fg-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .st { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font-size: 12px; color: var(--fg-3); }
  .rops { display: none; gap: 4px; }
  .rops .icon-btn { width: 24px; height: 24px; }
  .row.folder:hover .rops { display: flex; }
  .row.folder:hover .txt { display: none; }
  .rstar { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 5px; color: var(--fg-3); opacity: 0; transition: opacity var(--dur), color var(--dur), background var(--dur); }
  .row:hover .rstar, .rstar.on { opacity: 1; }
  .rstar:hover { background: var(--bg-2); color: var(--fg); }
  .rstar.on { color: var(--md-primary); }
  .r { text-align: right; justify-self: end; }
  .sz { font-size: 12px; color: var(--fg-3); }

  /* ---------- 拖入覆盖层：实色，不用半透明 ---------- */
  .dropzone { position: absolute; inset: 0; z-index: 4; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; background: var(--bg); color: var(--fg-2); pointer-events: none; }
  .dropzone::before { content: ''; position: absolute; inset: 14px; border: 1.5px dashed color-mix(in srgb, var(--md-primary) 60%, transparent); border-radius: 16px; }
  .dropzone strong { font-size: 18px; font-weight: 500; color: var(--fg); }
  .dropzone span { font-size: 13px; color: var(--fg-3); }
  .dropzone.bad::before { border-color: var(--md-error); }
  .dropzone.bad strong { color: var(--danger); }

  .drag-chip { position: fixed; z-index: 50; pointer-events: none; padding: 5px 10px; border-radius: var(--r); background: var(--bg-2); border: 1px solid var(--line-strong); color: var(--fg); font-size: 12px; white-space: nowrap; }
  :global(html.dragging-mods), :global(html.dragging-mods *) { cursor: grabbing !important; }

  /* ---------- 详情 ---------- */
  .detail { width: 320px; flex: none; border-left: 1px solid var(--line); padding: 14px 18px 18px; overflow-y: auto; background: var(--bg); }
  .dh { display: flex; align-items: center; gap: 2px; }
  .dh .faved { color: var(--fg); }
  .hero { position: relative; aspect-ratio: 16 / 10; margin-top: 10px; border: 1px solid var(--line); border-radius: var(--r); overflow: hidden; }
  h3 { margin: 14px 0 2px; font-size: 18px; font-weight: 500; overflow-wrap: anywhere; }
  .detail .meta { display: block; padding: 0; margin: 0 0 12px; white-space: normal; }
  .warn { margin: 8px 0; font-size: 12px; color: var(--danger); overflow-wrap: anywhere; }
  .desc { color: var(--fg-2); margin: 0 0 16px; overflow-wrap: anywhere; }
  .origins { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; min-width: 0; }
  .origins .btn { max-width: 100%; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .origins .dl { color: var(--fg-3); }
  .kv { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 10px 12px; align-items: center; padding: 12px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); font-size: 13px; }
  .kv select { height: 28px; font-size: 12px; min-width: 0; }
  .pick-btn { display: flex; align-items: center; gap: 6px; min-width: 0; height: 28px; padding: 0 8px; border: 1px solid var(--line-strong); border-radius: var(--r); background: var(--bg-1); color: var(--fg); font-size: 12px; text-align: left; transition: border-color var(--dur); }
  .pick-btn:hover { border-color: var(--fg-4); }
  .pick-btn span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .small { font-size: 12px; }
  .block { padding: 14px 0 0; display: flex; flex-direction: column; gap: 6px; }
  .path { color: var(--fg-2); word-break: break-all; }
  .conflict { border: 1px solid var(--line-strong); border-radius: var(--r); padding: 10px; display: flex; flex-direction: column; gap: 4px; }
  .ch { display: flex; justify-content: space-between; margin-bottom: 2px; }
  .ch .mono { font-size: 12px; }
  .cw { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; }
  .actions { display: flex; gap: 4px; margin-top: 18px; flex-wrap: wrap; }
  .del:hover { color: var(--danger); }
  .bh { display: flex; align-items: center; justify-content: space-between; min-height: 24px; }
  .cpath { display: flex; align-items: center; gap: 4px; }
  .cpath .path { flex: 1; min-width: 0; }
  .cmp { flex: none; height: 22px; padding: 0 6px; border: 1px solid var(--line-strong); border-radius: var(--r-sm); font-size: 11px; color: var(--fg-2); }
  .cmp:hover, .cmp.on { color: var(--fg); border-color: var(--fg-3); }

  @media (max-width: 1500px) {
    .detail { position: absolute; right: 0; top: 0; bottom: 0; z-index: 5; width: 320px; }
    .side { width: 184px; }
  }
  /* 主区宽度随 pi 面板 / 详情面板变化，按主区自身宽度收紧 */
  @container modmain (max-width: 860px) {
    .head, .toolbar { padding-left: 14px; padding-right: 14px; }
    .row, .list.flat .row { grid-template-columns: 14px 36px minmax(120px, 1fr) minmax(100px, 150px) 64px 26px 34px; gap: 10px; padding-left: 14px; padding-right: 14px; }
    .row .cat { display: none; }
  }
  @container modmain (max-width: 700px) {
    .head, .toolbar { flex-wrap: wrap; }
  }
</style>
