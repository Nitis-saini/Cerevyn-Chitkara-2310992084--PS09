import { memo } from 'react';
import type { Card } from '../types/game';

interface MemoryCardProps {
  card: Card;
  position: number;
  onSelect: (cardId: string) => void;
}

function MemoryCardBase({ card, position, onSelect }: MemoryCardProps) {
  const revealed = card.status !== 'faceDown';
  const label =
    card.status === 'faceDown'
      ? `Card ${position}, face down`
      : card.status === 'faceUp'
        ? `Card ${position}, face up: ${card.label}`
        : `Card ${position}, matched: ${card.label}`;

  return (
    <button
      type="button"
      className="card"
      data-status={card.status}
      data-testid={`card-${card.id}`}
      aria-label={label}
      aria-disabled={card.status === 'matched' || undefined}
      onClick={() => onSelect(card.id)}
    >
      <span className="card-inner" data-revealed={revealed} aria-hidden="true">
        <span className="card-face card-back" />
        <span className="card-face card-front">{card.symbol}</span>
      </span>
    </button>
  );
}

export const MemoryCard = memo(MemoryCardBase);
