import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DesktopService } from '../desktop/service.mjs';
import { validateManifest, validatePresentation, validatePlugin } from '../core.mjs';
import { ExternalPlatforms } from '../platforms/manager.mjs';
import { PlatformLifecycle } from '../platforms/lifecycle.mjs';
import { dllCatalogs } from '../../src/lib/plugins/catalog.ts';

test('bundled DLL catalog, old manifests and safe covers', async () => {
  const service = new DesktopService({ dataDir: await fs.mkdtemp(path.join(os.tmpdir(), 'flare-collections-')), core: { discover: async () => ({ games: [], warnings: [] }) } });
  const snapshot = await service.dispatch('snapshot');
  assert.equal(snapshot.plugins.length, 0);
  const crosshair = snapshot.availablePlugins.find(p => p.id === 'skeeto.crosshair');
  assert.equal(crosshair.installed, false);
  assert.equal(crosshair.enabled, false);
  assert.equal(crosshair.presentation.catalog.id, 'skeeto');
  assert.equal(crosshair.presentation.collections[0].id, 'skeeto.visuals');
  assert.equal((await validatePlugin(crosshair.packageDirectory)).pe.architecture, 'x86');
  const career = snapshot.availablePlugins.find(p => p.id === 'skeeto.career');
  assert.equal(career.installed, false);
  assert.equal(career.enabled, false);
  assert.equal(career.presentation.catalog.id, 'skeeto');
  assert.equal(career.presentation.collections[0].id, 'skeeto.personal');
  assert.equal(career.actions[0].effect, 'read');
  assert.equal((await validatePlugin(career.packageDirectory)).pe.architecture, 'x86');
  assert.deepEqual(await service.dispatch('plugin-cover', { id: crosshair.id, kind: 'collection' }), { dataUrl: null });
  assert.match((await service.dispatch('plugin-cover', { id: crosshair.id, kind: 'catalog' })).dataUrl, /^data:image\/png;base64,/);
  assert.deepEqual(await service.dispatch('plugin-cover', { id: crosshair.id, kind: 'collection', collectionId: 'skeeto.visuals' }), { dataUrl: null });
  await assert.rejects(service.dispatch('plugin-cover', { id: crosshair.id, kind: 'collection', collectionId: '../outside' }), { code: 'collection_missing' });
  await assert.rejects(service.dispatch('plugin-cover', { id: '../other', kind: 'collection' }), { code: 'plugin_missing' });
  for (const cover of ['../outside.png', 'C:/outside.png', 'images/../cover.png', 'cover.svg', 'NUL.png'])
    assert.throws(() => validatePresentation({ schema: 1, cover }), { code: 'invalid_manifest' });
  const old = JSON.parse(await fs.readFile(new URL('../../native/examples/demo.hello/manifest.json', import.meta.url), 'utf8'));
  validateManifest(old);
  const catalogs = dllCatalogs(snapshot.availablePlugins,[]);
  const skeeto = catalogs.find(c=>c.id==='catalog:skeeto');
  assert.equal(skeeto.collections.length,5);
  assert.equal(skeeto.plugins.length,25);
  const viewmodel=snapshot.availablePlugins.find(p=>p.id==='skeeto.viewmodel');
  assert.equal(viewmodel.presentation.collections[0].id,'skeeto.visuals');
  assert.equal(viewmodel.config.length,6);
  assert.equal(viewmodel.actions.length,10);
  assert.equal((await validatePlugin(viewmodel.packageDirectory)).pe.architecture,'x86');
  const dissolve=snapshot.availablePlugins.find(p=>p.id==='skeeto.corpse-dissolve');
  assert.equal(dissolve.presentation.collections[0].id,'skeeto.visuals');
  assert.equal(dissolve.config.length,6);
  assert.equal(dissolve.actions.length,2);
  assert.equal((await validatePlugin(dissolve.packageDirectory)).pe.architecture,'x86');
  const feedback=snapshot.availablePlugins.find(p=>p.id==='skeeto.hit-feedback');
  assert.equal(feedback.presentation.collections[0].id,'skeeto.visuals');
  assert.equal(feedback.config.length,20);
  assert.equal(feedback.actions.length,4);
  assert.equal((await validatePlugin(feedback.packageDirectory)).pe.architecture,'x86');
  const cfg=snapshot.availablePlugins.find(p=>p.id==='skeeto.config-override');
  assert.deepEqual(cfg.dependencies,[{id:'beacon.source',version:'0.4.0'}]);
  assert.equal((await validatePlugin(cfg.packageDirectory)).pe.architecture,'x86');
  assert.equal(snapshot.availablePlugins.some(p=>p.id==='beacon.source'),true);
  assert.equal(catalogs.some(c=>c.title.includes('Skeeto ·')),false);
});

test('author-defined subcollections share feature identity and retain legacy packages', () => {
  const meta = (id,title) => ({ id,title,author:'Author',summary:title });
  const presentation = {schema:1,catalog:meta('author.pack','作者大合集'),collections:[meta('tools','工具'),meta('favorites','精选')],description:'作者编写的功能说明'};
  validatePresentation(presentation);
  const feature = {id:'author.feature',name:'功能',enabled:true,installed:true,presentation};
  const catalogs = dllCatalogs([{...feature,installed:false,enabled:false},feature],[]);
  assert.equal(catalogs.length,1);
  assert.equal(catalogs[0].plugins.length,1);
  assert.equal(catalogs[0].collections.length,2);
  for (const group of catalogs[0].collections) assert.equal(group.plugins[0],feature);
  for (const invalid of [
    {...presentation,collections:[]},
    {...presentation,catalog:undefined},
    {...presentation,collections:[presentation.collections[0],presentation.collections[0]]},
    {...presentation,catalog:{...presentation.catalog,cover:'../cover.png'}},
    {...presentation,collections:[{...presentation.collections[0],cover:'NUL.png'}]},
  ]) assert.throws(()=>validatePresentation(invalid),{code:'invalid_manifest'});
  const legacy={schema:1,collection:meta('legacy','旧合集')}; validatePresentation(legacy);
  const old=dllCatalogs([{...feature,presentation:legacy}],[])[0];
  assert.equal(old.title,'旧合集');assert.equal(old.collections[0].title,'全部功能');
});

test('retired monolith refuses acquisition and activation before filesystem or network work', async () => {
  const manager = new ExternalPlatforms();
  const lifecycle = new PlatformLifecycle({ dataDir: os.tmpdir(), readOnly: manager, inspectGame: () => { throw Error('should not inspect'); }, fetch: () => { throw Error('should not fetch'); } });
  await assert.rejects(lifecycle.preview('unused', 'skeeto', 'install', { version: '2.2.19' }), { code: 'platform_retired' });
  await assert.rejects(lifecycle.preview('unused', 'skeeto', 'set-enabled', { enabled: true }), { code: 'platform_retired' });
  await assert.rejects(lifecycle.release('skeeto').release(), { code: 'platform_retired' });
  const catalog = JSON.parse(await fs.readFile(new URL('../../docs/platform/skeeto-modules.json', import.meta.url), 'utf8'));
  const ports = JSON.parse(await fs.readFile(new URL('../../docs/platform/skeeto-ports.json', import.meta.url), 'utf8'));
  assert.deepEqual(ports.ports.map(p => p.id).sort(), catalog.modules.map(p => p.id).sort());
  assert.equal(ports.ports.find(p => p.id === 'anti-anti-cheat').status, 'excluded');
});
