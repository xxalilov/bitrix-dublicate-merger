import { Request, Response, NextFunction } from 'express';
import { exchangeCode, bindPlacements, bindEvents } from '../services/bitrix';

// Where Bitrix should POST CRM "record added" events. Defaults to the
// REDIRECT_URI origin + /events/handler when EVENT_HANDLER_URL is unset.
function eventHandlerUrl(): string | undefined {
  if (process.env.EVENT_HANDLER_URL) return process.env.EVENT_HANDLER_URL;
  try {
    const origin = new URL(process.env.REDIRECT_URI || '').origin;
    return `${origin}/events/handler`;
  } catch {
    return undefined;
  }
}

// Step 1: send the admin to Bitrix24's authorize page. `domain` is the portal
// host (e.g. company.bitrix24.ru), passed by Bitrix24 when the app is opened.
export const authInstall = (req: Request, res: Response) => {
  const domain = String(req.query.DOMAIN || req.query.domain || '');
  if (!domain) return res.status(400).send('domain required');
  const clientId = encodeURIComponent(process.env.CLIENT_ID || '');
  const redirectUri = encodeURIComponent(process.env.REDIRECT_URI || '');
  const url = `https://${domain}/oauth/authorize/?client_id=${clientId}&response_type=code&redirect_uri=${redirectUri}`;
  res.redirect(url);
};

// Step 2: Bitrix24 redirects back with `code` (+ domain/member_id). Exchange it
// for tokens and store the portal.
export const authCallback = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = String(req.query.code || '');
    const domain = String(req.query.domain || req.query.DOMAIN || '');
    if (!code) throw new Error('code required');
    const portal = await exchangeCode(code, domain);

    // Register the app's UI entry points in CRM (best-effort).
    const handler = process.env.APP_HANDLER_URL;
    if (handler) await bindPlacements(portal.memberId, handler).catch(() => {});

    // Subscribe to CRM add-events so we can auto-merge new duplicates (best-effort).
    const evtHandler = eventHandlerUrl();
    if (evtHandler) await bindEvents(portal.memberId, evtHandler).catch(() => {});

    res.send(
      `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;text-align:center;padding:40px">` +
      `<h3>✅ Приложение установлено</h3><p>Портал: ${portal.domain}</p>` +
      `<p>Откройте «Поиск и объединение дубликатов» в CRM.</p></body>`,
    );
  } catch (err) {
    next(err);
  }
};
