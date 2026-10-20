import { describe, expect, it } from 'vitest';
import { DIFFICULTY_CONFIG, DIFFICULTY_ORDER } from '../config/gameConfig';
import type { Difficulty, GameAction, GameState } from '../types/game';
import { createInitialState, formatTime, gameReducer } from '../utils/gameLogic';

const run = (state: GameState, ...actions: GameAction[]) => actions.reduce(gameReducer, state);
const flip = (cardId: string): GameAction => ({ type: 'FLIP_CARD', cardId });

function setup(difficulty: Difficulty = 'easy') {
  const state = createInitialState(difficulty, 0, 42);
  const [a, ...rest] = state.cards;
  const partner = rest.find((c) => c.pairId === a!.pairId)!;
  const other = rest.find((c) => c.pairId !== a!.pairId)!;
  return { state, a: a!, partner, other };
}

function winAll(initial: GameState): GameState {
  let state = initial;
  const pairIds = [...new Set(state.cards.map((c) => c.pairId))];
  for (const pairId of pairIds) {
    const ids = state.cards.filter((c) => c.pairId === pairId).map((c) => c.id);
    state = run(state, flip(ids[0]!), flip(ids[1]!));
  }
  return state;
}

describe.each(DIFFICULTY_ORDER)('gameReducer on %s', (level) => {
  const { pairCount } = DIFFICULTY_CONFIG[level];

  it('starts idle with a full face-down board of the configured size', () => {
    const { state } = setup(level);
    expect(state.status).toBe('idle');
    expect(state.moves).toBe(0);
    expect(state.difficulty).toBe(level);
    expect(state.cards).toHaveLength(pairCount * 2);
    expect(state.cards.every((c) => c.status === 'faceDown')).toBe(true);
  });

  it('first flip starts play but does not count a move', () => {
    const { state, a } = setup(level);
    const next = run(state, flip(a.id));
    expect(next.status).toBe('playing');
    expect(next.moves).toBe(0);
  });

  it('matches a pair and counts one move', () => {
    const { state, a, partner } = setup(level);
    const next = run(state, flip(a.id), flip(partner.id));
    expect(next.moves).toBe(1);
    expect(next.matchedPairs).toBe(1);
    expect(next.cards.filter((c) => c.status === 'matched').map((c) => c.id).sort()).toEqual(
      [a.id, partner.id].sort(),
    );
  });

  it('locks input during a mismatch, then unlocks on resolve', () => {
    const { state, a, other } = setup(level);
    const third = state.cards.find((c) => c.id !== a.id && c.id !== other.id)!;
    const mismatched = run(state, flip(a.id), flip(other.id));
    expect(mismatched.resolving).toBe(true);
    expect(mismatched.moves).toBe(1);
    expect(run(mismatched, flip(third.id))).toBe(mismatched);

    const resolved = run(mismatched, { type: 'RESOLVE_MISMATCH', roundId: 0 });
    expect(resolved.resolving).toBe(false);
    expect(resolved.cards.every((c) => c.status === 'faceDown')).toBe(true);
  });

  it('wins exactly when all pairs are matched, and then ignores flips', () => {
    const initial = createInitialState(level, 0, 42);
    // One pair short of the end: not won yet.
    const pairIds = [...new Set(initial.cards.map((c) => c.pairId))];
    let state = initial;
    for (const pairId of pairIds.slice(0, -1)) {
      const ids = state.cards.filter((c) => c.pairId === pairId).map((c) => c.id);
      state = run(state, flip(ids[0]!), flip(ids[1]!));
    }
    expect(state.status).toBe('playing');
    expect(state.matchedPairs).toBe(pairCount - 1);

    const won = winAll(initial);
    expect(won.status).toBe('won');
    expect(won.matchedPairs).toBe(pairCount);
    expect(won.moves).toBe(pairCount);
    expect(run(won, flip(won.cards[0]!.id))).toBe(won);
  });

  it('handles many rapid clicks consistently (never more than two face up)', () => {
    const { state } = setup(level);
    const next = run(state, ...state.cards.map((c) => flip(c.id)));
    const faceUp = next.cards.filter((c) => c.status === 'faceUp').length;
    const matched = next.cards.filter((c) => c.status === 'matched').length;
    expect(faceUp).toBeLessThanOrEqual(2);
    expect(next.matchedPairs * 2).toBe(matched);
  });

  it('NEW_ROUND with the same difficulty keeps the grid size and resets everything', () => {
    const { state, a, other } = setup(level);
    const dirty = run(state, flip(a.id), flip(other.id));
    const fresh = gameReducer(dirty, { type: 'NEW_ROUND', difficulty: level });
    expect(fresh).toMatchObject({ moves: 0, matchedPairs: 0, status: 'idle', resolving: false, difficulty: level });
    expect(fresh.cards).toHaveLength(pairCount * 2);
    expect(fresh.cards.every((c) => c.status === 'faceDown')).toBe(true);
    expect(fresh.roundId).toBe(1);
  });

  it('ignores a stale RESOLVE_MISMATCH from a previous round', () => {
    const { state, a, other } = setup(level);
    const mismatched = run(state, flip(a.id), flip(other.id));
    const fresh = gameReducer(mismatched, { type: 'NEW_ROUND', difficulty: level, seedBase: 42 });
    const afterOne = run(fresh, flip(fresh.cards[0]!.id));
    expect(run(afterOne, { type: 'RESOLVE_MISMATCH', roundId: 0 })).toBe(afterOne);
  });
});

describe('gameReducer shared rules', () => {
  it('ignores a repeated click on the same face-up card', () => {
    const { state, a } = setup();
    const once = run(state, flip(a.id));
    expect(run(once, flip(a.id))).toBe(once);
    expect(once.moves).toBe(0);
  });

  it('ignores clicks on matched cards and unknown IDs', () => {
    const { state, a, partner } = setup();
    const matched = run(state, flip(a.id), flip(partner.id));
    expect(run(matched, flip(a.id))).toBe(matched);
    expect(run(matched, flip('does-not-exist'))).toBe(matched);
  });

  it('NEW_ROUND switches to the grid of the requested difficulty', () => {
    let state = createInitialState('easy', 0, 42);
    expect(state.cards).toHaveLength(16);
    state = gameReducer(state, { type: 'NEW_ROUND', difficulty: 'medium', seedBase: 42 });
    expect(state.cards).toHaveLength(20);
    expect(state.difficulty).toBe('medium');
    state = gameReducer(state, { type: 'NEW_ROUND', difficulty: 'hard', seedBase: 42 });
    expect(state.cards).toHaveLength(36);
    state = gameReducer(state, { type: 'NEW_ROUND', difficulty: 'easy', seedBase: 42 });
    expect(state.cards).toHaveLength(16);
  });

  it('seeded rounds are reproducible per difficulty', () => {
    const a = createInitialState('hard', 3, 42);
    const b = createInitialState('hard', 3, 42);
    expect(a.cards.map((c) => c.id)).toEqual(b.cards.map((c) => c.id));
  });
});

describe('formatTime', () => {
  it('formats m:ss and truncates partial seconds', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(999)).toBe('0:00');
    expect(formatTime(42_900)).toBe('0:42');
    expect(formatTime(61_000)).toBe('1:01');
  });
});
