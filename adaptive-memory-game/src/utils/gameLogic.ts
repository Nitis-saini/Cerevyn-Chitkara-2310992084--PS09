import { ADAPTIVE_POLICY, CARD_SYMBOLS, DIFFICULTY_CONFIG } from '../config/gameConfig';
import type { Card, Difficulty, GameAction, GameState } from '../types/game';
import { shuffle } from './shuffle';

/**
 * Builds `pairCount` pairs (2 x pairCount face-down cards), then shuffles them.
 * Each pair uses a unique symbol; each card gets a unique stable ID.
 * Pass a seed for a reproducible order.
 */
export function createDeck(pairCount: number, seed?: number): Card[] {
  if (!Number.isInteger(pairCount) || pairCount < 1 || pairCount > CARD_SYMBOLS.length) {
    throw new RangeError(`pairCount must be an integer from 1 to ${CARD_SYMBOLS.length}`);
  }
  const cards: Card[] = CARD_SYMBOLS.slice(0, pairCount).flatMap(({ id, symbol, label }) =>
    (['a', 'b'] as const).map((suffix) => ({
      id: `${id}-${suffix}`,
      pairId: id,
      symbol,
      label,
      status: 'faceDown' as const,
    })),
  );
  return shuffle(cards, seed);
}

export function createInitialState(
  difficulty: Difficulty = ADAPTIVE_POLICY.initialDifficulty,
  roundId = 0,
  seedBase?: number,
): GameState {
  return {
    cards: createDeck(
      DIFFICULTY_CONFIG[difficulty].pairCount,
      seedBase === undefined ? undefined : seedBase + roundId,
    ),
    moves: 0,
    matchedPairs: 0,
    status: 'idle',
    resolving: false,
    difficulty,
    roundId,
  };
}

function flipCard(state: GameState, cardId: string): GameState {
  // Locked while a mismatch is being shown, or after the round is won.
  if (state.status === 'won' || state.resolving) return state;

  const target = state.cards.find((c) => c.id === cardId);
  // Unknown card, already face up (repeat click) or already matched: ignore.
  if (!target || target.status !== 'faceDown') return state;

  const cards = state.cards.map((c) =>
    c.id === cardId ? { ...c, status: 'faceUp' as const } : c,
  );
  const faceUp = cards.filter((c) => c.status === 'faceUp');

  if (faceUp.length < 2) {
    return { ...state, cards, status: 'playing' };
  }

  // Second distinct card revealed: this completes one move.
  const [first, second] = faceUp as [Card, Card];
  const moves = state.moves + 1;

  if (first.pairId === second.pairId) {
    const matchedPairs = state.matchedPairs + 1;
    return {
      ...state,
      cards: cards.map((c) =>
        c.status === 'faceUp' ? { ...c, status: 'matched' as const } : c,
      ),
      moves,
      matchedPairs,
      status: matchedPairs * 2 === state.cards.length ? 'won' : 'playing',
    };
  }

  return { ...state, cards, moves, status: 'playing', resolving: true };
}

function resolveMismatch(state: GameState, roundId: number): GameState {
  // A callback from an older round (or a stray one) must never touch this board.
  if (roundId !== state.roundId || !state.resolving) return state;
  return {
    ...state,
    cards: state.cards.map((c) =>
      c.status === 'faceUp' ? { ...c, status: 'faceDown' as const } : c,
    ),
    resolving: false,
  };
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'FLIP_CARD':
      return flipCard(state, action.cardId);
    case 'RESOLVE_MISMATCH':
      return resolveMismatch(state, action.roundId);
    case 'NEW_ROUND':
      return createInitialState(action.difficulty, state.roundId + 1, action.seedBase);
  }
}

/** Formats milliseconds as m:ss (whole seconds, truncated). */
export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
