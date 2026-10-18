/**
 * Cross-tab & Real-time App Sync Broadcaster
 * Synchronizes schedules, employees, store configuration and database state
 * across all active browser tabs and client instances.
 */

export interface SyncPayload {
  type: 'SYNC_ALL' | 'PLANNING_UPDATED' | 'EMPLOYEES_UPDATED' | 'DB_CONNECTED';
  monthKey?: string;
  teamSchedules?: Record<string, any>;
  employees?: any[];
  storeName?: string;
  timestamp: number;
}

const CHANNEL_NAME = 'planning_pro_realtime_sync';

let broadcastChannel: BroadcastChannel | null = null;
if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
  try {
    broadcastChannel = new BroadcastChannel(CHANNEL_NAME);
  } catch {
    broadcastChannel = null;
  }
}

/**
 * Broadcast an immediate update to all open tabs and windows
 */
export function broadcastSync(payload: Omit<SyncPayload, 'timestamp'>): void {
  const fullPayload: SyncPayload = {
    ...payload,
    timestamp: Date.now(),
  };

  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage(fullPayload);
    } catch (e) {
      console.warn('BroadcastChannel error:', e);
    }
  }

  // Also dispatch a custom event on current window for same-tab instant reactivity
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('planning_internal_sync', { detail: fullPayload })
    );
  }
}

/**
 * Subscribe to sync events
 */
export function subscribeToBroadcastSync(
  callback: (payload: SyncPayload) => void
): () => void {
  if (typeof window === 'undefined') return () => {};

  const handleMessage = (event: MessageEvent<SyncPayload>) => {
    if (event.data && event.data.type) {
      callback(event.data);
    }
  };

  const handleCustomEvent = (event: Event) => {
    const custom = event as CustomEvent<SyncPayload>;
    if (custom.detail && custom.detail.type) {
      callback(custom.detail);
    }
  };

  if (broadcastChannel) {
    broadcastChannel.addEventListener('message', handleMessage);
  }
  window.addEventListener('planning_internal_sync', handleCustomEvent);

  return () => {
    if (broadcastChannel) {
      broadcastChannel.removeEventListener('message', handleMessage);
    }
    window.removeEventListener('planning_internal_sync', handleCustomEvent);
  };
}
