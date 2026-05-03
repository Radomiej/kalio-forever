import { useState, useEffect, useCallback } from 'react';
import { tileSizeForIndex } from './tileColors';
import { AppTile } from './AppTile';
import { QuickChatWidget } from './QuickChatWidget';
import { useTileIcons } from './useTileIcons';
import { useSessionStore } from '../../store/sessionStore';
import { apiClient, getRAApps, getRAAppGroups } from '../../services/apiClient';
import { bucketCatalogApps } from '../raapp/catalog.utils';
import type { ChatSession } from '@kalio/types';

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
  const addSession = useSessionStore((s) => s.addSession);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const setPendingMessage = useSessionStore((s) => s.setPendingMessage);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getRAAppGroups().catch(() => []),
      getRAApps().catch(() => []),
    ])
      .then(([groups, flatApps]) => {
        const buckets = bucketCatalogApps(flatApps, groups);

        const byId = new Map(flatApps.map((app) => [app.id, app]));
        const groupedCurrent: TileItem[] = groups.map((group) => {
          const currentId = group.current.meta.id;
          const fromFlat = byId.get(currentId);
          return {
            id: currentId,
            name: group.current.meta.name,
            description: group.current.meta.description ?? fromFlat?.description ?? '',
          };
        });

        const coreTiles: TileItem[] = buckets.coreApps.map((app) => ({
          id: app.id,
          name: app.name,
          description: app.description,
        }));

        const userStandaloneTiles: TileItem[] = buckets.userStandaloneApps.map((app) => ({
          id: app.id,
          name: app.name,
          description: app.description,
        }));

        const seen = new Set<string>();
        const merged = [...groupedCurrent, ...coreTiles, ...userStandaloneTiles].filter((tile) => {
          if (seen.has(tile.id)) return false;
          seen.add(tile.id);
          return true;
        });

        setTiles(merged);
      })
      .catch(() => setTiles([]))
      .finally(() => setLoading(false));
  }, []);

  const handleTileClick = useCallback(async (tile: TileItem) => {
    try {
      const { data } = await apiClient.post<ChatSession>('/api/sessions', {
        personaId: 'ra-apps',
        title: tile.name,
      });
      console.debug('[Landing] RA-App tile session created', data.id, tile.id);
      addSession(data);
      const prompt = `Run the "${tile.name}" RA-App for me.${
        tile.description ? ` ${tile.description}` : ''
      } Launch it immediately.`;
      setPendingMessage(prompt);
      setActiveSession(data.id);
      onNavigateToChat();
    } catch (err) {
      console.error('[Landing] failed to create session for tile', tile.id, err);
    }
  }, [addSession, setActiveSession, setPendingMessage, onNavigateToChat]);

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
