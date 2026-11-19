// Shared by the desktop launch path and the browser's live parameter preview.
export function baseLaunchArgv(mode) {
  return mode === 'development' ? ['-insecure'] : ['-steam', '-novid'];
}

const aliases = new Map(Object.entries({
  '-freq': '-refresh', '-width': '-w', '-height': '-h', '-full': '-fullscreen',
  '-sw': '-windowed', '-window': '-windowed', '-win': '-windowed', '-startwindowed': '-windowed',
}));

export function buildLaunchArgv(base, v, extra) {
  const groups = new Map();
  let screenRate;
  const add = (...group) => {
    const raw = group[0].toLowerCase(), key = aliases.get(raw) ?? raw;
    if (key === '-fullscreen') { groups.delete('-windowed'); groups.delete('-noborder'); }
    if (key === '-windowed' || key === '-noborder') {
      groups.delete('-fullscreen');
      if (screenRate && groups.get('-refresh') === screenRate) groups.delete('-refresh');
    }
    groups.delete(key); groups.set(key, group);
    return group;
  };
  for (const token of base) if (token !== '-novid' || v.novid) add(token);
  const d = v.display;
  if (d.mode === 'fullscreen') {
    add('-fullscreen');
    if (d.refreshHz != null) screenRate = add('-refresh', String(d.refreshHz));
  }
  if (d.mode === 'windowed' || d.mode === 'noborder') add('-windowed');
  if (d.mode === 'noborder') add('-noborder');
  if (d.width != null && d.height != null) { add('-w', String(d.width)); add('-h', String(d.height)); }
  if (v.novid && !groups.has('-novid')) add('-novid');
  if (v.console) add('-console');
  if (v.lowViolence) add('-lv');
  if (v.consoleLog) add('-condebug');
  if (v.highPriority) add('-high');
  if (v.fpsMax !== null) add('+fps_max', String(v.fpsMax));
  let group = [];
  for (const token of extra) {
    if (/^[+-][a-z_]/i.test(token) && group.length) { add(...group); group = []; }
    group.push(token);
  }
  if (group.length) add(...group);
  return [...groups.values()].flat();
}

// The existing custom launch line is the single source of truth, including old hand-entered flags.
export function l4nLaunchOn(extraArgs) {
  return !/(?:^|\s)-hide_neko(?=\s|$)/i.test(extraArgs);
}
export function setL4nLaunch(extraArgs, enabled) {
  if (enabled === l4nLaunchOn(extraArgs)) return extraArgs;
  return enabled ? extraArgs.replace(/(^|\s)-hide_neko(?=\s|$)/gi, '').trim()
    : [extraArgs.trimEnd(), '-hide_neko'].filter(Boolean).join(' ');
}
