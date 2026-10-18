export interface ServerStatusResponse {
  status: string;
  connectedClients: number;
  db: {
    type: string;
    connected: boolean;
    storageLocation?: string;
    totalMonths?: number;
    totalChanges?: number;
    totalHistory?: number;
    lastSavedAt?: string | null;
  };
  timestamp: string;
}

/**
 * Check server connection and status
 */
export async function checkServerHealth(): Promise<ServerStatusResponse | null> {
  try {
    const res = await fetch('/api/health', { cache: 'no-cache' });
    if (res.ok) {
      return await res.json();
    }
  } catch {
    // Offline or unreachable
  }
  return null;
}
