// Exercise the private child/desktop Mod channel without model requests.
import { requestMod } from '../mod-bridge.mjs';
import readline from 'node:readline';
const input = readline.createInterface({ input: process.stdin });
input.on('line', async line => {
  const command = JSON.parse(line);
  const send = value => process.stdout.write(JSON.stringify({ type: 'response', id: command.id, command: command.type, ...value }) + '\n');
  try {
    let data = {};
    if (command.type === 'get_state') data = { isStreaming: false };
    if (command.type === 'get_session_stats') data = await requestMod(command.operation, command.params, command.confirmation);
    send({ success: true, data });
  } catch (error) { send({ success: false, error: error.message }); }
});
input.on('close', () => { if (process.connected) process.disconnect(); });
