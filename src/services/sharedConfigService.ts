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
