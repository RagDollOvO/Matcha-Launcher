import { call } from './bridge';
import type { Server, LaunchMode, ServerLayout } from '../types';

export interface FriendServer extends Server { friends:string[]; avatars?: (string | null)[] }

export const serverApi = {
  friends: () => call<FriendServer[]>('friend-servers'),
  friendInfo: (id:string) => call<FriendServer>('friend-server-info', {id}),
  favoriteFriend: (id:string) => call<Server[]>('favorite-friend-server', {id}),
  list: () => call<Server[]>('list-servers'),
  state: () => call<{ servers: Server[]; serverLayout: ServerLayout }>('server-state'),
  add: (address: string, label: string, gamePort?: string) => call<Server[]>('add-server', { address, label, gamePort }),
  remove: (id: string) => call<Server[]>('remove-server', { id }),
  favorite: (id: string, favorite: boolean) => call<Server[]>('favorite-server', { id, favorite }),
  query: (ids: string[]) => call<Server[]>('query-servers', { ids }),
  /** 改备注 / 连接端口，保留 id、收藏、合集位置与探测缓存 → 完整列表 */
  update: (id: string, label: string, gamePort: number | null) => call<Server[]>('update-server', { id, label, gamePort }),
  /** 整份覆盖保存合集布局；snapshot.serverLayout 原样返回 */
  saveLayout: (layout: ServerLayout, expected?: ServerLayout) => call<{ status: 'saved' }>('save-server-layout', { layout, ...(expected ? { expected } : {}) }),
  /** 有受管外部平台时必须带 platformPlanId，返回 { taskId } */
  connect: (id: string, profileId: string, mode: LaunchMode, platformPlanId?: string) =>
    call<{ status: 'requested'; pid?: number } | { taskId: string }>('connect-server', { id, profileId, mode, platformPlanId }, true),
};
