// 主页玩家卡片用的 Steam 账号资料。只在主页打开时读一次，头像是 data URL，不放进 5 秒轮询的快照里。
import { api } from '../api';
import { isMissing } from '../agent/pi-protocol';
import type { SteamProfile } from '../types';

export const steam = $state<{
  profile: SteamProfile | null;
  /** missing：后端还没有 steam-profile 命令；none：本机找不到 Steam 账号 */
  status: 'idle' | 'loading' | 'ready' | 'none' | 'missing' | 'error';
}>({ profile: null, status: 'idle' });

let pending: Promise<void> | null = null;

export function loadSteamProfile(force = false): Promise<void> {
  if (pending) return pending;
  if (!force && (steam.status === 'ready' || steam.status === 'none' || steam.status === 'missing')) return Promise.resolve();
  steam.status = 'loading';
  pending = api.steamProfile()
    .then((r) => {
      steam.profile = r.profile;
      steam.status = r.profile ? 'ready' : 'none';
    })
    .catch((e) => {
      // 桌面服务对没实现的命令返回 unsupported_capability（「此能力待接入」）
      const code = (e as { code?: string })?.code;
      steam.status = isMissing(e) || code === 'unsupported_capability' ? 'missing' : 'error';
    })
    .finally(() => { pending = null; });
  return pending;
}
