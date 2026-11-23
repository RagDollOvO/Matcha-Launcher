import { api, type Snapshot } from '../api';
import { errorText } from '../api/bridge';
import { conflictReviewNotice } from './conflict-reviews';
import type { ActionFeedback } from '../feedback';
import type { Conflict, Mod, Profile } from '../types';

interface ProfileHost extends ActionFeedback {
  readonly game: { root: string };
  readonly mods: readonly Mod[];
  readonly modState: Snapshot['modState'];
  activeConflicts(profile: Profile): Conflict[];
  openModPanel(panel: 'missing', profileId: string): void;
}

export class ModProfilesStore {
  profiles = $state<Profile[]>([]);
  activeProfileId = $state('');
  /** Mod 页正在编辑的方案，可与启动方案不同 */
  editingProfileId = $state('');
  lastModBackup = $state('');
  activeProfile = $derived(this.profiles.find((p) => p.id === this.activeProfileId));
  editingProfile = $derived(this.profiles.find((p) => p.id === this.editingProfileId));

  constructor(private readonly host: ProfileHost, private readonly createId: () => string) {}

  acceptSnapshot(profiles: Profile[], activeProfileId: string) {
    this.profiles = profiles;
    this.activeProfileId = activeProfileId;
    if (!this.profiles.some(p => p.id === this.editingProfileId)) this.editingProfileId = activeProfileId;
  }

  profile(id: string): Profile | undefined { return this.profiles.find((p) => p.id === id); }

  // ---------- 方案 ----------
  async setActiveProfile(id: string, silent = false) {
    try { await api.selectProfile(id); } catch (e) { this.host.toast(errorText(e)); return; }
    this.activeProfileId = id;
    if (!silent) this.host.toast(`启动方案已切换为「${this.profile(id)?.name}」`);
  }
  /** 主页左右切换方案 */
  cycleProfile(step: 1 | -1) {
    const i = this.profiles.findIndex((p) => p.id === this.activeProfileId);
    const next = this.profiles[(i + step + this.profiles.length) % this.profiles.length];
    this.setActiveProfile(next.id, true);
  }
  /** opts.modIds：新方案直接带上这些 Mod；opts.open = false 时不切换正在编辑的方案 */
  createProfile(name: string, fromId?: string, opts: { modIds?: string[]; open?: boolean } = {}) {
    const src = fromId ? this.profile(fromId) : undefined;
    const p: Profile = {
      id: this.createId(), name, note: src ? `复制自「${src.name}」` : '',
      modIds: opts.modIds ? [...opts.modIds] : src ? [...src.modIds] : [], pluginIds: src ? [...src.pluginIds] : [],
      launchOptions: src?.launchOptions ?? '', updatedAt: today(), modsInitialized: true, modsGameRoot: this.host.game.root,
    };
    this.profiles.push(p);
    if (opts.open !== false) this.editingProfileId = p.id;
    void api.saveProfile(p).catch(e => this.host.toast(errorText(e)));
    return this.profiles[this.profiles.length - 1];
  }
  freshProfileName(base = '新方案') {
    for (let i = 1; ; i++) { const n = i === 1 ? base : `${base} ${i}`; if (!this.profiles.some((p) => p.name === n)) return n; }
  }
  renameProfile(id: string, name: string) {
    const p = this.profile(id);
    if (!p || !name.trim()) return;
    p.name = name.trim();
    this.touch(p);
  }
  async deleteProfile(id: string) {
    if (this.profiles.length <= 1) return this.host.toast('至少保留一个方案');
    try { await api.deleteProfile(id); } catch (e) { this.host.toast(errorText(e)); return; }
    const name = this.profile(id)?.name;
    this.profiles = this.profiles.filter((p) => p.id !== id);
    if (this.activeProfileId === id) this.activeProfileId = this.profiles[0].id;
    if (this.editingProfileId === id) this.editingProfileId = this.profiles[0].id;
    this.host.toast(`已删除方案「${name}」`);
  }

  // ---------- Mod ----------
  isEnabled(modId: string, profile = this.editingProfile) { return !!profile?.modIds.includes(modId); }
  async setModsEnabled(ids: string[], enabled: boolean, profile = this.editingProfile, message?: string) {
    if (!profile) return;
    const set = new Set(profile.modIds);
    ids.forEach((id) => (enabled ? set.add(id) : set.delete(id)));
    const next = { ...$state.snapshot(profile), modIds: [...set], modsInitialized: true, modsGameRoot: this.host.game.root, updatedAt: today() };
    await this.host.perform('保存 Mod 方案', () => api.saveProfile(next), message ?? `已保存到「${profile.name}」`);
  }

  toggleMod(id: string) { this.setModsEnabled([id], !this.isEnabled(id)); }
  missingMods(profile = this.editingProfile): string[] {
    const ids = profile && this.host.modState.missingByProfile?.[profile.id];
    return Array.isArray(ids) ? ids : [];
  }
  async removeMissingMods(profile = this.editingProfile) {
    const ids = [...this.missingMods(profile)];
    if (!profile || !ids.length) return;
    const root = this.host.game.root;
    if (!await this.host.confirm('移出缺失 Mod？', `仅从「${profile.name}」移出下面的缺失项，保留其余勾选。`, '移出缺失项', {
      lists: [{ title: '缺失文件', rows: ids.map(id => ({ k: id, v: '未找到' })) }],
    })) return;
    const result = await this.host.perform('检查并移出缺失项', () => api.removeMissingProfileMods(profile.id, root, ids));
    if (result) this.host.toast(result.removed.length ? `已移出 ${result.removed.length} 个缺失项` : '所选条目已恢复或已移出');
  }
  async syncMods(profile = this.editingProfile) {
    if (!profile) return;
    await this.host.perform('同步游戏启用项', async () => {
      if (!await this.host.confirm('从游戏同步 Mod 方案', `用游戏的 Mod 设置覆盖「${profile.name}」的勾选。尚未登记的有效 VPK 默认勾选。`)) return;
      const next = { ...$state.snapshot(profile), modIds: this.host.mods.filter(m => !m.error && m.enabled !== false).map(m => m.id), modsInitialized: true, modsGameRoot: this.host.game.root, updatedAt: today() };
      await api.saveProfile(next); this.host.toast('已从游戏同步');
    });
  }
  async applyMods(profile = this.editingProfile) {
    if (!profile) return;
    if (this.missingMods(profile).length) return this.host.openModPanel('missing', profile.id);
    await this.host.perform('应用 Mod 方案', async () => {
      const overlap = await conflictReviewNotice({ gameRoot: this.host.game.root, profileId: profile.id }, this.host.activeConflicts(profile).length > 0);
      if (!await this.host.confirm('应用 Mod 方案', `「${profile.name}」· ${profile.modIds.length} 个启用项\n${this.host.modState.addonListPath}\n\n备份原配置，写入 Mod 启停状态，并设为启动方案。其余条目保留，下次完整启动生效。${overlap}`)) return;
      const result = await api.applyModProfile(profile.id);
      this.lastModBackup = result.backup ?? '';
      this.host.toast('Mod 方案已应用，下次完整启动生效');
    });
  }

  setLaunchOptions(value: string, profile = this.editingProfile) {
    if (!profile) return;
    profile.launchOptions = value;
    this.touch(profile);
  }

  private touch(p: Profile) {
    p.updatedAt = today();
    void api.saveProfile($state.snapshot(p) as Profile).catch(e => this.host.toast(errorText(e)));
  }
}

function today() { return new Date().toISOString().slice(0, 10); }
