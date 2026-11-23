# 构建 Matcha Windows 便携包

改了后端文件或手册，先在仓库根目录运行：

```powershell
node scripts/package-desktop.mjs --check
node scripts/package-desktop.mjs --check --beta
```

预检使用 `npm ci` 安装的 TypeScript 解析后端入口的相对导入，并核对包内使用说明的本地链接。它读取 `src-tauri/tauri.conf.json` 的 `bundle.resources`，与实际复制使用同一份资源映射；预检即可在原生构建之前运行。

## 准备构建输入

- 使用 Windows x64 和 Node.js 24.x，在仓库根目录执行 `npm ci` 与 `npm ci --prefix backend`。桌面构建需要 Rust、Windows 构建工具和 WebView2。
- 准备 CMake、Ninja 和 Windows x86 C++ 工具链。沿用已配置的 `native/build-x86`，或用 `FLARE_CXX` 指定编译器。桌面构建会生成随包的音频、回收、运行时和好友查询等工具。
- 便携包默认从 `node.exe` 同目录下的 `node_modules/@earendil-works/pi-coding-agent` 复制 Pi CLI，也可用 `BEACON_PI_PACKAGE` 指定已有的 Pi 包目录。Steam++ 使用 `backend/community/steampp-manifest.json` 指定的 `vendor/steampp/<版本>`。

## 选一个产出入口

**正式便携文件夹**：构建并复制到新的 `release/Matcha-<版本>-<UTC 时间>/`，成功后更新本地 `release/latest.json`。

```powershell
npm run desktop:package
```

**本地候选**：使用同样的正式版构建产物，保留现有 `release/latest.json`。如果已有本轮构建的 EXE，可直接执行第二行。

```powershell
npm run desktop:build
node scripts/package-desktop.mjs --candidate
```

**内测便携包**：使用独立的 Tauri 标识和数据目录，交付文件名仍为 `Matcha.exe`。

```powershell
npm run desktop:build:beta
node scripts/package-desktop.mjs --beta
```

打包默认从 `src-tauri/target/release/` 取 EXE；指定 `CARGO_TARGET_DIR` 时建议构建与打包共用同一个绝对路径。内测可加 `--output <新目录>`，目标须名为 `内测版`，父目录已存在。两种包都可用 `--notes <Markdown 文件>` 替换「本次更新」，相对路径以仓库根目录为起点；可带相同参数先跑预检。

复制时保留已存在的便携目录。上面的命令只生成本机文件夹，上传和发布是独立步骤。交付时一起保留 EXE、`backend`、`runtime`、`vendor` 和许可文件。

## 随包说明从这里维护

包根目录的 `Matcha使用说明.md` 是入口。根目录旧版的 Mod、服务器说明文件仍随包提供，内容来自同一份手册。更新说明默认取同目录的 `MATCHA_DESKTOP_UPDATE.md`；内测包的桌面入门使用 `BETA_START.md`。哪些手册随包、放在哪里，在 `scripts/portable-docs.mjs` 维护。
