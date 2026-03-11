type Env = {
  ALLOWED_HOSTS: string
  REQUIRE_TOKEN?: string
  ACCESS_TOKEN?: string
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

function parseAllowedHosts(env: Env): Set<string> {
  const raw = env.ALLOWED_HOSTS || ''
  const parts = raw
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)

  return new Set(parts)
}

function pickRequestHeaders(req: Request): Headers {
  const h = new Headers()

  const range = req.headers.get('range')
  if (range) h.set('range', range)

  const ifRange = req.headers.get('if-range')
  if (ifRange) h.set('if-range', ifRange)

  const ifModifiedSince = req.headers.get('if-modified-since')
  if (ifModifiedSince) h.set('if-modified-since', ifModifiedSince)

  const ifNoneMatch = req.headers.get('if-none-match')
  if (ifNoneMatch) h.set('if-none-match', ifNoneMatch)

  const accept = req.headers.get('accept')
  if (accept) h.set('accept', accept)

  // UA is controlled by Cloudflare; upstream usually doesn't need client UA.

  return h
}

function pickResponseHeaders(upstream: Headers): Headers {
  const out = new Headers()

  const passthrough = [
    'content-type',
    'content-length',
    'content-range',
    'accept-ranges',
    'cache-control',
    'etag',
    'last-modified',
  ]

  for (const key of passthrough) {
    const value = upstream.get(key)
    if (value) out.set(key, value)
  }

  // Some players need this exposed.
  out.set('access-control-expose-headers', 'content-length,content-range,accept-ranges,etag,last-modified')

  // Safe for media fetching.
  out.set('access-control-allow-origin', '*')
  out.set('access-control-allow-methods', 'GET,HEAD,OPTIONS')
  out.set('access-control-allow-headers', 'range,if-range,if-modified-since,if-none-match,accept')

  out.set('x-content-type-options', 'nosniff')

  return out
}

function validateToken(url: URL, env: Env): Response | null {
  const requireToken = (env.REQUIRE_TOKEN || '0') === '1'
  if (!requireToken) return null

  const token = url.searchParams.get('token') || ''
  const expected = env.ACCESS_TOKEN || ''

  if (!expected) {
    return json({ success: false, error: { message: 'ACCESS_TOKEN is not configured' } }, 500)
  }

  if (!token || token !== expected) {
    return json({ success: false, error: { message: 'Unauthorized' } }, 401)
  }

  return null
}

function handleOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,HEAD,OPTIONS',
      'access-control-allow-headers': 'range,if-range,if-modified-since,if-none-match,accept',
      'access-control-max-age': '86400',
    },
  })
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return handleOptions()
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ success: false, error: { message: 'Method not allowed' } }, 405)
    }

    const tokenErr = validateToken(url, env)
    if (tokenErr) return tokenErr

    const raw = url.searchParams.get('url')
    if (!raw) {
      return json({ success: false, error: { message: 'Missing url' } }, 400)
    }

    if (raw.length > 4000) {
      return json({ success: false, error: { message: 'URL too long' } }, 400)
    }

    let target: URL
    try {
      target = new URL(raw)
    } catch {
      return json({ success: false, error: { message: 'Invalid url' } }, 400)
    }

    if (target.protocol !== 'https:' && target.protocol !== 'http:') {
      return json({ success: false, error: { message: 'Invalid protocol' } }, 400)
    }

    const allowed = parseAllowedHosts(env)
    if (!allowed.has(target.hostname.toLowerCase())) {
      return json({ success: false, error: { message: 'Host not allowed' } }, 403)
    }

    const upstream = await fetch(target.toString(), {
      method: request.method,
      headers: pickRequestHeaders(request),
      redirect: 'follow',
      // Avoid caching range responses at the edge by default.
      cf: {
        cacheTtl: 0,
        cacheEverything: false,
      },
    })

    const headers = pickResponseHeaders(upstream.headers)

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    })
  },
}
