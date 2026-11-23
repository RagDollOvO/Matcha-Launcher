/** 文件大小；不到 1 MiB 的用 KiB，免得显示成 0.0 MiB */
export const mib = (bytes: number) => (bytes < 1048576 ? `${bytes > 0 ? Math.max(1, Math.round(bytes / 1024)) : 0} KiB` :`${(bytes / 1048576).toFixed(bytes >= 104857600 ? 0 : 1)} MiB`);
