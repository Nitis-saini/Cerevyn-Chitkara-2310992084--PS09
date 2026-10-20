import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { DIFFICULTY_CONFIG, HISTORY_CONFIG } from '../config/gameConfig';
import type { SessionRecord } from '../types/game';
import { createDeck, createInitialState, gameReducer } from '../utils/gameLogic';
import { addRecord, loadHistory, updateRecord } from '../utils/sessionStorage';

const SEED = 11;
const card = (i: number) => screen.getByTestId('board').children[i] as HTMLElement;
const text = (id: string) => screen.getByTestId(id).textContent;
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const deck = createDeck(DIFFICULTY_CONFIG.easy.pairCount, SEED);
const mismatchPair = (() => {
  const b = deck.findIndex((c, i) => i !== 0 && c.pairId !== deck[0]!.pairId);
  return [0, b] as const;
})();
const pairs = (() => {
  const m = new Map<string, number[]>();
  deck.forEach((c, i) => m.set(c.pairId, [...(m.get(c.pairId) ?? []), i]));
  return [...m.values()];
})();

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});

const setHidden = (hidden: boolean) =>
  act(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
    document.dispatchEvent(new Event('visibilitychange'));
  });

describe('mismatch tracking (reducer)', () => {
  it('counts a mismatch only when two different cards are revealed, and moves = pairs + mismatches', () => {
    let s = createInitialState('easy', 0, SEED);
    s = gameReducer(s, { type: 'FLIP_CARD', cardId: s.cards[mismatchPair[0]]!.id });
    expect(s.mismatches).toBe(0); // one card is not a move
    s = gameReducer(s, { type: 'FLIP_CARD', cardId: s.cards[mismatchPair[1]]!.id });
    expect(s).toMatchObject({ moves: 1, mismatches: 1, matchedPairs: 0, resolving: true });
    // A third click during resolution changes nothing.
    s = gameReducer(s, { type: 'FLIP_CARD', cardId: s.cards[5]!.id });
    expect(s).toMatchObject({ moves: 1, mismatches: 1 });
    s = gameReducer(s, { type: 'RESOLVE_MISMATCH', roundId: 0 });
    const [i, j] = pairs[0]!;
    s = gameReducer(s, { type: 'FLIP_CARD', cardId: s.cards[i!]!.id });
    s = gameReducer(s, { type: 'FLIP_CARD', cardId: s.cards[j!]!.id });
    expect(s).toMatchObject({ moves: 2, mismatches: 1, matchedPairs: 1 });
    expect(s.moves).toBe(s.matchedPairs + s.mismatches);
  });

  it('resets mismatches for a new round', () => {
    let s = createInitialState('easy', 0, SEED);
    s = gameReducer(s, { type: 'FLIP_CARD', cardId: s.cards[mismatchPair[0]]!.id });
    s = gameReducer(s, { type: 'FLIP_CARD', cardId: s.cards[mismatchPair[1]]!.id });
    expect(gameReducer(s, { type: 'NEW_ROUND', difficulty: 'easy' }).mismatches).toBe(0);
  });
});

describe('active timer safety (UI)', () => {
  it('pauses while the tab is hidden and resumes without counting the hidden time', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App initialSeed={SEED} />);
    await user.click(card(pairs[0]![0]!));
    advance(5000);
    await setHidden(true);
    advance(60_000);
    await setHidden(false);
    advance(2000);
    expect(text('time')).toBe('0:07');
  });

  it('shows mismatches in the stats panel', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App initialSeed={SEED} />);
    await user.click(card(mismatchPair[0]));
    await user.click(card(mismatchPair[1]));
    expect(text('mismatches')).toBe('1');
    advance(DIFFICULTY_CONFIG.easy.mismatchDelayMs);
  });
});

describe('anonymous session record', () => {
  it('stores every required field after a round, with no personal data', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App initialSeed={SEED} />);
    await user.click(card(mismatchPair[0]));
    await user.click(card(mismatchPair[1]));
    advance(DIFFICULTY_CONFIG.easy.mismatchDelayMs);
    for (const [i, j] of pairs) {
      await user.click(card(i!));
      await user.click(card(j!));
    }
    await act(async () => {});
    const [r] = loadHistory();
    expect(r).toMatchObject({
      difficulty: 'easy', previousDifficulty: null, nextDifficulty: 'medium',
      gridColumns: 4, gridRows: 4, completedPairs: 8, moves: 9, mismatches: 1,
      aiCoachSucceeded: false,
    });
    expect(r?.reason).toContain('Medium (5×4 grid, 10 pairs)');
    expect(r?.roundId).toMatch(/-r0$/);
    expect(Date.parse(r!.completedAt)).not.toBeNaN();
    expect(Object.keys(r!).sort()).toEqual(
      ['aiCoachSucceeded', 'completedAt', 'completedPairs', 'difficulty', 'elapsedSeconds', 'gridColumns',
        'gridRows', 'mismatches', 'moves', 'nextDifficulty', 'previousDifficulty', 'reason', 'roundId', 'sessionId'].sort(),
    );
    // The history list shows the decision reason.
    expect(screen.getByTestId('history-list').textContent).toContain('Your next round will be Medium');
  });
});

describe('sessionStorage updateRecord and optional fields', () => {
  const base: SessionRecord = {
    sessionId: 's', roundId: 's-r0', completedAt: '2026-01-01T00:00:00.000Z', moves: 9,
    elapsedSeconds: 20, difficulty: 'easy', nextDifficulty: 'medium', aiCoachSucceeded: false,
  };

  it('patches only the matching record and persists it', () => {
    addRecord(base);
    addRecord({ ...base, roundId: 's-r1' });
    updateRecord('s-r1', { aiCoachSucceeded: true });
    expect(loadHistory().map((r) => r.aiCoachSucceeded)).toEqual([false, true]);
  });

  it('ignores unknown round IDs and never writes an invalid record', () => {
    addRecord(base);
    updateRecord('nope', { aiCoachSucceeded: true });
    updateRecord('s-r0', { difficulty: 'bogus' as never });
    expect(loadHistory()).toEqual([base]);
  });

  it('drops stored records whose optional fields are malformed', () => {
    window.localStorage.setItem(
      HISTORY_CONFIG.storageKey,
      JSON.stringify([base, { ...base, mismatches: -2 }, { ...base, reason: 5 }, { ...base, previousDifficulty: 'x' }]),
    );
    expect(loadHistory()).toEqual([base]);
  });

  it('still loads legacy records saved before the new fields existed', () => {
    const legacy = { sessionId: 'old', completedAt: base.completedAt, moves: 12, elapsedSeconds: 30, difficulty: 'easy', nextDifficulty: 'easy' };
    window.localStorage.setItem(HISTORY_CONFIG.storageKey, JSON.stringify([legacy]));
    expect(loadHistory()).toHaveLength(1);
  });
});
