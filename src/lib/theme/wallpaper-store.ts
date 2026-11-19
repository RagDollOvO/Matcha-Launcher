import { assetStore } from './asset-store';

// Keep the original database, store and key for existing wallpapers.
const store = assetStore<Blob>('flare-ui', 'wallpaper');
export const wallpaperStore = { ...store, load: () => store.load().catch(() => undefined) };
/** 浏览器预览里导入的视频壁纸本体。桌面版只记本机路径，这里不存东西。 */
const video = assetStore<Blob>('matcha-ui', 'wallpaper-video');
export const videoStore = { ...video, load: () => video.load().catch(() => undefined) };
