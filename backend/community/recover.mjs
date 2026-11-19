import path from 'node:path';
import { CommunityAcceleration } from './manager.mjs';
import { APP_DATA, currentDataDir } from '../legacy-names.mjs';

const dataDir = process.env.BEACON_DATA_DIR || currentDataDir(APP_DATA);
if (!dataDir) { console.error('找不到 Matcha 本地数据目录。'); process.exitCode = 1; }
else {
  const manager = new CommunityAcceleration({ dataDir });
  try {
    const info = await manager.status();
    if (info.recoveryRequired || info.enabled) await manager.recover();
    else if (!info.supported) throw new Error(info.message || '请在 Windows 上执行网络恢复。');
    console.log('Matcha 社区加速已关闭。');
  } catch (error) {
    console.error(error.message); process.exitCode = 1;
  } finally { await manager.close(); }
}
