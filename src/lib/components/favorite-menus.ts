import FolderPlus from '@lucide/svelte/icons/folder-plus';
import type { FavoriteCollection } from '../types';
import { app } from '../stores/app.svelte';
import type { MenuItem } from './menu';

export async function setFavoriteMembers(c: FavoriteCollection, ids: string[], add: boolean) {
  if (await app.editFavoriteCollection({action:add ? 'add' : 'remove', collectionId:c.id, modIds:ids}))
    app.toast((add ? '已加入' : '已移出') + '「' + c.name + '」');
}
export function favoriteMenu(ids: string[], create: (ids: string[]) => void, fromLibrary=false): MenuItem[] {
  return [
    ...app.favoriteCollections.map((c): MenuItem => {
      const count = ids.filter(id => c.modIds.includes(id)).length, all = count === ids.length;
      if(fromLibrary)return {label:c.name,hint:all?'更新收藏':'收藏并加入',run:()=>void app.collectMods(ids,c.id)};
      return {label:c.name, checked:all || (count ? 'mixed' : false), hint:all ? '移出' : '加入', run:() => void setFavoriteMembers(c, ids, !all)};
    }),
    ...(app.favoriteCollections.length ? [{kind:'sep' as const}] : []),
    {label:'新建合集…', icon:FolderPlus, run:() => create([...ids])},
  ];
}
