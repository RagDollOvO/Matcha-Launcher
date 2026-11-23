import fs from 'node:fs/promises';
import path from 'node:path';

const platform = 'docs/platform/';
const guides = [
  ['MATCHA_DESKTOP.md', '打开使用手册'],
  ['COMMUNITY_ACCELERATION.md', '社区加速'],
  ['MODS.md', 'Mod', 'Mod使用说明.md'],
  ['SERVERS.md', '服务器', '服务器使用说明.md'],
];
const betaGuides = ['DLL_SPEC.md', 'RELEASE_VERIFICATION.md', 'GAME_SETTINGS.md', 'LIGHTWEIGHT_MODS.md', 'NATIVE_LIBRARIES.md'];
const notesFile = '本次更新.md';
const destination = /(?<=\]\()(<[^>\r\n]+>|[^\s()]+)(?=\s*(?:\)|["']))/g;

function linkPath(link) {
  const value = link.startsWith('<') ? link.slice(1, -1) : link;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value)) return '';
  return value.split('#', 1)[0];
}

export function localGuideLinks(markdown) {
  return [...markdown.matchAll(destination)].map(match => linkPath(match[0])).filter(Boolean);
}

// The root copies link to the same files as their originals under docs/.
function atPackageRoot(markdown, source, project, releaseNotes = false) {
  return markdown.replace(destination, link => {
    const rel = linkPath(link);
    if (!rel || rel.startsWith('docs/')) return link;
    const fromSource = path.relative(project, path.resolve(path.dirname(source), rel)).split(path.sep).join('/');
    let target = fromSource.startsWith('docs/') ? fromSource : '';
    // Notes outside docs/platform have also accepted short guide links.
    if (!target && releaseNotes && /^[\w-]+\.md$/i.test(rel)) target = platform + rel;
    if (!target && releaseNotes && /^\.\.\/[a-z-]+\.md$/i.test(rel)) target = 'docs/' + rel.slice(3);
    return target ? link.replace(rel, target) : link;
  });
}

export async function portableDocs(project, { appName, beta, notes }) {
  const betaFiles = [...guides.map(([file]) => file), ...betaGuides].map(file =>
    [platform + file, platform + (file === 'MATCHA_DESKTOP.md' ? 'BETA_START.md' : file)]);
  const copies = new Map((beta ? [...betaFiles, ['docs/licenses/', 'docs/licenses/']] : [['docs/', 'docs/']])
    .map(([dest, source]) => [dest, path.join(project, source)]));
  const links = guides.map(([file, label]) => `[${label}](${platform}${file})`);
  const generated = new Map([
    [`${appName}使用说明.md`, `# ${appName} 使用说明\n\n${[...links, `[本次更新](${notesFile})`].join(' · ')}\n`],
  ]);
  for (const [file, , alias] of guides) {
    if (!alias) continue;
    const source = path.join(project, platform, file);
    generated.set(alias, atPackageRoot(await fs.readFile(source, 'utf8'), source, project));
  }
  const notesSource = path.resolve(project, notes ?? platform + 'MATCHA_DESKTOP_UPDATE.md');
  generated.set(notesFile, atPackageRoot(await fs.readFile(notesSource, 'utf8'), notesSource, project, true));
  return { copies, generated };
}

export async function writePortableDocs(target, { copies, generated }) {
  // The stable docs tree overlays the catalog already copied by the resource manifest.
  for (const [dest, source] of copies)
    await fs.cp(source, path.join(target, dest), { recursive: true, force: false, errorOnExist: dest !== 'docs/' });
  for (const [dest, text] of generated) await fs.writeFile(path.join(target, dest), text, 'utf8');
}
