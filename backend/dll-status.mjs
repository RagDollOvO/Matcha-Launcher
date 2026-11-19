const failureReasons = {
  invalid_plugin: '模组包或配置格式需要检查。', release_rejected: '模组发布文件核验失败。',
  dependency_unavailable: '所需依赖尚未成功加载。', dll_load_failed: 'DLL 装载失败。',
  abi_mismatch: 'DLL 接口、ID 或版本与模组声明不匹配。', init_failed: '模组初始化失败。',
};
const windowsReasons = { 126: 'DLL 或其依赖文件未找到', 127: '依赖 DLL 缺少所需导出',
  193: 'DLL 位数或文件格式不匹配', 1114: 'DLL 初始化例程失败' };

/** Current process evidence and next-launch selection are separate facts. */
export function dllLoadStatus({ installed = true, enabled = false, host = 'flare', loadKind = 'sdk',
  hostEnabled = true, running = false, connected = false, observed, error } = {}) {
  observed = running ? observed : undefined;
  const library = loadKind === 'library' || host === 'l4n';
  const state = observed?.state === 'initialized' && library ? 'loaded' : observed?.state;
  const mapped = observed?.mapped ?? (['loaded', 'initialized'].includes(state) ? true : !observed && connected ? false : null);
  const base = { host, nextLaunchEnabled: enabled, observed: running && (!!observed || connected), mapped: running ? mapped : false,
    initialized: library ? null : state === 'initialized' ? true : state === 'failed' ? false : null,
    pendingChange: running && mapped !== null && enabled !== mapped, applies: 'next-launch' };
  const result = (value, label, extra = {}) => ({ ...base, state: value, label, ...extra });
  if (!installed) return result('available', '未安装');
  if (['loaded', 'initialized'].includes(state))
    return result(state, state === 'loaded' ? '已装载' : '初始化完成', error ? { nextLaunchError: error } : {});
  if (state === 'failed' || error) {
    const code = observed?.errorCode ?? error?.code ?? 'plugin_load_failed';
    const detail = observed?.error ?? error?.message;
    const message = observed?.nativeError && windowsReasons[observed.nativeError]
      ? `${windowsReasons[observed.nativeError]}（Windows ${observed.nativeError}）。`
      : failureReasons[code] ?? detail ?? '请查看模组日志。';
    return result('failed', '加载失败', {
      code, message, ...(detail && detail !== message ? { detail } : {}),
      ...(observed?.stage ? { stage: observed.stage } : {}),
      ...(observed?.nativeError ? { nativeError: observed.nativeError } : {}),
    });
  }
  if (!hostEnabled && enabled) return result('host-disabled', host === 'l4n' ? '随 L4N 停用' : 'Matcha 加载器已停用');
  if (!enabled) return result('disabled', '已停用');
  if (!running) return result('pending', '下次启动加载');
  if (connected) return result('pending', '下次启动加载', { pendingChange: true, mapped: false });
  return result('unobserved', '当前加载情况待确认');
}
