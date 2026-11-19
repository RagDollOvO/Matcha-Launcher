import { parseServerAddress } from './servers/address.mjs';
import { gameLaunchArgs } from './game-settings.mjs';
import { baseLaunchArgv } from './launch-argv.mjs';

const modes = {
  direct: { label: '模组直启', route: 'game-exe', vacMode: 'game-default' },
  development: { label: '开发模式', route: 'steam-applaunch', vacMode: 'insecure' },
  modded: { label: 'L4N 平台启动', route: 'game-exe', vacMode: 'game-default' },
  clean: { label: '纯净对抗', route: 'game-exe', vacMode: 'game-default' },
};
export const launchModes = Object.keys(modes);

/** Concrete launch policy shared by Core, desktop and confirmation previews. */
export function launchSpec(mode = 'development', connect, settings) {
  if (!launchModes.includes(mode))
    throw Object.assign(new Error('请选择有效的游戏启动方式。'), { code: 'launch_mode_invalid' });
  const target = connect === undefined ? undefined : parseServerAddress(connect).addr;
  const base = baseLaunchArgv(mode), policy = modes[mode];
  // The clean route uses the official default renderer and no custom flags.
  const args = settings === undefined || mode === 'clean' ? base : gameLaunchArgs(base, settings);
  return {
    mode, ...policy,
    launchOptions: [...args, ...(target ? ['+connect', target] : [])],
    ...(target ? { connect: target } : {}),
  };
}
