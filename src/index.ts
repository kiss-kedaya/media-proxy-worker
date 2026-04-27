type Env = {
  ALLOWED_HOSTS: string
  REQUIRE_TOKEN?: string
  ACCESS_TOKEN?: string
}

const ALLOWED_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-length',
  'expect',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

const BLOCKED_REQUEST_HEADERS = new Set([
  ...HOP_BY_HOP_HEADERS,
  'cf-connecting-ip',
  'cf-ipcountry',
  'cf-ray',
  'cf-visitor',
  'cdn-loop',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
])

const BLOCKED_RESPONSE_HEADERS = new Set([
  ...HOP_BY_HOP_HEADERS,
  // Worker owns CORS for proxied responses.
  'access-control-allow-origin',
  'access-control-allow-credentials',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-expose-headers',
  'access-control-max-age',
])

type HostRule =
  | { type: 'any' }
  | { type: 'exact'; host: string }
  | { type: 'suffix'; suffix: string }

function json(obj: unknown, status = 200, req?: Request): Response {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })

  if (req) appendCorsHeaders(headers, req)

  return new Response(JSON.stringify(obj), {
    status,
    headers,
  })
}

function parseAllowedHosts(env: Env): HostRule[] {
  const raw = env.ALLOWED_HOSTS || ''
  return raw
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
    .map((item): HostRule => {
      if (item === '*') return { type: 'any' }

      if (item.startsWith('*.')) {
        return { type: 'suffix', suffix: item.slice(1) }
      }

      if (item.startsWith('.')) {
        return { type: 'suffix', suffix: item }
      }

      try {
        const parsed = new URL(item)
        return { type: 'exact', host: parsed.hostname.toLowerCase() }
      } catch {
        return { type: 'exact', host: item }
      }
    })
}

function isAllowedHost(hostname: string, env: Env): boolean {
  const host = hostname.toLowerCase()
  const rules = parseAllowedHosts(env)

  return rules.some((rule) => {
    if (rule.type === 'any') return true
    if (rule.type === 'exact') return host === rule.host
    return host.endsWith(rule.suffix)
  })
}

function isAllowedMethod(method: string): boolean {
  return ALLOWED_METHODS.includes(method.toUpperCase())
}

function copyRequestHeaders(req: Request): Headers {
  const headers = new Headers()

  req.headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (BLOCKED_REQUEST_HEADERS.has(lower)) return
    headers.set(key, value)
  })

  return headers
}

function appendCorsHeaders(headers: Headers, req: Request): Headers {
  const origin = req.headers.get('origin')

  if (origin) {
    headers.set('access-control-allow-origin', origin)
    headers.set('access-control-allow-credentials', 'true')
    headers.append('vary', 'Origin')
  } else {
    headers.set('access-control-allow-origin', '*')
  }

  headers.set('access-control-allow-methods', ALLOWED_METHODS.join(','))
  headers.set(
    'access-control-allow-headers',
    req.headers.get('access-control-request-headers') ||
      'authorization,content-type,cookie,merchant-token,range,if-range,if-modified-since,if-none-match,accept,user-agent,origin,referer',
  )
  headers.set(
    'access-control-expose-headers',
    'content-length,content-range,accept-ranges,etag,last-modified,set-cookie,location',
  )
  headers.set('access-control-max-age', '86400')

  return headers
}

function copyResponseHeaders(upstream: Headers, req: Request): Headers {
  const headers = new Headers()

  upstream.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (BLOCKED_RESPONSE_HEADERS.has(lower)) return
    headers.set(key, value)
  })

  headers.set('x-content-type-options', 'nosniff')
  return appendCorsHeaders(headers, req)
}

function validateToken(url: URL, env: Env, req: Request): Response | null {
  const requireToken = (env.REQUIRE_TOKEN || '0') === '1'
  if (!requireToken) return null

  const token = url.searchParams.get('token') || ''
  const expected = env.ACCESS_TOKEN || ''

  if (!expected) {
    return json({ success: false, error: { message: 'ACCESS_TOKEN is not configured' } }, 500, req)
  }

  if (!token || token !== expected) {
    return json({ success: false, error: { message: 'Unauthorized' } }, 401, req)
  }

  return null
}

function handleOptions(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: appendCorsHeaders(new Headers(), request),
  })
}

function stripProxyOnlySearchParams(url: URL): string {
  const params = new URLSearchParams(url.search)
  params.delete('token')
  const search = params.toString()
  return search ? `?${search}` : ''
}

function decodePathname(pathname: string): string {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return pathname
  }
}

function extractTargetUrl(url: URL): string | null {
  const queryTarget = url.searchParams.get('url')
  if (queryTarget) return queryTarget

  const rawPath = decodePathname(url.pathname).replace(/^\/+/, '')
  const withoutPrefix = rawPath.replace(/^(proxy|url)\/+/i, '')

  if (!/^https?:\/\//i.test(withoutPrefix)) return null

  return withoutPrefix + stripProxyOnlySearchParams(url)
}

function buildTarget(raw: string, req: Request): URL | Response {
  if (raw.length > 8192) {
    return json({ success: false, error: { message: 'URL too long' } }, 400, req)
  }

  try {
    const target = new URL(raw)
    if (target.protocol !== 'https:' && target.protocol !== 'http:') {
      return json({ success: false, error: { message: 'Invalid protocol' } }, 400, req)
    }
    return target
  } catch {
    return json({ success: false, error: { message: 'Invalid url' } }, 400, req)
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const method = request.method.toUpperCase()

    if (method === 'OPTIONS') {
      return handleOptions(request)
    }

    if (!isAllowedMethod(method)) {
      return json({ success: false, error: { message: 'Method not allowed' } }, 405, request)
    }

    const tokenErr = validateToken(url, env, request)
    if (tokenErr) return tokenErr

    const rawTarget = extractTargetUrl(url)
    if (!rawTarget) {
      return json({ success: false, error: { message: 'Missing url' } }, 400, request)
    }

    const targetOrError = buildTarget(rawTarget, request)
    if (targetOrError instanceof Response) return targetOrError

    if (!isAllowedHost(targetOrError.hostname, env)) {
      return json({ success: false, error: { message: 'Host not allowed' } }, 403, request)
    }

    const upstreamInit: RequestInit & {
      cf?: {
        cacheTtl: number
        cacheEverything: boolean
      }
    } = {
      method,
      headers: copyRequestHeaders(request),
      body: method === 'GET' || method === 'HEAD' ? undefined : request.body,
      redirect: 'follow',
      cf: {
        cacheTtl: 0,
        cacheEverything: false,
      },
    }

    const upstream = await fetch(targetOrError.toString(), upstreamInit)

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: copyResponseHeaders(upstream.headers, request),
    })
  },
}
