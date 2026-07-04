import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import { initDb } from './db';
import { authInstall, authCallback } from './controllers/auth';
import { startScan, getJobStatus, merge, startMergeAll, search } from './controllers/dedup';
import { getSettings, updateSettings } from './controllers/settings';
import { listHistory } from './controllers/history';
import { getStats } from './controllers/stats';
import { handleEvent } from './controllers/events';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
app.use(cors({ origin: allowedOrigins.length > 0 ? allowedOrigins : true }));
app.use(express.json());
// Bitrix24 posts install/event callbacks as form-encoded too.
app.use(express.urlencoded({ extended: true }));

// OAuth (install + token exchange) — the only unauthenticated surface.
app.get('/auth/install', authInstall);
app.get('/auth/callback', authCallback);
app.post('/auth/callback', authCallback);

// Bitrix24 CRM add-events (auto-merge on create). Authenticity is verified
// inside the handler via the portal's application_token.
app.post('/events/handler', handleEvent);

// CRM dedup API (portal resolved from the X-Member-Id header / member_id param).
app.post('/api/scan', startScan);
app.post('/api/search', search);
app.get('/api/jobs/:id', getJobStatus);
app.post('/api/merge', merge);
app.post('/api/merge-all', startMergeAll);

app.get('/api/settings', getSettings);
app.put('/api/settings', updateSettings);
app.get('/api/history', listHistory);
app.get('/api/stats', getStats);

app.get('/health', (_req, res) => res.json({ ok: true }));

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Error:', err.message);
  res.status(err.status || 500).json({ success: false, message: err.message });
});

initDb()
  .then(() => app.listen(PORT, () => console.log(`bitrix24-dedup backend on :${PORT}`)))
  .catch((err) => {
    console.error('Failed to start:', err.message);
    process.exit(1);
  });
