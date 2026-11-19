/** Pi CLI RPC records consumed by Matcha. Tool results and final messages keep their native shape. */
export interface PiImage { type: 'image'; data: string; mimeType: string }
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type PiCommand =
  | { id?: string; type: 'prompt'; message: string; images?: PiImage[]; streamingBehavior?: 'steer' | 'followUp' }
  | { id?: string; type: 'steer' | 'follow_up'; message: string; images?: PiImage[] }
  | { id?: string; type: 'abort' | 'new_session' | 'get_state' | 'get_messages' | 'get_available_models' | 'reconnect' | 'clear_queue' | 'get_session_stats' }
  | { id?: string; type: 'set_model'; provider: string; modelId: string }
  | { id?: string; type: 'set_thinking_level'; level: ThinkingLevel }
  | { id?: string; type: 'set_session_name'; name: string }
  | { id?: string; type: 'switch_session'; sessionPath: string }
  | { id?: string; type: 'compact'; customInstructions?: string }
  | { type: 'extension_ui_response'; id: string; confirmed?: boolean; value?: string; cancelled?: boolean };

/** pi 的完整 Model 对象（get_available_models / set_model / get_state.model） */
export interface PiModel {
  id: string; name?: string; provider: string; api?: string; baseUrl?: string;
  reasoning?: boolean; input?: string[]; contextWindow?: number; maxTokens?: number;
  cost?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
}
export interface PiUsage { input: number; output: number; cacheRead?: number; cacheWrite?: number; totalTokens?: number; cost?: { total: number } }
export interface PiSessionStats {
  sessionFile?: string; sessionId?: string; userMessages?: number; assistantMessages?: number; toolCalls?: number;
  tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  cost?: number; contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
}
export interface PiState {
  model?: PiModel | string; thinkingLevel?: ThinkingLevel; isStreaming?: boolean; isCompacting?: boolean;
  sessionFile?: string; sessionId?: string; sessionName?: string; autoCompactionEnabled?: boolean;
  messageCount?: number; pendingMessageCount?: number; steeringMode?: string; followUpMode?: string;
}
export interface PiToolResult { content: { type: string; text?: string }[]; details?: Record<string, unknown> }
export interface PiContent { type: string; text?: string; thinking?: string; id?: string; name?: string; arguments?: Record<string, unknown>; data?: string; mimeType?: string }
export interface PiMessage {
  role: string; content: string | PiContent[]; toolCallId?: string; toolName?: string; isError?: boolean;
  stopReason?: string; errorMessage?: string; usage?: PiUsage; model?: string; provider?: string; timestamp?: number;
}
export interface PiAssistantEvent {
  type: string; contentIndex: number; delta?: string; id?: string; toolName?: string;
  partial?: PiMessage; toolCall?: { id: string; name: string; arguments: Record<string, unknown> };
}
export type PiRecord =
  | { type: 'response'; id?: string; command: string; success: boolean; data?: any; error?: string }
  | { type: 'agent_start' | 'turn_start' | 'turn_end' }
  | { type: 'message_start' | 'message_end'; message: PiMessage }
  | { type: 'message_update'; assistantMessageEvent: PiAssistantEvent; usage?: PiUsage }
  | { type: 'tool_execution_start'; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { type: 'tool_execution_update'; toolCallId: string; toolName: string; partialResult: PiToolResult }
  | { type: 'tool_execution_end'; toolCallId: string; toolName: string; result: PiToolResult; isError: boolean }
  | { type: 'agent_end'; willRetry?: boolean }
  | { type: 'agent_settled'; aborted?: boolean }
  | { type: 'queue_update'; steering: string[]; followUp: string[] }
  | { type: 'thinking_level_changed'; level: ThinkingLevel }
  | { type: 'session_info_changed'; name?: string }
  | { type: 'compaction_start'; reason: 'manual' | 'threshold' | 'overflow' }
  | { type: 'compaction_end'; reason: string; result?: { tokensBefore: number; estimatedTokensAfter: number }; aborted?: boolean; willRetry?: boolean; errorMessage?: string }
  | { type: 'auto_retry_start'; attempt: number; maxAttempts: number; delayMs: number; errorMessage?: string }
  | { type: 'auto_retry_end'; success: boolean; attempt: number; finalError?: string }
  | { type: 'extension_ui_request'; id: string; method: string; title?: string; message?: string; timeout?: number; options?: string[]; placeholder?: string; prefill?: string; notifyType?: 'info' | 'warning' | 'error' }
  | { type: 'connection'; status: 'connecting' | 'connected' | 'disconnected'; message?: string; configDir?: string; loginCommand?: string };

export interface PiTransport {
  send(cmd: PiCommand): void;
  subscribe(listener: (r: PiRecord) => void): () => void;
  /** 直接取结果的查询（设置页、用量等），失败时抛出带 code 的错误 */
  query<T = unknown>(type: string, params?: Record<string, unknown>): Promise<T>;
}

/** 后端还没放行 / 还没实现的命令：界面显示「待接入」而不是报错 */
export const isMissing = (e: unknown) => {
  const code = (e as { code?: string })?.code ?? '';
  return code === 'COMMAND_SCOPE' || code === 'unknown_command' || /Unsupported platform Pi command|未知的 Pi 命令/.test(String((e as Error)?.message ?? e));
};
