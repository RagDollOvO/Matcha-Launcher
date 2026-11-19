# 网页下载的作者来源与 B站点赞

下载完成后，卡片上的「直接点赞」使用内置浏览器里的 B站登录。手动导入或交给茶茶导入同一条网页下载，Mod 详情都会保留识别到的作者页，并单独保留下载页。

## 点赞：一次点击只给当前视频点赞

主界面调用 `browser_call('bili-like', { bvid })`，`bvid` 为 `BV` 加 10 位 ASCII 字母或数字。桌面壳用普通标签页的 `browser/profile` 打开临时隐藏视频页，在页面内先查询点赞状态，确认尚未点赞才发一次 `like=1`。Cookie 和 CSRF 字段留在网页内；这条路径没有投币、收藏或取消赞的操作。

| 返回的 `status` | 卡片行为 |
|---|---|
| `voted` / `already` | 就地道谢，不再提醒这个视频。 |
| `login` | 在内置浏览器打开 `https://passport.bilibili.com/login?gourl=<编码后的视频页>`，登录后回视频页，由玩家点一下赞。 |
| `failed` | 显示简短原因，打开视频页供手动操作。等待超过 15 秒也走这条路径。 |

隐藏页用后即关，不占标签页或下载记录。旧桌面壳返回「浏览器操作无效」时，前端沿用打开视频页的方式。

## 作者页从哪里来

`src/lib/browser/trail.ts` 在下载开始时，从发起下载的标签页往回找最近三小时的访问记录。网页打开的新标签页接上原标签页的访问链；输入新地址或回首页会重置该标签页的链。

- 识别 B站视频、爱发电作品或主页、Steam 创意工坊条目、GameMaps 详情。离下载最近的在前，最多两个网站，每站一条。
- B站视频简介、置顶评论里的链接按站点和路径登记。玩家把网盘链接复制到新标签页时，也有机会找回原视频。同一视频在当前会话内每小时最多请求一次 `bilibili-detail`，失败后继续按访问链识别。
- 识别到的作者页写入原生下载记录。升级时，前端会把本机 `flare.trail.downloads` 中仍有对应下载记录的来源补进去。找不到作者页时沿用下载页。

## 前后端接口

```ts
type ModCreator = {
  source: 'steam' | 'bilibili' | 'gamemaps' | 'afdian';
  url: string; title: string; author?: string;
};

// 仅主界面；按已有下载 id 写入 browser/downloads.json，返回实际保存的作者页。
invoke('browser_call', { action: 'annotate', params: { id, creators } }); // → { creators: ModCreator[] }

// VPK 和 ZIP 共用；每个成功导入的 Mod 各自保存 origin。
call('browser-import', { id, selected?, creators? }, true);
// settings.modOrigins[modId] → { pageUrl, title, downloadId, creators? }
```

两个入口均校验 HTTPS 和来源域名：`steamcommunity.com`、`bilibili.com`、`gamemaps.com`、`afdian.com` / `afdian.net` / `ifdian.net`，包含各自子域。标题和作者名各最多 200 字，逐条跳过无效来源。

手动导入优先用本次传入的有效作者页，缺省时读下载记录。茶茶的 `mod-acquire` 在 `browser-list`、`browser-preview` 中读同一条记录，确认后走同一个导入入口。原始下载页在两条路径中都保留。

## 验收

- **离线已验：** VPK 手动导入、茶茶从 ZIP 选择 VPK 导入后，Mod 快照与持久化来源匹配；原生 `annotate` 只更新指定记录。模拟 B站响应覆盖已登录点赞、已赞、未登录和失败分支，成功路径仅有一次点赞写请求。
- **真账号验收：** 用内置浏览器从 B站视频进入爱发电作品页，再下载一个 ZIP。卡片应先列爱发电、再列 B站。玩家点 B站的「点赞」后，在视频页确认大拇指亮起；未登录时走登录页并回到原视频。ZIP 导入后在 Mod 详情查看两个作者页与下载页。
