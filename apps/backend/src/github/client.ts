import { createPrivateKey, sign } from "node:crypto";
import { env, githubAppConfigured } from "../env";

// A small GitHub App client: app JWTs, cached installation tokens, REST and GraphQL calls.
// GitHub's rate limits become RateLimitError so the job queue can wait instead of failing.

const API = "https://api.github.com";
const USER_AGENT = "mergio-sync-worker";

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class RateLimitError extends Error {
  constructor(readonly resetAt: Date) {
    super(`GitHub rate limit reached; resets at ${resetAt.toISOString()}`);
  }
}

export class NotConfiguredError extends Error {
  constructor() {
    super("The GitHub App isn't configured: set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY.");
  }
}

const base64url = (value: Buffer | string) => Buffer.from(value).toString("base64url");

let cachedKey: ReturnType<typeof createPrivateKey> | null = null;

/** A JWT that authenticates as the app itself (valid for 9 minutes). */
export function appJwt(now = Date.now()) {
  if (!githubAppConfigured()) throw new NotConfiguredError();
  cachedKey ??= createPrivateKey(env.github.privateKey);
  const seconds = Math.floor(now / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  // iat is backdated a minute to allow for clock drift, as GitHub recommends.
  const payload = base64url(
    JSON.stringify({ iat: seconds - 60, exp: seconds + 540, iss: env.github.appId }),
  );
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), cachedKey);
  return `${header}.${payload}.${base64url(signature)}`;
}

function checkRateLimit(response: Response) {
  if (response.status !== 403 && response.status !== 429) return;
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) throw new RateLimitError(new Date(Date.now() + Number(retryAfter) * 1000));
  if (response.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(response.headers.get("x-ratelimit-reset") ?? 0) * 1000;
    throw new RateLimitError(new Date(Math.max(reset, Date.now() + 60_000)));
  }
}

async function call(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(path.startsWith("http") ? path : `${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": USER_AGENT,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  checkRateLimit(response);
  return response;
}

const tokens = new Map<string, { token: string; expiresAt: number }>();

/** An installation access token, reused until five minutes before it expires. */
export async function installationToken(installationId: bigint) {
  const key = installationId.toString();
  const cached = tokens.get(key);
  if (cached && cached.expiresAt - Date.now() > 5 * 60_000) return cached.token;
  const response = await call(`/app/installations/${key}/access_tokens`, appJwt(), {
    method: "POST",
  });
  if (!response.ok) {
    throw new GitHubError(`Couldn't get a token for installation ${key}`, response.status);
  }
  const data = (await response.json()) as { token: string; expires_at: string };
  tokens.set(key, { token: data.token, expiresAt: Date.parse(data.expires_at) });
  return data.token;
}

/** The installation that covers a repo, or null when the app isn't installed on it. */
export async function repoInstallationId(owner: string, name: string) {
  const response = await call(`/repos/${owner}/${name}/installation`, appJwt());
  if (response.status === 404) return null;
  if (!response.ok) throw new GitHubError(`Installation lookup failed for ${owner}/${name}`, response.status);
  return BigInt(((await response.json()) as { id: number }).id);
}

/** A REST GET. Returns null on 404 and 410 (gone), throws on other errors. */
export async function restGet<T>(path: string, token: string): Promise<T | null> {
  const response = await call(path, token);
  if (response.status === 404 || response.status === 410) return null;
  if (!response.ok) throw new GitHubError(`GET ${path} answered ${response.status}`, response.status);
  return (await response.json()) as T;
}

/** Every page of a list endpoint, following Link headers, until `stop` says enough. */
export async function restList<T>(
  path: string,
  token: string,
  options: { maxPages?: number; stop?: (page: T[]) => boolean; pick?: (body: unknown) => T[] } = {},
): Promise<T[]> {
  const items: T[] = [];
  let url: string | null = path;
  for (let page = 0; url && page < (options.maxPages ?? 20); page++) {
    const response = await call(url, token);
    if (response.status === 404) break;
    if (!response.ok) throw new GitHubError(`GET ${url} answered ${response.status}`, response.status);
    const body: unknown = await response.json();
    const batch = options.pick ? options.pick(body) : (body as T[]);
    items.push(...batch);
    if (options.stop?.(batch)) break;
    url = /<([^>]+)>;\s*rel="next"/.exec(response.headers.get("link") ?? "")?.[1] ?? null;
  }
  return items;
}

export async function restPost(path: string, token: string, body: unknown) {
  const response = await call(path, token, { method: "POST", body: JSON.stringify(body) });
  return response;
}

/** A GraphQL query. GraphQL errors (other than NOT_FOUND) throw. */
export async function graphql<T>(query: string, variables: Record<string, unknown>, token: string) {
  const response = await call("/graphql", token, {
    method: "POST",
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new GitHubError(`GraphQL answered ${response.status}`, response.status);
  const body = (await response.json()) as {
    data?: T;
    errors?: { type?: string; message: string }[];
  };
  const errors = body.errors?.filter((error) => error.type !== "NOT_FOUND") ?? [];
  if (errors.some((error) => error.type === "RATE_LIMITED")) {
    throw new RateLimitError(new Date(Date.now() + 5 * 60_000));
  }
  if (errors.length > 0) throw new GitHubError(errors.map((error) => error.message).join("; "), 200);
  return body.data ?? null;
}
