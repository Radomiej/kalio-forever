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
      className={`
        group relative overflow-hidden rounded-lg select-none
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
      data-testid={`app-tile-${id}`}
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

      {/* Generate / Remove icon buttons — top-right, visible on hover/focus */}
      <div
        className="absolute top-2 right-2 z-20 flex gap-1.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
        role="group"
        aria-label="Tile actions"
      >
        {isGenerating ? (
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-black/45 text-white">
            <Loader2 size={14} className="animate-spin" />
          </span>
        ) : (
          <>
            {onGenerateIcon && (
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-black/45 text-white hover:bg-black/65 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80 cursor-pointer"
                onClick={(e) => { e.stopPropagation(); onGenerateIcon(); }}
                aria-label={`Generate icon for ${name}`}
                title="Generate icon"
                data-testid={`tile-gen-icon-${id}`}
              >
                <ImagePlus size={14} />
              </button>
            )}
            {iconUrl && onRemoveIcon && (
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-black/45 text-white hover:bg-red-600/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80 cursor-pointer"
                onClick={(e) => { e.stopPropagation(); onRemoveIcon(); }}
                aria-label={`Remove icon from ${name}`}
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

      <button
        type="button"
        className="absolute inset-y-0 left-0 right-12 z-10 flex cursor-pointer flex-col items-start justify-end rounded-md p-3 text-left outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/85"
        onClick={onClick}
        data-testid={`app-tile-open-${id}`}
        aria-label={`Open ${name}`}
      >
        <span className="w-full break-words text-left text-sm font-semibold leading-tight">
          {name}
        </span>
        {description && (
          <span className="mt-0.5 w-full break-words text-left text-[10px] leading-tight opacity-70">
            {description}
          </span>
        )}
      </button>
    </div>
  );
}
