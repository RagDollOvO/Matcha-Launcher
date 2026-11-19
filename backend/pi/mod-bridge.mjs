import { randomUUID } from 'node:crypto';

/** Private Node IPC channel to the same desktop service that owns the Mod page. */
export function requestMod(operation, params = {}, confirmation, signal) {
  if (process.env.FLARE_MOD_HOST !== '1' || !process.send) return Promise.reject(new Error('请在 Matcha 内置助手中使用 Mod 管理工具。'));
  if (signal?.aborted) return Promise.reject(new Error('操作已取消。'));
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const send = value => { if (process.connected) process.send(value, () => {}); };
    const finish = (error, value) => {
      process.off('message', receive); process.off('disconnect', disconnect);
      signal?.removeEventListener('abort', abort); clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const receive = message => {
      if (message?.type !== 'flare_mod_reply' || message.id !== id) return;
      finish(message.ok ? null : Object.assign(new Error(message.error?.message ?? 'Mod 操作失败。'), {
        code: message.error?.code, ...(message.error?.details !== undefined ? { details: message.error.details } : {}),
      }), message.result);
    };
    const disconnect = () => finish(new Error('Matcha Mod 服务已关闭。'));
    const abort = () => { send({ type: 'flare_mod_cancel', id }); finish(new Error('操作已取消。')); };
    const timer = setTimeout(() => { send({ type: 'flare_mod_cancel', id }); finish(new Error('等待 Mod 管理服务超时，请刷新后检查结果。')); }, operation === 'compare' ? 300000 : 120000);
    process.on('message', receive); process.once('disconnect', disconnect); signal?.addEventListener('abort', abort, { once: true });
    if (!process.connected) return disconnect();
    process.send({ type: 'flare_mod_request', id, operation, params, confirmation }, error => { if (error) finish(error); });
  });
}
