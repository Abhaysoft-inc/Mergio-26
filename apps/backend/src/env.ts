import { createPrivateKey } from "node:crypto";

export const env = {
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: (process.env.CORS_ORIGIN ?? "http://localhost:3001")
    .split(",")
    .map((origin) => origin.trim()),
  isProduction: process.env.NODE_ENV === "production",
  // The GitHub sync worker runs in the API process unless this is "false" (e.g. to run it as its
  // own process with `pnpm --filter backend worker`).
  runWorker: process.env.RUN_WORKER !== "false",
  workerConcurrency: Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 4)),
  github: {
    appId: process.env.GITHUB_APP_ID ?? "",
    // The PEM key; "\n" escapes are allowed so it fits on one line in .env files.
    privateKey: (process.env.GITHUB_APP_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
  },
};

let keyValid: boolean | null = null;

/**
 * The App ID is set and the private key is a real PEM key. A common mistake is pasting the key's
 * SHA256 fingerprint from GitHub's settings page; that counts as not configured, so jobs wait
 * instead of burning their retries.
 */
export const githubAppConfigured = () => {
  if (!env.github.appId || !env.github.privateKey) return false;
  if (keyValid === null) {
    try {
      createPrivateKey(env.github.privateKey);
      keyValid = true;
    } catch {
      keyValid = false;
      console.error("GITHUB_APP_PRIVATE_KEY isn't a valid PEM private key (is it the fingerprint?).");
    }
  }
  return keyValid;
};
