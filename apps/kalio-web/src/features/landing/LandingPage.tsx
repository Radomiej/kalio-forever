import { useState, useEffect, useCallback } from 'react';
import { tileSizeForIndex } from './tileColors';
import { AppTile } from './AppTile';
import { QuickChatWidget } from './QuickChatWidget';
import { useTileIcons } from './useTileIcons';
import { useSessionStore } from '../../store/sessionStore';

interface TileItem {
  id: string;
  name: string;
  description: string;
}

interface LandingPageProps {
  onNavigateToChat: () => void;
}

export function LandingPage({ onNavigateToChat }: LandingPageProps) {
  const [tiles, setTiles] = useState<TileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { icons, generating, generateIcon, removeIcon } = useTileIcons('raapp');
  const createSession = useSessionStore((s) => s.createSession);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const setPendingRAAppId = useSessionStore((s) => s.setPendingRAAppId);

  useEffect(() => {
    setLoading(true);
    fetch('/api/ra-apps')
      .then((r) => r.json())
      .then((data: TileItem[]) => setTiles(data))
      .catch(() => setTiles([]))
      .finally(() => setLoading(false));
  }, []);

  const handleTileClick = useCallback((tile: TileItem) => {
    const sessionId = createSession(tile.name);
    setPendingRAAppId(tile.id);
    setActiveSession(sessionId);
    onNavigateToChat();
  }, [createSession, setActiveSession, setPendingRAAppId, onNavigateToChat]);

  const handleQuickChatSent = useCallback(() => {
    onNavigateToChat();
  }, [onNavigateToChat]);

  return (
    <div
      className="h-full overflow-y-auto px-4 py-6 sm:px-8 md:px-12"
      data-testid="landing-page"
    >
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <span className="text-primary font-black text-3xl drop-shadow-[0_0_12px_oklch(0.60_0.176_232.6/0.7)]">
          KALIO
        </span>
        <span className="text-base-content/40 text-sm">Your apps at a glance</span>
      </div>

      {/* Grid: quick-chat widget + app tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pb-8">

        {/* Quick Chat — spans full row */}
        <QuickChatWidget onMessageSent={handleQuickChatSent} />

        {/* Loading skeleton */}
        {loading && Array.from({ length: 6 }).map((_, i) => (
          <div
            key={`skeleton-${i}`}
            className={`rounded-lg bg-base-300/50 animate-pulse ${i % 5 === 2 ? 'col-span-2 aspect-[2/1]' : 'aspect-square'}`}
          />
        ))}

        {/* App tiles */}
        {!loading && tiles.map((tile, i) => (
          <AppTile
            key={tile.id}
            id={tile.id}
            name={tile.name}
            description={tile.description}
            size={tileSizeForIndex(i)}
            index={i}
            onClick={() => handleTileClick(tile)}
            iconUrl={icons[tile.id]}
            isGenerating={generating === tile.id}
            onGenerateIcon={() => generateIcon(tile.id, tile.name, tile.description)}
            onRemoveIcon={() => removeIcon(tile.id)}
          />
        ))}

        {/* Empty state */}
        {!loading && tiles.length === 0 && (
          <div className="col-span-full text-center py-12 text-base-content/40 text-sm">
            No RA-Apps available. Upload a ZIP or load core apps from Settings.
          </div>
        )}
      </div>
    </div>
  );
}
