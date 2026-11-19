import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { beaconBridge } from './backend/desktop/vite-plugin.mjs';
import { copyFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// Tauri 2 期望固定端口且不清屏，后续接壳时无需改动
export default defineConfig(({ mode }) => ({
  plugins: [svelte(), beaconBridge(), {
    name: 'home-music-for-web-preview',
    apply: 'build',
    // The desktop package streams this same file from its resource directory.
    async writeBundle({ dir }) {
      if (mode === 'desktop' || !dir) return;
      await mkdir(resolve(dir, 'media'), { recursive: true });
      await copyFile(resolve('media/home-relax.mp3'), resolve(dir, 'media/home-relax.mp3'));
    },
  }],
  // 设置页「关于」的版本号兜底（后端 app-info 没接上、又不在桌面壳里时）
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  build: { target: 'es2022' },
}));
