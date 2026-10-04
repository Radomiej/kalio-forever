import { useEffect, useRef, useState } from 'react';
import type { ExecutionProfile } from '@kalio/types';
import { getCodexModels } from '../../../services/codexModelClient';

export function useCodexModelChoices(profiles: ExecutionProfile[]) {
  const accountsKey = JSON.stringify([...new Set(profiles.filter(profile => profile.enabled
    && profile.kind === 'codex-app-server').map(profile => profile.authProfileId || profile.id))].sort());
  const [catalogs, setCatalogs] = useState<Record<string, string[] | null>>({});
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const refreshing = useRef(false);
  useEffect(() => {
    let cancelled = false;
    const current = ++generation.current;
    const accounts = JSON.parse(accountsKey) as string[];
    void Promise.all(accounts.map(async account => [account, await getCodexModels(account)] as const))
      .then(entries => { if (!cancelled && current === generation.current) setCatalogs(Object.fromEntries(entries)); })
      .catch((cause: unknown) => {
        console.error('[Codex picker] Catalog read failed', cause);
        if (!cancelled && current === generation.current) { setCatalogs({}); setError('Codex models unavailable. Recheck the connection.'); }
      });
    return () => { cancelled = true; };
  }, [accountsKey]);
  const refresh = async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    const current = ++generation.current;
    setChecking(true);
    setError(null);
    try {
      const accounts = JSON.parse(accountsKey) as string[];
      const entries = await Promise.all(accounts.map(async account => [account, await getCodexModels(account, true)] as const));
      if (current === generation.current) setCatalogs(Object.fromEntries(entries));
    } catch (cause) {
      console.error('[Codex picker] Explicit recheck failed', cause);
      if (current === generation.current) {
        setCatalogs({});
        setError('Codex models unavailable. Recheck the connection.');
      }
    } finally { refreshing.current = false; setChecking(false); }
  };
  const accounts = JSON.parse(accountsKey) as string[];
  const scopedCatalogs = Object.fromEntries(Object.entries(catalogs).filter(([account]) => accounts.includes(account)));
  return { catalogs: scopedCatalogs, checking, error, refresh, hasAccounts: accountsKey !== '[]' };
}
