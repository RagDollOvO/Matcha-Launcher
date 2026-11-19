// Compile just the changed store; bridge requests are controlled in memory.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { compileModule } from 'svelte/compiler';
import { defaultGameSettings } from '../backend/game-settings.mjs';
import { launchSpec } from '../backend/launch.mjs';

const source = (await fs.readFile('src/lib/stores/game-settings.svelte.ts', 'utf8'))
  .replaceAll('../../../backend/launch-argv.mjs', '../../backend/launch-argv.mjs')
  .replace("import { call, errorText } from '../api/bridge';", 'const { call, errorText } = globalThis.__gameSettingsBridge;');
const toJs = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const file = path.resolve('checks/.artifacts/game-settings-store-compiled.mjs');
await fs.mkdir(path.dirname(file), { recursive: true });
await fs.writeFile(file, compileModule(toJs(source), { filename: 'game-settings.svelte.js', generate: 'client' }).js.code);
const snippetsFile = path.join(path.dirname(file), 'cfg-snippets-compiled.mjs');
await fs.writeFile(snippetsFile, toJs(await fs.readFile('src/lib/settings/cfg-snippets.ts', 'utf8')));
const { insertSnippet, applySnippet, snippetRows, snippetGroups } = await import(pathToFileURL(snippetsFile));
const reply = v => ({ ...v, effective: { direct: launchSpec('direct', undefined, v).launchOptions, development: launchSpec('development', undefined, v).launchOptions } });
const calls = []; let releaseFirst, started, rejectSave = false;
const firstStarted = new Promise(resolve => { started = resolve; });
globalThis.__gameSettingsBridge = { errorText: e => e.message, call: async (command, params) => {
  if (command === 'game-settings-get') return reply(defaultGameSettings());
  calls.push(params.fpsMax);
  if (rejectSave) throw new Error('fixture settings save failed');
  if (calls.length === 1) { started(); await new Promise(resolve => { releaseFirst = resolve; }); }
  return reply(params);
} };
const { gameSettings: g } = await import(pathToFileURL(file));
await g.flush(); // A launch from another page loads saved settings before confirmation.
g.value.fpsMax = 100; g.change(); const first = g.flush();
await firstStarted;
g.value.fpsMax = 200; g.change();
assert(g.args('direct').includes('200')); // live draft preview, before server acknowledgement
const second = g.flush();
assert.deepEqual(calls, [100]);
releaseFirst(); await Promise.all([first, second]);
assert.deepEqual(calls, [100, 200]); assert(g.effective.direct.includes('200'));
rejectSave = true; g.value.fpsMax = 300; g.change();
await assert.rejects(g.flush(), /settings save failed/);
assert.equal(g.status, 'error'); assert.equal(g.value.fpsMax, 300);
rejectSave = false; await g.load(); // Retry preserves and saves the failed draft.
assert.equal(g.status, 'ready'); assert(g.effective.direct.includes('300'));
const raw = '// 原来的草稿\n\nbind "x" "echo keep; net_graph 0"\necho text; NET_GRAPHPOS 2 // net_graphshowinterp 1';
g.value.autoexec = { enabled: false, values: { volume: '0.35', cc_subtitles: '0', user_variable: 'kept' }, extra: raw };
g.resetLaunch();
assert.equal(g.value.fpsMax, null);
const before = g.cfgText();
assert.equal(before, 'volume "0.35"\ncc_subtitles "0"\nuser_variable "kept"\n' + raw);
const graph = snippetGroups.flatMap(group => group.items).find(s => s.label === '帧率与网络信息');
const result = insertSnippet(before, graph);
assert.equal(result.added, 4); assert.equal(result.kept, 1); assert(result.text.startsWith(before));
g.setCfgText(result.text);
assert.equal(g.value.autoexec.values.volume, '0.35'); assert.equal(g.value.autoexec.enabled, false);
assert.equal(insertSnippet(g.cfgText(), graph).text, result.text);
g.setCfgText(g.cfgText().replace('volume "0.35"', 'volume "0.6"'));
assert.deepEqual(g.value.autoexec.values, {}); assert(g.cfgText().includes(raw));
g.value.extraArgs = '-w 1280 -LV -condebug'; g.toggleFlag('lowViolence');
assert.equal(g.flagOn('lowViolence'), false); assert.equal(g.value.extraArgs, '-w 1280 -condebug');
g.toggleFlag('lowViolence'); assert(g.args('modded').includes('-lv'));
await g.flush();
// Direct edits: change the last assignment in place, keep comments/binds/EOLs, add the rest of the group once.
const glow = snippetGroups.find(x => x.label === '画面').items[0];
const own = '// mine\r\nbind x "cl_glow_survivor_r 9"\r\ncl_glow_survivor_r 0.2 // keep\r\n"cl_glow_survivor_g" "0.5"; echo hi\r\n';
const edited = applySnippet(own, glow, { cl_glow_survivor_r: '1', cl_glow_survivor_g: '0.25' });
assert.equal(edited, '// mine\r\nbind x "cl_glow_survivor_r 9"\r\ncl_glow_survivor_r 1 // keep\r\n"cl_glow_survivor_g" "0.25"; echo hi\r\n\r\n// 队友轮廓\r\ncl_glow_survivor_b 0');
assert.deepEqual(snippetRows(edited, glow).map(r => [r.value, r.present]), [['1', true], ['0.25', true], ['0', true]]);
assert.equal(applySnippet(edited, glow, { cl_glow_survivor_b: '0.5' }), edited.replace('cl_glow_survivor_b 0', 'cl_glow_survivor_b 0.5'));
assert.equal(applySnippet('', glow, {}), '// 队友轮廓\ncl_glow_survivor_r 0\ncl_glow_survivor_g 1\ncl_glow_survivor_b 0');
console.log('Game settings store: serialized saves, retry, legacy CFG editing, additive snippets, direct edits and flag toggles passed.');
