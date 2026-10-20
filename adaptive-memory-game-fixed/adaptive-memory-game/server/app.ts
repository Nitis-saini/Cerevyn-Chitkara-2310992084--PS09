import express, { type ErrorRequestHandler, type Express, type NextFunction, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { createGeminiGenerate, type LlmGenerate } from './llm';
import type { ServerConfig } from './config';
import { openStore, type RoundStore } from './db';
import { RoundsService, type ApiResult } from './rounds';

const RATE_LIMITED_MESSAGE = 'Too many requests. Try again shortly.';

function send(res: Response, result: ApiResult): void {
  res.status(result.status);
  if (result.body === undefined) res.end();
  else res.json(result.body);
}

/**
 * @param generate optional model double (tests). Defaults to the real Gemini client.
 * @param store optional database (tests). By default the SQLite file from the config is opened
 *   lazily on the first session request.
 */
export function createApp(config: ServerConfig, generate?: LlmGenerate, store?: RoundStore): Express {
  const app = express();
  const llm = generate ?? createGeminiGenerate(config);
  let openedStore: RoundStore | undefined = store;
  let service: RoundsService | undefined;
  const rounds = (): RoundsService => {
    openedStore ??= openStore(config.databasePath);
    service ??= new RoundsService({
      store: openedStore,
      generate: llm,
      timeoutMs: config.llmTimeoutMs,
      configured: Boolean(config.geminiApiKey) || generate !== undefined,
      model: config.geminiModel,
    });
    return service;
  };
  app.locals.closeStore = () => openedStore?.close();

  app.disable('x-powered-by');
  if (config.trustProxy !== undefined) {
    app.set('trust proxy', /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy);
  }

  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // Exact-match CORS allow-list. No wildcard, no credentials.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && config.allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.get('/api/health', (_req, res) => {
    // Reports only whether a key exists, never the key or the model account.
    res.json({ ok: true, aiConfigured: Boolean(config.geminiApiKey) });
  });

  const makeLimiter = (limit: number) =>
    rateLimit({
      windowMs: config.rateLimitWindowMs,
      limit,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: (_req, res) => {
        res.status(429).json({ error: 'rate_limited', message: RATE_LIMITED_MESSAGE });
      },
    });
  // Routes that call the model share one budget; cheap database routes get a larger one.
  const modelLimiter = makeLimiter(config.rateLimitMax);
  const dataLimiter = makeLimiter(config.rateLimitMax * 6);

  // --- Anonymous sessions, Gemini-evaluated rounds and persisted history -------------------
  app.post('/api/sessions', dataLimiter, (_req, res) => send(res, rounds().createSession()));

  app.post(
    '/api/sessions/:sessionId/rounds',
    modelLimiter,
    express.json({ limit: '4kb', type: 'application/json' }),
    async (req, res) => send(res, await rounds().submitRound(String(req.params.sessionId), req.body)),
  );

  app.post('/api/sessions/:sessionId/rounds/:clientRoundId/fallback', dataLimiter, (req, res) =>
    send(res, rounds().useFallback(String(req.params.sessionId), String(req.params.clientRoundId))),
  );

  app.get('/api/sessions/:sessionId/history', dataLimiter, (req, res) =>
    send(res, rounds().getHistory(String(req.params.sessionId))),
  );

  app.delete('/api/sessions/:sessionId', dataLimiter, (req, res) =>
    send(res, rounds().deleteSession(String(req.params.sessionId))),
  );

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found', message: 'Not found' });
  });

  const onError: ErrorRequestHandler = (err, _req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const type = (err as { type?: string }).type;
    if (type === 'entity.too.large') {
      res.status(413).json({ error: 'payload_too_large', message: 'Request body is too large.' });
    } else if (type === 'entity.parse.failed' || type === 'charset.unsupported' || type === 'encoding.unsupported') {
      res.status(400).json({ error: 'invalid_request', message: 'Request body is not valid JSON.' });
    } else {
      console.warn('[server] unexpected error');
      res.status(500).json({ error: 'server_error', message: 'Unexpected server error.' });
    }
  };
  app.use(onError);

  return app;
}
