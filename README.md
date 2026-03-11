# media-proxy-worker

Cloudflare Workers media proxy for `video.twimg.com` and `pbs.twimg.com` with Range/206 passthrough.

## One-click deploy

Open the link below and replace `<YOUR_GITHUB_REPO_URL>` with your repo URL:

https://deploy.workers.cloudflare.com/?url=<YOUR_GITHUB_REPO_URL>

After deploy, bind a custom domain route (recommended):
- `media.kedaya.xyz/*` -> this Worker

## Usage

- `https://media.kedaya.xyz/?url=<encoded>`
- or `https://media.kedaya.xyz/?url=https%3A%2F%2Fvideo.twimg.com%2F...`

Optional token protection:
- Set `REQUIRE_TOKEN=1` and `ACCESS_TOKEN` in Workers dashboard.
- Then call: `https://media.kedaya.xyz/?url=...&token=...`

## Security

- Strict upstream host allowlist: `video.twimg.com`, `pbs.twimg.com`
- GET/HEAD only
- URL length capped

## Dev

```bash
npm i
npm run dev
```
