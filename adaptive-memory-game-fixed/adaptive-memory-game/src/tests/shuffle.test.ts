import { describe, expect, it } from 'vitest';
import { CARD_SYMBOLS, DIFFICULTY_CONFIG, DIFFICULTY_ORDER } from '../config/gameConfig';
import { createDeck } from '../utils/gameLogic';
import { shuffle } from '../utils/shuffle';

describe('seeded shuffle', () => {
  const items = Array.from({ length: 16 }, (_, i) => i);

  it('produces the same order for the same seed', () => {
    expect(shuffle(items, 123)).toEqual(shuffle(items, 123));
  });

  it('produces a different order for a different seed', () => {
    expect(shuffle(items, 1)).not.toEqual(shuffle(items, 2));
  });

  it('keeps every element exactly once and does not mutate the input', () => {
    const copy = [...items];
    const result = shuffle(items, 7);
    expect([...result].sort((a, b) => a - b)).toEqual(items);
    expect(items).toEqual(copy);
  });

  it('actually reorders the items', () => {
    expect(shuffle(items, 99)).not.toEqual(items);
  });
});

describe.each(DIFFICULTY_ORDER)('createDeck for %s', (level) => {
  const pairCount = DIFFICULTY_CONFIG[level].pairCount;

  it('contains exactly pairCount pairs with unique stable IDs, all face down', () => {
    const deck = createDeck(pairCount, 1);
    expect(deck).toHaveLength(pairCount * 2);
    expect(new Set(deck.map((c) => c.id)).size).toBe(pairCount * 2);

    const counts = new Map<string, number>();
    deck.forEach((c) => counts.set(c.pairId, (counts.get(c.pairId) ?? 0) + 1));
    expect(counts.size).toBe(pairCount);
    expect([...counts.values()].every((n) => n === 2)).toBe(true);
    expect(deck.every((c) => c.status === 'faceDown')).toBe(true);

    // Each pair has its own symbol, so two different pairs never look alike.
    expect(new Set(deck.map((c) => c.symbol)).size).toBe(pairCount);
  });

  it('is reproducible with a seed and differs between seeds', () => {
    expect(createDeck(pairCount, 42).map((c) => c.id)).toEqual(createDeck(pairCount, 42).map((c) => c.id));
    expect(createDeck(pairCount, 42).map((c) => c.id)).not.toEqual(createDeck(pairCount, 43).map((c) => c.id));
  });

  it('is shuffled, not left in generation order', () => {
    const ids = createDeck(pairCount, 5).map((c) => c.id);
    const sorted = [...ids].sort();
    expect(ids).not.toEqual(sorted);
    const generated = CARD_SYMBOLS.slice(0, pairCount).flatMap((s) => [`${s.id}-a`, `${s.id}-b`]);
    expect(ids).not.toEqual(generated);
  });

  it('keeps IDs identical across different shuffles', () => {
    expect(createDeck(pairCount, 1).map((c) => c.id).sort()).toEqual(
      createDeck(pairCount, 2).map((c) => c.id).sort(),
    );
  });
});

describe('createDeck validation', () => {
  it('rejects impossible pair counts', () => {
    expect(() => createDeck(0)).toThrow(RangeError);
    expect(() => createDeck(CARD_SYMBOLS.length + 1)).toThrow(RangeError);
    expect(() => createDeck(2.5)).toThrow(RangeError);
  });
});
