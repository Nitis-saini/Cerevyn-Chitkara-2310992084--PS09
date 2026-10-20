// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ValidationError, isValidId, parseRoundSubmission } from '../validate';

const round = {
  clientRoundId: 'round-aaaa1111',
  completed: true,
  difficulty: 'easy',
  gridColumns: 4,
  gridRows: 4,
  pairCount: 8,
  completedPairs: 8,
  moves: 12,
  mismatches: 4,
  elapsedSeconds: 40,
};

describe('parseRoundSubmission', () => {
  it('accepts a valid completed round', () => {
    const parsed = parseRoundSubmission(round);
    expect(parsed.moves).toBe(12);
    expect(parsed.clientRoundId).toBe('round-aaaa1111');
    expect(parsed.completed).toBe(true);
  });

  it.each([
    ['null body', null],
    ['array body', []],
    ['missing clientRoundId', { ...round, clientRoundId: undefined }],
    ['unsafe clientRoundId', { ...round, clientRoundId: '../etc/passwd' }],
    ['completed not true', { ...round, completed: false }],
    ['unknown field (free text)', { ...round, name: 'Sam' }],
    ['unsupported difficulty', { ...round, difficulty: 'insane' }],
    ['prototype-key difficulty', { ...round, difficulty: 'constructor' }],
    ['grid not matching difficulty', { ...round, gridColumns: 5 }],
    ['string number', { ...round, moves: '12' }],
    ['float moves', { ...round, moves: 12.5 }],
    ['negative mismatches', { ...round, mismatches: -1, moves: 7 }],
    ['moves inconsistent with pairs + mismatches', { ...round, moves: 99 }],
    ['not every pair matched', { ...round, completedPairs: 5, moves: 9 }],
    ['absurd time', { ...round, elapsedSeconds: 10 ** 9 }],
  ])('rejects %s', (_name, body) => {
    expect(() => parseRoundSubmission(body)).toThrow(ValidationError);
  });
});

describe('isValidId', () => {
  it('accepts UUIDs and rejects unsafe strings', () => {
    expect(isValidId('3f2b8c1e-9a4d-4c55-8e01-0a1b2c3d4e5f')).toBe(true);
    expect(isValidId('short')).toBe(false);
    expect(isValidId('has space in it')).toBe(false);
    expect(isValidId(42)).toBe(false);
  });
});
