import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PiTransport } from './transport.mjs';

/** JSONL host for a Rust/Tauri parent. Configuration stays outside model input. */
export async function runHost(configPath) {
  if (!configPath || !isAbsolute(configPath)) throw new Error('Usage: node host.mjs <absolute-config.json>');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const transport = new PiTransport(config);
  const output = record => process.stdout.write(`${JSON.stringify(record)}\n`);
  transport.on('event', event => output({ type: 'pi_event', event }));
  transport.on('diagnostic', diagnostic => process.stderr.write(diagnostic.text));
  transport.on('fault', error => output({ type: 'pi_fault', error }));
  transport.on('exit', exit => {
    output({ type: 'pi_exit', ...exit });
    if (!exit.expected) {
      process.exitCode = 1;
      process.stdin.destroy();
    }
  });
  const state = await transport.start();
  output({ type: 'ready', state });
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index).replace(/\r$/, '');
      buffer = buffer.slice(index + 1);
      if (line) void handle(line);
    }
  });
  process.stdin.once('end', () => { void transport.close(); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    process.stdin.destroy();
    void transport.close();
  });

  async function handle(line) {
    let request;
    try {
      request = JSON.parse(line);
      if (!request || typeof request.id !== 'string') throw new Error('Each host command needs a string id');
      let data;
      switch (request.type) {
        case 'command': data = await transport.request(request.command, request.params); break;
        case 'ui_response': data = await transport.answerUi(request.dialogId, request.answer); break;
        case 'cancel': data = await transport.cancel(); break;
        case 'close':
          data = await transport.close();
          process.stdin.destroy();
          break;
        default: throw new Error(`Unknown host command: ${request.type}`);
      }
      output({ type: 'response', id: request.id, success: true, data });
    } catch (error) {
      output({ type: 'response', id: request?.id, success: false,
        error: { code: error.code ?? 'HOST_COMMAND', message: error.message } });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runHost(process.argv[2]).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
