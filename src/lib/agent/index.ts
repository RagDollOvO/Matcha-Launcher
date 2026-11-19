import { Chat } from './chat.svelte';
import { CliPiTransport } from './cli-pi';
import { MockPiTransport, mockHostCall } from './mock-pi';
import { setHostCall } from './host';

/** 开发预览：地址带 ?mockpi 时用假 pi，不连真实模型、不改任何文件 */
const mock = import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).has('mockpi');
if (mock) setHostCall(mockHostCall);
export const agent = new Chat(mock ? new MockPiTransport() : new CliPiTransport());
