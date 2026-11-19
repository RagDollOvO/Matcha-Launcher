// Deterministic CLI fixture: no model, game process, network, or Core writes.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

let buffer = '';
const send = value => process.stdout.write(`${JSON.stringify(value)}\n`);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (line) void handle(JSON.parse(line));
  }
});
process.stdin.on('end', () => process.stdout.end());

async function handle(command) {
  const respond = data => send({ id: command.id, type: 'response', command: command.type, success: true, data });
  if (command.type === 'get_state') {
    const dir = process.env.PI_CODING_AGENT_SESSION_DIR;
    await mkdir(dir, { recursive: true });
    const sessionFile = join(dir, 'fixture.jsonl');
    await writeFile(sessionFile, '{"type":"session","id":"fixture"}\n');
    respond({ sessionFile, sessionId: 'fixture', isStreaming: false,
      args: process.argv.slice(2), configDir: process.env.PI_CODING_AGENT_DIR,
      gameRoot: process.env.L4P_GAME_ROOT, cwd: process.cwd() });
  } else if (command.type === 'prompt') {
    respond({ disposition: 'started' });
    if (command.message === 'fixture:exit') {
      process.stderr.write('fixture unexpected exit\n');
      process.exit(7);
    } else if (command.message === 'fixture:confirm') {
      send({ type: 'extension_ui_request', id: 'dialog-1', method: 'confirm', title: 'Fixture approval' });
    } else {
      const record = `${JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '中\u2028文\u2029保持一条 JSONL' } })}\r\n`;
      process.stdout.write(record.slice(0, 20));
      setTimeout(() => {
        process.stdout.write(record.slice(20));
        send({ type: 'agent_settled' });
      }, 10);
    }
  } else if (command.type === 'extension_ui_response') {
    send({ type: 'fixture_answer', answer: command });
    send({ type: 'agent_settled' });
  } else if (command.type === 'clear_queue') respond({ steering: [], followUp: [] });
  else if (command.type === 'abort') respond({});
  else if (command.type === 'get_session_stats') {
    setTimeout(() => respond({ fixture: true }), 20);
  } else if (command.type === 'get_messages') respond({ messages: [] });
  else if (command.type === 'compact') setTimeout(() => respond({ summary: 'fixture summary' }), command.fixtureDelayMs ?? 80);
  else respond({});
}
