import { useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

type ChangeEvent = 'INSERT' | 'UPDATE';
const DEFAULT_EVENTS: readonly ChangeEvent[] = ['INSERT', 'UPDATE'];

export interface RealtimeTableSubscription {
  table: string;
  filter?: string;
  events?: readonly ChangeEvent[];
}

export type RealtimeConnectionStatus = 'connecting' | 'live' | 'reconnecting';

interface Options {
  supabase: SupabaseClient | null;
  identity: string | null;
  scope: string;
  tables: readonly RealtimeTableSubscription[];
  onChange: () => void | Promise<void>;
  fallbackIntervalMs?: number;
}

/** Subscribe only to role-visible table changes and quietly reload the current view. */
export function useRealtimeRefresh({
  supabase,
  identity,
  scope,
  tables,
  onChange,
  fallbackIntervalMs = 30_000,
}: Options): RealtimeConnectionStatus {
  const [status, setStatus] = useState<RealtimeConnectionStatus>('connecting');
  const refreshRef = useRef(onChange);
  refreshRef.current = onChange;
  const tablesKey = JSON.stringify(tables);

  useEffect(() => {
    if (!supabase || !identity || !tables.length) {
      setStatus('connecting');
      return;
    }

    let active = true;
    let connected = false;
    let hasConnected = false;
    let refreshRunning = false;
    let refreshQueued = false;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;

    const runRefresh = () => {
      if (!active || document.visibilityState !== 'visible') return;
      if (refreshRunning) {
        refreshQueued = true;
        return;
      }
      refreshRunning = true;
      void Promise.resolve()
        .then(() => refreshRef.current())
        .catch(() => undefined)
        .finally(() => {
          refreshRunning = false;
          if (active && refreshQueued) {
            refreshQueued = false;
            runRefresh();
          }
        });
    };

    const scheduleRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(runRefresh, 180);
    };

    const channelName = `fixmate-live-${scope}-${identity}-${crypto.randomUUID()}`;
    let channel = supabase.channel(channelName);
    for (const tableSubscription of tables) {
      for (const event of tableSubscription.events ?? DEFAULT_EVENTS) {
        channel = channel.on(
          'postgres_changes',
          {
            event,
            schema: 'public',
            table: tableSubscription.table,
            ...(tableSubscription.filter ? { filter: tableSubscription.filter } : {}),
          },
          scheduleRefresh,
        );
      }
    }

    channel.subscribe((nextStatus) => {
      if (!active) return;
      if (nextStatus === 'SUBSCRIBED') {
        const wasConnected = connected;
        connected = true;
        setStatus('live');
        // Refresh on first join and reconnect to cover changes missed while offline.
        if (!hasConnected || !wasConnected) scheduleRefresh();
        hasConnected = true;
      } else if (nextStatus === 'CHANNEL_ERROR' || nextStatus === 'TIMED_OUT' || nextStatus === 'CLOSED') {
        connected = false;
        setStatus('reconnecting');
      }
    });

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') scheduleRefresh();
    };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);

    const fallbackTimer = setInterval(() => {
      if (!connected && document.visibilityState === 'visible') scheduleRefresh();
    }, fallbackIntervalMs);

    return () => {
      active = false;
      if (debounceTimer) clearTimeout(debounceTimer);
      clearInterval(fallbackTimer);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      void supabase.removeChannel(channel);
    };
  }, [supabase, identity, scope, tablesKey, fallbackIntervalMs]);

  return status;
}
