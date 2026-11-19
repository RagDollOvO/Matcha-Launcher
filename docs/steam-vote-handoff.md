# Steam 点赞直接复用内置浏览器的登录（给 codex）

下载完成后右下角的点赞卡片，Steam 创意工坊条目现在显示「直接点赞」。点了以后不跳转，用内置浏览器里 Steam 页面那份登录直接点赞，点上就地道谢。没登录、点不上或桌面壳还不支持时，退回原来的做法：在内置浏览器打开作品页（没登录时打开登录页，登录完回到作品页）。

前端已接好：`src/lib/browser/browser.svelte.ts` 的 `browser.steamVote()`、`src/lib/stores/support.svelte.ts` 的 `go()`、`src/lib/components/SupportPrompt.svelte`。后端缺下面两项。

## 1. `browser_call` 新增 `steam-vote`

```ts
invoke('browser_call', { action: 'steam-vote', params: { workshopId: '3141592653' } })
// → { status: 'voted' | 'already' | 'login' | 'failed'; message?: string }
```

| status | 含义 | 前端怎么做 |
|---|---|---|
| `voted` | 这次点上了 | 卡片就地道谢，以后不再提醒这个条目 |
| `already` | 之前就点过（页面上的点赞按钮已是选中状态） | 同上，换句台词 |
| `login` | Steam 页面那份登录没登上 | 提示一句，在内置浏览器打开 `steamcommunity.com/login/home/?goto=<作品页>` |
| `failed` | 其他失败，`message` 给玩家看（一句中文） | 提示 `message`，在内置浏览器打开作品页 |

reject（返回 Err）时前端按 `failed` 处理，把错误文字给玩家看。**例外**：错误文字含「浏览器操作无效」时，前端当作旧版桌面壳不支持，悄悄关掉直接点赞，改回「前往点赞」。所以未知 action 的这句报错请保留。

要求：

- **用和标签页一样的 profile。** 按 `steam_route()` 选：社区加速开着用 `browser/steam-profile`（加 `--no-proxy-server`），关着用 `browser/profile`。这样用的就是玩家在内置浏览器里看到的那个 Steam 登录。
- **Cookie 不出 WebView。** 不要把 `steamLoginSecure` / `sessionid` 读到 Rust 或 Node 再自己发请求（和 `gamemaps/transfer.rs` 的原则一样）。建议做法：建一个隐藏的子 webview（label 不要用 `browser-tab-*`，比如 `steam-vote`），打开 `https://steamcommunity.com/sharedfiles/filedetails/?id=<workshopId>`，加载完用 WebView2 的 `ExecuteScript` 拿结果：
  - 页面里 `g_steamID` 为假 → `login`
  - 点赞按钮（`#VoteUpBtn`）已是选中状态 → `already`
  - 否则在页面里 `fetch` 页面自己 `VoteUp()` 发的那个请求（目前是 POST `/sharedfiles/voteup`，表单带 `id` 和 `sessionid=g_sessionID`；以页面实际发出的为准），返回 `success === 1` → `voted`，其他 → `failed`，`message` 里带上 Steam 的 success 码
  - 做完关掉这个 webview。整个过程 15 秒内没结果就 `failed`（「Steam 没响应，稍后再试」）。
- `workshopId` 只收 1–20 位数字；只认主界面调用（`require_shell` 已有）。
- 前端不经过标签页队列，直接 `invoke`，同一时间只发一个。别碰正在显示的标签页 webview，也别把这个隐藏 webview 显示出来或写进下载记录。

## 2. 社区加速开关两边的 Steam 登录不通

现在社区加速开着时 Steam 页面走 `steam-profile`，关着走 `profile`，两份 Cookie 各存各的（本机两份都有 `EBWebView/Default/Network/Cookies`）。玩家在一边登录 Steam，切换社区加速后打开 Steam 页面就是没登录，直接点赞也会返回 `login`。

希望切换路线时把 Steam 相关域名（`steamcommunity.com`、`steampowered.com` 及其子域，尤其 `login.steampowered.com`）的 Cookie 从旧 profile 同步到新 profile，例如用 `ICoreWebView2CookieManager` 的 `GetCookies` → `AddOrUpdateCookie`。Cookie 只在两个 WebView2 profile 之间搬，不落到别的文件、不经过前端。如果有更好的办法（比如两边共用一个 profile、代理开关换个方式实现），按你的来，结果是「切换社区加速不用重新登录 Steam」就行。

## 怎么验收

1. 内置浏览器里登录 Steam（勾「记住我」），重启 Matcha 后打开 Steam 页面仍是登录状态。
2. 下载一个工坊条目，卡片上点「直接点赞」：不跳转，几秒内道谢；去作品页看，点赞按钮是选中状态。
3. 再下载同一个条目（或手动清掉 `flare.support.liked` 后再下）：返回 `already`。
4. 退出 Steam 登录后点「直接点赞」：提示没登录，打开登录页，登录后回到作品页。
5. 切换社区加速开关后打开 Steam 页面，仍是登录状态。
