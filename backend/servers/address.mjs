import { isIP } from 'node:net';

export function serverError(code, message) {
  return Object.assign(new Error(message), { code });
}

export function parsePort(value) {
  if (!/^\d{1,5}$/.test(String(value)) || Number(value) < 1 || Number(value) > 65535)
    throw serverError('server_address_invalid', '端口范围为 1–65535。');
  return Number(value);
}

/** One endpoint only. Never pass console text or URL credentials to Steam. */
export function parseServerAddress(input) {
  if (typeof input !== 'string' || input.length > 300)
    throw serverError('server_address_invalid', '请输入服务器 IPv4 或域名，可附带端口。');
  const value = input.trim().replace(/^connect\s+/i, '').replace(/^steam:\/\/connect\//i, '').replace(/\/$/, '');
  const match = /^([a-zA-Z0-9.-]+)(?::(\d{1,5}))?$/.exec(value);
  if (!match) throw serverError('server_address_invalid', '请输入 IPv4 或域名:端口，例如 connect example.com:27015。');
  const host = match[1].toLowerCase().replace(/\.$/, '');
  const validHost = host.length <= 253 && host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  if (!validHost || (/^[\d.]+$/.test(host) && isIP(host) !== 4))
    throw serverError('server_address_invalid', '服务器 IPv4 或域名格式有误。');
  const port = parsePort(match[2] ?? 27015);
  return { host, port, addr: `${host}:${port}` };
}
