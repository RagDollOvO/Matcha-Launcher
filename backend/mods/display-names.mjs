import path from 'node:path';

// A local filename identifies an addon only within one game installation.
const key = root => path.resolve(root).toLowerCase();
export const displayNames = (settings, root) => settings.modNames?.[key(root)] ?? {};
export function replaceDisplayNames(settings, root, names) {
  const all = { ...settings.modNames }, id = key(root);
  if (Object.keys(names).length) all[id] = names; else delete all[id];
  return all;
}
