import type { Persona } from '@kalio/types';
import { PersonaAvatar } from './PersonaAvatar';
import { formatPersonaListMeta, personaToAvatarToken } from './persona-avatar.utils';

interface Props {
  persona: Persona;
  selected: boolean;
  onSelect: () => void;
}

export function PersonaListItem({ persona, selected, onSelect }: Props) {
  const avatar = personaToAvatarToken(persona);

  return (
    <button
      type="button"
      data-testid="persona-item"
      onClick={onSelect}
      className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
        selected
          ? 'border-sky-500/60 bg-base-100 shadow-[0_0_0_1px_rgba(56,189,248,0.18)]'
          : 'border-base-300 bg-base-100/70 hover:bg-base-100'
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <PersonaAvatar token={avatar} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium truncate">{persona.name}</span>
            <span className="text-[10px] text-base-content/40 font-mono truncate">{persona.model}</span>
          </div>
          <p className="mt-0.5 text-[11px] text-base-content/45 truncate">
            {formatPersonaListMeta(persona)}
          </p>
        </div>
      </div>
    </button>
  );
}
