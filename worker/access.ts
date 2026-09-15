/**
 * Who is asking, according to Cloudflare Access.
 *
 * Access sits in front of the hostname, so every request that reaches this
 * Worker already belongs to someone on the allowlist — but "on the allowlist"
 * is not "may edit board 5". Access carries the identity in a signed JWT on the
 * `Cf-Access-Jwt-Assertion` header (preferred over the CF_Authorization cookie,
 * which is not guaranteed to be passed), and this verifies it.
 *
 * Validating the header without checking the signature would be worthless:
 * a header is trivially forged by anything that can reach the origin.
 *
 * Off Access — `npm run dev`, or a local wrangler — no header arrives at all.
 * That case is treated as the developer, with full rights, which is safe only
 * because the deployed Worker has exactly one route and no workers.dev
 * hostname, so nothing in production can reach it around Access. If a second
 * route is ever added, this assumption is the thing that breaks.
 */

/** Karl's Zero Trust team domain. Overridable, so another account can run this. */
const DEFAULT_TEAM_DOMAIN = 'flat-wave-abfe.cloudflareaccess.com'

/**
 * A bare host becomes https://host; anything with a scheme is taken as given.
 *
 * The second form exists so the verification path can be exercised against a
 * stub issuer with a key we hold — otherwise the only way to test any of this
 * is in production, against tokens nobody can mint on purpose.
 */
function issuerOrigin(domain: string): string {
  return domain.includes('://') ? domain.replace(/\/+$/, '') : `https://${domain}`
}

/** Signing keys rotate; re-reading them once an hour is plenty. */
const CERTS_TTL_MS = 60 * 60 * 1000

interface Jwk {
  kid: string
  kty: string
  alg?: string
  n: string
  e: string
}

let certsCache: { domain: string; at: number; keys: Jwk[] } | null = null

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function decodeJson(part: string): any {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(part)))
}

async function publicKeys(domain: string): Promise<Jwk[]> {
  if (certsCache && certsCache.domain === domain && Date.now() - certsCache.at < CERTS_TTL_MS) {
    return certsCache.keys
  }
  const response = await fetch(`${issuerOrigin(domain)}/cdn-cgi/access/certs`, {
    signal: AbortSignal.timeout(10_000),
    headers: { accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`Access certs returned ${response.status}`)
  const body = (await response.json()) as { keys?: Jwk[] }
  const keys = body.keys ?? []
  if (keys.length === 0) throw new Error('Access certs contained no keys')
  certsCache = { domain, at: Date.now(), keys }
  return keys
}

export interface AccessClaims {
  email: string
  /** True only when the audience tag was configured and matched. */
  audChecked: boolean
}

export interface AccessResult {
  /** 'local' off Access, 'verified' with a good token, 'rejected' otherwise. */
  state: 'local' | 'verified' | 'rejected'
  claims: AccessClaims | null
  /** Why a token was rejected, in words worth showing someone. */
  reason: string | null
}

/**
 * Verifies the Access token on a request.
 *
 * `aud` is only checked when ACCESS_AUD is configured. Skipping it is a real
 * weakening — a token minted for a *different* Access application in the same
 * account would otherwise pass — so `audChecked` is reported rather than
 * hidden, and /api/me surfaces it. It is one copy-paste from the Zero Trust
 * dashboard to close.
 */
export async function identify(
  request: Request,
  env: { ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string },
): Promise<AccessResult> {
  const token = request.headers.get('Cf-Access-Jwt-Assertion')
  if (!token) return { state: 'local', claims: null, reason: null }

  const domain = env.ACCESS_TEAM_DOMAIN || DEFAULT_TEAM_DOMAIN
  const parts = token.split('.')
  if (parts.length !== 3) {
    return { state: 'rejected', claims: null, reason: 'the Access token is not a JWT' }
  }

  try {
    const header = decodeJson(parts[0]) as { kid?: string; alg?: string }
    const payload = decodeJson(parts[1]) as {
      email?: string
      iss?: string
      aud?: string | string[]
      exp?: number
    }

    if (header.alg !== 'RS256') {
      return { state: 'rejected', claims: null, reason: `unexpected token algorithm ${header.alg}` }
    }

    const keys = await publicKeys(domain)
    const jwk = keys.find((k) => k.kid === header.kid)
    if (!jwk) {
      return { state: 'rejected', claims: null, reason: 'the token was signed by an unknown key' }
    }

    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    )
    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      base64UrlToBytes(parts[2]),
      signed,
    )
    if (!ok) return { state: 'rejected', claims: null, reason: 'the token signature did not verify' }

    if (payload.iss !== issuerOrigin(domain)) {
      return { state: 'rejected', claims: null, reason: 'the token was issued for another team' }
    }
    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) {
      return { state: 'rejected', claims: null, reason: 'the Access session has expired — reload' }
    }

    let audChecked = false
    if (env.ACCESS_AUD) {
      const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
      if (!aud.includes(env.ACCESS_AUD)) {
        return { state: 'rejected', claims: null, reason: 'the token is for another application' }
      }
      audChecked = true
    }

    if (!payload.email) {
      return { state: 'rejected', claims: null, reason: 'the token carries no email' }
    }

    return { state: 'verified', claims: { email: payload.email.toLowerCase(), audChecked }, reason: null }
  } catch (cause) {
    // A malformed token throws deep in the decode; the JSON parser's complaint
    // about a stray byte helps nobody standing at a table.
    const detail = cause instanceof Error ? cause.message : String(cause)
    const unreadable = /JSON|atob|InvalidCharacter|Unexpected token/i.test(detail)
    return {
      state: 'rejected',
      claims: null,
      reason: unreadable
        ? 'the Access token could not be read — reload the page to sign in again'
        : `could not check the Access token (${detail})`,
    }
  }
}
