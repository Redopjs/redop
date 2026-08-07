// ─────────────────────────────────────────────
//  redop — auth plugins
//  Two modes following MCP spec auth guidance:
//    jwt()   — validate Bearer JWT on every request
//    oauth() — OAuth 2.1 discovery + JWKS + scope check
// ─────────────────────────────────────────────

import { middleware, type Redop } from "../redop";
import type { ProtectedResourceConfig } from "../types";
import {
  absoluteMetadataUrl,
  HttpAuthError,
  protectedResourceMetadataPaths,
} from "./http-auth";

export {
  absoluteMetadataUrl,
  buildProtectedResourceDocument,
  buildWwwAuthenticate,
  HttpAuthError,
  isHttpAuthError,
  protectedResourceMetadataPaths,
  type HttpAuthChallenge,
  type HttpAuthErrorCode,
  type ProtectedResourceConfig,
} from "./http-auth";

// ── JWT ───────────────────────────────────────

export interface JwtPayload {
  aud?: string | string[];
  exp?: number;
  iat?: number;
  iss?: string;
  jti?: string;
  nbf?: number;
  scope?: string;
  sub?: string;
  [key: string]: unknown;
}

export interface JwtOptions {
  /** Expected audience — validated against `aud` claim. */
  audience?: string | string[];
  /**
   * Authorization servers for Protected Resource Metadata.
   * Defaults to `[issuer]` when `resource` is set and `issuer` is provided.
   */
  authorizationServers?: string[];
  /**
   * Key to store the verified payload on `ctx`.
   * @default "jwtPayload"
   */
  ctxKey?: string;
  /** Expected issuer — validated against `iss` claim. */
  issuer?: string;
  /** How long to cache JWKS keys in ms. Default: 3_600_000 (1 hour). */
  jwksCacheTtl?: number;
  /**
   * URL to a JWKS endpoint. Keys are fetched once and cached for `jwksCacheTtl` ms.
   * Mutually exclusive with `secret`.
   */
  jwksUri?: string;
  /**
   * When true, requests without an Authorization header pass through
   * instead of throwing. Useful for mixed public/protected endpoints.
   * @default false
   */
  optional?: boolean;
  /**
   * Absolute MCP resource URL. When set, Redop serves Protected Resource
   * Metadata and returns HTTP 401/403 `WWW-Authenticate` challenges.
   */
  resource?: string;
  /** Required scopes — all must be present in the `scope` claim. */
  requiredScopes?: string[];
  /** Scopes advertised in PRM / challenges. Defaults to `requiredScopes`. */
  scopesSupported?: string[];
  /**
   * HMAC secret (for HS256/HS384/HS512) OR PEM-encoded public key (for RS256/ES256).
   * Mutually exclusive with `jwksUri`.
   */
  secret?: string;
  /**
   * Custom validator — receives the decoded payload, return false to reject.
   */
  validate?: (payload: JwtPayload) => boolean | Promise<boolean>;
}

/**
 * Decode a JWT without verifying the signature.
 * Used for payload inspection before HMAC/RSA verification.
 */
function decodeJwtParts(token: string): {
  header: Record<string, unknown>;
  payload: JwtPayload;
  sig: string;
} {
  const [h, p, s] = token.split(".");
  if (!(h && p && s)) {
    throw new Error("Malformed JWT: expected 3 parts");
  }

  const decode = (b64: string) => {
    const padded = b64
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(b64.length / 4) * 4, "=");
    return JSON.parse(atob(padded));
  };

  return { header: decode(h), payload: decode(p), sig: s };
}

/**
 * Verify an HS256/HS384/HS512 JWT using the Web Crypto API.
 * Returns the decoded payload or throws.
 */
async function verifyHmacJwt(
  token: string,
  secret: string
): Promise<JwtPayload> {
  const [headerB64, payloadB64, sigB64] = token.split(".");
  if (!(headerB64 && payloadB64 && sigB64)) {
    throw new Error("Malformed JWT");
  }

  const { header, payload } = decodeJwtParts(token);
  const alg = header.alg as string;
  if (!alg.startsWith("HS")) {
    throw new Error(`Expected HMAC algorithm, got ${alg}`);
  }

  const hashMap: Record<string, string> = {
    HS256: "SHA-256",
    HS384: "SHA-384",
    HS512: "SHA-512",
  };
  const hashName = hashMap[alg];
  if (!hashName) {
    throw new Error(`Unsupported algorithm: ${alg}`);
  }

  const keyData = new TextEncoder().encode(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: hashName },
    false,
    ["verify"]
  );

  const message = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const sigBytes = Uint8Array.from(
    atob(sigB64.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0)
  );

  const valid = await crypto.subtle.verify("HMAC", key, sigBytes, message);
  if (!valid) {
    throw new Error("JWT signature verification failed");
  }

  return payload;
}

/** In-memory JWKS cache entry. */
interface JwksKey extends JsonWebKey {
  kid?: string;
}

interface JwksCache {
  expiresAt: number;
  keys: JwksKey[];
}

const jwksCache = new Map<string, JwksCache>();

async function fetchJwks(uri: string, cacheTtl: number): Promise<JwksKey[]> {
  const cached = jwksCache.get(uri);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.keys;
  }

  const resp = await fetch(uri);
  if (!resp.ok) {
    throw new Error(`JWKS fetch failed: ${resp.status}`);
  }
  const { keys } = (await resp.json()) as { keys: JwksKey[] };
  jwksCache.set(uri, { keys, expiresAt: Date.now() + cacheTtl });
  return keys;
}

/**
 * Verify a JWT against a JWKS endpoint.
 * Tries each key until one verifies or all fail.
 */
async function verifyJwksJwt(
  token: string,
  jwksUri: string,
  cacheTtl: number
): Promise<JwtPayload> {
  const [headerB64, payloadB64, sigB64] = token.split(".");
  if (!(headerB64 && payloadB64 && sigB64)) {
    throw new Error("Malformed JWT");
  }

  const { header, payload } = decodeJwtParts(token);
  const alg = header.alg as string;
  const kid = header.kid as string | undefined;
  const keys = await fetchJwks(jwksUri, cacheTtl);

  // Filter by kid if present
  const candidates = kid ? keys.filter((k) => k.kid === kid) : keys;
  if (candidates.length === 0) {
    throw new Error("No matching key found in JWKS");
  }

  const message = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const sigBytes = Uint8Array.from(
    atob(sigB64.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0)
  );

  const cryptoAlg: Record<string, RsaHashedImportParams | EcdsaParams> = {
    RS256: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    RS384: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-384" },
    RS512: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-512" },
    ES256: { name: "ECDSA", hash: "SHA-256" },
    ES384: { name: "ECDSA", hash: "SHA-384" },
    ES512: { name: "ECDSA", hash: "SHA-512" },
  };

  const algoParams = cryptoAlg[alg];
  if (!algoParams) {
    throw new Error(`Unsupported algorithm from JWKS: ${alg}`);
  }

  for (const jwk of candidates) {
    try {
      const key = await crypto.subtle.importKey("jwk", jwk, algoParams, false, [
        "verify",
      ]);
      const valid = await crypto.subtle.verify(
        algoParams,
        key,
        sigBytes,
        message
      );
      if (valid) {
        return payload;
      }
    } catch {}
  }

  throw new Error("JWT signature verification failed against all JWKS keys");
}

/** Validate standard JWT claims (exp, nbf, iss, aud). Scope misses throw 403. */
function validateClaims(
  payload: JwtPayload,
  opts: Pick<JwtOptions, "issuer" | "audience" | "requiredScopes">,
  challenge: AuthChallengeContext
): void {
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp !== undefined && now > payload.exp) {
    throw unauthorized("JWT expired", challenge, "invalid_token");
  }
  if (payload.nbf !== undefined && now < payload.nbf) {
    throw unauthorized("JWT not yet valid", challenge, "invalid_token");
  }
  if (opts.issuer && payload.iss !== opts.issuer) {
    throw unauthorized(
      `JWT issuer mismatch: expected ${opts.issuer}`,
      challenge,
      "invalid_token"
    );
  }
  if (opts.audience) {
    const expected = Array.isArray(opts.audience)
      ? opts.audience
      : [opts.audience];
    const actual = Array.isArray(payload.aud)
      ? payload.aud
      : [payload.aud ?? ""];
    if (!expected.some((e) => actual.includes(e))) {
      throw unauthorized("JWT audience mismatch", challenge, "invalid_token");
    }
  }
  if (opts.requiredScopes?.length) {
    const grantedScopes = (payload.scope ?? "").split(" ");
    for (const s of opts.requiredScopes) {
      if (!grantedScopes.includes(s)) {
        throw insufficientScope(
          `JWT missing required scope: ${s}`,
          challenge,
          opts.requiredScopes
        );
      }
    }
  }
}

type AuthChallengeContext = {
  resourceMetadataUrl?: string;
  scope?: string;
};

function unauthorized(
  message: string,
  challenge: AuthChallengeContext,
  error: "invalid_token" | "invalid_request" = "invalid_token"
): HttpAuthError {
  return new HttpAuthError(message, {
    status: 401,
    challenge: {
      resourceMetadataUrl: challenge.resourceMetadataUrl,
      scope: challenge.scope,
      error,
      errorDescription: message,
    },
  });
}

function insufficientScope(
  message: string,
  challenge: AuthChallengeContext,
  scopes: string[]
): HttpAuthError {
  return new HttpAuthError(message, {
    status: 403,
    challenge: {
      resourceMetadataUrl: challenge.resourceMetadataUrl,
      scope: scopes.join(" "),
      error: "insufficient_scope",
      errorDescription: message,
    },
  });
}

function resolveChallengeContext(
  requestUrl: string | undefined,
  config: ProtectedResourceConfig | undefined,
  scopes: string[] | undefined
): AuthChallengeContext {
  const scope = scopes?.length ? scopes.join(" ") : undefined;
  if (!config) {
    return { scope };
  }
  try {
    const resourceUrl = new URL(config.resource);
    const origin = requestUrl ? new URL(requestUrl).origin : resourceUrl.origin;
    const mcpPath = resourceUrl.pathname || "/mcp";
    const paths = protectedResourceMetadataPaths(mcpPath);
    return {
      scope: scope ?? config.scopesSupported?.join(" "),
      resourceMetadataUrl: absoluteMetadataUrl(origin, paths.suffixed),
    };
  } catch {
    return { scope: scope ?? config.scopesSupported?.join(" ") };
  }
}

function attachProtectedResource(
  app: Redop,
  config: ProtectedResourceConfig | undefined
): Redop {
  if (config) {
    app._setProtectedResource(config);
  }
  return app;
}

function protectedResourceFromAuthOpts(opts: {
  resource?: string;
  issuer?: string;
  authorizationServers?: string[];
  requiredScopes?: string[];
  scopesSupported?: string[];
}): ProtectedResourceConfig | undefined {
  if (!opts.resource) {
    return undefined;
  }
  const authorizationServers =
    opts.authorizationServers ??
    (opts.issuer ? [opts.issuer] : undefined);
  if (!authorizationServers?.length) {
    throw new Error(
      "[redop] resource requires authorizationServers or issuer for Protected Resource Metadata"
    );
  }
  return {
    resource: opts.resource,
    authorizationServers,
    scopesSupported: opts.scopesSupported ?? opts.requiredScopes,
    bearerMethodsSupported: ["header"],
  };
}

/**
 * Validate Bearer JWTs on every HTTP request.
 * Verified payload is stored on `ctx[ctxKey]` (default: "jwtPayload").
 *
 * Set `resource` to enable MCP OAuth discovery (PRM + 401 `WWW-Authenticate`).
 *
 * @example HMAC secret
 * app.use(jwt({ secret: process.env.JWT_SECRET }));
 *
 * @example JWKS with MCP OAuth challenge (Clerk / WorkOS / Auth0)
 * app.use(jwt({
 *   jwksUri: "https://your-app.clerk.accounts.dev/.well-known/jwks.json",
 *   issuer: "https://your-app.clerk.accounts.dev",
 *   resource: "https://mcp.example.com/mcp",
 *   audience: "https://mcp.example.com/mcp",
 * }));
 */
export function jwt(opts: JwtOptions): Redop {
  if (!(opts.secret || opts.jwksUri)) {
    throw new Error("[redop] jwt() requires either secret or jwksUri");
  }
  const cacheTtl = opts.jwksCacheTtl ?? 3_600_000;
  const ctxKey = opts.ctxKey ?? "jwtPayload";
  const prm = protectedResourceFromAuthOpts(opts);
  const audience = opts.audience ?? opts.resource;

  const app = middleware(async ({ request, ctx, next }) => {
    if (request.transport !== "http") {
      return next();
    }

    const challenge = resolveChallengeContext(
      request.url || request.raw?.url,
      prm,
      opts.scopesSupported ?? opts.requiredScopes
    );

    const authHeader = request.headers["authorization"] ?? "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : "";

    if (!token) {
      if (opts.optional) {
        return next();
      }
      throw unauthorized("Unauthorized: missing Bearer token", challenge);
    }

    let payload: JwtPayload;
    try {
      payload = opts.secret
        ? await verifyHmacJwt(token, opts.secret)
        : await verifyJwksJwt(token, opts.jwksUri!, cacheTtl);
    } catch (e) {
      throw unauthorized(
        `Unauthorized: ${e instanceof Error ? e.message : "invalid token"}`,
        challenge,
        "invalid_token"
      );
    }

    validateClaims(
      payload,
      { issuer: opts.issuer, audience, requiredScopes: opts.requiredScopes },
      challenge
    );

    if (opts.validate) {
      const ok = await opts.validate(payload);
      if (!ok) {
        throw unauthorized(
          "Unauthorized: custom validation failed",
          challenge,
          "invalid_token"
        );
      }
    }

    (ctx as Record<string, unknown>)[ctxKey] = payload;
    return next();
  });

  return attachProtectedResource(app, prm);
}

// ── OAuth 2.1 discovery ───────────────────────

export interface OAuthOptions {
  /**
   * Expected audience in the JWT.
   * Defaults to `resource` when set.
   */
  audience?: string | string[];
  /**
   * Authorization servers advertised in Protected Resource Metadata.
   * Defaults to `[issuer]`.
   */
  authorizationServers?: string[];
  /**
   * Key to store the verified payload on ctx.
   * @default "oauthPayload"
   */
  ctxKey?: string;
  /**
   * How long to cache the discovered JWKS URI in ms.
   * @default 3_600_000 (1 hour)
   */
  discoveryTtl?: number;
  /**
   * The issuer URL of the authorization server.
   * Used to construct the discovery URL and validate the `iss` claim.
   *
   * @example "https://auth.example.com"
   */
  issuer: string;
  /**
   * When true, requests without an Authorization header pass through.
   * @default false
   */
  optional?: boolean;
  /**
   * Absolute MCP resource URL (RFC 8707 / RFC 9728).
   * Required for Claude / MCP OAuth discovery (PRM + 401 challenges).
   *
   * @example "https://mcp.example.com/mcp"
   */
  resource?: string;
  /**
   * Required scopes. All must be present.
   */
  requiredScopes?: string[];
  /** Scopes advertised in PRM / challenges. Defaults to `requiredScopes`. */
  scopesSupported?: string[];
}

interface DiscoveryDoc {
  issuer: string;
  jwks_uri: string;
  [key: string]: unknown;
}

const discoveryCache = new Map<
  string,
  { doc: DiscoveryDoc; expiresAt: number }
>();

async function fetchDiscovery(
  issuer: string,
  ttl: number
): Promise<DiscoveryDoc> {
  const cached = discoveryCache.get(issuer);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.doc;
  }

  const base = issuer.replace(/\/$/, "");
  const candidates = [
    `${base}/.well-known/oauth-authorization-server`,
    `${base}/.well-known/openid-configuration`,
  ];

  let lastError: Error | undefined;
  for (const discoveryUrl of candidates) {
    try {
      const resp = await fetch(discoveryUrl);
      if (!resp.ok) {
        lastError = new Error(
          `OAuth discovery failed at ${discoveryUrl}: ${resp.status}`
        );
        continue;
      }
      const doc = (await resp.json()) as DiscoveryDoc;
      if (!doc.jwks_uri) {
        lastError = new Error(
          `Discovery document at ${discoveryUrl} is missing jwks_uri`
        );
        continue;
      }
      // Some OIDC issuers append a trailing slash; accept either form.
      const docIssuer = String(doc.issuer ?? "").replace(/\/$/, "");
      const expected = base;
      if (docIssuer && docIssuer !== expected) {
        lastError = new Error(
          `Discovery issuer mismatch: ${doc.issuer} !== ${issuer}`
        );
        continue;
      }
      discoveryCache.set(issuer, { doc, expiresAt: Date.now() + ttl });
      return doc;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }

  throw lastError ?? new Error(`OAuth discovery failed for ${issuer}`);
}

/**
 * Validate Bearer tokens via OAuth 2.1 — discovers the authorization server
 * metadata (OAuth AS or OpenID), verifies JWTs via JWKS, and (when `resource`
 * is set) serves Protected Resource Metadata + HTTP 401/403 challenges for
 * MCP clients such as Claude.
 *
 * @example
 * app.use(
 *   oauth({
 *     issuer: "https://auth.example.com",
 *     resource: "https://mcp.example.com/mcp",
 *     requiredScopes: ["mcp:tools"],
 *   })
 * );
 */
export function oauth(opts: OAuthOptions): Redop {
  const ttl = opts.discoveryTtl ?? 3_600_000;
  const ctxKey = opts.ctxKey ?? "oauthPayload";
  const prm = protectedResourceFromAuthOpts(opts);
  const audience = opts.audience ?? opts.resource;

  const app = middleware(async ({ request, ctx, next }) => {
    if (request.transport !== "http") {
      return next();
    }

    const challenge = resolveChallengeContext(
      request.url || request.raw?.url,
      prm,
      opts.scopesSupported ?? opts.requiredScopes
    );

    const authHeader = request.headers["authorization"] ?? "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : "";
    if (!token) {
      if (opts.optional) {
        return next();
      }
      throw unauthorized("Unauthorized: missing Bearer token", challenge);
    }

    try {
      const doc = await fetchDiscovery(opts.issuer, ttl);
      const payload = await verifyJwksJwt(token, doc.jwks_uri, ttl);

      validateClaims(
        payload,
        {
          issuer: opts.issuer,
          audience,
          requiredScopes: opts.requiredScopes,
        },
        challenge
      );

      (ctx as Record<string, unknown>)[ctxKey] = payload;
      return next();
    } catch (e) {
      if (e instanceof HttpAuthError) {
        throw e;
      }
      throw unauthorized(
        `Unauthorized: ${e instanceof Error ? e.message : "invalid token"}`,
        challenge,
        "invalid_token"
      );
    }
  });

  return attachProtectedResource(app, prm);
}

// ── Scope guard helper ────────────────────────

/**
 * Throw if the request context is missing any of the required scopes.
 * Use inside a tool handler after jwt() or oauth() has run.
 *
 * Throws `HttpAuthError` (403 insufficient_scope) so MCP clients can step up.
 *
 * @example
 * app.tool("delete_user", {
 *   handler: ({ ctx }) => {
 *     requireScopes(ctx, ["admin:write"]);
 *     return deleteUser();
 *   },
 * });
 */
export function requireScopes(
  ctx: Record<string, unknown>,
  scopes: string[],
  payloadKey = "jwtPayload"
): void {
  const payload = ctx[payloadKey] as JwtPayload | undefined;
  if (!payload) {
    throw unauthorized("Unauthorized: no auth payload on context", {
      scope: scopes.join(" "),
    });
  }
  const granted = (payload.scope ?? "").split(" ");
  for (const s of scopes) {
    if (!granted.includes(s)) {
      throw insufficientScope(`Forbidden: missing scope '${s}'`, {}, scopes);
    }
  }
}
