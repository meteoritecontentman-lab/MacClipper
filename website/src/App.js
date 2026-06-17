import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { supabase } from './supabaseClient';
import Home from './components/Home';
import Admin from './components/Admin';
import Dashboard from './components/Dashboard';
import SignIn from './components/SignIn';
import SignUp from './components/SignUp';
import ResetPassword from './components/ResetPassword';
import Settings from './components/Settings';
import Clips from './components/Clips';
import Favourites from './components/Favourites';
import Watch from './components/Watch';
import CreatorProfile from './components/CreatorProfile';
import AppLayout from './components/AppLayout';
import Support from './components/Support';
import LinkApp from './components/LinkApp';
import LinkDiscord from './components/LinkDiscord';
import SharedClipPage from './components/SharedClipPage';
import OrderConfirmation from './components/OrderConfirmation';
import NotFound from './components/NotFound';
import ClipDetailPage from './components/ClipDetailPage';
import BotHosting from './components/BotHosting';
import { syncSupabaseProfile } from './lib/profileSync';
import { flushProfileUpdateQueue } from './lib/profileUpdateQueue';
import { canAccessAdminPortal } from './lib/accountState';
import { readLinkedAppState, saveLinkedAppState } from './lib/appLinkState';
import { fetchEntitlementsByAppUuid } from './lib/cloudAccount';
import { buildAppURL, rememberAuthRedirect, shouldUseHashRouting } from './lib/appRuntime';
import { logAuthDebug } from './lib/authDebug';
import { initGoogleTranslateWidget } from './lib/siteTranslation';
import { resolveSupabaseSession } from './lib/supabaseSession';

const AUTO_RELOAD_BUNDLE_KEY = 'macclipper-auto-reloaded-main-bundle';
const BUNDLE_VERSION_CHECK_INTERVAL_MS = 60000;

function normalizeBundleAssetName(value) {
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) {
    return '';
  }

  const withoutQuery = normalizedValue.split('?')[0];
  const segments = withoutQuery.split('/').filter(Boolean);
  return segments[segments.length - 1] || withoutQuery;
}

function resolveLoadedMainBundleName() {
  if (typeof document === 'undefined') {
    return '';
  }

  const scripts = Array.from(document.scripts || []);
  const bundleSource = scripts
    .map((script) => String(script?.src || '').trim())
    .find((src) => src.includes('/static/js/main.'));

  return normalizeBundleAssetName(bundleSource);
}

async function fetchLatestMainBundleName() {
  if (typeof window === 'undefined') {
    return '';
  }

  const manifestURL = new URL('/asset-manifest.json', window.location.origin);
  manifestURL.searchParams.set('ts', String(Date.now()));

  const response = await fetch(manifestURL.toString(), {
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`Asset manifest lookup failed with ${response.status}`);
  }

  const payload = await response.json().catch(() => ({}));
  return normalizeBundleAssetName(payload?.files?.['main.js']);
}

function ProtectedPage({ authResolved, currentUser, canAccessAdmin, onSignOut, children }) {
  if (!authResolved) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800"></div>
      </div>
    );
  }

  if (!currentUser) {
    if (typeof window !== 'undefined') {
      const pendingPath = `${window.location.pathname || '/'}${window.location.search || ''}${window.location.hash || ''}`;
      rememberAuthRedirect(pendingPath || '/dashboard');
    }
    logAuthDebug('protected-route redirect to /signin', { authResolved, hasUser: false });
    return <Navigate to="/signin" replace />;
  }

  return (
    <AppLayout currentUser={currentUser} canAccessAdmin={canAccessAdmin} onSignOut={onSignOut}>
      {children}
    </AppLayout>
  );
}

function AdminProtectedPage({ authResolved, currentUser, canAccessAdmin, onSignOut, children }) {
  if (!authResolved) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800"></div>
      </div>
    );
  }

  if (!currentUser) {
    if (typeof window !== 'undefined') {
      const pendingPath = `${window.location.pathname || '/'}${window.location.search || ''}${window.location.hash || ''}`;
      rememberAuthRedirect(pendingPath || '/admin');
    }
    logAuthDebug('admin-route redirect to /signin', { authResolved, hasUser: false });
    return <Navigate to="/signin" replace />;
  }

  if (!canAccessAdmin) {
    logAuthDebug('admin-route redirect to /dashboard', { userId: currentUser?.id ?? null, email: currentUser?.email ?? null });
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <AppLayout currentUser={currentUser} canAccessAdmin={canAccessAdmin} onSignOut={onSignOut}>
      {children}
    </AppLayout>
  );
}

function PublicPage({ currentUser, canAccessAdmin, onSignOut, children }) {
  if (currentUser) {
    return (
      <AppLayout currentUser={currentUser} canAccessAdmin={canAccessAdmin} onSignOut={onSignOut}>
        {children}
      </AppLayout>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto w-full max-w-7xl p-4 md:p-8">
        {children}
      </main>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [authResolved, setAuthResolved] = useState(false);
  const hydrationCompleteRef = useRef(false);
  const RouterComponent = shouldUseHashRouting() ? HashRouter : BrowserRouter;
  const canAccessAdmin = useMemo(() => canAccessAdminPortal(user), [user]);

  useEffect(() => {
    initGoogleTranslateWidget();
    logAuthDebug('app init');

    // Compatibility bridge: older app builds may open hash URLs such as
    // https://macclipper.co/#/link-app?appUuid=... while production uses BrowserRouter.
    // Normalize that URL to /link-app?... so route matching works.
    if (typeof window !== 'undefined' && !shouldUseHashRouting()) {
      const rawHash = String(window.location.hash || '');
      if (rawHash.startsWith('#/')) {
        const browserPath = rawHash.slice(1);
        window.location.replace(`${window.location.origin}${browserPath}`);
        return;
      }
    }

    const hydrateSession = async () => {
      const { session } = await resolveSupabaseSession();
      const initialUser = session?.user ?? null;
      logAuthDebug('hydrateSession complete', {
        hasSession: Boolean(session),
        hasUser: Boolean(initialUser),
        userId: initialUser?.id ?? null
      });

      setUser(initialUser);
      setAuthResolved(true);

      if (initialUser && typeof window !== 'undefined' && ['/', '/signin', '/signup'].includes(window.location.pathname)) {
        const targetURL = buildAppURL('/dashboard');
        logAuthDebug('hydrateSession redirecting to dashboard', { targetURL });
        window.location.replace(buildAppURL('/dashboard'));
      }

      if (initialUser) {
        const { error } = await syncSupabaseProfile(initialUser);
        if (error) {
          console.error('Error syncing Supabase profile:', error);
        }
      }

      hydrationCompleteRef.current = true;
    };
    hydrateSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      const nextUser = session?.user ?? null;
      logAuthDebug('onAuthStateChange', {
        event,
        hasSession: Boolean(session),
        hasUser: Boolean(nextUser),
        userId: nextUser?.id ?? null
      });

      if (!nextUser && event !== 'SIGNED_OUT') {
        logAuthDebug('ignore transient auth null event', {
          event,
          hydrationComplete: hydrationCompleteRef.current
        });
        return;
      }

      setUser(nextUser);
      setAuthResolved(true);

      if (nextUser && ['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED', 'INITIAL_SESSION'].includes(event)) {
        if (typeof window !== 'undefined' && ['/', '/signin', '/signup'].includes(window.location.pathname)) {
          const targetURL = buildAppURL('/dashboard');
          logAuthDebug('auth state redirecting to dashboard', { event, targetURL });
          window.location.replace(buildAppURL('/dashboard'));
        }

        const { error } = await syncSupabaseProfile(nextUser);
        if (error) {
          console.error('Error syncing Supabase profile:', error);
        }
      }
    });

    return () => {
      logAuthDebug('unsubscribe auth listener');
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleLocalProfileUpdate = (event) => {
      const nextUser = event?.detail?.user;
      if (!nextUser?.id) {
        return;
      }

      setUser((previousUser) => {
        if (previousUser?.id && previousUser.id !== nextUser.id) {
          return previousUser;
        }

        return {
          ...(previousUser || {}),
          ...nextUser,
          user_metadata: {
            ...(previousUser?.user_metadata || {}),
            ...(nextUser?.user_metadata || {})
          },
          app_metadata: {
            ...(previousUser?.app_metadata || {}),
            ...(nextUser?.app_metadata || {})
          }
        };
      });
    };

    window.addEventListener('macclipper:user-profile-updated', handleLocalProfileUpdate);
    return () => window.removeEventListener('macclipper:user-profile-updated', handleLocalProfileUpdate);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    let active = true;

    const checkForNewBundle = async () => {
      const loadedBundleName = resolveLoadedMainBundleName();
      if (!loadedBundleName) {
        return;
      }

      try {
        const latestBundleName = await fetchLatestMainBundleName();
        if (!active || !latestBundleName || latestBundleName === loadedBundleName) {
          if (latestBundleName === loadedBundleName) {
            window.sessionStorage.removeItem(AUTO_RELOAD_BUNDLE_KEY);
          }
          return;
        }

        const alreadyReloadedForBundle = String(window.sessionStorage.getItem(AUTO_RELOAD_BUNDLE_KEY) || '').trim();
        if (alreadyReloadedForBundle === latestBundleName) {
          return;
        }

        logAuthDebug('stale bundle detected; reloading page', {
          loadedBundleName,
          latestBundleName
        });
        window.sessionStorage.setItem(AUTO_RELOAD_BUNDLE_KEY, latestBundleName);
        window.location.reload();
      } catch (error) {
        if (active) {
          console.error('Error checking for a newer website bundle:', error);
        }
      }
    };

    void checkForNewBundle();

    const intervalId = window.setInterval(() => {
      void checkForNewBundle();
    }, BUNDLE_VERSION_CHECK_INTERVAL_MS);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void checkForNewBundle();
      }
    };

    window.addEventListener('focus', handleVisibility);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleVisibility);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  useEffect(() => {
    if (!user?.id || typeof window === 'undefined') {
      return;
    }

    let active = true;

    const flushQueuedProfileUpdates = async () => {
      try {
        await flushProfileUpdateQueue(user);
      } catch (error) {
        if (active) {
          console.error('Queued profile update flush failed:', error);
        }
      }
    };

    void flushQueuedProfileUpdates();

    const flushOnWake = () => {
      void flushQueuedProfileUpdates();
    };

    window.addEventListener('focus', flushOnWake);
    window.addEventListener('online', flushOnWake);
    document.addEventListener('visibilitychange', flushOnWake);

    return () => {
      active = false;
      window.removeEventListener('focus', flushOnWake);
      window.removeEventListener('online', flushOnWake);
      document.removeEventListener('visibilitychange', flushOnWake);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || typeof window === 'undefined') {
      return;
    }

    let active = true;
    let syncing = false;

    const syncLinkedEntitlements = async () => {
      const linkedState = readLinkedAppState(user.id);
      if (!linkedState.linked || !linkedState.appUuid || syncing) {
        return;
      }

      syncing = true;
      try {
        const entitlements = await fetchEntitlementsByAppUuid(linkedState.appUuid);
        if (!active) {
          return;
        }

        saveLinkedAppState(user.id, {
          appUuid: linkedState.appUuid,
          linkedAt: linkedState.linkedAt,
          subscriptionTier: entitlements.subscriptionTier,
          paidFeatures: entitlements.paidFeatures,
          verifiedAt: new Date().toISOString()
        });
      } catch (error) {
        console.error('Error syncing linked app entitlements in app shell:', error);
      } finally {
        syncing = false;
      }
    };

    void syncLinkedEntitlements();

    const refreshTimer = window.setInterval(() => {
      void syncLinkedEntitlements();
    }, 45000);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void syncLinkedEntitlements();
      }
    };

    window.addEventListener('focus', handleVisibility);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      active = false;
      window.clearInterval(refreshTimer);
      window.removeEventListener('focus', handleVisibility);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [user?.id]);

  const handleSignOut = async () => {
    try {
      const globalSignOut = await supabase.auth.signOut({ scope: 'global' });
      if (globalSignOut?.error) {
        console.error('Global sign-out failed, retrying local sign-out:', globalSignOut.error);
      }

      const localSignOut = await supabase.auth.signOut({ scope: 'local' });
      if (localSignOut?.error) {
        throw localSignOut.error;
      }
    } catch (error) {
      console.error('Sign-out error:', error);
      if (typeof window !== 'undefined') {
        try {
          const keysToRemove = [];
          for (let i = 0; i < window.localStorage.length; i++) {
            const key = window.localStorage.key(i);
            if (key && key.startsWith('sb-')) {
              keysToRemove.push(key);
            }
          }
          keysToRemove.forEach((key) => window.localStorage.removeItem(key));
        } catch (storageError) {
          console.error('Could not clear local auth cache during sign-out fallback:', storageError);
        }

        window.location.replace(buildAppURL('/signin'));
      }
    }
  };

  return (
    <RouterComponent>
      <Routes>
        <Route path="/" element={<Home currentUser={user} />} />
        <Route path="/shared/:shareId" element={<SharedClipPage currentUser={user} />} />
        <Route path="/clip/:clipId" element={(
          <PublicPage currentUser={user} canAccessAdmin={canAccessAdmin} onSignOut={handleSignOut}>
            <ClipDetailPage currentUser={user} />
          </PublicPage>
        )} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/support" element={<Support currentUser={user} />} />
        <Route path="/bot-hosting" element={<BotHosting />} />
        <Route path="/buy" element={<Navigate to="/support" replace />} />
        <Route path="/order-confirmation" element={<OrderConfirmation currentUser={user} />} />
        <Route path="/dashboard" element={(
          <ProtectedPage authResolved={authResolved} currentUser={user} canAccessAdmin={canAccessAdmin} onSignOut={handleSignOut}>
            <Dashboard currentUser={user} authResolved={authResolved} />
          </ProtectedPage>
        )} />
        <Route path="/clips" element={(
          <ProtectedPage authResolved={authResolved} currentUser={user} canAccessAdmin={canAccessAdmin} onSignOut={handleSignOut}>
            <Clips currentUser={user} authResolved={authResolved} />
          </ProtectedPage>
        )} />
        <Route path="/favorites" element={(
          <ProtectedPage authResolved={authResolved} currentUser={user} canAccessAdmin={canAccessAdmin} onSignOut={handleSignOut}>
            <Favourites currentUser={user} authResolved={authResolved} />
          </ProtectedPage>
        )} />
        <Route path="/community" element={(
          <ProtectedPage authResolved={authResolved} currentUser={user} canAccessAdmin={canAccessAdmin} onSignOut={handleSignOut}>
            <Watch currentUser={user} authResolved={authResolved} />
          </ProtectedPage>
        )} />
        <Route path="/profile/:profileId" element={(
          <PublicPage currentUser={user} canAccessAdmin={canAccessAdmin} onSignOut={handleSignOut}>
            <CreatorProfile currentUser={user} authResolved={authResolved} />
          </PublicPage>
        )} />
        <Route path="/watch" element={<Navigate to="/community" replace />} />
        <Route path="/favourites" element={<Navigate to="/favorites" replace />} />
        <Route path="/settings" element={(
          <ProtectedPage authResolved={authResolved} currentUser={user} canAccessAdmin={canAccessAdmin} onSignOut={handleSignOut}>
            <Settings currentUser={user} />
          </ProtectedPage>
        )} />
        <Route path="/account" element={<Navigate to="/settings" replace />} />
        <Route path="/link-app" element={(
          <ProtectedPage authResolved={authResolved} currentUser={user} canAccessAdmin={canAccessAdmin} onSignOut={handleSignOut}>
            <LinkApp currentUser={user} authResolved={authResolved} />
          </ProtectedPage>
        )} />
        <Route path="/link-discord" element={(
          <ProtectedPage authResolved={authResolved} currentUser={user} canAccessAdmin={canAccessAdmin} onSignOut={handleSignOut}>
            <LinkDiscord currentUser={user} authResolved={authResolved} />
          </ProtectedPage>
        )} />
        <Route path="/admin" element={(
          <AdminProtectedPage authResolved={authResolved} currentUser={user} canAccessAdmin={canAccessAdmin} onSignOut={handleSignOut}>
            <Admin currentUser={user} authResolved={authResolved} canAccessAdmin={canAccessAdmin} />
          </AdminProtectedPage>
        )} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </RouterComponent>
  );
}

export default App;