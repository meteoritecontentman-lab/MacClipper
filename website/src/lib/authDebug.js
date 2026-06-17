const AUTH_DEBUG_STORAGE_KEY = 'macclipper-auth-debug-log';
const AUTH_DEBUG_MAX_ENTRIES = 200;

function readLogs() {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(AUTH_DEBUG_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function writeLogs(logs) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(AUTH_DEBUG_STORAGE_KEY, JSON.stringify(logs.slice(-AUTH_DEBUG_MAX_ENTRIES)));
  } catch (error) {
    // Ignore storage quota errors in debug path.
  }
}

export function clearAuthDebugLogs() {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.removeItem(AUTH_DEBUG_STORAGE_KEY);
  } catch (error) {
    // Ignore storage errors in debug path.
  }
}

export function getAuthDebugLogs() {
  return readLogs();
}

export function logAuthDebug(message, data = {}) {
  const entry = {
    ts: new Date().toISOString(),
    message,
    path: typeof window !== 'undefined' ? window.location.pathname : 'server',
    href: typeof window !== 'undefined' ? window.location.href : 'server',
    data
  };

  console.log('[auth-debug]', entry.ts, message, {
    path: entry.path,
    href: entry.href,
    ...data
  });

  const logs = readLogs();
  logs.push(entry);
  writeLogs(logs);

  if (typeof window !== 'undefined') {
    window.__MACCLIPPER_AUTH_DEBUG_LOGS__ = logs.slice(-AUTH_DEBUG_MAX_ENTRIES);
  }
}

// Expose helpers globally at module load time so they are always callable
// from the browser console regardless of whether any auth events have fired.
if (typeof window !== 'undefined') {
  window.getMacClipperAuthDebugLogs = () => getAuthDebugLogs();
  window.clearMacClipperAuthDebugLogs = () => clearAuthDebugLogs();
}
