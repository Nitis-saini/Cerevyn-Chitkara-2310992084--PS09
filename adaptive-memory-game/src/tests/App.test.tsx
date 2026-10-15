import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { DIFFICULTY_CONFIG, HISTORY_CONFIG } from '../config/gameConfig';
import type { Difficulty } from '../types/game';
import { createDeck } from '../utils/gameLogic';
import { loadHistory } from '../utils/sessionStorage';

const SEED = 42;
/** The App seeds round N with SEED + N, so tests can predict every board. */
const deckFor = (round: number, level: Difficulty) =>
  createDeck(DIFFICULTY_CONFIG[level].pairCount, SEED + round);

type User = ReturnType<typeof userEvent.setup>;
type Deck = ReturnType<typeof createDeck>;

// Cards are located by board position (fast). Accessible names are still verified through
// getByRole in expectBoard/cardCount/faceDownCount and in the label test below.
const card = (i: number) => {
  const el = screen.getByTestId('board').children[i];
  if (!(el instanceof HTMLElement)) throw new Error(`No card at position ${i + 1}`);
  return el;
};
const status = (i: number) => card(i).getAttribute('data-status');
const text = (id: string) => screen.getByTestId(id).textContent;
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const control = (name: RegExp) => screen.getByRole('button', { name });
const cardCount = () => screen.getAllByRole('button', { name: /^Card \d+,/ }).length;
const faceDownCount = () => screen.getAllByRole('button', { name: /^Card \d+, face down$/ }).length;

function expectBoard(level: Difficulty) {
  const { columns, rows, pairCount, label } = DIFFICULTY_CONFIG[level];
  const board = screen.getByTestId('board');
  expect(cardCount()).toBe(columns * rows);
  expect(cardCount()).toBe(pairCount * 2);
  expect(board.getAttribute('data-columns')).toBe(String(columns));
  expect(board.getAttribute('data-rows')).toBe(String(rows));
  expect(board.style.gridTemplateColumns).toContain(`repeat(${columns}`);
  expect(text('difficulty-badge')).toContain(label);
  expect(text('pairs')).toBe(`0 / ${pairCount}`);
  expect(text('board-info')).toBe(`${columns}×${rows} grid, ${pairCount} pairs`);
  expect(faceDownCount()).toBe(pairCount * 2);
}

/** Index pairs [i, j] of matching cards in a deck. */
function pairsOf(deck: Deck): [number, number][] {
  const byPair = new Map<string, number[]>();
  deck.forEach((c, i) => byPair.set(c.pairId, [...(byPair.get(c.pairId) ?? []), i]));
  return [...byPair.values()].map(([a, b]) => [a!, b!]);
}

/** Two indices that do NOT match, plus a third unrelated index. */
function mismatchIn(deck: Deck) {
  const a = 0;
  const b = deck.findIndex((c, i) => i !== a && c.pairId !== deck[a]!.pairId);
  const third = deck.findIndex((_, i) => i !== a && i !== b);
  return { a, b, third };
}

async function playPair(user: User, [i, j]: [number, number]) {
  await user.click(card(i));
  await user.click(card(j));
}

/** Plays a perfect round: no mismatches, `msBetweenPairs` between pairs. */
async function winRound(user: User, round: number, level: Difficulty, msBetweenPairs = 1000) {
  for (const pair of pairsOf(deckFor(round, level))) {
    await playPair(user, pair);
    advance(msBetweenPairs);
  }
}

/** Plays a round that ends with exactly `totalMoves` moves (extra moves are mismatches). */
async function playWithMoves(user: User, round: number, level: Difficulty, totalMoves: number) {
  const deck = deckFor(round, level);
  const mismatches = totalMoves - DIFFICULTY_CONFIG[level].pairCount;
  const { a, b } = mismatchIn(deck);
  for (let n = 0; n < mismatches; n++) {
    await playPair(user, [a, b]);
    advance(DIFFICULTY_CONFIG[level].mismatchDelayMs);
  }
  for (const pair of pairsOf(deck)) await playPair(user, pair);
}

/** Plays a perfect round whose active time is exactly `totalMs` (first flip to last match). */
async function playWithTime(user: User, round: number, level: Difficulty, totalMs: number) {
  const pairs = pairsOf(deckFor(round, level));
  await playPair(user, pairs[0]!);
  advance(totalMs);
  for (const pair of pairs.slice(1)) await playPair(user, pair);
}

/** Starts a round of `level` and returns its round index. */
async function startLevel(user: User, level: Difficulty): Promise<number> {
  if (level === 'easy') return 0;
  return reachDifficulty(user, level);
}

const NEXT_IF_MET = { easy: 'Medium', medium: 'Hard', hard: 'Hard' } as const;

/** Wins rounds until the next round is `target`; returns the current round index. */
async function reachDifficulty(user: User, target: 'medium' | 'hard'): Promise<number> {
  await winRound(user, 0, 'easy');
  await user.click(control(/^Next round \(Medium\)$/));
  if (target === 'medium') return 1;
  await winRound(user, 1, 'medium');
  await user.click(control(/^Next round \(Hard\)$/));
  return 2;
}

function setup() {
  // delay: null removes user-event's internal waits (we control fake time ourselves),
  // which makes full 36-card rounds much faster.
  const user = userEvent.setup({ delay: null });
  const utils = render(<App initialSeed={SEED} />);
  return { user, ...utils };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('initial board', () => {
  it('starts on Easy: 4x4 grid, 8 pairs, 16 face-down cards', () => {
    setup();
    expectBoard('easy');
    expect(text('moves')).toBe('0');
    expect(text('time')).toBe('0:00');
    expect(screen.getByText(/find all 8 pairs/)).toBeTruthy();
  });
});

describe('card accessibility', () => {
  it('labels cards by position, hides the symbol while face down, and reveals it when flipped', async () => {
    const { user } = setup();
    const deck = deckFor(0, 'easy');
    expect(screen.getByRole('button', { name: 'Card 1, face down' })).toBe(card(0));
    expect(screen.getByRole('button', { name: 'Card 16, face down' })).toBe(card(15));

    await user.click(card(0));
    expect(card(0).getAttribute('aria-label')).toBe(`Card 1, face up: ${deck[0]!.label}`);

    const partner = pairsOf(deck).find((p) => p.includes(0))!.find((i) => i !== 0)!;
    await user.click(card(partner));
    expect(card(0).getAttribute('aria-label')).toBe(`Card 1, matched: ${deck[0]!.label}`);
    expect(card(0).getAttribute('aria-disabled')).toBe('true');
  });

  it('cards are real buttons reachable by keyboard and activate with Enter', async () => {
    const { user } = setup();
    await user.tab();
    expect(document.activeElement).toBe(card(0));
    await user.keyboard('{Enter}');
    expect(status(0)).toBe('faceUp');
  });
});

describe('matching (Easy board)', () => {
  it('marks a matching pair as matched and updates the counters', async () => {
    const { user } = setup();
    const [i, j] = pairsOf(deckFor(0, 'easy'))[0]!;
    await playPair(user, [i, j]);
    expect(status(i)).toBe('matched');
    expect(status(j)).toBe('matched');
    expect(text('pairs')).toBe('1 / 8');
    expect(text('moves')).toBe('1');
  });

  it('flips a mismatched pair back only after the configured delay', async () => {
    const { user } = setup();
    const { a, b } = mismatchIn(deckFor(0, 'easy'));
    await playPair(user, [a, b]);
    expect(status(a)).toBe('faceUp');
    expect(status(b)).toBe('faceUp');

    const delay = DIFFICULTY_CONFIG.easy.mismatchDelayMs;
    advance(delay - 1);
    expect(status(a)).toBe('faceUp');
    advance(1);
    expect(status(a)).toBe('faceDown');
    expect(status(b)).toBe('faceDown');
  });

  it('does not allow a third card while a mismatch is resolving', async () => {
    const { user } = setup();
    const { a, b, third } = mismatchIn(deckFor(0, 'easy'));
    await playPair(user, [a, b]);
    await user.click(card(third));
    expect(status(third)).toBe('faceDown');

    advance(DIFFICULTY_CONFIG.easy.mismatchDelayMs);
    expect(text('moves')).toBe('1');
    expect(status(third)).toBe('faceDown');
  });

  it('ignores a second click on the same card (no move counted)', async () => {
    const { user } = setup();
    const deck = deckFor(0, 'easy');
    await user.click(card(0));
    await user.click(card(0));
    expect(text('moves')).toBe('0');
    expect(status(0)).toBe('faceUp');

    const partner = pairsOf(deck).find((p) => p.includes(0))!.find((i) => i !== 0)!;
    await user.click(card(partner));
    expect(text('moves')).toBe('1');
    expect(status(0)).toBe('matched');
  });

  it('does not let a matched card be selected again', async () => {
    const { user } = setup();
    const deck = deckFor(0, 'easy');
    const [i, j] = pairsOf(deck)[0]!;
    await playPair(user, [i, j]);

    await user.click(card(i));
    expect(text('moves')).toBe('1');
    expect(status(i)).toBe('matched');

    const other = deck.findIndex((_, k) => k !== i && k !== j);
    await user.click(card(other));
    await user.click(card(j));
    expect(text('moves')).toBe('1');
    expect(status(other)).toBe('faceUp');
    expect(status(j)).toBe('matched');
  });

  it('increments moves once per attempt (mismatch then match = 2)', async () => {
    const { user } = setup();
    const deck = deckFor(0, 'easy');
    const { a, b } = mismatchIn(deck);
    await playPair(user, [a, b]);
    expect(text('moves')).toBe('1');
    advance(DIFFICULTY_CONFIG.easy.mismatchDelayMs);
    await playPair(user, pairsOf(deck)[0]!);
    expect(text('moves')).toBe('2');
  });
});

describe('timer', () => {
  it('starts on the first flip, stops on win, and resets on restart', async () => {
    const { user } = setup();
    advance(5000);
    expect(text('time')).toBe('0:00'); // not started yet

    const pairs = pairsOf(deckFor(0, 'easy'));
    await user.click(card(pairs[0]![0]));
    advance(3000);
    expect(text('time')).toBe('0:03');

    await user.click(card(pairs[0]![1]));
    for (const pair of pairs.slice(1)) {
      advance(1000);
      await playPair(user, pair);
    }
    expect(screen.getByTestId('result')).toBeTruthy();
    const finalTime = text('time');
    expect(finalTime).toBe('0:10'); // 3 s + 7 x 1 s

    advance(30_000); // time on the results screen is not counted
    expect(text('time')).toBe(finalTime);

    await user.click(control(/^Restart round$/));
    expect(text('time')).toBe('0:00');
    advance(5000);
    expect(text('time')).toBe('0:00'); // idle again until the first flip
  });

  it('runs a single interval across many re-renders and none after the win', async () => {
    const { user } = setup();
    const pairs = pairsOf(deckFor(0, 'easy'));
    expect(vi.getTimerCount()).toBe(0); // idle: nothing running
    await user.click(card(pairs[0]![0]));
    expect(vi.getTimerCount()).toBe(1);

    await user.click(card(pairs[0]![1])); // match: more renders, still one interval
    await playPair(user, pairs[1]!);
    expect(vi.getTimerCount()).toBe(1);

    for (const pair of pairs.slice(2)) await playPair(user, pair);
    expect(screen.getByTestId('result')).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not run while a mismatch is shown beyond its own timeout, and keeps counting', async () => {
    const { user } = setup();
    const { a, b } = mismatchIn(deckFor(0, 'easy'));
    await playPair(user, [a, b]);
    expect(vi.getTimerCount()).toBe(2); // stopwatch + the one mismatch timeout
    advance(DIFFICULTY_CONFIG.easy.mismatchDelayMs);
    expect(vi.getTimerCount()).toBe(1);
    expect(text('time')).toBe('0:01');
  });

  it.each(['medium', 'hard'] as const)(
    'next round (%s) resets the timer to 0:00 and waits for the first flip',
    async (level) => {
      const { user } = setup();
      const round = await reachDifficulty(user, level);
      expect(text('time')).toBe('0:00');
      advance(20_000);
      expect(text('time')).toBe('0:00');

      await user.click(card(pairsOf(deckFor(round, level))[0]![0]));
      advance(2000);
      expect(text('time')).toBe('0:02');
    },
  );
});

describe('adaptive progression through all three grid sizes', () => {
  it('Easy win -> Medium: next round really uses the 5x4 / 10-pair board', async () => {
    const { user } = setup();
    await winRound(user, 0, 'easy');

    expect(text('pairs')).toBe('8 / 8');
    expect(text('moves')).toBe('8');
    expect(text('result')).toContain('You matched all 8 pairs!');
    const message = text('result-message')!;
    expect(message).toContain('8 moves and 7 seconds');
    expect(message).toContain('Your next round will be Medium (5×4 grid, 10 pairs)');
    expect(message).toContain('met both Easy targets');

    // The finished round is not changed retroactively.
    expect(text('difficulty-badge')).toContain('Easy');
    expect(cardCount()).toBe(16);

    await user.click(control(/^Next round \(Medium\)$/));
    expectBoard('medium');
    expect(text('moves')).toBe('0');
    expect(screen.queryByTestId('result')).toBeNull();
    expect(screen.getByText(/find all 10 pairs/)).toBeTruthy();
    expect(text('targets')).toContain('35 moves');
    expect(text('targets')).toContain('150 seconds');
  });

  it('Medium win -> Hard: next round uses the 6x6 / 18-pair board', async () => {
    const { user } = setup();
    await reachDifficulty(user, 'medium');
    expectBoard('medium');

    await winRound(user, 1, 'medium');
    expect(text('pairs')).toBe('10 / 10');
    expect(text('moves')).toBe('10');
    expect(text('result')).toContain('You matched all 10 pairs!');
    expect(text('result-message')).toContain('Your next round will be Hard (6×6 grid, 18 pairs)');
    expect(text('result-message')).toContain('met both Medium targets');
    expect(cardCount()).toBe(20);

    await user.click(control(/^Next round \(Hard\)$/));
    expectBoard('hard');
    expect(screen.getByText(/find all 18 pairs/)).toBeTruthy();
  });

  it('Hard can be won, and winning on Hard starts a fresh Hard board', async () => {
    const { user } = setup();
    await reachDifficulty(user, 'hard');
    expectBoard('hard');

    await winRound(user, 2, 'hard');
    expect(text('pairs')).toBe('18 / 18');
    expect(text('moves')).toBe('18');
    expect(text('result')).toContain('You matched all 18 pairs!');
    expect(text('result-message')).toContain('Your next round will be Hard (6×6 grid, 18 pairs)');

    await user.click(control(/^Next round \(Hard\)$/));
    expectBoard('hard');
    expect(text('moves')).toBe('0');
  });

  it('Hard -> Easy when the Hard time target is missed (back to 4x4 / 8 pairs)', async () => {
    const { user } = setup();
    const round = await reachDifficulty(user, 'hard');

    const pairs = pairsOf(deckFor(round, 'hard'));
    await playPair(user, pairs[0]!);
    advance((DIFFICULTY_CONFIG.hard.targets.maxSeconds + 5) * 1000);
    for (const pair of pairs.slice(1)) await playPair(user, pair);

    expect(text('result-message')).toContain('Your next round will be Easy (4×4 grid, 8 pairs)');
    expect(text('result-message')).toContain('exceeded the time limit');

    await user.click(control(/^Next round \(Easy\)$/));
    expectBoard('easy');
  });

  it('Medium -> Easy when the Medium time target is missed', async () => {
    const { user } = setup();
    const round = await reachDifficulty(user, 'medium');

    const pairs = pairsOf(deckFor(round, 'medium'));
    await playPair(user, pairs[0]!);
    advance((DIFFICULTY_CONFIG.medium.targets.maxSeconds + 5) * 1000);
    for (const pair of pairs.slice(1)) await playPair(user, pair);

    expect(text('result-message')).toContain('Your next round will be Easy (4×4 grid, 8 pairs)');
    await user.click(control(/^Next round \(Easy\)$/));
    expectBoard('easy');
  });
});

describe('inclusive move and time limits, played through the UI', () => {
  it.each(['easy', 'medium', 'hard'] as const)(
    '%s: finishing in exactly the maximum moves meets the target',
    async (level) => {
      const { user } = setup();
      const round = await startLevel(user, level);
      const { maxMoves } = DIFFICULTY_CONFIG[level].targets;
      await playWithMoves(user, round, level, maxMoves);

      expect(text('moves')).toBe(String(maxMoves));
      expect(text('result-message')).toContain(`Your next round will be ${NEXT_IF_MET[level]}`);
      expect(text('result-message')).toContain('met both');
      await user.click(control(new RegExp(`^Next round \\(${NEXT_IF_MET[level]}\\)$`)));
      expectBoard(NEXT_IF_MET[level].toLowerCase() as Difficulty);
    },
  );

  it.each(['easy', 'medium', 'hard'] as const)(
    '%s: one move over the maximum returns to Easy',
    async (level) => {
      const { user } = setup();
      const round = await startLevel(user, level);
      const { maxMoves } = DIFFICULTY_CONFIG[level].targets;
      await playWithMoves(user, round, level, maxMoves + 1);

      expect(text('moves')).toBe(String(maxMoves + 1));
      expect(text('result-message')).toContain('Your next round will be Easy (4×4 grid, 8 pairs)');
      expect(text('result-message')).toContain('exceeded the move limit');
      await user.click(control(/^Next round \(Easy\)$/));
      expectBoard('easy');
    },
  );

  it.each(['easy', 'medium', 'hard'] as const)(
    '%s: finishing in exactly the time limit meets the target',
    async (level) => {
      const { user } = setup();
      const round = await startLevel(user, level);
      const { maxSeconds } = DIFFICULTY_CONFIG[level].targets;
      await playWithTime(user, round, level, maxSeconds * 1000);

      expect(text('time')).toBe(
        `${Math.floor(maxSeconds / 60)}:${String(maxSeconds % 60).padStart(2, '0')}`,
      );
      expect(text('result-message')).toContain(`Your next round will be ${NEXT_IF_MET[level]}`);
      expect(text('result-message')).toContain('met both');
    },
  );

  it.each(['easy', 'medium', 'hard'] as const)(
    '%s: one second over the time limit returns to Easy',
    async (level) => {
      const { user } = setup();
      const round = await startLevel(user, level);
      const { maxSeconds } = DIFFICULTY_CONFIG[level].targets;
      await playWithTime(user, round, level, (maxSeconds + 1) * 1000);

      expect(text('result-message')).toContain('Your next round will be Easy (4×4 grid, 8 pairs)');
      expect(text('result-message')).toContain('exceeded the time limit');
    },
  );

  it('times are truncated to whole seconds, so 90.9 s still meets the Easy limit', async () => {
    const { user } = setup();
    await playWithTime(user, 0, 'easy', 90_900);
    expect(text('result-message')).toContain('Your next round will be Medium');
  });

  it('shows the current level targets in the instructions and stats, and updates them per level', async () => {
    const { user } = setup();
    expect(text('targets')).toContain('24 moves or fewer and 90 seconds or less');
    expect(text('instructions-targets')).toContain('Easy targets: 24 moves or fewer and 90 seconds or less');
    expect(text('instructions-targets')).toContain('Meet both to play Medium next');

    await reachDifficulty(user, 'hard');
    expect(text('targets')).toContain('60 moves or fewer and 300 seconds or less');
    expect(text('instructions-targets')).toContain('Hard targets: 60 moves or fewer and 300 seconds or less');
    expect(text('instructions-targets')).toContain('miss either and the next round is Easy');
  });

  it('marks the result panel as advance or retry (not colour alone)', async () => {
    const { user } = setup();
    await winRound(user, 0, 'easy');
    expect(screen.getByTestId('result').getAttribute('data-outcome')).toBe('advance');
    await user.click(control(/^Restart round$/));
    await playWithMoves(user, 1, 'easy', 25);
    expect(screen.getByTestId('result').getAttribute('data-outcome')).toBe('retry');
  });
});

describe('restart and new game', () => {
  it.each(['easy', 'medium', 'hard'] as const)(
    'restart on %s keeps the difficulty and grid size and resets progress',
    async (level) => {
      const { user } = setup();
      let round = 0;
      if (level !== 'easy') round = await reachDifficulty(user, level);

      await playPair(user, pairsOf(deckFor(round, level))[0]!);
      expect(text('pairs')).toBe(`1 / ${DIFFICULTY_CONFIG[level].pairCount}`);

      await user.click(control(/^Restart round$/));
      expectBoard(level);
      expect(text('moves')).toBe('0');
      expect(text('time')).toBe('0:00');

      // The restarted board is a new shuffle (round + 1 seed): its known pair matches.
      await playPair(user, pairsOf(deckFor(round + 1, level))[0]!);
      expect(text('pairs')).toBe(`1 / ${DIFFICULTY_CONFIG[level].pairCount}`);
    },
  );

  it.each(['easy', 'medium', 'hard'] as const)(
    'restart during a pending mismatch on %s cannot be modified by the old callback',
    async (level) => {
      const { user } = setup();
      let round = 0;
      if (level !== 'easy') round = await reachDifficulty(user, level);

      const { a, b } = mismatchIn(deckFor(round, level));
      await playPair(user, [a, b]);

      await user.click(control(/^Restart round$/));
      expect(text('moves')).toBe('0');
      expectBoard(level);

      await user.click(card(0));
      advance(DIFFICULTY_CONFIG[level].mismatchDelayMs * 3);
      expect(status(0)).toBe('faceUp'); // an old callback would have flipped it down
      expect(text('moves')).toBe('0');
      expect(vi.getTimerCount()).toBe(1); // only the running stopwatch remains
    },
  );

  it('restart after a win replays the same difficulty, not the next one', async () => {
    const { user } = setup();
    await winRound(user, 0, 'easy'); // next would be Medium
    await user.click(control(/^Restart round$/));
    expectBoard('easy');
    expect(screen.queryByTestId('result')).toBeNull();
  });

  it('new game returns to Easy 4x4 even after reaching Hard', async () => {
    const { user } = setup();
    await reachDifficulty(user, 'hard');
    expectBoard('hard');
    await user.click(control(/^New game$/));
    expectBoard('easy');
    expect(text('moves')).toBe('0');
  });
});

describe('session history', () => {
  it('saves a completed round and reloads it on the next visit', async () => {
    const { user, unmount } = setup();
    await winRound(user, 0, 'easy');

    const saved = loadHistory();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      moves: 8,
      elapsedSeconds: 7,
      difficulty: 'easy',
      nextDifficulty: 'medium',
    });
    expect(saved[0]!.sessionId.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(saved[0]!.completedAt))).toBe(false);

    const list = within(screen.getByTestId('history-list'));
    expect(list.getAllByRole('listitem')).toHaveLength(1);
    expect(list.getByText(/Easy to Medium/)).toBeTruthy();
    expect(text('best-time')).toBe('0:07');
    expect(text('best-moves')).toBe('8');

    unmount();
    render(<App initialSeed={SEED} />);
    expect(within(screen.getByTestId('history-list')).getAllByRole('listitem')).toHaveLength(1);
    expect(text('best-moves')).toBe('8');
  });

  it('records rounds from every difficulty with their own results', async () => {
    const { user } = setup();
    await reachDifficulty(user, 'hard'); // wins Easy and Medium
    await winRound(user, 2, 'hard');

    const saved = loadHistory();
    expect(saved.map((r) => [r.difficulty, r.nextDifficulty, r.moves])).toEqual([
      ['easy', 'medium', 8],
      ['medium', 'hard', 10],
      ['hard', 'hard', 18],
    ]);
  });

  it('records a round only once', async () => {
    const { user } = setup();
    await winRound(user, 0, 'easy');
    advance(5000);
    expect(loadHistory()).toHaveLength(1);
  });

  it('does not crash on corrupted localStorage and shows the empty state', () => {
    window.localStorage.setItem(HISTORY_CONFIG.storageKey, '{{{ definitely not json');
    setup();
    expect(screen.getByText(/No results yet/)).toBeTruthy();
    expect(text('best-time')).toBe('None yet');
  });

  it('ignores invalid entries inside a stored array', () => {
    window.localStorage.setItem(HISTORY_CONFIG.storageKey, JSON.stringify([{ moves: 'x' }, 5]));
    setup();
    expect(screen.getByText(/No results yet/)).toBeTruthy();
  });

  it('clears history only after confirmation', async () => {
    const { user } = setup();
    await winRound(user, 0, 'easy');
    const confirm = vi.spyOn(window, 'confirm');

    confirm.mockReturnValueOnce(false);
    await user.click(control(/^Clear history$/));
    expect(loadHistory()).toHaveLength(1);

    confirm.mockReturnValueOnce(true);
    await user.click(control(/^Clear history$/));
    expect(loadHistory()).toHaveLength(0);
    expect(screen.getByText(/No results yet/)).toBeTruthy();
    expect(text('best-time')).toBe('None yet');
  });
});
