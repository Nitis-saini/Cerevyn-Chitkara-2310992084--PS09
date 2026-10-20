/** Server configuration, read from environment variables. Secrets never leave the server. */
export interface ServerConfig {
  port: number;
  /** Gemini API key. Undefined means the coach runs in explicit "not configured" mode. */
  geminiApiKey: string | undefined;
  geminiModel: string;
  /** Hard limit for one LLM call. */
  llmTimeoutMs: number;
  rateLimitWindowMs: number;
  rateLimitMax: number;
  /** Exact browser origins allowed to call the API cross-origin. Empty = same-origin only. */
  allowedOrigins: string[];
  /** Passed to Express `trust proxy` (e.g. "1" behind Azure). */
  trustProxy: string | undefined;
  /** SQLite file for anonymous sessions and rounds. ':memory:' gives a throw-away database. */
  databasePath: string;
}

const int = (v: string | undefined, fallback: number) => {
  const n = v === undefined || v.trim() === '' ? NaN : Number(v);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    port: int(env.PORT, 8787),
    geminiApiKey: env.GEMINI_API_KEY?.trim() || undefined,
    // Check https://ai.google.dev/gemini-api/docs/models for the model your key can use.
    geminiModel: env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite',
    llmTimeoutMs: int(env.LLM_TIMEOUT_MS, 15_000),
    rateLimitWindowMs: int(env.RATE_LIMIT_WINDOW_MS, 60_000),
    rateLimitMax: int(env.RATE_LIMIT_MAX, 10),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    trustProxy: env.TRUST_PROXY?.trim() || undefined,
    databasePath: env.DATABASE_PATH?.trim() || 'data/memory-game.sqlite',
  };
}
