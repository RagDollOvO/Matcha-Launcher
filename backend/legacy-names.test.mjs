import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { migrateLegacyNames, rewritePath, folderName, gameFolder, isFolder, claimDataDir, currentDataDir, MARKER, DEV_DATA, APP_DATA } from './legacy-names.mjs';
import { prepareDataDir } from './desktop/service.mjs';

const exists = p => fs.access(p).then(() => true, () => false);
async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'matcha-legacy-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const game = path.join(base, 'Left 4 Dead 2'), content = path.join(game, 'left4dead2');
  const oldData = path.join(base, 'local', APP_DATA.legacy), data = path.join(base, 'local', APP_DATA.name);
  for (const dir of ['.flare-library/workshop/101', '.flare-trash/abc', '.flare-backups', '.flare-data/cache', 'addons']) await fs.mkdir(path.join(content, dir), { recursive: true });
  for (const dir of ['.flare-tests/7a18bf1a-278f-4bda-b5b6-6c1e60c934bf', '.flare-l4n-plugins/disabled']) await fs.mkdir(path.join(game, dir), { recursive: true });
  await fs.writeFile(path.join(content, '.flare-library/workshop/101/mod.vpk'), 'vpk');
  await fs.mkdir(path.join(content, 'cfg')); await fs.writeFile(path.join(content, 'cfg/autoexec.cfg.flare.bak'), 'pristine');
  await fs.mkdir(path.join(data, 'pi/sessions'), { recursive: true }); await fs.mkdir(path.join(data, 'browser'));
  await fs.writeFile(path.join(data, MARKER), JSON.stringify({ from: oldData, to: data }));
  return { base, game, content, oldData, data };
}

test('legacy names: rename game folders and rewrite stored paths once', async t => {
  const f = await fixture(t), oldStore = path.join(f.content, '.flare-data');
  await fs.writeFile(path.join(f.data, 'storage.json'), JSON.stringify({ root: oldStore, custom: false, pending: [f.oldData], profileRoot: oldStore, note: '.flare-data 不是路径开头不改' }, null, 2));
  await fs.writeFile(path.join(f.data, 'settings.json'), JSON.stringify({ version: 1, gameRoot: f.game, profiles: [{ id: 'default' }] }));
  await fs.writeFile(path.join(f.data, 'quick-test.json'), JSON.stringify({ last: { directory: path.join(f.game, '.flare-tests', 'x').replaceAll('\\', '/') } }));
  await fs.writeFile(path.join(f.data, 'ledger.json'), JSON.stringify({ entries: [{ path: '.flare-l4n-plugins/disabled/a.dll' }, { path: '.flare-l4n-pluginsX/a.dll' }] }));
  await fs.writeFile(path.join(f.data, 'broken.json'), '{ not json');
  const session = path.join(f.data, 'pi/sessions/s.jsonl');
  await fs.writeFile(session, JSON.stringify({ type: 'session', cwd: path.join(f.oldData, 'pi', 'workspace') }) + '\n{"type":"message","text":"在 com.flare.launcher 里"}\n');
  const rows = [{ id: 'a', path: path.join(oldStore, 'downloads', 'x.zip'), state: 'done' }, { id: 'b', path: path.join(oldStore, 'downloads', 'y.zip'), state: 'downloading' }, { id: 'c', path: 'D:\\Other\\z.zip', state: 'done' }];
  await fs.writeFile(path.join(f.data, 'browser/downloads.json'), JSON.stringify(rows));
  const patches = [];
  const result = await migrateLegacyNames({ dataDir: f.data, gameRoot: f.game, patchBrowser: async (...a) => patches.push(a) });

  assert.deepEqual(result.failed, []); assert.equal(result.renamed.length, 7);
  assert.equal(await fs.readFile(path.join(f.content, 'cfg/autoexec.cfg.matcha.bak'), 'utf8'), 'pristine');
  assert.equal(await exists(path.join(f.content, 'cfg/autoexec.cfg.flare.bak')), false);
  for (const name of ['.matcha-library/workshop/101/mod.vpk', '.matcha-trash/abc', '.matcha-backups', '.matcha-data/cache']) assert.ok(await exists(path.join(f.content, name)), name);
  for (const name of ['.matcha-tests', '.matcha-l4n-plugins/disabled']) assert.ok(await exists(path.join(f.game, name)), name);
  assert.equal(await exists(path.join(f.content, '.flare-library')), false);
  const store = JSON.parse(await fs.readFile(path.join(f.data, 'storage.json'), 'utf8')), newStore = path.join(f.content, '.matcha-data');
  assert.deepEqual([store.root, store.profileRoot, store.pending[0], store.note], [newStore, newStore, f.data, '.flare-data 不是路径开头不改']);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.data, 'quick-test.json'), 'utf8')).last.directory, path.join(f.game, '.matcha-tests', 'x').replaceAll('\\', '/'));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.data, 'ledger.json'), 'utf8')).entries.map(e => e.path), ['.matcha-l4n-plugins/disabled/a.dll', '.flare-l4n-pluginsX/a.dll']);
  assert.equal(await fs.readFile(path.join(f.data, 'broken.json'), 'utf8'), '{ not json');
  const [head, ...rest] = (await fs.readFile(session, 'utf8')).split('\n');
  assert.equal(JSON.parse(head).cwd, path.join(f.data, 'pi', 'workspace')); assert.match(rest[0], /com\.flare\.launcher/);
  // 下载记录交给桌面壳改；下载中的那条不动，文件本身也不直接写。
  assert.deepEqual(patches, [['a', rows[0].path, { path: path.join(newStore, 'downloads', 'x.zip') }]]);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.data, 'browser/downloads.json'), 'utf8')), rows);
  assert.equal(await exists(path.join(f.data, MARKER)), false);

  const again = await migrateLegacyNames({ dataDir: f.data, gameRoot: f.game, patchBrowser: async (...a) => patches.push(a) });
  assert.deepEqual([again.renamed, again.changed, again.dataDir, patches.length], [[], [], null, 1]);
});

test('legacy names: keep both folders when the new one already exists, and fall back to an unrenamed folder', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.content, '.matcha-library'));
  const result = await migrateLegacyNames({ dataDir: f.data, gameRoot: f.game });
  assert.ok(!result.renamed.some(r => r.from.endsWith('.flare-library')));
  assert.ok(await exists(path.join(f.content, '.flare-library/workshop/101/mod.vpk')));
  assert.equal(folderName(f.content, 'library'), '.matcha-library');

  const other = path.join(f.base, 'other', 'left4dead2');
  await fs.mkdir(path.join(other, '.flare-trash'), { recursive: true });
  assert.equal(folderName(other, 'trash'), '.flare-trash');
  assert.equal(gameFolder(other, 'library'), path.join(other, '.matcha-library'));
  assert.ok(isFolder(path.join(other, '.flare-trash'), 'trash') && isFolder(path.join(other, '.MATCHA-TRASH'), 'trash'));
  assert.equal(isFolder(path.join(other, 'trash'), 'trash'), false);
});

test('legacy names: path rewriting stops at folder boundaries', () => {
  const pairs = [['C:\\Users\\A\\AppData\\Local\\com.flare.launcher', 'C:\\Users\\A\\AppData\\Local\\com.matcha.launcher']];
  assert.equal(rewritePath('c:\\users\\a\\appdata\\local\\COM.FLARE.LAUNCHER\\pi', pairs), 'C:\\Users\\A\\AppData\\Local\\com.matcha.launcher\\pi');
  assert.equal(rewritePath('C:/Users/A/AppData/Local/com.flare.launcher/logs/x.log', pairs), 'C:/Users/A/AppData/Local/com.matcha.launcher/logs/x.log');
  assert.equal(rewritePath('C:\\Users\\A\\AppData\\Local\\com.flare.launcher-old', pairs), 'C:\\Users\\A\\AppData\\Local\\com.flare.launcher-old');
  assert.equal(rewritePath(42, pairs), 42);
});

test('legacy names: development data folder Flare becomes Matcha', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'matcha-dev-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  assert.equal(currentDataDir(DEV_DATA, base), path.join(base, 'Matcha'));
  await fs.mkdir(path.join(base, 'Flare')); await fs.writeFile(path.join(base, 'Flare', 'settings.json'), '{}');
  assert.equal(currentDataDir(DEV_DATA, base), path.join(base, 'Flare'));
  assert.equal(claimDataDir(DEV_DATA, base), path.join(base, 'Matcha'));
  assert.ok(await exists(path.join(base, 'Matcha', 'settings.json')));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(base, 'Matcha', MARKER), 'utf8')), { from: path.join(base, 'Flare'), to: path.join(base, 'Matcha') });
  assert.equal(claimDataDir(DEV_DATA, base), path.join(base, 'Matcha'));
});

test('legacy names: service startup finds the game without saved settings', async t => {
  const f = await fixture(t);
  const result = await prepareDataDir({ dataDir: f.data, discover: async () => ({ games: [{ gameRoot: f.game }] }) });
  assert.equal(result.dataDir.from, f.oldData);
  assert.ok(await exists(path.join(f.content, '.matcha-library/workshop/101/mod.vpk')));
});
