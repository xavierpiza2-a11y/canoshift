import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import {
  initDatabase,
  getDatabaseStatus,
  dbGetStores,
  dbGetStoreById,
  dbGetStoreByToken,
  dbCreateStore,
  dbUpdateStore,
  dbDeleteStore,
  dbGetStoreStats,
  dbGetConfig,
  dbSaveConfig,
  dbGetAllSchedules,
  dbGetMonthSchedules,
  dbSaveMonthSchedules,
  dbUpdateShift,
  dbGetDayNotes,
  dbSaveDayNotes,
  dbDeleteMonth,
  dbGetChanges,
  dbClearChanges,
  dbGetHistory,
  dbGetAllHistory,
  dbClearEmployeeHistory,
  dbClearAllHistory,
  dbResetToCleanStore,
  dbGetFullBackup,
  dbRestoreBackup,
  dbGetAllStoresBackup,
} from './src/server/db.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// ---------------------------------------------------------------------------
// WEBSOCKET REAL-TIME BROADCAST ENGINE
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ server, path: '/ws' });

interface ClientInfo {
  ws: WebSocket;
  isAlive: boolean;
  ip: string;
}

const clients = new Set<ClientInfo>();

function broadcast(event: { type: string; storeId?: string; entity?: string; [key: string]: any }) {
  const message = JSON.stringify({
    ...event,
    _broadcastTimestamp: Date.now(),
  });

  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(message);
      } catch (err) {
        console.error('WebSocket send error:', err);
      }
    }
  }
}

wss.on('connection', (ws, req) => {
  const client: ClientInfo = {
    ws,
    isAlive: true,
    ip: req.socket.remoteAddress || 'unknown',
  };
  clients.add(client);

  // Send initial welcome & status
  ws.send(
    JSON.stringify({
      type: 'INIT_CONNECTED',
      serverTime: Date.now(),
      dbStatus: getDatabaseStatus(),
    })
  );

  ws.on('pong', () => {
    client.isAlive = true;
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
      }
    } catch {
      // ignore
    }
  });

  ws.on('close', () => {
    clients.delete(client);
  });

  ws.on('error', () => {
    clients.delete(client);
  });
});

// Heartbeat ping interval to keep connection alive
const pingInterval = setInterval(() => {
  for (const client of clients) {
    if (!client.isAlive) {
      client.ws.terminate();
      clients.delete(client);
      continue;
    }
    client.isAlive = false;
    client.ws.ping();
  }
}, 30000);

wss.on('close', () => {
  clearInterval(pingInterval);
});

// Helper to resolve current store from request headers, query, or body
function resolveStoreId(req: express.Request): string {
  const fromHeader = req.headers['x-store-id'];
  if (typeof fromHeader === 'string' && fromHeader.trim()) return fromHeader.trim();

  const fromQuery = req.query.storeId;
  if (typeof fromQuery === 'string' && fromQuery.trim()) return fromQuery.trim();

  const fromBody = req.body?.storeId;
  if (typeof fromBody === 'string' && fromBody.trim()) return fromBody.trim();

  const fallback = dbGetStoreById();
  return fallback?.id || 'store_main';
}

// ---------------------------------------------------------------------------
// AUTHENTICATION & MULTI-STORE RESOLUTION
// ---------------------------------------------------------------------------

// Health & Status
app.get('/api/health', (req, res) => {
  const storeId = resolveStoreId(req);
  res.json({
    status: 'ok',
    connectedClients: clients.size,
    db: getDatabaseStatus(storeId),
    timestamp: new Date().toISOString(),
  });
});

// Token verification: looks up matching store across all stores
app.post('/api/verify-token', async (req, res) => {
  try {
    const { token } = req.body;
    const entered = (token || '').trim().toUpperCase();
    if (!entered) {
      return res.json({ success: true, valid: false });
    }

    const matchedStore = dbGetStoreByToken(entered);
    if (matchedStore) {
      res.json({
        success: true,
        valid: true,
        store: {
          id: matchedStore.id,
          name: matchedStore.name,
          token: matchedStore.token,
        },
      });
    } else {
      res.json({ success: true, valid: false });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Store Admin PIN verification (per-store)
app.post('/api/verify-pin', async (req, res) => {
  try {
    const storeId = resolveStoreId(req);
    const store = dbGetStoreById(storeId);
    const { pin } = req.body;
    const serverPin = (store?.adminPin || '000000').trim();
    const entered = (pin || '').trim();
    const isValid = entered.length === 6 && entered === serverPin;
    res.json({ success: true, valid: isValid });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// SUPER-ADMIN / GESTIONNAIRE MULTI-MAGASINS ROUTES
// ---------------------------------------------------------------------------

// Super-admin login verification against SUPER_ADMIN_PASSWORD in .env
app.post('/api/superadmin/login', (req, res) => {
  try {
    const { password } = req.body;
    const masterPassword = (process.env.SUPER_ADMIN_PASSWORD || '').trim();
    const entered = (password || '').trim();

    if (!masterPassword) {
      return res.status(503).json({
        success: false,
        error: "Aucun mot de passe Super-Admin configuré sur le serveur. Veuillez créer votre fichier .env à partir de .env.example et définir SUPER_ADMIN_PASSWORD.",
      });
    }

    if (entered && entered === masterPassword) {
      res.json({ success: true, token: 'superadmin_authorized' });
    } else {
      res.status(401).json({ success: false, error: 'Mot de passe gestionnaire incorrect.' });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// List all stores with metadata and statistics
app.get('/api/superadmin/stores', (req, res) => {
  try {
    const stores = dbGetStores().map((s) => ({
      ...s,
      stats: dbGetStoreStats(s.id),
    }));
    res.json({ success: true, stores });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create new store
app.post('/api/superadmin/stores', async (req, res) => {
  try {
    const { name, token, adminPin } = req.body;
    const newStore = await dbCreateStore(name, token, adminPin);
    broadcast({
      type: 'STORE_CREATED',
      store: newStore,
    });
    res.json({ success: true, store: newStore });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Update store information (name, token, adminPin)
app.put('/api/superadmin/stores/:storeId', async (req, res) => {
  try {
    const { storeId } = req.params;
    const { name, token, adminPin } = req.body;
    const updatedStore = await dbUpdateStore(storeId, { name, token, adminPin });

    broadcast({
      type: 'STORE_UPDATED',
      storeId,
      store: updatedStore,
    });

    if (token) {
      broadcast({
        type: 'TOKEN_CHANGED',
        storeId,
        newToken: token.trim().toUpperCase(),
      });
    }

    if (adminPin) {
      broadcast({
        type: 'PIN_CHANGED',
        storeId,
        newPin: adminPin.trim(),
      });
    }

    res.json({ success: true, store: updatedStore });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Delete store
app.delete('/api/superadmin/stores/:storeId', async (req, res) => {
  try {
    const { storeId } = req.params;
    await dbDeleteStore(storeId);
    broadcast({
      type: 'STORE_DELETED',
      storeId,
    });
    res.json({ success: true, storeId });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Download store backup file
app.get('/api/superadmin/stores/:storeId/backup', async (req, res) => {
  try {
    const { storeId } = req.params;
    const store = dbGetStoreById(storeId);
    if (!store) return res.status(404).json({ success: false, error: 'Magasin introuvable' });

    const backup = await dbGetFullBackup(storeId);
    const filename = `sauvegarde_${store.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now()}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(backup);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Restore store backup file
app.post('/api/superadmin/stores/:storeId/restore', async (req, res) => {
  try {
    const { storeId } = req.params;
    const updatedConfig = await dbRestoreBackup(storeId, req.body);
    broadcast({
      type: 'BACKUP_RESTORED',
      storeId,
      config: updatedConfig,
    });
    res.json({ success: true, message: 'Sauvegarde restaurée avec succès', config: updatedConfig });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reset store data to clean template
app.post('/api/superadmin/stores/:storeId/reset', async (req, res) => {
  try {
    const { storeId } = req.params;
    const newConfig = await dbResetToCleanStore(storeId);
    broadcast({
      type: 'STORE_RESET',
      storeId,
      config: newConfig,
    });
    res.json({ success: true, config: newConfig });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Download global backup containing all stores
app.get('/api/superadmin/backup-all', async (req, res) => {
  try {
    const allBackup = await dbGetAllStoresBackup();
    const filename = `reseau_complet_backup_${Date.now()}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(allBackup);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// STORE-SCOPED STANDARD REST API ROUTES
// ---------------------------------------------------------------------------

// 1. Config
app.get('/api/config', async (req, res) => {
  try {
    const storeId = resolveStoreId(req);
    const config = await dbGetConfig(storeId);
    res.json({ success: true, storeId, config });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/config', async (req, res) => {
  try {
    const storeId = resolveStoreId(req);
    const updated = await dbSaveConfig(storeId, req.body);
    broadcast({
      type: 'CONFIG_UPDATED',
      storeId,
      config: updated,
    });

    if (req.body.adminPin) {
      broadcast({
        type: 'PIN_CHANGED',
        storeId,
        newPin: req.body.adminPin.trim(),
      });
    }

    res.json({ success: true, storeId, config: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Schedules
app.get('/api/schedules', async (req, res) => {
  try {
    const storeId = resolveStoreId(req);
    const schedules = await dbGetAllSchedules(storeId);
    res.json({ success: true, storeId, schedules });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Month Schedules
app.get('/api/schedules/:monthKey', async (req, res) => {
  try {
    const storeId = resolveStoreId(req);
    const { monthKey } = req.params;
    const schedules = await dbGetMonthSchedules(storeId, monthKey);
    res.json({ success: true, storeId, monthKey, schedules });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/schedules/:monthKey', async (req, res) => {
  try {
    const storeId = resolveStoreId(req);
    const { monthKey } = req.params;
    const { teamSchedules } = req.body;
    await dbSaveMonthSchedules(storeId, monthKey, teamSchedules || {});
    broadcast({
      type: 'SCHEDULES_UPDATED',
      storeId,
      monthKey,
      teamSchedules,
    });
    res.json({ success: true, storeId, monthKey });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Shift Update (Atomic shift modification)
app.post('/api/schedules/:monthKey/shift', async (req, res) => {
  try {
    const storeId = resolveStoreId(req);
    const { monthKey } = req.params;
    const { employeeName, dateKey, shift, hours, info } = req.body;
    if (!employeeName || !dateKey) {
      return res.status(400).json({ success: false, error: 'Paramètres manquants' });
    }

    const result = await dbUpdateShift(storeId, monthKey, employeeName, dateKey, shift, hours, info);
    broadcast({
      type: 'SHIFT_UPDATED',
      storeId,
      monthKey,
      employeeName,
      dateKey,
      shift,
      hours,
      info,
      schedule: result.schedule,
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Day Notes
app.get('/api/notes/:monthKey', async (req, res) => {
  try {
    const storeId = resolveStoreId(req);
    const { monthKey } = req.params;
    const notes = await dbGetDayNotes(storeId, monthKey);
    res.json({ success: true, storeId, monthKey, notes });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/notes/:monthKey', async (req, res) => {
  try {
    const storeId = resolveStoreId(req);
    const { monthKey } = req.params;
    const { notes } = req.body;
    await dbSaveDayNotes(storeId, monthKey, notes || {});
    broadcast({
      type: 'NOTES_UPDATED',
      storeId,
      monthKey,
      notes: notes || {},
    });
    res.json({ success: true, storeId, monthKey });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Delete Month
app.delete('/api/months/:monthKey', async (req, res) => {
  try {
    const storeId = resolveStoreId(req);
    const { monthKey } = req.params;
    await dbDeleteMonth(storeId, monthKey);
    broadcast({
      type: 'MONTH_DELETED',
      storeId,
      monthKey,
    });
    res.json({ success: true, storeId, monthKey });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Changes & Notifications
app.get('/api/changes/:employeeName', async (req, res) => {
  try {
    const storeId = resolveStoreId(req);
    const { employeeName } = req.params;
    const changes = await dbGetChanges(storeId, employeeName);
    res.json({ success: true, storeId, employeeName, changes });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/changes/:employeeName/clear', async (req, res) => {
  try {
    const storeId = resolveStoreId(req);
    const { employeeName } = req.params;
    await dbClearChanges(storeId, employeeName);
    broadcast({
      type: 'CHANGES_CLEARED',
      storeId,
      employeeName,
    });
    res.json({ success: true, storeId, employeeName });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. History
app.get('/api/history', async (req, res) => {
  try {
    const storeId = resolveStoreId(req);
    const result = await dbGetAllHistory(storeId);
    res.json({
      success: true,
      storeId,
      records: result.records,
      count: result.count,
      byEmployee: result.byEmployee,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/history/:employeeName', async (req, res) => {
  try {
    const storeId = resolveStoreId(req);
    const { employeeName } = req.params;
    const history = await dbGetHistory(storeId, employeeName);
    res.json({ success: true, storeId, employeeName, history });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Supprimer tout l'historique de modification du magasin
app.delete('/api/history', async (req, res) => {
  try {
    const storeId = resolveStoreId(req);
    const deletedCount = await dbClearAllHistory(storeId);
    broadcast({
      type: 'HISTORY_CLEARED',
      storeId,
      deletedCount,
    });
    res.json({
      success: true,
      storeId,
      deletedCount,
      message: 'Tout l\'historique des modifications a été purgé avec succès.',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Supprimer l'historique de modification d'un salarié spécifique
app.delete('/api/history/:employeeName', async (req, res) => {
  try {
    const storeId = resolveStoreId(req);
    const { employeeName } = req.params;
    const deletedCount = await dbClearEmployeeHistory(storeId, employeeName);
    broadcast({
      type: 'EMPLOYEE_HISTORY_CLEARED',
      storeId,
      employeeName,
      deletedCount,
    });
    res.json({
      success: true,
      storeId,
      employeeName,
      deletedCount,
      message: `L'historique de ${employeeName} a été supprimé (${deletedCount} entrées).`,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Reset / Blank Slate (Scoped)
app.post('/api/reset', async (req, res) => {
  try {
    const storeId = resolveStoreId(req);
    const newConfig = await dbResetToCleanStore(storeId);
    broadcast({
      type: 'STORE_RESET',
      storeId,
      config: newConfig,
    });
    res.json({ success: true, storeId, config: newConfig });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. Full Backup Export & Import (Scoped)
app.get('/api/backup', async (req, res) => {
  try {
    const storeId = resolveStoreId(req);
    const store = dbGetStoreById(storeId);
    const backup = await dbGetFullBackup(storeId);
    const safeName = (store?.name || 'magasin').toLowerCase().replace(/[^a-z0-9]/g, '_');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="planning_${safeName}_${Date.now()}.json"`);
    res.json(backup);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/backup', async (req, res) => {
  try {
    const storeId = resolveStoreId(req);
    const updatedConfig = await dbRestoreBackup(storeId, req.body);
    broadcast({
      type: 'BACKUP_RESTORED',
      storeId,
      config: updatedConfig,
    });
    res.json({ success: true, storeId, message: 'Sauvegarde restaurée avec succès', config: updatedConfig });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// SERVER STARTUP & VITE INTEGRATION
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT || '3000', 10);
const isProd = process.env.NODE_ENV === 'production';

async function startServer() {
  await initDatabase();

  if (!isProd) {
    // Development mode: Vite middleware with HMR disabled to prevent WebSocket closed without opened errors in iframe
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production mode: Serve compiled assets
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    console.log(`WebSocket server active on ws://0.0.0.0:${PORT}/ws`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
