import { convertFileSrc, isTauri } from '@tauri-apps/api/core';
import { resolveResource } from '@tauri-apps/api/path';

const track = 'media/home-relax.mp3';

export async function homeMusicUrl() {
  if (isTauri() && !import.meta.env.DEV) return convertFileSrc(await resolveResource(track));
  return `${import.meta.env.BASE_URL}${track}`;
}
