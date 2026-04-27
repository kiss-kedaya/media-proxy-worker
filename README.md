# media-proxy-worker

Cloudflare Worker 通用转发代理。默认路由：

- `media.kedaya.xyz/*`

## 配置

`ALLOWED_HOSTS` 使用英文逗号分隔，当前默认：

```toml
ALLOWED_HOSTS = "video.twimg.com,pbs.twimg.com,t.co"
```

也支持：

- `example.com`：只允许精确域名
- `*.example.com` 或 `.example.com`：允许子域名
- `*`：允许任意域名

如需令牌保护，设置：

```toml
REQUIRE_TOKEN = "1"
ACCESS_TOKEN = "your-secret"
```

请求时追加 `token` 参数即可。

## 用法

查询参数模式：

```bash
curl "https://media.kedaya.xyz/?url=https%3A%2F%2Fvideo.twimg.com%2F..."
```

路径模式：

```bash
curl "https://media.kedaya.xyz/https://pbs.twimg.com/media/example.jpg"
```

POST JSON 也会转发请求体和常用请求头：

```bash
curl -X POST "https://media.kedaya.xyz/?url=https%3A%2F%2Fexample.com%2Fapi" \
  -H "content-type: application/json" \
  -d '{"hello":"world"}'
```

## 能力

- 支持 `GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS`
- 支持 Range、Cookie、Authorization、Content-Type、Merchant-Token 等请求头透传
- 自动处理 CORS 预检
- 默认不缓存上游响应

## 开发

```bash
npm i
npm run dev
npm run deploy -- --dry-run
```
