// Cloudflare Access JWT verification for /api/admin/*.
//
// Verifies the `Cf-Access-Jwt-Assertion` request header against
// `env.ACCESS_TEAM_DOMAIN` + `env.ACCESS_AUD` by fetching the team's JWKS
// and checking the RS256 signature + aud + exp with WebCrypto.
//
// FAILS CLOSED: if ACCESS_TEAM_DOMAIN or ACCESS_AUD is empty/unset, every
// request is rejected (503) -- UNLESS env.ADMIN_DEV_BYPASS === "1", which is
// for local dev only (set via .dev.vars, never committed/deployed).

// Per-isolate JWKS cache so a warm isolate doesn't refetch certs on every
// admin request. Keyed by team domain; isolates are short-lived, so a simple
// TTL is enough -- no need for cross-request invalidation beyond "retry once
// on unknown kid" (handles key rotation).
const jwksCache = new Map(); // domain -> { keys, fetchedAt }
const JWKS_TTL_MS = 10 * 60 * 1000;

function base64urlToUint8Array(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64urlDecodeJson(b64url) {
  const bytes = base64urlToUint8Array(b64url);
  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text);
}

async function fetchJwks(teamDomain, { forceRefresh = false } = {}) {
  const cached = jwksCache.get(teamDomain);
  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) {
    return cached.keys;
  }
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`JWKS fetch failed: HTTP ${res.status}`);
  const body = await res.json();
  const keys = body.keys || [];
  jwksCache.set(teamDomain, { keys, fetchedAt: Date.now() });
  return keys;
}

async function importRsaKey(jwk) {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
}

// Returns { ok: true, payload } or { ok: false, status, error }. Never
// throws -- any unexpected failure (malformed input, WebCrypto edge cases,
// etc.) is caught and turned into a closed (401) result, so the middleware
// always gets a clean JSON-able outcome instead of an uncaught exception
// surfacing as a generic 500 HTML error page.
export async function verifyAccessJwt(request, env) {
  try {
    return await verifyAccessJwtInner(request, env);
  } catch (err) {
    return { ok: false, status: 401, error: `Token verification failed: ${err.message}` };
  }
}

async function verifyAccessJwtInner(request, env) {
  if (env.ADMIN_DEV_BYPASS === "1") {
    return { ok: true, payload: { bypass: true } };
  }

  const teamDomain = (env.ACCESS_TEAM_DOMAIN || "").trim();
  const aud = (env.ACCESS_AUD || "").trim();
  if (!teamDomain || !aud) {
    return {
      ok: false,
      status: 503,
      error: "Admin auth is not configured (ACCESS_TEAM_DOMAIN/ACCESS_AUD unset).",
    };
  }

  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) {
    return { ok: false, status: 401, error: "Missing Cf-Access-Jwt-Assertion header." };
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, status: 401, error: "Malformed access token." };
  }
  const [headerB64, payloadB64, sigB64] = parts;

  let header, payload;
  try {
    header = base64urlDecodeJson(headerB64);
    payload = base64urlDecodeJson(payloadB64);
  } catch {
    return { ok: false, status: 401, error: "Malformed access token." };
  }

  if (header.alg !== "RS256") {
    return { ok: false, status: 401, error: `Unsupported token algorithm: ${header.alg}` };
  }

  let jwk = null;
  try {
    let keys = await fetchJwks(teamDomain);
    jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) {
      // Key rotation: refetch once before giving up.
      keys = await fetchJwks(teamDomain, { forceRefresh: true });
      jwk = keys.find((k) => k.kid === header.kid);
    }
  } catch (err) {
    return { ok: false, status: 503, error: `Could not fetch Access JWKS: ${err.message}` };
  }
  if (!jwk) {
    return { ok: false, status: 401, error: "No matching signing key for this token." };
  }

  let key;
  try {
    key = await importRsaKey(jwk);
  } catch {
    return { ok: false, status: 401, error: "Could not import Access signing key." };
  }

  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64urlToUint8Array(sigB64);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signingInput);
  if (!valid) {
    return { ok: false, status: 401, error: "Invalid token signature." };
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= now) {
    return { ok: false, status: 401, error: "Token expired." };
  }

  const audClaim = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audClaim.includes(aud)) {
    return { ok: false, status: 401, error: "Token audience mismatch." };
  }

  return { ok: true, payload };
}
