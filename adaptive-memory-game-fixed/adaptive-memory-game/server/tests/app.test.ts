// @vitest-environment node
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import type { LlmGenerate } from '../llm';
import { loadConfig, type ServerConfig } from '../config';

let server: Server | undefined;
afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

const baseConfig = (over: Partial<ServerConfig> = {}): ServerConfig => ({
  ...loadConfig({}),
  geminiApiKey: 'test-key-not-real',
  rateLimitMax: 100,
  llmTimeoutMs: 200,
  ...over,
});

async function start(config: ServerConfig, generate?: LlmGenerate) {
  const app = createApp(config, generate);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  return { base };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('CORS, health and routing', () => {
  it('allows only exactly listed origins', async () => {
    const { base } = await start(baseConfig({ allowedOrigins: ['https://game.example'] }));
    const ok = await fetch(`${base}/api/health`, { headers: { Origin: 'https://game.example' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://game.example');
    const bad = await fetch(`${base}/api/health`, { headers: { Origin: 'https://evil.example' } });
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('answers preflight requests for session routes', async () => {
    const { base } = await start(baseConfig({ allowedOrigins: ['https://game.example'] }));
    const res = await fetch(`${base}/api/sessions`, { method: 'OPTIONS', headers: { Origin: 'https://game.example' } });
    expect(res.status).toBe(204);
  });

  it('health reports only whether AI is configured, never the key', async () => {
    const { base } = await start(baseConfig());
    const body = await (await fetch(`${base}/api/health`)).text();
    expect(JSON.parse(body)).toEqual({ ok: true, aiConfigured: true });
    expect(body).not.toContain('test-key-not-real');
  });

  it('returns JSON 404 for unknown routes (including removed /api/coach)', async () => {
    const { base } = await start(baseConfig());
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    // The /api/coach route has been removed
    expect((await fetch(`${base}/api/coach`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(404);
  });
});

describe('loadConfig', () => {
  it('uses safe defaults and treats a blank key as unconfigured', () => {
    const c = loadConfig({ GEMINI_API_KEY: '   ' });
    expect(c.geminiApiKey).toBeUndefined();
    expect(c.port).toBe(8787);
    expect(c.llmTimeoutMs).toBe(15_000);
    expect(c.allowedOrigins).toEqual([]);
  });

  it('parses overrides and ignores invalid numbers', () => {
    const c = loadConfig({ PORT: 'abc', RATE_LIMIT_MAX: '3', ALLOWED_ORIGINS: 'https://a.test, https://b.test' });
    expect(c.port).toBe(8787);
    expect(c.rateLimitMax).toBe(3);
    expect(c.allowedOrigins).toEqual(['https://a.test', 'https://b.test']);
  });
});

describe('session and round evaluation routes', () => {
  it('creates a session and returns a valid ID', async () => {
    const { base } = await start(baseConfig());
    const res = await fetch(`${base}/api/sessions`, { method: 'POST' });
    expect(res.status).toBe(201);
    const body = await res.json() as { sessionId: string };
    expect(body.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects a round submission when not configured (503)', async () => {
    const { base } = await start(baseConfig({ geminiApiKey: undefined }));
    const session = await (await fetch(`${base}/api/sessions`, { method: 'POST' })).json() as { sessionId: string };
    const res = await fetch(`${base}/api/sessions/${session.sessionId}/rounds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        difficulty: 'easy', gridColumns: 4, gridRows: 4, pairCount: 8, completedPairs: 8,
        moves: 12, mismatches: 4, elapsedSeconds: 40, clientRoundId: 'round-aaaa1111', completed: true,
      }),
    });
    expect(res.status).toBe(503);
    expect((await res.json() as { error: string }).error).toBe('not_configured');
  });

  it('returns the Gemini decision for a valid round submission', async () => {
    const goodDecision = JSON.stringify({
      nextDifficulty: 'medium',
      reason: 'The player completed the round efficiently and is ready for more.',
      metricsSummary: { moves: 12, elapsedActiveSeconds: 40, completedPairs: 8 },
    });
    const generate: LlmGenerate = async () => goodDecision;
    const { base } = await start(baseConfig(), generate);
    const session = await (await fetch(`${base}/api/sessions`, { method: 'POST' })).json() as { sessionId: string };
    const res = await fetch(`${base}/api/sessions/${session.sessionId}/rounds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        difficulty: 'easy', gridColumns: 4, gridRows: 4, pairCount: 8, completedPairs: 8,
        moves: 12, mismatches: 4, elapsedSeconds: 40, clientRoundId: 'round-aaaa1111', completed: true,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { round: { decision: { nextDifficulty: string } } };
    expect(body.round.decision.nextDifficulty).toBe('medium');
  });
});
