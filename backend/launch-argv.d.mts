export type DisplayMode = 'default' | 'fullscreen' | 'windowed' | 'noborder';
export function baseLaunchArgv(mode: 'modded' | 'direct' | 'development' | 'clean'): string[];
export interface LaunchPreferences {
  display: { mode: DisplayMode; width: number | null; height: number | null; refreshHz: number | null };
  fpsMax: number | null;
  novid: boolean;
  console: boolean;
  lowViolence?: boolean;
  consoleLog: boolean;
  highPriority: boolean;
  extraArgs: string;
}
export function buildLaunchArgv(base: readonly string[], v: LaunchPreferences, extra: string[]): string[];

export function l4nLaunchOn(extraArgs:string):boolean;
export function setL4nLaunch(extraArgs:string,enabled:boolean):string;
