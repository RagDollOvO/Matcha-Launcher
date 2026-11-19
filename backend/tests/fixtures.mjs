import fs from 'node:fs/promises';
import path from 'node:path';

// Deliberately non-executable PE fixtures: only metadata parsing is exercised.
export function peFixture(names = [], { architecture = 'x86', dll = true } = {}) {
  const b = Buffer.alloc(4096); b.writeUInt16LE(0x5a4d, 0); b.writeUInt32LE(0x80, 0x3c);
  const pe = 0x80, optional = pe + 24;
  b.writeUInt32LE(0x4550, pe); b.writeUInt16LE(architecture === 'x86' ? 0x14c : 0x8664, pe + 4);
  b.writeUInt16LE(1, pe + 6); b.writeUInt16LE(0xe0, pe + 20); b.writeUInt16LE(dll ? 0x2000 : 0x0002, pe + 22);
  b.writeUInt16LE(0x10b, optional); b.writeUInt32LE(0x200, optional + 60); b.writeUInt32LE(16, optional + 92);
  b.writeUInt32LE(0x1000, optional + 96); b.writeUInt32LE(0x800, optional + 100);
  const section = optional + 0xe0; b.write('.edata', section, 'ascii');
  b.writeUInt32LE(0x800, section + 8); b.writeUInt32LE(0x1000, section + 12); b.writeUInt32LE(0x800, section + 16); b.writeUInt32LE(0x200, section + 20);
  b.writeUInt32LE(names.length, 0x200 + 24); b.writeUInt32LE(0x1040, 0x200 + 32);
  let stringOffset = 0x400;
  names.forEach((name, index) => {
    b.writeUInt32LE(stringOffset - 0x200 + 0x1000, 0x240 + index * 4);
    b.write(`${name}\0`, stringOffset, 'ascii'); stringOffset += name.length + 1;
  });
  return b;
}
export const manifest = (id = 'demo.hello', dependencies = []) => ({
  schemaVersion: 1, id, name: id, version: '0.1.0', apiVersion: 1,
  architecture: 'x86', phase: 'render-init', entry: 'plugin.dll', dependencies,
  config: [{ id: 'greeting', label: 'Greeting', type: 'string', default: 'hello', maxLength: 80, apply: 'next-launch' }],
  actions: [{ id: 'hello', label: 'Hello', description: 'Offline read example', effect: 'read', requiresConfirmation: false, parameters: { name: { type: 'string', required: false, default: 'survivor', maxLength: 80 } } },
    { id: 'change', label: 'Change', description: 'Offline write example', effect: 'write', requiresConfirmation: true, parameters: { amount: { type: 'integer', required: true, minimum: 1, maximum: 3 } } }],
});
export async function pluginFixture(root, id = 'demo.hello', dependencies = []) {
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest(id, dependencies), null, 2));
  await fs.writeFile(path.join(root, 'plugin.dll'), peFixture(['L4P_GetPluginApi']));
  return root;
}
export async function createFixture(base,{l4n=false}={}) {
  const gameRoot = path.join(base, 'game'), distRoot = path.join(base, 'dist');
  const bin = path.join(gameRoot, 'bin'); await fs.mkdir(bin, { recursive: true }); await fs.mkdir(path.join(gameRoot, 'left4dead2'));
  await fs.writeFile(path.join(gameRoot, 'left4dead2.exe'), peFixture([], { dll: false }));
  if(l4n){await fs.appendFile(path.join(gameRoot,'left4dead2.exe'),'left4neko.dll');await fs.writeFile(path.join(bin,'left4neko.dll'),peFixture());}
  const original = peFixture(['Direct3DCreate9', 'Direct3DCreate9Ex']);
  await fs.writeFile(path.join(bin, 'dxvk_d3d9.dll'), original);
  const runtime = path.join(distRoot, 'bin', 'l4p'); await fs.mkdir(runtime, { recursive: true });
  await fs.writeFile(path.join(distRoot, 'bin', 'dxvk_d3d9.dll'), peFixture(['Direct3DCreate9', 'Direct3DCreate9Ex', 'L4P_PlatformShimVersion']));
  await fs.writeFile(path.join(runtime, 'l4p_runtime.dll'), peFixture(['L4P_RuntimeInitialize', 'L4P_RuntimeFactoryReady']));
  await pluginFixture(path.join(runtime, 'plugins', 'demo.hello'));
  await fs.writeFile(path.join(runtime, 'enabled.txt'), 'demo.hello\n');
  const bridge='bin/neko/plugins/MatchaRuntime.dll';await fs.mkdir(path.dirname(path.join(distRoot,bridge)),{recursive:true});await fs.writeFile(path.join(distRoot,bridge),peFixture(['GetL4NPluginInstance']));
  return { bridge:path.join(gameRoot,bridge), gameRoot, distRoot, original, bin, runtime: path.join(bin, 'l4p') };
}
