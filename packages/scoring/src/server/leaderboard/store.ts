import { Redis as UpstashRedis } from "@upstash/redis";
import IORedis from "ioredis";

// The leaderboard cache's connection to Redis, behind the few operations it needs, so the same
// code runs on Upstash's REST API (Vercel functions, where a TCP connection doesn't survive between
// invocations) and over a TLS connection (the worker, local Redis).
//
//   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN  REST (the web app on Vercel)
//   REDIS_URL                                          TCP; rediss:// for Upstash over TLS
//
// With neither set there is no cache and the leaderboards are computed in Postgres on each read.

export interface Kv {
  /** Runs a Lua script. Results come back raw: strings stay strings. */
  eval<T>(script: string, keys: string[], args: (string | number)[]): Promise<T>;
  del(keys: string[]): Promise<void>;
  /** SET key value NX PX ttl; true when this call set it. */
  setNx(key: string, value: string, ttlMs: number): Promise<boolean>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  /** Adds members with score 0. */
  zaddZero(key: string, members: string[]): Promise<void>;
  hset(key: string, values: Record<string, string>): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  expire(key: string, seconds: number): Promise<void>;
}

function upstash(url: string, token: string): Kv {
  const redis = new UpstashRedis({
    url,
    token,
    automaticDeserialization: false,
    enableTelemetry: false,
  });
  return {
    eval: (script, keys, args) => redis.eval(script, keys, args.map(String)),
    del: async (keys) => {
      if (keys.length) await redis.del(...keys);
    },
    setNx: async (key, value, ttlMs) => (await redis.set(key, value, { nx: true, px: ttlMs })) === "OK",
    set: async (key, value, ttlSeconds) => {
      await (ttlSeconds ? redis.set(key, value, { ex: ttlSeconds }) : redis.set(key, value));
    },
    zaddZero: async (key, members) => {
      if (members.length === 0) return;
      const [first, ...rest] = members.map((member) => ({ score: 0, member }));
      await redis.zadd(key, first!, ...rest);
    },
    hset: async (key, values) => {
      if (Object.keys(values).length) await redis.hset(key, values);
    },
    rename: async (from, to) => {
      await redis.rename(from, to);
    },
    expire: async (key, seconds) => {
      await redis.expire(key, seconds);
    },
  };
}

function tcp(url: string): Kv {
  const redis = new IORedis(url, {
    // Fail fast instead of queueing forever: callers fall back to Postgres.
    maxRetriesPerRequest: 2,
    connectTimeout: 5_000,
    enableOfflineQueue: true,
  });
  redis.on("error", (error) => console.error("Redis:", error.message));
  return {
    eval: async (script, keys, args) =>
      (await redis.eval(script, keys.length, ...keys, ...args.map(String))) as never,
    del: async (keys) => {
      if (keys.length) await redis.del(...keys);
    },
    setNx: async (key, value, ttlMs) => (await redis.set(key, value, "PX", ttlMs, "NX")) === "OK",
    set: async (key, value, ttlSeconds) => {
      await (ttlSeconds ? redis.set(key, value, "EX", ttlSeconds) : redis.set(key, value));
    },
    zaddZero: async (key, members) => {
      if (members.length) await redis.zadd(key, ...members.flatMap((member) => [0, member]));
    },
    hset: async (key, values) => {
      if (Object.keys(values).length) await redis.hset(key, values);
    },
    rename: async (from, to) => {
      await redis.rename(from, to);
    },
    expire: async (key, seconds) => {
      await redis.expire(key, seconds);
    },
  };
}

const cache = globalThis as unknown as { __mergioKv?: Kv | null };

/** The shared connection, or null when no Redis is configured. */
export function kv(): Kv | null {
  if (cache.__mergioKv !== undefined) return cache.__mergioKv;
  const restUrl = process.env.UPSTASH_REDIS_REST_URL;
  const restToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const url = process.env.REDIS_URL;
  cache.__mergioKv = restUrl && restToken ? upstash(restUrl, restToken) : url ? tcp(url) : null;
  return cache.__mergioKv;
}
