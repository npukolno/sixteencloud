import { ipcMain, session, type BrowserWindow } from 'electron';
import { IPC_CHANNELS, SOUNDCLOUD_API_V2 } from '../../shared/constants';
import { assertMainRenderer, safeSend } from './guard';
import { eFetch } from './net';
import { getSecret, setSecret } from './store';

type AuthUser = { isLoggedIn: boolean; username: string; avatarUrl: string; userId: string };
type AuthResult = { success: boolean; error?: string; user?: AuthUser };

async function fetchMe(token: string): Promise<{ resp: Response; user: AuthUser | null }> {
  const resp = await eFetch(`${SOUNDCLOUD_API_V2}/me`, { headers: { Authorization: `OAuth ${token}` } });
  if (!resp.ok) return { resp, user: null };
  const me = await resp.json() as { username?: string; avatar_url?: string; id?: number };
  return { resp, user: { isLoggedIn: true, username: me.username || '', avatarUrl: me.avatar_url || '', userId: String(me.id || '') } };
}

/** Validate an OAuth token against the API and install it as the SoundCloud session. */
async function applyAuthToken(mainWindow: BrowserWindow, token: string): Promise<AuthResult> {
  if (typeof token !== 'string' || token.length < 8 || token.length > 4096 || !/^[A-Za-z0-9._~-]+$/.test(token)) {
    return { success: false, error: 'Invalid token format' };
  }
  try {
    const { resp, user } = await fetchMe(token);
    if (!user) return { success: false, error: `API returned ${resp.status}` };
    setSecret('authToken.token', token);
    await session.defaultSession.cookies.set({ url: 'https://soundcloud.com', name: 'oauth_token', value: token });
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript(`localStorage.setItem('oauth_token', ${JSON.stringify(token)});`).catch(() => {});
    }
    safeSend(mainWindow, IPC_CHANNELS.AUTH_STATE, user);
    // The page only reads the cookie at boot; reload so SoundCloud picks it up.
    setTimeout(() => { if (!mainWindow.isDestroyed()) mainWindow.webContents.reload(); }, 300);
    return { success: true, user };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export function setupAuthIPC(mainWindow: BrowserWindow): void {
  ipcMain.handle(IPC_CHANNELS.AUTH_SET_TOKEN, async (event, token: string) => {
    assertMainRenderer(event, mainWindow);
    return applyAuthToken(mainWindow, token);
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_VALIDATE, async (event) => {
    assertMainRenderer(event, mainWindow);
    const token = getSecret('authToken.token');
    if (!token) return { success: false };
    try {
      const { user } = await fetchMe(token);
      return user ? { success: true, user } : { success: false };
    } catch {
      return { success: false };
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, async (event) => {
    assertMainRenderer(event, mainWindow);
    setSecret('authToken.token', '');
    await session.defaultSession.cookies.remove('https://soundcloud.com', 'oauth_token');
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript(`localStorage.removeItem('oauth_token');`).catch(() => {});
    }
    safeSend(mainWindow, IPC_CHANNELS.AUTH_STATE, { isLoggedIn: false });
  });
}
