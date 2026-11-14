import React from 'react';
import { useSocialStore } from '../../stores/useSocialStore';

export default function FloatingReactions() {
  const floatingReactions = useSocialStore((state) => state.floatingReactions);

  if (!floatingReactions || floatingReactions.length === 0) return null;

  return (
    <div className="floating-reactions-container" aria-hidden="true">
      {floatingReactions.map((r, idx) => {
        // Random horizontal position for natural confetti-like drift
        const leftPercent = 15 + ((r.id ? String(r.id).charCodeAt(0) * 17 : idx * 23) % 70);
        return (
          <div
            key={r.id || idx}
            className="floating-reaction-item"
            style={{
              left: `${leftPercent}%`,
              animationDelay: `${(idx % 4) * 0.08}s`
            }}
          >
            <span className="reaction-emoji">{r.emoji}</span>
            {r.nickname && r.nickname !== 'Guest' && (
              <span className="reaction-sender-chip" style={{ borderColor: r.avatarColor || '#6366f1' }}>
                {r.nickname}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
