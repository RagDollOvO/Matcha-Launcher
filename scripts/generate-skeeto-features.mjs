// Derive DLL configuration validators from the same authored manifest Flare uses.
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../native/plugins/', import.meta.url));
for (const id of ['skeeto.night-vision', 'skeeto.silent-si-fix', 'skeeto.gunshot-feel', 'skeeto.crosshair-tps', 'skeeto.hide-back-items', 'skeeto.model-scale', 'skeeto.endgame-music', 'skeeto.team-glow-style', 'skeeto.auto-reload', 'skeeto.auto-semiauto', 'skeeto.script-cues', 'skeeto.idle-restore', 'skeeto.viewmodel', 'skeeto.corpse-dissolve', 'skeeto.hit-feedback']) {
  const manifest = JSON.parse(await fs.readFile(`${root}/${id}/manifest.json`, 'utf8'));
  const fields = Object.fromEntries(manifest.config.map(({ id, label, apply, ...spec }) => [id, spec]));
  await fs.writeFile(`${root}/${id}/definition.hpp`, `// Generated from manifest.json by scripts/generate-skeeto-features.mjs\n#pragma once\nstatic constexpr char kFields[] = R"fields(${JSON.stringify(fields)})fields";\n`);
}
