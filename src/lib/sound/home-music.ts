import { convertFileSrc, isTauri } from '@tauri-apps/api/core';
import { resolveResource } from '@tauri-apps/api/path';
import { assetStore } from '../theme/asset-store';

const track = 'media/home-relax.mp3';
export const localMusic = assetStore<File>('matcha-home-music', 'track');

/** Probe the selected file before replacing the user's previous track. Never play the probe. */
export async function checkMusicFile(file: File) {
  if (!file.size || file.size > 64 * 1024 ** 2) throw new Error('请选择 64 MB 以内的非空音频文件。');
  const audio = new Audio(), url = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => {
      const fail = () => reject(new Error('这段音频无法播放，请换一个 MP3、M4A、WAV、OGG 或 FLAC 文件。'));
      const timer = setTimeout(fail, 10000);
      audio.onloadedmetadata = () => { clearTimeout(timer); resolve(); };
      audio.onerror = () => { clearTimeout(timer); fail(); };
      audio.preload = 'metadata';
      audio.src = url;
    });
  } finally {
    audio.onloadedmetadata = null; audio.onerror = null;
    audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url);
  }
}

export async function homeMusicUrl() {
  if (isTauri() && !import.meta.env.DEV) return convertFileSrc(await resolveResource(track));
  return `${import.meta.env.BASE_URL}${track}`;
}
