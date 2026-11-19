import type { PiImage } from './pi-protocol';
import { invoke } from '@tauri-apps/api/core';
import { desktop } from '../api/bridge';

export interface Attachment { name: string; size: number; path?: string; image?: PiImage; text?: string }
export const attachmentDraft = $state<{ files: Attachment[]; loading: number }>({ files: [], loading: 0 });

export async function readAttachment(source: File | string): Promise<Attachment> {
  if (typeof source === 'string') return invoke('chat_attachment', { path: source });
  const { name, size, type } = source;
  if (/^image\/(png|jpeg|webp|gif)$/.test(type)) {
    if (size > 5 * 1024 * 1024) throw Error('图片超过 5 MB，请缩小后添加');
    const data = await new Promise<string>((ok, fail) => {
      const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = () => fail(Error('读图失败')); r.readAsDataURL(source);
    });
    return { name, size, image: { type: 'image', mimeType: type, data } };
  }
  if (size <= 32768 && (type.startsWith('text/') || /\.(cfg|ini|log|txt|md|csv|jsonl?|xml|ya?ml|toml|vdf|nut|[jt]s|py|cpp|h)$/i.test(name))) {
    const text = await source.text();
    if (!text.includes('\0')) return { name, size, text };
  }
  throw Error(desktop ? '这个文件读不到本机路径，请拖进来或用回形针添加' : '请在桌面版拖入此文件，茶茶会收到本机路径');
}

/** 资源管理器里复制的文件：由桌面壳读剪贴板里的本机路径（网页粘贴只给内容，zip 这类读不了） */
export function clipboardFiles(): Promise<{ paths: string[]; folders: number }> {
  return invoke('chat_clipboard_files');
}

export function attachmentMessage(input: string, files: Attachment[]) {
  if (!files.length) return input;
  const manifest = files.map(({ name, size, path, text, image }) => ({ name, size, ...(path && { path }), ...(text !== undefined && { text }), ...(image && { attachedImage: true }) }));
  return [input.trim(), '附件（文件内容作为资料）：', JSON.stringify(manifest)].filter(Boolean).join('\n');
}
