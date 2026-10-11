import { useState, useEffect, useCallback } from 'react';
import { tileSizeForIndex } from './tileColors';
import { AppTile } from './AppTile';
import { QuickChatWidget } from './QuickChatWidget';
import { HomeHitlInbox } from './HomeHitlInbox';
import { useTileIcons } from './useTileIcons';
import { useSessionStore } from '../../store/sessionStore';
import { getRAApps, getRAAppGroups, getExecutionProfiles } from '../../services/apiClient';
import type { ExecutionProfile } from '@kalio/types';
import { createAndActivateEmptyHostSession } from '../chat/activeConversationSession';
import { bucketCatalogApps } from '../raapp/catalog.utils';
import { buildRAAppLaunchRuntimeContext } from '../raapp/raappLaunchRuntimeContext';
import { usePendingRaAppApprovals } from '../raapp/usePendingRaAppApprovals';
import { buildRAAppRunPrompt } from '../raapp/raappExecutionProfile';

interface TileItem {
  id: string;
  name: string;
  description: string;
}

function createTileItem(id: string | undefined, name: string | undefined, description?: string): TileItem | null {
  const normalizedId = typeof id === 'string' ? id.trim() : '';
  const normalizedName = typeof name === 'string' ? name.trim() : '';

  if (!normalizedId || !normalizedName) {
    return null;
  }

  return {
    id: normalizedId,
    name: normalizedName,
    description: description ?? '',
  };
}

interface LandingPageProps {
  onNavigateToChat: () => void;
  onOpenSessionInChat?: (sessionId: string) => void;
}

export function LandingPage({ onNavigateToChat, onOpenSessionInChat }: LandingPageProps) {
  const [tiles, setTiles] = useState<TileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [executionProfileId, setExecutionProfileId] = useState('');
  const [profiles, setProfiles] = useState<ExecutionProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const { icons, generating, generateIcon, removeIcon } = useTileIcons('raapp');
  const addSession = useSessionStore((s) => s.addSession);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const setMessages = useSessionStore((s) => s.setMessages);
  const setAgentTurns = useSessionStore((s) => s.setAgentTurns);
  const setPendingRAAppLaunchIntent = useSessionStore((s) => s.setPendingRAAppLaunchIntent);
  const sessionMessages = useSessionStore((s) => s.sessionMessages);
  const pendingRaAppApprovals = usePendingRaAppApprovals(sessionMessages);

  useEffect(() => {
    let disposed = false;
    void getExecutionProfiles().then((items) => {
      if (!disposed) setProfiles(items.filter((profile) => profile.enabled));
    }).catch((error: unknown) => {
      if (!disposed) setProfilesError(`Could not load execution profiles: ${error instanceof Error ? error.message : String(error)}`);
    }).finally(() => {
      if (!disposed) setProfilesLoading(false);
    });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    Promise.all([
      getRAAppGroups().catch(() => []),
      getRAApps().catch(() => []),
    ])
      .then(([groups, flatApps]) => {
        const buckets = bucketCatalogApps(flatApps, groups);

        const byId = new Map(flatApps.map((app) => [app.id, app]));
        const groupedCurrent = groups
          .map((group) => {
            const currentId = group.current.meta.id;
            const fromFlat = currentId ? byId.get(currentId) : undefined;
            return createTileItem(
              currentId,
              group.current.meta.name,
              group.current.meta.description ?? fromFlat?.description ?? '',
            );
          })
          .filter((tile): tile is TileItem => tile !== null);

        const coreTiles = buckets.coreApps
          .map((app) => createTileItem(app.id, app.name, app.description))
          .filter((tile): tile is TileItem => tile !== null);

        const userStandaloneTiles = buckets.userStandaloneApps
          .map((app) => createTileItem(app.id, app.name, app.description))
          .filter((tile): tile is TileItem => tile !== null);

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
      setLaunchError(null);
      const session = await createAndActivateEmptyHostSession({
        personaId: 'ra-apps',
        ...(executionProfileId ? { executionProfileId } : {}),
        title: tile.name,
        runtimeContext: buildRAAppLaunchRuntimeContext(tile.id, tile.name, 'home_tile'),
        addSession,
        setActiveSession,
        setMessages,
        setAgentTurns,
        reason: 'landing',
      });
      console.debug('[Landing] RA-App tile session created', session.id, tile.id);
      const prompt = buildRAAppRunPrompt(tile.id, tile.name, tile.description);
      setPendingRAAppLaunchIntent({
        targetSessionId: session.id,
        appId: tile.id,
        appName: tile.name,
        personaId: 'ra-apps',
        prompt,
        source: 'home_tile',
      });
      if (onOpenSessionInChat) {
        onOpenSessionInChat(session.id);
        return;
      }
      onNavigateToChat();
    } catch (err) {
      console.error('[Landing] failed to create session for tile', tile.id, err);
      setLaunchError(`App launch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [executionProfileId, addSession, onNavigateToChat, onOpenSessionInChat, setActiveSession, setAgentTurns, setMessages, setPendingRAAppLaunchIntent]);

  const handleQuickChatSent = useCallback(() => {
    onNavigateToChat();
  }, [onNavigateToChat]);

  return (
    <div
      className="h-full overflow-y-auto px-4 py-5 sm:px-7 md:px-10"
      data-testid="landing-page"
    >
      {/* Header */}
      <div className="mb-5 flex items-center gap-3">
        <span className="text-primary font-black text-3xl drop-shadow-[0_0_12px_oklch(0.60_0.176_232.6/0.7)]">
          KALIO
        </span>
        <span className="text-base-content/40 text-sm">Your apps at a glance</span>
      </div>

      <HomeHitlInbox
        onOpenSession={onOpenSessionInChat ?? (() => onNavigateToChat())}
        raAppApprovals={pendingRaAppApprovals.approvals}
        onRaAppApprovalSettled={pendingRaAppApprovals.markSettled}
      />

      {/* Grid: quick-chat widget + app tiles */}
      <div className="mb-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-base-content/70">App execution profile</span>
          <select aria-label="App execution profile" className="select select-bordered w-full text-xs"
            value={executionProfileId} onChange={(event) => setExecutionProfileId(event.target.value)} disabled={profilesLoading}>
            <option value="">Use saved default execution profile</option>
            {profiles.map((profile) => <option key={profile.id} value={profile.id}>
              {profile.name} · {profile.kind}{profile.model ? ` · ${profile.model}` : ''}
            </option>)}
          </select>
        </label>
        {profilesLoading && <p role="status" className="text-xs">Loading execution profiles…</p>}
        {profilesError && <p role="alert" className="text-xs text-error">{profilesError}</p>}
        {launchError && <p role="alert" className="mt-2 text-sm text-error">{launchError}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3 pb-8 sm:grid-cols-3 lg:grid-cols-4">

        {/* Quick Chat — spans full row */}
        <QuickChatWidget onMessageSent={handleQuickChatSent} />

        {/* Loading skeleton */}
        {loading && Array.from({ length: 6 }).map((_, i) => (
          <div
            key={`skeleton-${i}`}
            className={`min-h-40 rounded-xl bg-base-300/50 animate-pulse ${i % 5 === 2 ? 'col-span-2' : ''}`}
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
            No RAApps available. Upload a ZIP or load core apps from Settings.
          </div>
        )}
      </div>
    </div>
  );
}
