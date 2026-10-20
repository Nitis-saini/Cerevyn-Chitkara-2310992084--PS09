import { DIFFICULTY_CONFIG } from '../config/gameConfig';
import type {
  Difficulty,
  EvaluationFailureReason,
  EvaluationResult,
  PerformanceBand,
  PerformanceRating,
  RoundDecision,
  RoundSubmission,
  StoredRound,
} from '../types/game';



export type Unavailable = { status: 'unavailable'; reason: EvaluationFailureReason; message: string };
export type SessionResult = { status: 'ok'; sessionId: string } | Unavailable;
export type HistoryResult = { status: 'ok'; rounds: StoredRound[] } | Unavailable;
export type DeleteResult = { status: 'ok' } | Unavailable;

export interface RoundEvaluator {
  createSession(signal?: AbortSignal): Promise<SessionResult>;
  /** Evaluates a finished round with Gemini; resolves 'ok' only for a validated, stored decision. */
  submitRound(sessionId: string, round: RoundSubmission, signal?: AbortSignal): Promise<EvaluationResult>;
  /** Asks the server for the documented rule-based fallback (never labelled as Gemini). */
  useFallback(sessionId: string, clientRoundId: string, signal?: AbortSignal): Promise<EvaluationResult>;
  fetchHistory(sessionId: string, signal?: AbortSignal): Promise<HistoryResult>;
  deleteSession(sessionId: string, signal?: AbortSignal): Promise<DeleteResult>;
}
export const ROUND_API_CONFIG = {
  // Empty = same origin. In dev Vite proxies /api to the Express server (port 8787).
  baseUrl: (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '',
  timeoutMs: 25_000,
} as const;

const MESSAGES: Record<EvaluationFailureReason, string> = {
  not_configured: 'Gemini is not configured on the server.',
  timeout: 'Gemini took too long to evaluate your round.',
  network: 'The evaluation service could not be reached.',
  rate_limited: 'Too many requests. Please wait a moment and retry.',
  invalid_response: 'Gemini returned a decision that could not be used.',
  service_error: 'The evaluation service is temporarily unavailable.',
  invalid_request: 'The round could not be submitted.',
  session_not_found: 'The saved session was not found on the server.',
  round_not_found: 'The round was not found on the server.',
  round_conflict: 'This round was already submitted with different results.',
  persistence_error: 'The round result could not be saved on the server.',
};

const REASONS = Object.keys(MESSAGES) as EvaluationFailureReason[];
const unavailable = (reason: EvaluationFailureReason): Unavailable => ({
  status: 'unavailable',
  reason,
  message: MESSAGES[reason],
});

// ---- Validation of server output ----------------------------------------------------------

const isDifficulty = (v: unknown): v is Difficulty =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(DIFFICULTY_CONFIG, v);
const isInt = (v: unknown, min = 0): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min;
const isBand = (v: unknown): v is PerformanceBand => v === 'strong' || v === 'mixed' || v === 'weak';
const isRating = (v: unknown): v is PerformanceRating =>
  v === 'strong' || v === 'good' || v === 'mixed' || v === 'weak';

function parseDecision(value: unknown): RoundDecision | null {
  if (typeof value !== 'object' || value === null) return null;
  const d = value as Record<string, unknown>;
  const source = d.source;
  if (source !== 'gemini' && source !== 'rules_fallback') return null;
  if (!isDifficulty(d.nextDifficulty)) return null;
  if (d.performance !== null && !isRating(d.performance)) return null;
  if (typeof d.reason !== 'string' || d.reason.trim().length === 0 || d.reason.length > 1000) return null;
  return { nextDifficulty: d.nextDifficulty, source, performance: d.performance, reason: d.reason };
}

/** Returns a StoredRound only if every field has the expected type and value. */
export function parseStoredRound(value: unknown): StoredRound | null {
  if (typeof value !== 'object' || value === null) return null;
  const r = value as Record<string, unknown>;
  if (
    typeof r.sessionId !== 'string' ||
    typeof r.clientRoundId !== 'string' ||
    !isInt(r.roundNumber, 1) ||
    !isDifficulty(r.difficulty) ||
    !isInt(r.gridColumns, 1) ||
    !isInt(r.gridRows, 1) ||
    !isInt(r.pairCount, 1) ||
    !isInt(r.completedPairs) ||
    !isInt(r.moves) ||
    !isInt(r.mismatches) ||
    !isInt(r.elapsedSeconds) ||
    typeof r.completed !== 'boolean' ||
    !isBand(r.policyBand) ||
    typeof r.createdAt !== 'string' ||
    Number.isNaN(Date.parse(r.createdAt))
  ) {
    return null;
  }
  const status = r.decisionStatus;
  if (status !== 'pending' && status !== 'decided' && status !== 'failed') return null;
  const decision = r.decision === null || r.decision === undefined ? null : parseDecision(r.decision);
  if (r.decision !== null && r.decision !== undefined && decision === null) return null;
  if ((status === 'decided') !== (decision !== null)) return null;

  return {
    sessionId: r.sessionId,
    roundNumber: r.roundNumber,
    clientRoundId: r.clientRoundId,
    difficulty: r.difficulty,
    gridColumns: r.gridColumns,
    gridRows: r.gridRows,
    pairCount: r.pairCount,
    completedPairs: r.completedPairs,
    moves: r.moves,
    mismatches: r.mismatches,
    elapsedSeconds: r.elapsedSeconds,
    completed: r.completed,
    policyBand: r.policyBand,
    decisionStatus: status,
    decision,
    failureCode: typeof r.failureCode === 'string' ? r.failureCode : null,
    model: typeof r.model === 'string' ? r.model : null,
    createdAt: r.createdAt,
    decidedAt: typeof r.decidedAt === 'string' ? r.decidedAt : null,
  };
}

// ---- Transport ----------------------------------------------------------------------------

interface Options {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

type Reply = { ok: true; status: number; json: unknown } | { ok: false; failure: Unavailable };

function reasonFor(status: number, body: unknown): EvaluationFailureReason {
  const code = (body as { error?: unknown } | null)?.error;
  if (typeof code === 'string' && (REASONS as string[]).includes(code)) return code as EvaluationFailureReason;
  if (status === 429) return 'rate_limited';
  if (status === 503) return 'not_configured';
  if (status === 504) return 'timeout';
  if (status === 404) return 'session_not_found';
  if (status === 400) return 'invalid_request';
  return 'service_error';
}

async function call(
  path: string,
  init: { method: string; body?: unknown },
  signal: AbortSignal | undefined,
  options: Options,
): Promise<Reply> {
  const baseUrl = options.baseUrl ?? ROUND_API_CONFIG.baseUrl;
  const timeoutMs = options.timeoutMs ?? ROUND_API_CONFIG.timeoutMs;
  const doFetch = options.fetchImpl ?? fetch;

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onCallerAbort = () => controller.abort();
  signal?.addEventListener('abort', onCallerAbort);
  if (signal?.aborted) controller.abort();

  try {
    const res = await doFetch(`${baseUrl}${path}`, {
      method: init.method,
      headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
    let json: unknown = null;
    if (res.status !== 204) {
      try {
        json = await res.json();
      } catch {
        json = null;
      }
    }
    if (!res.ok) return { ok: false, failure: unavailable(reasonFor(res.status, json)) };
    return { ok: true, status: res.status, json };
  } catch {
    return { ok: false, failure: unavailable(timedOut ? 'timeout' : 'network') };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCallerAbort);
  }
}

const seg = (id: string) => encodeURIComponent(id);

function toEvaluation(reply: Reply): EvaluationResult {
  if (!reply.ok) return reply.failure;
  const round = parseStoredRound((reply.json as { round?: unknown } | null)?.round);
  // A decision is only usable if it is complete, validated and marked as stored by the server.
  if (!round || round.decisionStatus !== 'decided' || round.decision === null) {
    return unavailable('invalid_response');
  }
  return { status: 'ok', round };
}

export function createHttpRoundEvaluator(options: Options = {}): RoundEvaluator {
  return {
    async createSession(signal) {
      const reply = await call('/api/sessions', { method: 'POST' }, signal, options);
      if (!reply.ok) return reply.failure;
      const id = (reply.json as { sessionId?: unknown } | null)?.sessionId;
      return typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id)
        ? { status: 'ok', sessionId: id }
        : unavailable('invalid_response');
    },
    async submitRound(sessionId, round, signal) {
      return toEvaluation(
        await call(`/api/sessions/${seg(sessionId)}/rounds`, { method: 'POST', body: round }, signal, options),
      );
    },
    async useFallback(sessionId, clientRoundId, signal) {
      return toEvaluation(
        await call(
          `/api/sessions/${seg(sessionId)}/rounds/${seg(clientRoundId)}/fallback`,
          { method: 'POST' },
          signal,
          options,
        ),
      );
    },
    async fetchHistory(sessionId, signal) {
      const reply = await call(`/api/sessions/${seg(sessionId)}/history`, { method: 'GET' }, signal, options);
      if (!reply.ok) return reply.failure;
      const raw = (reply.json as { rounds?: unknown } | null)?.rounds;
      if (!Array.isArray(raw)) return unavailable('invalid_response');
      const rounds = raw.map(parseStoredRound).filter((r): r is StoredRound => r !== null);
      return { status: 'ok', rounds };
    },
    async deleteSession(sessionId, signal) {
      const reply = await call(`/api/sessions/${seg(sessionId)}`, { method: 'DELETE' }, signal, options);
      return reply.ok ? { status: 'ok' } : reply.failure;
    },
  };
}
