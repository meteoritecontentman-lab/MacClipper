import { supabase } from '../supabaseClient';

const SUPABASE_SESSION_LOOKUP_TIMEOUT_MS = 5000;
const SUPABASE_USER_LOOKUP_TIMEOUT_MS = 5000;

let inFlightSessionPromise = null;

function readStoredSupabaseAccessToken() {
  if (typeof window === 'undefined') {
    return '';
  }

  try {
    const storage = window.localStorage;
    const matchingKeys = [];

    for (let index = 0; index < storage.length; index += 1) {
      const key = String(storage.key(index) || '').trim();
      if (!key || !key.includes('auth-token')) {
        continue;
      }

      matchingKeys.push(key);
    }

    const orderedKeys = matchingKeys.sort((leftKey, rightKey) => {
      const leftPriority = leftKey.startsWith('sb-') ? 0 : 1;
      const rightPriority = rightKey.startsWith('sb-') ? 0 : 1;
      return leftPriority - rightPriority;
    });

    for (const key of orderedKeys) {
      const rawValue = storage.getItem(key);
      if (!rawValue) {
        continue;
      }

      try {
        const parsedValue = JSON.parse(rawValue);
        const session = parsedValue?.currentSession || parsedValue?.session || parsedValue;
        const accessToken = String(session?.access_token || parsedValue?.access_token || '').trim();
        if (accessToken) {
          return accessToken;
        }
      } catch {
        // Ignore malformed auth storage entries.
      }
    }
  } catch (error) {
    console.error('Error reading stored Supabase auth token:', error);
  }

  return '';
}

function readStoredSupabaseSession() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const storage = window.localStorage;
    const matchingKeys = [];

    for (let index = 0; index < storage.length; index += 1) {
      const key = String(storage.key(index) || '').trim();
      if (!key || !key.includes('auth-token')) {
        continue;
      }

      matchingKeys.push(key);
    }

    const orderedKeys = matchingKeys.sort((leftKey, rightKey) => {
      const leftPriority = leftKey.startsWith('sb-') ? 0 : 1;
      const rightPriority = rightKey.startsWith('sb-') ? 0 : 1;
      return leftPriority - rightPriority;
    });

    for (const key of orderedKeys) {
      const rawValue = storage.getItem(key);
      if (!rawValue) {
        continue;
      }

      try {
        const parsedValue = JSON.parse(rawValue);
        const session = parsedValue?.currentSession || parsedValue?.session || parsedValue;
        const accessToken = String(session?.access_token || parsedValue?.access_token || '').trim();
        const refreshToken = String(session?.refresh_token || parsedValue?.refresh_token || '').trim();
        const user = session?.user || parsedValue?.user || null;
        if (accessToken || refreshToken) {
          return {
            user,
            access_token: accessToken,
            refresh_token: refreshToken,
            token_type: session?.token_type || parsedValue?.token_type || 'bearer',
            expires_in: Number(session?.expires_in || parsedValue?.expires_in || 0),
            expires_at: Number(session?.expires_at || parsedValue?.expires_at || 0)
          };
        }
      } catch {
        // Ignore malformed auth storage entries.
      }
    }
  } catch (error) {
    console.error('Error reading stored Supabase session:', error);
  }

  return null;
}

export async function resolveSupabaseSession() {
  if (inFlightSessionPromise) {
    return inFlightSessionPromise;
  }

  inFlightSessionPromise = new Promise((resolve) => {
    let timeoutId = 0;

    Promise.race([
      supabase.auth.getSession(),
      new Promise((fallbackResolve) => {
        timeoutId = window.setTimeout(() => {
          fallbackResolve({
            data: { session: null },
            error: {
              message: `Supabase session lookup timed out after ${SUPABASE_SESSION_LOOKUP_TIMEOUT_MS}ms.`,
              code: 'session_timeout'
            }
          });
        }, SUPABASE_SESSION_LOOKUP_TIMEOUT_MS);
      })
    ])
      .then((sessionResult) => {
        const session = sessionResult?.data?.session || null;
        const accessToken = String(session?.access_token || '').trim();
        if (accessToken) {
          resolve({ session, accessToken, error: null, source: 'supabase.auth.getSession' });
          return;
        }

        const fallbackAccessToken = readStoredSupabaseAccessToken();
        const fallbackStoredSession = readStoredSupabaseSession();
        if (fallbackStoredSession?.user?.id) {
          resolve({
            session: fallbackStoredSession,
            accessToken: String(fallbackStoredSession.access_token || '').trim(),
            error: sessionResult?.error || null,
            source: 'localStorage-fallback-session'
          });
          return;
        }

        if (fallbackAccessToken) {
          // If we have a cached token but no hydrated session yet, resolve user
          // from the token so route guards don't treat this as signed-out.
          Promise.race([
            supabase.auth.getUser(fallbackAccessToken),
            new Promise((fallbackResolve) => {
              window.setTimeout(() => {
                fallbackResolve({ data: { user: null }, error: { code: 'user_lookup_timeout' } });
              }, SUPABASE_USER_LOOKUP_TIMEOUT_MS);
            })
          ])
            .then((userResult) => {
              const tokenUser = userResult?.data?.user || null;
              if (tokenUser) {
                resolve({
                  session: {
                    user: tokenUser,
                    access_token: fallbackAccessToken
                  },
                  accessToken: fallbackAccessToken,
                  error: sessionResult?.error || null,
                  source: 'localStorage-fallback-user'
                });
                return;
              }

              resolve({
                session: null,
                accessToken: fallbackAccessToken,
                error: sessionResult?.error || null,
                source: 'localStorage-fallback'
              });
            })
            .catch(() => {
              resolve({
                session: null,
                accessToken: fallbackAccessToken,
                error: sessionResult?.error || null,
                source: 'localStorage-fallback'
              });
            });
          return;
        }

        if (fallbackStoredSession?.refresh_token) {
          Promise.race([
            supabase.auth.refreshSession({ refresh_token: fallbackStoredSession.refresh_token }),
            new Promise((fallbackResolve) => {
              window.setTimeout(() => {
                fallbackResolve({ data: { session: null }, error: { code: 'refresh_timeout' } });
              }, SUPABASE_USER_LOOKUP_TIMEOUT_MS);
            })
          ])
            .then((refreshResult) => {
              const refreshedSession = refreshResult?.data?.session || null;
              const refreshedToken = String(refreshedSession?.access_token || '').trim();
              if (refreshedSession?.user?.id && refreshedToken) {
                resolve({
                  session: refreshedSession,
                  accessToken: refreshedToken,
                  error: null,
                  source: 'refresh-token-fallback'
                });
                return;
              }

              resolve({
                session: null,
                accessToken: '',
                error: refreshResult?.error || sessionResult?.error || null,
                source: 'unavailable'
              });
            })
            .catch((error) => {
              resolve({
                session: null,
                accessToken: '',
                error,
                source: 'unavailable'
              });
            });
          return;
        }

        resolve({
          session: null,
          accessToken: '',
          error: sessionResult?.error || null,
          source: 'unavailable'
        });
      })
      .catch((error) => {
        const fallbackAccessToken = readStoredSupabaseAccessToken();
        resolve({
          session: null,
          accessToken: fallbackAccessToken,
          error,
          source: fallbackAccessToken ? 'localStorage-fallback' : 'unavailable'
        });
      })
      .finally(() => {
        if (timeoutId) {
          window.clearTimeout(timeoutId);
        }
        inFlightSessionPromise = null;
      });
  });

  return inFlightSessionPromise;
}