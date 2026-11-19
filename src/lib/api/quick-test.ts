import { call } from './bridge';
export interface TestPreset { modIds: string[]; mapModId: string; map: string; width: number; quiet: boolean; infiniteAmmo: boolean }
export interface TestStatus { state: 'idle' | 'busy' | 'loading' | 'ready' | 'exited' | 'failed'; pid?: number; directory?: string; map?: string; startedAt?: string; readyAt?: string; configured?: boolean; cacheHit?: boolean; preparationMs?: number; processRunning?: boolean; failure?: string; logFile?: string }
export interface TestOptions {
  preset: TestPreset; maps: {id: string; source: string; modId: string}[];
  conflicts: {a: string; b: string; pathCount: number}[]; status: TestStatus;
}
export const quickTestApi = {
  options: (modIds?: string[], mapModId?: string) => call<TestOptions>('test-options', {modIds, mapModId}),
  status: () => call<TestStatus>('test-status'),
  start: (preset: TestPreset) => call<TestStatus>('start-test', {preset}, true),
};
