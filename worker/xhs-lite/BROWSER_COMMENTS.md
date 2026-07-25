# 小红书评论的浏览器读取通道

小红书可能只对评论列表接口启用更严格的网络风控。普通 Cloudflare Worker
`fetch` 即使请求头和签名正确，也可能返回 HTTP 406；点赞、收藏和发评论仍可正常。

`worker/index.js` 支持一个可选的 Cloudflare Browser Rendering 通道。配置后：

- 详情正文仍走原来的轻量 API。
- 评论只由 Cloudflare Chromium 打开帖子页面后读取，不再先请求直连接口。
- 点赞、收藏、发评论、搜索等功能不变。
- 浏览器读取失败时只返回 `comments_error`，不会再用登录 Cookie 重试直连接口。

在部署 `worker/index.js` 的同一个 Worker 中配置：

| 变量 | 类型 | 内容 |
|---|---|---|
| `CF_BROWSER_RENDERING_ACCOUNT_ID` | 普通环境变量 | Cloudflare Account ID |
| `CF_BROWSER_RENDERING_API_TOKEN` | Secret | 仅授予 `Browser Rendering Write` 的 API Token |

部署后访问 `/api/health`。当响应包含
`"comment_reader":"browser-rendering"` 时，评论已切到浏览器通道；若仍是
`direct-api`，说明两个变量至少缺少一个。

Browser Rendering 请求设置了 `cacheTTL=0`。小红书 Cookie 只作为该次浏览器页面的
Cookie 发送，不写入 Worker 存储，也不会放进响应或日志。

