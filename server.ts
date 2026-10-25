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
import {
  createSession,
  getSession,
  revokeStoreSessions,
  revokeAllForStore,
  safeEqual,
  FailureLimiter,
  publicConfig,
} from './src/server/auth.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

app.disable('x-powered-by');
// Caddy tourne sur la même machine : on fait confiance à X-Forwarded-For venant des réseaux locaux/privés
app.set('trust proxy', 'loopback, uniquelocal');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Petit parseur pour les routes publiques ; le gros parseur (15 Mo) n'est monté qu'APRÈS authentification
app.use(['/api/verify-token', '/api/verify-pin', '/api/superadmin/login'], express.json({ limit: '4kb' }));
const bigJson = express.json({ limit: '15mb' });

// ---------------------------------------------------------------------------
// AUTHENTIFICATION : sessions magasin / admin (PIN) / super-admin
// ---------------------------------------------------------------------------
function bearer(req: express.Request): string | undefined {
  const h = req.headers.authorization;
  if (typeof h === 'string' && h.startsWith('Bearer ')) return h.slice(7).trim();
  return undefined;
}

function requireStore(req: express.Request, res: express.Response, next: express.NextFunction) {
  const s = getSession(bearer(req), 'store');
  if (!s?.storeId) {
    return res.status(401).json({ success: false, error: 'Authentification requise', code: 'AUTH_REQUIRED' });
  }
  const hdr = req.headers['x-store-id'];
  if (typeof hdr === 'string' && hdr.trim() && hdr.trim() !== s.storeId) {
    return res.status(403).json({ success: false, error: 'Magasin non autorisé', code: 'STORE_MISMATCH' });
  }
  (req as any).auth = { storeId: s.storeId };
  next();
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const a = getSession(req.headers['x-admin-session'], 'admin');
  if (!a || a.storeId !== (req as any).auth?.storeId) {
    return res.status(403).json({ success: false, error: 'Droits administrateur requis', code: 'ADMIN_REQUIRED' });
  }
  next();
}

function requireSuper(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!getSession(req.headers['x-superadmin-token'], 'super')) {
    return res.status(401).json({ success: false, error: 'Authentification gestionnaire requise', code: 'SUPER_REQUIRED' });
  }
  next();
}

// Limitation des tentatives (échecs) : clé = IP (+ magasin pour le PIN)
const tokenLimiter = new FailureLimiter(10, 15 * 60 * 1000, 15 * 60 * 1000);
const pinLimiter = new FailureLimiter(5, 15 * 60 * 1000, 15 * 60 * 1000);
const superLimiter = new FailureLimiter(5, 15 * 60 * 1000, 15 * 60 * 1000);

function tooMany(res: express.Response, seconds: number) {
  res.setHeader('Retry-After', String(seconds));
  return res.status(429).json({
    success: false,
    error: `Trop de tentatives. Réessayez dans ${Math.ceil(seconds / 60)} min.`,
    retryAfter: seconds,
  });
}

// ---------------------------------------------------------------------------
// WEBSOCKET REAL-TIME BROADCAST ENGINE
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({
  server,
  path: '/ws',
  maxPayload: 64 * 1024,
  verifyClient: (info: any, cb: (ok: boolean, code?: number, msg?: string) => void) => {
    try {
      const url = new URL(info.req.url || '', 'http://localhost');
      const store = getSession(url.searchParams.get('session'), 'store');
      const isSuper = Boolean(getSession(url.searchParams.get('sa'), 'super'));
      if (!store?.storeId && !isSuper) return cb(false, 401, 'Unauthorized');
      info.req.wsAuth = { storeId: store?.storeId, isSuper };
      cb(true);
    } catch {
      cb(false, 400, 'Bad Request');
    }
  },
} as any);

interface ClientInfo {
  ws: WebSocket;
  isAlive: boolean;
  ip: string;
  storeId?: string;
  isSuper: boolean;
}

const clients = new Set<ClientInfo>();

function broadcast(event: { type: string; storeId?: string; entity?: string; superOnly?: boolean; [key: string]: any }) {
  const { superOnly, newPin: _p, newToken: _t, ...clean } = event;
  const safe: Record<string, any> = { ...clean };
  if (safe.config) safe.config = publicConfig(safe.config);
  const message = JSON.stringify({
    ...safe,
    _broadcastTimestamp: Date.now(),
  });

  for (const client of clients) {
    // Un client ne reçoit que les événements de SON magasin ; les événements
    // de gestion (création/modification de magasins) sont réservés au super-admin.
    const allowed =
      client.isSuper || (!superOnly && event.storeId !== undefined && event.storeId === client.storeId);
    if (!allowed) continue;
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
    storeId: (req as any).wsAuth?.storeId,
    isSuper: Boolean((req as any).wsAuth?.isSuper),
  };
  clients.add(client);

  // Send initial welcome (aucune information d'infrastructure)
  ws.send(
    JSON.stringify({
      type: 'INIT_CONNECTED',
      serverTime: Date.now(),
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

function dropStoreSockets(storeId: string, delayMs = 500) {
  setTimeout(() => {
    for (const c of clients) {
      if (c.storeId === storeId && !c.isSuper) {
        try { c.ws.close(4401, 'session revoked'); } catch { /* ignore */ }
      }
    }
  }, delayMs);
}

// Magasin résolu par l'authentification (jamais par un simple en-tête client)
function resolveStoreId(req: express.Request): string {
  return (req as any).auth?.storeId as string;
}

// ---------------------------------------------------------------------------
// AUTHENTICATION & MULTI-STORE RESOLUTION
// ---------------------------------------------------------------------------

// Health & Status
app.get('/api/health', (req, res) => {
  const store = getSession(bearer(req), 'store');
  if (!store?.storeId) {
    return res.json({ status: 'ok', timestamp: new Date().toISOString() });
  }
  let connected = 0;
  for (const c of clients) if (c.storeId === store.storeId) connected++;
  res.json({
    status: 'ok',
    connectedClients: connected,
    db: getDatabaseStatus(store.storeId),
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

    const limitKey = req.ip || 'unknown';
    const wait = tokenLimiter.check(limitKey);
    if (wait) return tooMany(res, wait);

    const matchedStore = dbGetStoreByToken(entered);
    if (matchedStore) {
      tokenLimiter.success(limitKey);
      res.json({
        success: true,
        valid: true,
        session: createSession('store', matchedStore.id),
        store: {
          id: matchedStore.id,
          name: matchedStore.name,
          token: matchedStore.token,
        },
      });
    } else {
      tokenLimiter.fail(limitKey);
      res.json({ success: true, valid: false });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Store Admin PIN verification (per-store)
app.post('/api/verify-pin', requireStore, async (req, res) => {
  try {
    const storeId = resolveStoreId(req);
    const limitKey = `${req.ip || 'unknown'}|${storeId}`;
    const wait = pinLimiter.check(limitKey);
    if (wait) return tooMany(res, wait);

    const store = dbGetStoreById(storeId);
    const { pin } = req.body;
    const serverPin = (store?.adminPin || '000000').trim();
    const entered = String(pin || '').trim();
    const isValid = entered.length === 6 && safeEqual(entered, serverPin);
    if (isValid) {
      pinLimiter.success(limitKey);
      res.json({ success: true, valid: true, adminSession: createSession('admin', storeId) });
    } else {
      pinLimiter.fail(limitKey);
      res.json({ success: true, valid: false });
    }
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

    const limitKey = req.ip || 'unknown';
    const wait = superLimiter.check(limitKey);
    if (wait) return tooMany(res, wait);

    if (entered && safeEqual(entered, masterPassword)) {
      superLimiter.success(limitKey);
      res.json({ success: true, token: createSession('super') });
    } else {
      superLimiter.fail(limitKey);
      res.status(401).json({ success: false, error: 'Mot de passe gestionnaire incorrect.' });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Toutes les routes super-admin suivantes exigent une session gestionnaire
app.use('/api/superadmin', requireSuper, bigJson);

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
      superOnly: true,
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
    const beforeStore = dbGetStoreById(storeId);
    const prevToken = beforeStore?.token;
    const prevPin = beforeStore?.adminPin;
    const updatedStore = await dbUpdateStore(storeId, { name, token, adminPin });

    broadcast({
      type: 'STORE_UPDATED',
      superOnly: true,
      storeId,
      store: updatedStore,
    });

    // Seuls les VRAIS changements révoquent les sessions
    if (token && token.trim().toUpperCase() !== prevToken) {
      broadcast({ type: 'TOKEN_CHANGED', storeId });
      revokeStoreSessions(storeId, 'store');
      dropStoreSockets(storeId);
    }

    if (adminPin && adminPin.trim() !== prevPin) {
      broadcast({ type: 'PIN_CHANGED', storeId });
      revokeStoreSessions(storeId, 'admin');
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
      superOnly: true,
      storeId,
    });
    revokeAllForStore(storeId);
    dropStoreSockets(storeId, 0);
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
    res.json({ success: true, message: 'Sauvegarde restaurée avec succès', config: publicConfig(updatedConfig) });
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
    res.json({ success: true, config: publicConfig(newConfig) });
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
// STORE-SCOPED STANDARD REST API ROUTES (session magasin obligatoire)
// ---------------------------------------------------------------------------
app.use('/api', requireStore, bigJson);

// 1. Config
app.get('/api/config', async (req, res) => {
  try {
    const storeId = resolveStoreId(req);
    const config = await dbGetConfig(storeId);
    res.json({ success: true, storeId, config: publicConfig(config) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/config', requireAdmin, async (req, res) => {
  try {
    const storeId = resolveStoreId(req);
    const beforeStore = dbGetStoreById(storeId);
    const prevToken = beforeStore?.token;
    const prevPin = beforeStore?.adminPin;
    const updated = await dbSaveConfig(storeId, req.body);
    broadcast({
      type: 'CONFIG_UPDATED',
      storeId,
      config: updated,
    });

    if (typeof req.body.apiToken === 'string' && req.body.apiToken.trim().toUpperCase() !== prevToken) {
      broadcast({ type: 'TOKEN_CHANGED', storeId });
      revokeStoreSessions(storeId, 'store');
      dropStoreSockets(storeId);
    }

    if (typeof req.body.adminPin === 'string' && req.body.adminPin.trim() && req.body.adminPin.trim() !== prevPin) {
      broadcast({ type: 'PIN_CHANGED', storeId });
      revokeStoreSessions(storeId, 'admin');
    }

    res.json({ success: true, storeId, config: publicConfig(updated) });
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

app.post('/api/schedules/:monthKey', requireAdmin, async (req, res) => {
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
app.post('/api/schedules/:monthKey/shift', requireAdmin, async (req, res) => {
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

app.post('/api/notes/:monthKey', requireAdmin, async (req, res) => {
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
app.delete('/api/months/:monthKey', requireAdmin, async (req, res) => {
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
app.delete('/api/history', requireAdmin, async (req, res) => {
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
app.delete('/api/history/:employeeName', requireAdmin, async (req, res) => {
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
app.post('/api/reset', requireAdmin, async (req, res) => {
  try {
    const storeId = resolveStoreId(req);
    const newConfig = await dbResetToCleanStore(storeId);
    broadcast({
      type: 'STORE_RESET',
      storeId,
      config: newConfig,
    });
    res.json({ success: true, storeId, config: publicConfig(newConfig) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. Full Backup Export & Import (Scoped)
app.get('/api/backup', requireAdmin, async (req, res) => {
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

app.post('/api/backup', requireAdmin, async (req, res) => {
  try {
    const storeId = resolveStoreId(req);
    const updatedConfig = await dbRestoreBackup(storeId, req.body);
    broadcast({
      type: 'BACKUP_RESTORED',
      storeId,
      config: updatedConfig,
    });
    res.json({ success: true, storeId, message: 'Sauvegarde restaurée avec succès', config: publicConfig(updatedConfig) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Erreurs de parsing / taille : réponse JSON propre, sans détail interne
app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!err) return next();
  const status = err.status === 413 ? 413 : err.status === 400 ? 400 : 500;
  res.status(status).json({ success: false, error: status === 413 ? 'Requête trop volumineuse' : 'Requête invalide' });
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
