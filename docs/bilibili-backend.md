# B站 Mod 搜索后端

> 已接入 `DesktopService`，实现位于 `backend/bilibili.mjs`。开发桥接和桌面 JSONL 共用这两个命令，无需连接 Pi 或选择游戏目录。
> 前端页为 `src/lib/pages/Bilibili.svelte`，客户端为 `src/lib/api/bilibili.ts`；开发预览加 `?mockbili` 使用假数据。连接旧版后端时仍保留「在浏览器里搜」兜底。

## 分工

- **后端只负责取数据**：搜索、视频详情、置顶评论。返回纯文本，不做链接识别。
- **前端负责识别资源**：从简介 + 置顶评论里认出创意工坊（直接走现有下载）、网盘（带提取码）、爱发电、GitHub（`src/lib/bilibili-links.ts`）。
- 网盘不做自动下载；用户在内置浏览器里下载的 VPK / ZIP 走现有「下载」页导入。

## `bilibili-search { keyword, order, page }` → `BiliPage`

```ts
type BiliOrder = 'totalrank' | 'pubdate' | 'click' | 'stow'; // 综合 / 最新 / 播放 / 收藏
interface BiliVideo {
  bvid: string;
  title: string;        // 去掉 <em class="keyword"> 等标签，HTML 实体解码
  cover: string;        // 原图地址，http/协议相对都可以，前端会转 https 并加缩略后缀
  author: string; mid?: number;
  duration: string;     // "4:32"
  play: number; favorites?: number; danmaku?: number;
  pubdate: string;      // ISO
  description: string;  // 搜索结果自带的简介，前端用它在卡片上先做一次链接识别
  tags?: string[];
  url: string;          // https://www.bilibili.com/video/BV…
}
interface BiliPage { items: BiliVideo[]; page: number; totalPages: number; total: number }
```

- 接口：`https://api.bilibili.com/x/web-interface/wbi/search/type?search_type=video&keyword=…&order=…&page=…`，每页 20 条。
- **WBI 签名**：从 `x/web-interface/nav` 取 key，缓存 6 小时。匿名响应 `code: -101` 中的 `wbi_img` 同样有效。搜索返回 -352、-403 或 `data.v_voucher` 时刷新 key，最多重试一次；HTTP 412、HTTP 403、HTTP 429 和 -412 直接返回风控错误。
- **Cookie**：按需调用 `x/frontend/finger/spi`，将 `data.b_3` / `data.b_4` 保存为 `buvid3` / `buvid4`，文件为 `<Matcha dataDir>/bilibili-anonymous.json`。重启后复用；请求只携带这两个匿名设备字段，浏览器账号、`SESSDATA`、`bili_jct` 均保持隔离。
- 请求头：桌面 Chrome 的 UA，`Referer: https://search.bilibili.com/`。
- **频率**：同一进程的全部 B站请求共用队列，每次请求结束后至少等待 1 秒再开始下一次；获取 cookie、更新 key、短链解析和评论也经过队列。相同搜索参数缓存 5 分钟，并合并同时发起的相同请求。按用户打开页面、搜索、翻页或查看详情触发，后台无预抓取。
- `keyword` 限 100 字，`page` 1–50。

### 签名计算

1. 取 `wbi_img.img_url` 和 `sub_url` 文件名中的 32 位 key，拼接 `img_key + sub_key`。
2. 按实现中的 64 项 `MIXIN` 索引表重排，截取前 32 字符得到 mixin key。
3. 参数加入当前 Unix 秒数 `wts`，按参数名升序排列；值移除 `!'()*`，再用 `encodeURIComponent` 编码，以 `&` 连接。空格编码为 `%20`。
4. 对 `query + mixinKey` 计算 MD5 十六进制字符串，追加为 `w_rid`。发送的 query 与参与摘要的 query 保持一致。

算法及固定向量来自 [WBI 原始研究文档](https://raw.githubusercontent.com/bilibili-plugins/bilibili-api-collect/master/docs/misc/sign/wbi.md)。key 地址仅用于提取文件名。

## `bilibili-detail { id }` → `BiliDetail`

`id` 接受 BV 号、av 号、完整视频链接或 `b23.tv` 短链。短链只读取一次重定向，目标必须是 bilibili.com 或其子域的视频路径。解析出视频 ID 后调用固定 API；账号信息、额外端口、跨站目标和二次短链会被拒绝。

```ts
interface BiliDetail extends BiliVideo {
  description: string;      // 完整简介（view 接口的 desc；desc_v2 有 @ 和链接时拼成纯文本）
  pinnedComment?: string;   // 置顶评论正文（很多 UP 把网盘链接放这里）
}
```

- 视频信息：`x/web-interface/view?bvid=…`（或 `aid=`）。有 `desc_v2` 时按顺序拼接 `raw_text`，@ 项补上 `@`；其他情况使用 `desc`。文本去标签、解码 HTML 实体，链接保留为普通文本。
- 置顶评论：`x/v2/reply/main?type=1&oid=<aid>&mode=3`，取 `data.top.upper.content.message`；拿不到就省略，不算错误。
- 详情缓存 10 分钟；同一视频的 BV / av / 完整链接复用缓存，短链解析后的结果也缓存 10 分钟。缓存合计最多 100 项，失败结果留待下次用户操作重试。

## 错误码

| code | 场景 | 前端表现 |
|---|---|---|
| `bilibili_blocked` | HTTP 403/412/429、`code: -352/-412/-403`、`v_voucher`；签名类错误最多刷新一次 | 「B站暂时拦截了请求」+ 稍后再试 / 在浏览器里搜 |
| `bilibili_not_found` | 视频不存在、已删除、id 不合法 | 详情页显示错误 |
| `invalid_argument` | 关键词、排序或页码无效 | 显示条件错误 |
| `bilibili_network` | 单次请求超过 15 秒或连接中断 | 显示网络错误 |
| `bilibili_response` | JSON、字段结构异常或响应超过 4 MiB | 显示数据错误 |
| 其他 | 网络等 | 显示 message |

置顶评论是可选补充，评论接口失败时仍返回视频详情。读取接口使用现有系统代理适配器，Matcha 的其他服务队列保持独立。

## 图片

B站封面（`*.hdslb.com`）有防盗链。前端用 `<img referrerpolicy="no-referrer">`，并加了 `@480w_270h_1c.webp` 缩略后缀；桌面 CSP 已放行 `https://*.hdslb.com` 图片。图片由前端直连。

## 检查与发布

- 针对性离线检查：`node --test backend/tests/bilibili.test.mjs`，覆盖签名固定向量、纯文本、匿名字段白名单、共享限频、缓存、重试上限、短链目标校验、可选评论和服务分发。
- 2026-11-17 匿名联网检查：`求生之路2 mod` 搜索返回 20 条；首条视频 `BV11DWX6HE4Q` 的详情和置顶评论读取成功。检查使用临时匿名数据目录。
- 桌面资源清单已包含后端模块及依赖。此实现随下次桌面打包进入发布目录。
