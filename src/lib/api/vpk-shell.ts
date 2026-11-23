import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export const readFileClipboard = () => invoke<string[]>('mod_clipboard_read');
export const writeFileClipboard = (paths: string[]) => invoke<void>('mod_clipboard_write', { paths });

export async function watchShortcutDrops(receive: (paths: string[]) => Promise<void>, onError: (e: unknown) => void) {
  let active = true;
  async function drain() {
    try {
      const paths = await invoke<string[]>('take_vpk_drops');
      if (active && paths.length) await receive(paths);
    } catch (e) { if (active) onError(e); }
  }
  const off = await listen('matcha://vpk-drop', () => void drain());
  void drain(); // Take the initial paths after attaching the live listener.
  return () => { active = false; off(); };
}
