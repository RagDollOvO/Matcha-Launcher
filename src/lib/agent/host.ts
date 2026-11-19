// 助手相关、但不属于 pi RPC 的桥接命令：会话列表、服务商密钥、pi 设置文件、工具清单。
// 契约见 docs/agent-backend.md；missing 兼容较旧的后端。
import { call, errorText } from '../api/bridge';
import { isMissing, type ThinkingLevel } from './pi-protocol';

export interface PiSessionInfo {
  path: string; id: string; name?: string; firstMessage?: string;
  messageCount: number; createdAt: string; updatedAt: string; current?: boolean;
}
export interface PiProvider {
  id: string; name: string; configured: boolean;
  /** 凭据来源：auth.json 里的密钥 / 环境变量 / 订阅登录 */
  source?: 'auth' | 'env' | 'oauth';
  /** 支持的登录方式；oauth 只能在终端里 /login */
  kind: 'api_key' | 'oauth' | 'both';
  /** 末 4 位之类的提示，绝不回传完整密钥 */
  keyHint?: string;
}
export type PiConfirmMode = 'auto' | 'ask' | 'full';
export interface PiToolInfo { name: string; label: string; description: string; write: boolean; enabled: boolean }
export interface PiAgentSettings {
  defaultProvider?: string; defaultModel?: string; defaultThinkingLevel?: ThinkingLevel;
  autoCompaction?: boolean; autoRetry?: boolean; enabledModels?: string[];
}
/** Pi 原生 models.json；apiKey 写入 auth.json，GET 中隐藏的 header 原值由后端保留。 */
export interface PiModelsConfig {
  providers: Record<string, { baseUrl?: string; api?: string; apiKey?: string; models?: { id: string; [key: string]: unknown }[]; [key: string]: unknown }>;
  [key: string]: unknown;
}

export type Result<T> = { ok: true; value: T } | { ok: false; missing: boolean; code: string; error: string };

type HostCall = <T>(command: string, params?: Record<string, unknown>) => Promise<T>;
let hostCall: HostCall = (command, params = {}) => call(command, params);
/** 开发预览用假后端时替换 */
export function setHostCall(fn: HostCall) { hostCall = fn; }

async function attempt<T>(command: string, params: Record<string, unknown> = {}): Promise<Result<T>> {
  try { return { ok: true, value: await hostCall<T>(command, params) }; }
  catch (e) { return { ok: false, missing: isMissing(e), code: (e as { code?: string })?.code ?? '', error: errorText(e) }; }
}

export const piHost = {
  sessions: () => attempt<{ sessions: PiSessionInfo[] }>('pi-sessions'),
  deleteSession: (path: string) => attempt<{ status: string }>('pi-session-delete', { path }),
  providers: () => attempt<{ providers: PiProvider[] }>('pi-auth-status'),
  setKey: (provider: string, apiKey: string) => attempt<{ status: string }>('pi-auth-set', { provider, apiKey }),
  removeKey: (provider: string) => attempt<{ status: string }>('pi-auth-remove', { provider }),
  models: () => attempt<PiModelsConfig>('pi-models-get'),
  saveModels: (config: PiModelsConfig) => attempt<PiModelsConfig>('pi-models-set', config),
  settings: () => attempt<PiAgentSettings>('pi-settings-get'),
  saveSettings: (patch: PiAgentSettings) => attempt<PiAgentSettings>('pi-settings-set', { ...patch }),
  tools: () => attempt<{ tools: PiToolInfo[] }>('pi-tools'),
  permissions: () => attempt<{ mode: PiConfirmMode }>('pi-permissions-get'),
  savePermissions: (mode: PiConfirmMode) => attempt<{ mode: PiConfirmMode }>('pi-permissions-set', { mode }),
};
