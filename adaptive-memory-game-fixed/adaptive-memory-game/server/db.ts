import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  RoundStats,
  Difficulty,
  PerformanceBand,
  PerformanceRating,
  RoundDecision,
  RoundDecisionStatus,
  StoredRound,
} from '../src/types/game';

/**
 * Persistent, anonymous storage for sessions and finished rounds (SQLite via Node's built-in
 * `node:sqlite`, so there is no native dependency to compile). No names, e-mail addresses or
 * accounts exist anywhere: a session is a random ID issued by the server.
 *
 * Every statement is prepared with `?` placeholders; no value is ever concatenated into SQL.
 */

/** Upper bound per session so one anonymous ID cannot grow the database without limit. */
export const MAX_ROUNDS_PER_SESSION = 1000;

export class StoreError extends Error {
  constructor(
    readonly code: 'round_limit' | 'session_missing',
    message: string,
  ) {
    super(message);
  }
}

export interface NewRound extends RoundStats {
  clientRoundId: string;
  policyBand: PerformanceBand;
}

export interface DecisionRecord {
  nextDifficulty: Difficulty;
  source: RoundDecision['source'];
  performance: PerformanceRating | null;
  reason: string;
  model: string | null;
}

export interface RoundStore {
  createSession(sessionId: string): void;
  sessionExists(sessionId: string): boolean;
  /** Deletes the session and all of its rounds. Returns false when it did not exist. */
  deleteSession(sessionId: string): boolean;
  getRound(sessionId: string, clientRoundId: string): StoredRound | null;
  /** Rounds of one session, oldest first. */
  listRounds(sessionId: string, limit?: number): StoredRound[];
  /** Inserts a round as 'pending' and assigns the next round number for the session. */
  insertRound(sessionId: string, round: NewRound): StoredRound;
  /** Stores a validated decision. A round that is already 'decided' is never overwritten. */
  recordDecision(sessionId: string, clientRoundId: string, decision: DecisionRecord): StoredRound | null;
  markFailed(sessionId: string, clientRoundId: string, failureCode: string): StoredRound | null;
  close(): void;
}

const SCHEMA_VERSION = 1;

const DIFFICULTIES = `('easy','medium','hard')`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rounds (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id       TEXT    NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  round_number     INTEGER NOT NULL,
  client_round_id  TEXT    NOT NULL,
  difficulty       TEXT    NOT NULL CHECK (difficulty IN ${DIFFICULTIES}),
  grid_columns     INTEGER NOT NULL,
  grid_rows        INTEGER NOT NULL,
  pair_count       INTEGER NOT NULL,
  moves            INTEGER NOT NULL CHECK (moves >= 0),
  completed_pairs  INTEGER NOT NULL CHECK (completed_pairs >= 0),
  mismatches       INTEGER NOT NULL CHECK (mismatches >= 0),
  elapsed_seconds  INTEGER NOT NULL CHECK (elapsed_seconds >= 0),
  completed        INTEGER NOT NULL CHECK (completed IN (0, 1)),
  policy_band      TEXT    NOT NULL CHECK (policy_band IN ('strong','mixed','weak')),
  decision_status  TEXT    NOT NULL CHECK (decision_status IN ('pending','decided','failed')),
  decision_source  TEXT    CHECK (decision_source IN ('gemini','rules_fallback')),
  next_difficulty  TEXT    CHECK (next_difficulty IN ${DIFFICULTIES}),
  performance      TEXT    CHECK (performance IN ('strong','good','mixed','weak')),
  reason           TEXT,
  failure_code     TEXT,
  model            TEXT,
  created_at       TEXT    NOT NULL,
  decided_at       TEXT,
  UNIQUE (session_id, round_number),
  UNIQUE (session_id, client_round_id)
);
CREATE INDEX IF NOT EXISTS idx_rounds_session ON rounds (session_id, round_number);
`;

type Row = Record<string, string | number | null>;

function toStoredRound(row: Row): StoredRound {
  const decided = row.decision_status === 'decided';
  return {
    sessionId: row.session_id as string,
    roundNumber: row.round_number as number,
    clientRoundId: row.client_round_id as string,
    difficulty: row.difficulty as Difficulty,
    gridColumns: row.grid_columns as number,
    gridRows: row.grid_rows as number,
    pairCount: row.pair_count as number,
    moves: row.moves as number,
    completedPairs: row.completed_pairs as number,
    mismatches: row.mismatches as number,
    elapsedSeconds: row.elapsed_seconds as number,
    completed: row.completed === 1,
    policyBand: row.policy_band as PerformanceBand,
    decisionStatus: row.decision_status as RoundDecisionStatus,
    decision: decided
      ? {
          nextDifficulty: row.next_difficulty as Difficulty,
          source: row.decision_source as RoundDecision['source'],
          performance: (row.performance as PerformanceRating | null) ?? null,
          reason: row.reason as string,
        }
      : null,
    failureCode: (row.failure_code as string | null) ?? null,
    model: (row.model as string | null) ?? null,
    createdAt: row.created_at as string,
    decidedAt: (row.decided_at as string | null) ?? null,
  };
}

/** Opens (and if needed creates) the database. Use ':memory:' for a throw-away database. */
export function openStore(path: string, now: () => Date = () => new Date()): RoundStore {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(SCHEMA);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);

  const stamp = () => now().toISOString();

  const q = {
    insertSession: db.prepare('INSERT OR IGNORE INTO sessions (session_id, created_at) VALUES (?, ?)'),
    sessionExists: db.prepare('SELECT 1 AS ok FROM sessions WHERE session_id = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE session_id = ?'),
    getRound: db.prepare('SELECT * FROM rounds WHERE session_id = ? AND client_round_id = ?'),
    listRounds: db.prepare(
      `SELECT * FROM (SELECT * FROM rounds WHERE session_id = ? ORDER BY round_number DESC LIMIT ?)
       ORDER BY round_number ASC`,
    ),
    countRounds: db.prepare('SELECT COUNT(*) AS n FROM rounds WHERE session_id = ?'),
    insertRound: db.prepare(
      `INSERT INTO rounds (
         session_id, round_number, client_round_id, difficulty, grid_columns, grid_rows, pair_count,
         moves, completed_pairs, mismatches, elapsed_seconds, completed, policy_band,
         decision_status, created_at
       ) VALUES (
         ?, (SELECT COALESCE(MAX(round_number), 0) + 1 FROM rounds WHERE session_id = ?), ?, ?, ?, ?, ?,
         ?, ?, ?, ?, 1, ?, 'pending', ?
       )`,
    ),
    decide: db.prepare(
      `UPDATE rounds SET decision_status = 'decided', decision_source = ?, next_difficulty = ?,
         performance = ?, reason = ?, model = ?, failure_code = NULL, decided_at = ?
       WHERE session_id = ? AND client_round_id = ? AND decision_status != 'decided'`,
    ),
    fail: db.prepare(
      `UPDATE rounds SET decision_status = 'failed', failure_code = ?
       WHERE session_id = ? AND client_round_id = ? AND decision_status != 'decided'`,
    ),
  };

  const get = (sessionId: string, clientRoundId: string) => {
    const row = q.getRound.get(sessionId, clientRoundId) as Row | undefined;
    return row ? toStoredRound(row) : null;
  };

  return {
    createSession(sessionId) {
      q.insertSession.run(sessionId, stamp());
    },
    sessionExists(sessionId) {
      return q.sessionExists.get(sessionId) !== undefined;
    },
    deleteSession(sessionId) {
      return Number(q.deleteSession.run(sessionId).changes) > 0;
    },
    getRound: get,
    listRounds(sessionId, limit = MAX_ROUNDS_PER_SESSION) {
      return (q.listRounds.all(sessionId, limit) as Row[]).map(toStoredRound);
    },
    insertRound(sessionId, r) {
      const count = (q.countRounds.get(sessionId) as { n: number }).n;
      if (count >= MAX_ROUNDS_PER_SESSION) {
        throw new StoreError('round_limit', 'This session has reached its round limit');
      }
      q.insertRound.run(
        sessionId,
        sessionId,
        r.clientRoundId,
        r.difficulty,
        r.gridColumns,
        r.gridRows,
        r.pairCount,
        r.moves,
        r.completedPairs,
        r.mismatches,
        r.elapsedSeconds,
        r.policyBand,
        stamp(),
      );
      const stored = get(sessionId, r.clientRoundId);
      if (!stored) throw new Error('Round was not stored');
      return stored;
    },
    recordDecision(sessionId, clientRoundId, d) {
      q.decide.run(d.source, d.nextDifficulty, d.performance, d.reason, d.model, stamp(), sessionId, clientRoundId);
      return get(sessionId, clientRoundId);
    },
    markFailed(sessionId, clientRoundId, failureCode) {
      q.fail.run(failureCode, sessionId, clientRoundId);
      return get(sessionId, clientRoundId);
    },
    close() {
      db.close();
    },
  };
}
