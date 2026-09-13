import { useMemo, useState } from 'react';
import type { PersonaAvatarToken } from '@kalio/types';
import { PersonaAvatar } from './PersonaAvatar';
import { buildAvatarCandidates, normalizeAvatarSeed } from './persona-avatar.utils';

const BATCH_SIZE = 24;

interface Props {
  baseSeed: string;
  selected: PersonaAvatarToken;
  onClose: () => void;
  onSelect: (token: PersonaAvatarToken) => void;
}

function tokensEqual(a: PersonaAvatarToken, b: PersonaAvatarToken): boolean {
  return a.avatarSeed === b.avatarSeed;
}

export function PersonaAvatarModal({ baseSeed, selected, onClose, onSelect }: Props) {
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);
  const normalizedSeed = normalizeAvatarSeed(baseSeed);
  const candidates = useMemo(
    () => buildAvatarCandidates(normalizedSeed, 0, visibleCount),
    [normalizedSeed, visibleCount],
  );

  return (
    <dialog className="modal modal-open" data-testid="persona-avatar-modal">
      <div className="modal-box w-11/12 max-w-3xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-base">Choose avatar</h3>
        <p className="mt-1 text-xs text-base-content/60">
          Candidates are generated deterministically from the persona name seed.
        </p>

        <div className="mt-4 grid grid-cols-4 sm:grid-cols-6 gap-3 max-h-[52vh] overflow-y-auto">
          {candidates.map((candidate) => {
            const isSelected = tokensEqual(candidate, selected);
            return (
              <button
                key={`${candidate.avatarIndex}-${candidate.avatarVariant}-${candidate.avatarPaletteKey}`}
                type="button"
                data-testid={`persona-avatar-option-${candidate.avatarIndex}`}
                className={`rounded-lg border p-2 transition-colors ${
                  isSelected ? 'border-primary bg-primary/10' : 'border-base-300 hover:bg-base-200/40'
                }`}
                onClick={() => onSelect(candidate)}
              >
                <PersonaAvatar token={candidate} size={56} />
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            className="btn btn-sm btn-outline"
            data-testid="persona-avatar-load-more-btn"
            onClick={() => setVisibleCount((count) => count + BATCH_SIZE)}
          >
            Load more
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="button" onClick={onClose}>close</button>
      </form>
    </dialog>
  );
}
