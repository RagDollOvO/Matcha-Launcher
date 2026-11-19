import { call, connectEvents, errorText, onBridgeEvent } from '../api/bridge';
import type { PiCommand, PiRecord, PiTransport } from './pi-protocol';

export class CliPiTransport implements PiTransport {
  private listeners = new Set<(r: PiRecord) => void>();
  constructor() {
    onBridgeEvent(record => {
      if (record.type === 'pi_event') this.emit(record.event as PiRecord);
      else if (['pi_exit', 'pi_fault', 'bridge_exit', 'bridge_fault', 'context_changed'].includes(record.type)) {
        this.emit({ type: 'connection', status: 'disconnected', message: record.error?.message ?? (record.type === 'context_changed' ? '游戏目录已切换，请重新连接茶茶。' : '茶茶的连接已断开，可重新连接。') });
      }
    });
  }
  private emit(record: PiRecord) { this.listeners.forEach(fn => fn(record)); }
  subscribe(fn: (r: PiRecord) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  send(command: PiCommand) { void this.execute(command); }
  query<T = unknown>(type: string, params: Record<string, unknown> = {}): Promise<T> {
    return call<T>('pi-command', { type, params });
  }
  private async execute(command: PiCommand) {
    try {
      let data: unknown;
      let configDir: string | undefined;
      let loginCommand: string | undefined;
      if (command.type === 'get_state' || command.type === 'reconnect') {
        this.emit({ type: 'connection', status: 'connecting' });
        await connectEvents();
        const info = await call<{ configDir: string; loginCommand: string }>('pi-info');
        data = await call(command.type === 'reconnect' ? 'pi-reconnect' : 'pi-connect');
        configDir = info.configDir;
        loginCommand = info.loginCommand;
      } else if (command.type === 'extension_ui_response') {
        const { id, type: _type, ...answer } = command;
        data = await call('pi-ui-response', { dialogId: id, answer });
      } else if (command.type === 'abort') data = await call('pi-cancel');
      else {
        const { id: _id, type, ...params } = command;
        data = await call('pi-command', { type, params });
      }
      this.emit({ type: 'response', id: command.id, command: command.type === 'reconnect' ? 'get_state' : command.type, success: true, data });
      if (command.type === 'get_state' || command.type === 'reconnect') {
        const messages = await call('pi-command', { type: 'get_messages' });
        this.emit({ type: 'response', command: 'get_messages', success: true, data: messages });
        const models = await call('pi-command', { type: 'get_available_models' });
        this.emit({ type: 'response', command: 'get_available_models', success: true, data: models });
        this.emit({ type: 'connection', status: 'connected', configDir, loginCommand });
      }
    } catch (error) {
      if (command.type === 'get_state' || command.type === 'reconnect') this.emit({ type: 'connection', status: 'disconnected', message: errorText(error) });
      this.emit({ type: 'response', id: command.id, command: command.type, success: false, error: errorText(error) });
    }
  }
}
