import { ImagePlus, Loader2, X } from 'lucide-react';
import { tileColorFromId } from './tileColors';

interface AppTileProps {
  id: string;
  name: string;
  description?: string;
  size: 'small' | 'wide';
  onClick: () => void;
  /** Stagger index for entrance animation delay */
  index: number;
  /** Pre-generated icon URL (data URL or http) */
  iconUrl?: string;
  /** True while the icon is being generated */
  isGenerating?: boolean;
  /** Called when user clicks the "generate icon" button */
  onGenerateIcon?: () => void;
  /** Called when user clicks the "remove icon" button */
  onRemoveIcon?: () => void;
}

export function AppTile({ id, name, description, size, onClick, index, iconUrl, isGenerating, onGenerateIcon, onRemoveIcon }: AppTileProps) {
  const color = tileColorFromId(id);
  const firstLetter = name.charAt(0).toUpperCase();

  return (
    <div
      role="button"
      tabIndex={0}
      className={`
        group relative overflow-hidden rounded-lg cursor-pointer select-none
        flex flex-col justify-end p-3
        transition-all duration-150 ease-out
        hover:scale-[1.04] hover:brightness-110 hover:shadow-lg
        active:scale-[0.97] active:brightness-95
        animate-[fadeSlideIn_0.3s_ease-out_both]
        ${size === 'wide' ? 'col-span-2 aspect-[2/1]' : 'aspect-square'}
      `}
      style={{
        backgroundColor: color.bg,
        color: color.text,
        animationDelay: `${index * 60}ms`,
      }}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      data-testid={`app-tile-${id}`}
      aria-label={`Open ${name}`}
      title={description ?? name}
    >
      {/* Generated icon background */}
      {iconUrl && (
        <img
          src={iconUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover opacity-60"
          draggable={false}
        />
      )}

      {/* Large background letter (only when no icon) */}
      {!iconUrl && (
        <span
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 font-black opacity-15 pointer-events-none leading-none"
          style={{ fontSize: size === 'wide' ? '5rem' : '4rem' }}
        >
          {firstLetter}
        </span>
      )}

      {/* Generate / Remove icon buttons — top-right, visible on hover */}
      <div
        className="absolute top-1.5 right-1.5 z-20 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="group"
        aria-label="Tile actions"
      >
        {isGenerating ? (
          <span className="p-1 rounded bg-black/40 text-white">
            <Loader2 size={14} className="animate-spin" />
          </span>
        ) : (
          <>
            {onGenerateIcon && (
              <button
                type="button"
                className="p-1 rounded bg-black/40 text-white hover:bg-black/60 cursor-pointer"
                onClick={(e) => { e.stopPropagation(); onGenerateIcon(); }}
                title="Generate icon"
                data-testid={`tile-gen-icon-${id}`}
              >
                <ImagePlus size={14} />
              </button>
            )}
            {iconUrl && onRemoveIcon && (
              <button
                type="button"
                className="p-1 rounded bg-black/40 text-white hover:bg-red-600/80 cursor-pointer"
                onClick={(e) => { e.stopPropagation(); onRemoveIcon(); }}
                title="Remove icon"
                data-testid={`tile-rm-icon-${id}`}
              >
                <X size={14} />
              </button>
            )}
          </>
        )}
      </div>

      {/* Gradient overlay for readability when icon image is present */}
      {iconUrl && (
        <span className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent pointer-events-none" />
      )}

      {/* App name */}
      <span className="relative z-10 text-sm font-semibold leading-tight truncate w-full text-left">
        {name}
      </span>
      {description && (
        <span className="relative z-10 text-[10px] opacity-70 leading-tight truncate w-full text-left mt-0.5">
          {description}
        </span>
      )}
    </div>
  );
}
