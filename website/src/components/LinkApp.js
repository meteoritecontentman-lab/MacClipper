import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle, Link as LinkIcon, Loader, XCircle } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import {
  clearLinkedAppState,
  isValidAppUuid,
  readLinkedAppState,
  saveLinkedAppState,
  subscribeToLinkedAppState
} from '../lib/appLinkState';
import { subscriptionLabelForUser } from '../lib/accountState';
import { fetchEntitlementsByAppUuid, fetchLinkStatus, hasProEntitlement } from '../lib/cloudAccount';

function nextLinkAttemptId() {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `link-${Date.now()}`;
}

function attemptStorageKey(userId) {
  return `macclipper.link-attempt:${String(userId || '').trim()}`;
}

function parseLinkCallbackParams(location) {
  // Start with the real browser search params (window.location.search) so we catch
  // the case where an older app build placed params BEFORE the '#' instead of inside it.
  // e.g. https://macclipper.co/?appUuid=X&linked=1#/link-app  (wrong but handled here)
  const combinedParams = new URLSearchParams(
    typeof window !== 'undefined' ? window.location.search : (location.search || '')
  );

  // Merge React Router's location.search (correct format: #/link-app?appUuid=X&linked=1)
  new URLSearchParams(location.search || '').forEach((value, key) => {
    if (!combinedParams.has(key)) {
      combinedParams.set(key, value);
    }
  });

  // Also check for params embedded in location.hash as a sub-fragment
  const rawHash = String(location.hash || '');
  const hashQueryIndex = rawHash.indexOf('?');
  if (hashQueryIndex >= 0) {
    const hashParams = new URLSearchParams(rawHash.slice(hashQueryIndex + 1));
    hashParams.forEach((value, key) => {
      if (!combinedParams.has(key)) {
        combinedParams.set(key, value);
      }
    });
  }

  return combinedParams;
}

function LinkApp({ currentUser = null, authResolved = false }) {
  const location = useLocation();
  const [linkStatus, setLinkStatus] = useState('');
  const [linkFlowState, setLinkFlowState] = useState('idle');
  const [linkedAppState, setLinkedAppState] = useState(() => readLinkedAppState(currentUser?.id));
  // linkVerified: only true after the entitlement round-trip succeeds for THIS session
  const [linkVerified, setLinkVerified] = useState(false);
  const [linkVerifying, setLinkVerifying] = useState(false);
  // track which appUuid triggered verification so re-renders don't re-fire it
  const verifiedForUuidRef = useRef('');
  // polling fallback: active when the user clicked Link but no URL callback yet
  const [isPollingForLink, setIsPollingForLink] = useState(false);
  const pollIntervalRef = useRef(null);
  const pollStartedAtRef = useRef(null);
  const subscriptionLabel = subscriptionLabelForUser(currentUser);
  const linkedPro = hasProEntitlement(linkedAppState);
  const canStartLink = !linkedAppState.linked;

  const queryParams = useMemo(() => parseLinkCallbackParams(location), [location]);
  const requestedAppUuid = queryParams.get('appUuid') || '';
  const callbackLinkedSignal = queryParams.get('linked') === '1';
  const callbackDeniedSignal = queryParams.get('denied') === '1' || queryParams.get('status') === 'denied';
  const callbackWebsiteUserId = queryParams.get('websiteUserId') || '';
  const callbackAttemptId = queryParams.get('attemptId') || '';
  const isLinked = linkedAppState.linked || linkVerified;
  const pendingAttemptIdRef = useRef('');

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem('macclipper-is-linked', isLinked ? 'true' : 'false');
    window['__MACCLIPPER_IS_LINKED'] = isLinked;
  }, [isLinked]);

  useEffect(() => {
    if (!currentUser?.id || typeof window === 'undefined') {
      pendingAttemptIdRef.current = '';
      return;
    }

    const storedAttemptId = String(window.sessionStorage.getItem(attemptStorageKey(currentUser.id)) || '').trim();
    pendingAttemptIdRef.current = storedAttemptId;
  }, [currentUser?.id]);

  const deepLinkURL = useMemo(() => {
    if (!currentUser?.id) {
      return 'macclipper://connect';
    }

    const attemptId = pendingAttemptIdRef.current || nextLinkAttemptId();
    const params = new URLSearchParams({ websiteUserId: currentUser.id, attemptId });
    return `macclipper://connect?${params.toString()}`;
  }, [currentUser]);

  const callbackMatchesPendingAttempt = !callbackAttemptId
    || !pendingAttemptIdRef.current
    || callbackAttemptId === pendingAttemptIdRef.current;

  useEffect(() => {
    const nextState = readLinkedAppState(currentUser?.id);
    setLinkedAppState(nextState);
    setLinkStatus(nextState.linked ? 'MacClipper linked.' : '');
    setLinkFlowState(nextState.linked ? 'success' : 'idle');

    return subscribeToLinkedAppState(currentUser?.id, (value) => {
      setLinkedAppState(value);
    });
  }, [currentUser?.id, requestedAppUuid]);

  // Instant callback signal from the app: mark linking as active immediately,
  // then pull the concrete appUuid via link-status if needed.
  useEffect(() => {
    if (!currentUser?.id || !callbackDeniedSignal) {
      return;
    }

    if (callbackWebsiteUserId && callbackWebsiteUserId !== currentUser.id) {
      return;
    }

    if (!callbackMatchesPendingAttempt) {
      return;
    }

    setIsPollingForLink(false);
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setLinkVerifying(false);
    setLinkVerified(false);
    setLinkFlowState('failed');
    setLinkStatus('Loading Failed. MacClipper denied the link request.');
  }, [callbackDeniedSignal, callbackMatchesPendingAttempt, callbackWebsiteUserId, currentUser?.id]);

  useEffect(() => {
    if (!currentUser?.id || !callbackLinkedSignal) {
      return;
    }

    if (callbackWebsiteUserId && callbackWebsiteUserId !== currentUser.id) {
      return;
    }

    if (!callbackMatchesPendingAttempt) {
      return;
    }

    if (!requestedAppUuid || !isValidAppUuid(requestedAppUuid)) {
      setLinkFlowState('linking');
      setLinkVerifying(true);
      setLinkStatus('Linking...');
      setIsPollingForLink(true);
      return;
    }

    setLinkFlowState('linking');
    setLinkStatus('Linking...');
  }, [callbackLinkedSignal, callbackMatchesPendingAttempt, callbackWebsiteUserId, currentUser?.id, requestedAppUuid]);

  useEffect(() => {
    if (!requestedAppUuid || !currentUser?.id || !isValidAppUuid(requestedAppUuid)) {
      return;
    }

    // Don't re-run if we already verified this exact uuid in this session
    if (verifiedForUuidRef.current === requestedAppUuid) {
      return;
    }

    let active = true;

    const syncLinkState = async () => {
      setLinkVerified(false);
      setLinkVerifying(true);
      setLinkFlowState('linking');
      setLinkStatus('Linking...');

      const linkedAt = new Date().toISOString();
      // Save to storage so other parts of the app see the link immediately
      saveLinkedAppState(currentUser.id, { appUuid: requestedAppUuid, linkedAt });

      try {
        const entitlements = await fetchEntitlementsByAppUuid(requestedAppUuid);
        if (!active) {
          return;
        }

        const verifiedState = saveLinkedAppState(currentUser.id, {
          appUuid: requestedAppUuid,
          linkedAt,
          subscriptionTier: entitlements.subscriptionTier,
          paidFeatures: entitlements.paidFeatures,
          verifiedAt: new Date().toISOString()
        });

        if (typeof window !== 'undefined') {
          window.sessionStorage.removeItem(attemptStorageKey(currentUser.id));
        }
        pendingAttemptIdRef.current = '';

        verifiedForUuidRef.current = requestedAppUuid;
        setLinkedAppState(verifiedState);
        setLinkVerifying(false);
        setLinkVerified(true);
        setLinkFlowState('success');
        setLinkStatus(hasProEntitlement(entitlements)
          ? 'Link complete. Pro synced. Your website now mirrors your app plan.'
          : 'Link complete. Your MacClipper account is connected.');
      } catch (error) {
        if (!active) {
          return;
        }
        console.error('Error verifying linked app entitlements:', error);
        // Still mark link as connected from storage, but not verified
        setLinkedAppState(readLinkedAppState(currentUser.id));
        setLinkVerifying(false);
        setLinkVerified(false);
        setLinkFlowState('failed');
        setLinkStatus('Connection saved. Plan verification could not complete right now.');
      }
    };

    void syncLinkState();

    return () => {
      active = false;
    };
  }, [currentUser?.id, requestedAppUuid]);

  // Stop polling as soon as a valid appUuid arrives through the URL callback
  useEffect(() => {
    if (requestedAppUuid && isValidAppUuid(requestedAppUuid)) {
      setIsPollingForLink(false);
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    }
  }, [requestedAppUuid]);

  // Polling fallback: when no URL callback arrives, query /link-status every 3 s for up to 90 s
  useEffect(() => {
    if (!isPollingForLink || !currentUser?.id || linkedAppState.linked) {
      return;
    }

    pollStartedAtRef.current = Date.now();

    pollIntervalRef.current = setInterval(async () => {
      // Give up after 90 seconds
      if (Date.now() - pollStartedAtRef.current > 90_000) {
        setIsPollingForLink(false);
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
        setLinkFlowState('failed');
        setLinkStatus('Loading Failed. Timed out waiting for MacClipper.');
        return;
      }

      try {
        const linkRecord = await fetchLinkStatus(currentUser.id);
        const polledUuid = String(linkRecord?.appUuid || '').trim().toLowerCase();
        const polledAttemptId = String(linkRecord?.attemptId || '').trim();
        const pendingAttemptId = pendingAttemptIdRef.current;
        const matchesAttempt = !pendingAttemptId || !polledAttemptId || polledAttemptId === pendingAttemptId;

        if (linkRecord?.isLinked && matchesAttempt && polledUuid && isValidAppUuid(polledUuid)) {
          setIsPollingForLink(false);
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
          // Trigger the same verification flow as a URL callback by simulating navigation
          // We directly run the sync flow here since we already have the appUuid
          if (verifiedForUuidRef.current !== polledUuid) {
            verifiedForUuidRef.current = ''; // reset so the requestedAppUuid effect can re-run
            const linkedAt = new Date().toISOString();
            saveLinkedAppState(currentUser.id, { appUuid: polledUuid, linkedAt });
            setLinkVerifying(true);
            setLinkFlowState('linking');
            setLinkStatus('Linking...');
            try {
              const entitlements = await fetchEntitlementsByAppUuid(polledUuid);
              const verifiedState = saveLinkedAppState(currentUser.id, {
                appUuid: polledUuid,
                linkedAt,
                subscriptionTier: entitlements.subscriptionTier,
                paidFeatures: entitlements.paidFeatures,
                verifiedAt: new Date().toISOString()
              });
              if (typeof window !== 'undefined') {
                window.sessionStorage.removeItem(attemptStorageKey(currentUser.id));
              }
              pendingAttemptIdRef.current = '';
              verifiedForUuidRef.current = polledUuid;
              setLinkedAppState(verifiedState);
              setLinkVerifying(false);
              setLinkVerified(true);
              setLinkFlowState('success');
              setLinkStatus(hasProEntitlement(entitlements)
                ? 'Link complete. Pro synced. Your website now mirrors your app plan.'
                : 'Link complete. Your MacClipper account is connected.');
            } catch {
              setLinkedAppState(readLinkedAppState(currentUser.id));
              setLinkVerifying(false);
              setLinkFlowState('failed');
              setLinkStatus('Connection saved. Plan verification could not complete right now.');
            }
          }
        }
      } catch {
        // Polling errors are silent — we just retry next interval
      }
    }, 3000);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [isPollingForLink, currentUser?.id, linkedAppState.linked]);

  const handleLinkMacClipper = () => {
    if (!canStartLink) {
      setLinkStatus('This account is already linked. Use Reset Link before linking again.');
      return;
    }

    const attemptId = nextLinkAttemptId();
    pendingAttemptIdRef.current = attemptId;
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(attemptStorageKey(currentUser.id), attemptId);
    }

    setLinkFlowState('opening');
    setLinkStatus('Linking...');
    window.location.assign(`macclipper://connect?${new URLSearchParams({ websiteUserId: currentUser.id, attemptId }).toString()}`);
    window.setTimeout(() => {
      setLinkFlowState('linking');
      setLinkStatus((currentStatus) => currentStatus || 'Linking...');
      setIsPollingForLink(true);
    }, 900);
  };


  const handleResetLinkedMac = () => {
    if (!currentUser?.id) {
      return;
    }

    const nextState = clearLinkedAppState(currentUser.id);
    setLinkedAppState(nextState);
    setLinkVerified(false);
    setLinkVerifying(false);
    setLinkFlowState('idle');
    verifiedForUuidRef.current = '';
    setLinkStatus('Stored Mac link removed from this browser.');
    setIsPollingForLink(false);
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(attemptStorageKey(currentUser.id));
    }
    pendingAttemptIdRef.current = '';
  };

  if (!authResolved) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800"></div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="mx-auto max-w-2xl rounded-3xl border border-border bg-card p-8 text-center shadow-sm">
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">Sign in to link the Mac.</h1>
        <p className="mt-3 text-sm text-muted-foreground">The uplink follows your account.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link to="/signin" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">Sign In</Link>
          <Link to="/signup" className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted">Create Account</Link>
        </div>
      </div>
    );
  }

  const showLinkingState = (linkFlowState === 'opening' || linkFlowState === 'linking') && !linkVerified;
  const showFailureState = linkFlowState === 'failed';
  const showSuccessState = !linkVerifying && (linkVerified || (isLinked && linkFlowState === 'success'));
  const showConnectedState = !linkVerifying && !showSuccessState && isLinked;
  const showIdleState = !showLinkingState && !showFailureState && !showSuccessState && !showConnectedState;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="page-heading">Link MacClipper.</h1>
        <p className="page-subtitle">Approve the connection for this account.</p>
      </div>

      <section className="glass-card p-8">
        {showLinkingState ? (
          <div className={[
            'mb-6 rounded-2xl border p-5',
            'border-sky-400/40 bg-sky-500/10'
          ].join(' ')}>
            <div className="flex items-center gap-3">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-dashed border-sky-500 border-t-transparent" />
              <div>
                <p className="text-base font-semibold text-foreground">Linking...</p>
                <p className="text-sm text-muted-foreground">
                  Waiting for MacClipper to confirm your connection.
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link to="/dashboard" className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted">Open Dashboard</Link>
            </div>
          </div>
        ) : null}

        {showFailureState ? (
          <div className="mb-6 rounded-2xl border border-rose-400/40 bg-rose-500/10 p-5">
            <div className="flex items-center gap-3">
              <XCircle className="h-6 w-6 text-rose-500" />
              <div>
                <p className="text-base font-semibold text-rose-700">Loading Failed</p>
                <p className="text-sm text-muted-foreground">The app link did not complete. Open MacClipper and try again.</p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <a
                href={deepLinkURL}
                onClick={(event) => {
                  event.preventDefault();
                  handleLinkMacClipper();
                }}
                className={[
                  'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                  canStartLink
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'cursor-not-allowed border border-border bg-muted text-muted-foreground'
                ].join(' ')}
              >
                Try Linking Again
              </a>
              <a href="https://github.com/Userbro20/macclip-auto-update/releases" target="_blank" rel="noreferrer" className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted">Download the app</a>
            </div>
          </div>
        ) : null}

        {showIdleState ? (
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">Signed in</span>
            <span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-secondary-foreground">Plan {subscriptionLabel}</span>
          </div>
        ) : null}

        {/* Verifying spinner — shown while waiting for the entitlement round-trip */}
        {showIdleState && linkVerifying ? (
          <div className="mt-6 flex items-center gap-3 rounded-2xl border border-sky-400/30 bg-sky-500/10 p-5">
            <Loader className="h-5 w-5 animate-spin text-sky-500" />
            <div>
              <p className="text-sm font-semibold text-foreground">Linking...</p>
              <p className="mt-0.5 text-sm text-muted-foreground">Checking your plan with MacClipper. Hang tight.</p>
            </div>
          </div>
        ) : null}

        {/* Euphoric success — only shown after full server verification */}
        {showSuccessState ? (
          <div className="mt-6 overflow-hidden rounded-2xl border border-emerald-400/40 bg-gradient-to-r from-emerald-500/15 via-sky-500/10 to-amber-500/10 p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-500/20">
                <CheckCircle className="h-6 w-6 text-emerald-500" />
              </div>
              <div>
                <p className="text-lg font-bold text-foreground">
                  {linkedPro ? 'Pro activated. You are live.' : 'MacClipper is connected.'}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {linkedPro
                    ? 'Pro entitlement confirmed from your app. Website features now run in Pro mode.'
                    : 'Link verified. Clip sync and posting are ready.'}
                </p>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link to="/dashboard" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90">Open Dashboard</Link>
              <Link to="/clips" className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted">Open Clips</Link>
              <button type="button" onClick={handleResetLinkedMac} className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted">Reset Link</button>
            </div>
          </div>
        ) : null}

        {/* Already linked state (returning visitor, no fresh link in this session) */}
        {showConnectedState ? (
          <div className="mt-6 rounded-2xl border border-border bg-muted/30 p-5">
            <div className="flex items-center gap-3">
              <LinkIcon className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-semibold text-foreground">MacClipper is connected to this account.</p>
                <p className="mt-0.5 text-sm text-muted-foreground">Use Reset Link below if you need to link a different device.</p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link to="/dashboard" className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted">Open Dashboard</Link>
              <button type="button" onClick={handleResetLinkedMac} className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted">Reset Link</button>
            </div>
          </div>
        ) : null}

        {/* Idle — not yet linked */}
        {showIdleState ? (
          <>
            <h2 className="mt-6 text-2xl font-bold tracking-tight text-foreground">Open MacClipper</h2>
            <p className="mt-2 text-sm text-muted-foreground">{linkStatus || (currentUser.email ? `Ready for ${currentUser.email}.` : 'Ready for your account.')}</p>
            <div className="mt-4 rounded-2xl border border-border bg-muted/30 p-4">
              <p className="text-sm font-semibold text-foreground">Connection status</p>
              <p className="mt-1 text-sm text-muted-foreground">Open the app and allow the connection.</p>
            </div>
          </>
        ) : null}

        {/* Status message for non-euphoric cases */}
        {showIdleState && !linkVerified && linkStatus && !linkVerifying ? (
          <p className="mt-4 text-sm text-muted-foreground">{linkStatus}</p>
        ) : null}

        {showIdleState ? (
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleLinkMacClipper}
              disabled={!canStartLink || linkVerifying}
              className={[
                'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                canStartLink && !linkVerifying
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'cursor-not-allowed border border-border bg-muted text-muted-foreground'
              ].join(' ')}
            >
              {linkVerifying ? 'Verifying…' : canStartLink ? 'Link MacClipper' : 'Already Linked'}
            </button>
            <Link to="/dashboard" className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted">Open Dashboard</Link>
            <a href="https://github.com/Userbro20/macclip-auto-update/releases" target="_blank" rel="noreferrer" className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted">Download the app</a>
          </div>
        ) : null}
      </section>
    </div>
  );
}

export default LinkApp;