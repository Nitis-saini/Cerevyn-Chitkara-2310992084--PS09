import type { CSSProperties } from 'react';
import { DIFFICULTY_CONFIG } from '../config/gameConfig';
import type { Card, Difficulty } from '../types/game';
import { MemoryCard } from './MemoryCard';

interface GameBoardProps {
  cards: Card[];
  difficulty: Difficulty;
  onCardSelect: (cardId: string) => void;
}

export function GameBoard({ cards, difficulty, onCardSelect }: GameBoardProps) {
  const { columns, rows } = DIFFICULTY_CONFIG[difficulty];
  return (
    <div
      className="board"
      data-testid="board"
      data-columns={columns}
      data-rows={rows}
      role="group"
      aria-label={`Memory board, ${columns} by ${rows} grid of ${cards.length} cards`}
      style={
        {
          '--cols': columns,
          '--rows': rows,
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        } as CSSProperties
      }
    >
      {cards.map((card, index) => (
        <MemoryCard key={card.id} card={card} position={index + 1} onSelect={onCardSelect} />
      ))}
    </div>
  );
}
