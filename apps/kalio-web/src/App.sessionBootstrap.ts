import { useEffect, useRef } from 'react';
import { useSessionStore } from './store/sessionStore';
import { eventBus } from './services/eventBus';
import { loadConversationSessions, loadRuntimeWatchlist } from './services/sessionBootstrap';
import {
  identifyWatchedSession,
  replaceBaselineWatchedSessions,
  resetSessionWatchConnectionEpoch,
} from './services/sessionWatchRegistry';
import { preloadRuntimeWatchSessionHistory } from './features/chat/runtimeWatchHistoryBootstrap';
import { mergeSessionsPreservingLocal } from './features/sessions/mergeSessionsPreservingLocal';

export function useAppSessionBootstrap({ isTalkActive }: { isTalkActive: boolean }) {
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const setSessions = useSessionStore((state) => state.setSessions);
  const epochs = useRef({ metadata: 0, watch: 0 });
  const wasTalkActive = useRef(isTalkActive);

  useEffect(() => {
    let disposed = false;
    const generation = epochs.current;
    const loadRuntimeState = (force: boolean) => {
      const metadataRequest = ++generation.metadata;
      const watchRequest = ++generation.watch;
      const shouldFetchSessions = force || useSessionStore.getState().sessions.length === 0;
      void Promise.all([
        shouldFetchSessions
          ? (force ? loadConversationSessions({ force: true }) : loadConversationSessions())
          : Promise.resolve(useSessionStore.getState().sessions),
        force ? loadRuntimeWatchlist({ force: true }) : loadRuntimeWatchlist(),
      ])
        .then(([sessionsFromApi, runtimeWatchTargets]) => {
          if (disposed) return;
          if (generation.metadata === metadataRequest && shouldFetchSessions) {
            setSessions(mergeSessionsPreservingLocal(useSessionStore.getState().sessions, sessionsFromApi));
          }
          // Talk refreshes metadata only; they must not invalidate watch restoration.
          if (generation.watch !== watchRequest) return;
          const reason = force ? 'reconnect' : 'bootstrap';
          replaceBaselineWatchedSessions(runtimeWatchTargets.map((target) => target.sessionId), `${reason}-watchlist`);
          void preloadRuntimeWatchSessionHistory({
            sessions: useSessionStore.getState().sessions,
            runtimeWatchTargets,
            ...(force ? { force: true } : {}),
          });
          identifyWatchedSession(useSessionStore.getState().activeSessionId, `${reason}-active-session`, { sticky: true });
        })
        .catch((err: unknown) => {
          console.warn(force
            ? '[App] Failed to refresh sessions after reconnect'
            : '[App] Failed to load bootstrap runtime state', err);
        });
    };

    loadRuntimeState(false);
    const offReconnect = eventBus.onReconnect(() => {
      resetSessionWatchConnectionEpoch('socket-reconnect');
      loadRuntimeState(true);
    });
    return () => {
      disposed = true;
      ++generation.metadata;
      ++generation.watch;
      offReconnect();
    };
  }, [setSessions]);

  useEffect(() => {
    identifyWatchedSession(activeSessionId, 'active-session', { sticky: true });
  }, [activeSessionId]);

  useEffect(() => {
    const enteredTalk = isTalkActive && !wasTalkActive.current;
    wasTalkActive.current = isTalkActive;
    if (!enteredTalk) return;
    const requestEpoch = ++epochs.current.metadata;
    // A rising edge must start a fresh request, even while an older load is pending.
    void loadConversationSessions({ force: true })
      .then((sessionsFromApi) => {
        if (epochs.current.metadata !== requestEpoch) return;
        setSessions(mergeSessionsPreservingLocal(useSessionStore.getState().sessions, sessionsFromApi));
      })
      .catch((err: unknown) => {
        console.warn('[App] Failed to refresh sessions on Talk entry', err);
      });
  }, [isTalkActive, setSessions]);
}
