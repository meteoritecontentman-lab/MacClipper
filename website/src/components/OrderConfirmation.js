import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  fetchEntitlementsByAppUuid,
  fetchLinkStatus,
  hasProEntitlement,
  verifyStripeCheckout
} from '../lib/cloudAccount';

const VERIFY_TIMEOUT_MS = 15000;

function isLikelyStripeSessionId(value) {
  return /^cs_[a-z0-9_]+$/i.test(String(value || '').trim());
}

function withTimeout(promise, timeoutMs, timeoutMessage) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    promise
      .then((result) => {
        window.clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

function OrderConfirmation({ currentUser }) {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id') || '';
  const orderIdFromQuery = searchParams.get('order_id') || '';
  const fallbackOrderId = (orderIdFromQuery || (sessionId ? `mco_${sessionId}` : '')).trim();

  const [status, setStatus] = useState('loading'); // loading | syncing | success | pending | error
  const [orderId, setOrderId] = useState(null);
  const [appUuid, setAppUuid] = useState('');
  const [syncMessage, setSyncMessage] = useState('Checking your payment and syncing Pro to your Mac...');
  const [errorMessage, setErrorMessage] = useState(null);
  const [didAttemptOpenApp, setDidAttemptOpenApp] = useState(false);
  const launchAttemptedRef = useRef(false);

  const openMacClipper = () => {
    if (!appUuid || typeof window === 'undefined') {
      return;
    }

    const target = new URL('macclipper://purchase-complete');
    target.searchParams.set('appUuid', appUuid);
    target.searchParams.set('feature', '4k-pro');
    if (currentUser?.id) {
      target.searchParams.set('userId', currentUser.id);
    }

    launchAttemptedRef.current = true;
    setDidAttemptOpenApp(true);
    window.location.href = target.toString();
  };

  useEffect(() => {
    if (!sessionId) {
      setStatus('error');
      setErrorMessage('No checkout session found in the URL.');
      return;
    }

    if (!currentUser?.id) {
      setOrderId((prev) => prev || fallbackOrderId || null);
      setStatus('pending');
      setSyncMessage('Sign in to the same account that purchased Pro to confirm this order securely.');
      setErrorMessage(null);
      return;
    }

    if (!isLikelyStripeSessionId(sessionId)) {
      setOrderId((prev) => prev || fallbackOrderId || null);
      setErrorMessage('Invalid checkout session id in return URL.');
      // Still try to fetch the linked app so the deep-link button and
      // entitlement polling work even when the placeholder was not replaced.
      (async () => {
        try {
          const linkStatus = await fetchLinkStatus(currentUser.id);
          const linkedAppUuid = String(linkStatus?.appUuid || '').trim().toLowerCase();
          if (linkedAppUuid) {
            setAppUuid(linkedAppUuid);
            const entitlements = await fetchEntitlementsByAppUuid(linkedAppUuid);
            if (hasProEntitlement(entitlements)) {
              setStatus('success');
              setSyncMessage('Pro is active on your Mac. Open MacClipper to see the unlock toast.');
              return;
            }
          }
        } catch {
          // Ignore — fall through to pending
        }
        setStatus('pending');
        setSyncMessage('This checkout link used a placeholder session id. We are syncing your Pro status from your linked Mac instead.');
      })();
      return;
    }

    const verify = async () => {
      try {
        const result = await withTimeout(
          verifyStripeCheckout({
            sessionId,
            websiteUserId: currentUser?.id || ''
          }),
          VERIFY_TIMEOUT_MS,
          'Checkout verification timed out. We are still syncing your Pro unlock in the background.'
        );

        setOrderId(result.orderId || fallbackOrderId || null);
        const verifiedAppUuid = String(result.appUuid || '').trim().toLowerCase();
        setAppUuid(verifiedAppUuid);

        if (result.fulfilled) {
          setStatus('syncing');
          setSyncMessage('Payment confirmed. Waiting for your Mac to light up with Pro...');
          return;
        }

        if (verifiedAppUuid) {
          try {
            const entitlements = await fetchEntitlementsByAppUuid(verifiedAppUuid);
            if (hasProEntitlement(entitlements)) {
              setStatus('success');
              setSyncMessage('Pro is already active on your Mac. Open MacClipper to pull the unlock toast.');
              return;
            }
          } catch {
            // Best-effort fallback only.
          }
        }

        setStatus('pending');
        setSyncMessage('Your payment reached Stripe, but Pro is still processing.');
      } catch (err) {
        const fallbackMessage = err?.message || 'Could not verify your order.';

        if (!currentUser?.id) {
          setOrderId((prev) => prev || fallbackOrderId || null);
          setStatus('pending');
          setSyncMessage('Payment verification is still syncing. If Pro already unlocked, you can continue using it now.');
          setErrorMessage(fallbackMessage);
          return;
        }

        try {
          const linkStatus = await fetchLinkStatus(currentUser.id);
          const linkedAppUuid = String(linkStatus?.appUuid || '').trim().toLowerCase();

          if (linkedAppUuid) {
            setAppUuid(linkedAppUuid);
            const entitlements = await fetchEntitlementsByAppUuid(linkedAppUuid);

            if (hasProEntitlement(entitlements)) {
              setOrderId((prev) => prev || fallbackOrderId || null);
              setStatus('success');
              setSyncMessage('Pro is active. Confirmation took too long, but your unlock is already live.');
              setErrorMessage(fallbackMessage);
              return;
            }

            setOrderId((prev) => prev || fallbackOrderId || null);
            setStatus('pending');
            setSyncMessage('Payment was received, and your Mac is linked. Pro is still finalizing.');
            setErrorMessage(fallbackMessage);
            return;
          }
        } catch {
          // Fallback to error UI below.
        }

        setOrderId((prev) => prev || fallbackOrderId || null);
        setStatus('error');
        setErrorMessage(fallbackMessage);
      }
    };

    void verify();
  }, [sessionId, currentUser?.id, fallbackOrderId]);

  useEffect(() => {
    if (!appUuid || (status !== 'syncing' && status !== 'pending')) {
      return undefined;
    }

    let active = true;
    let pollHandle;

    const syncEntitlements = async () => {
      try {
        const entitlements = await fetchEntitlementsByAppUuid(appUuid);
        if (!active) {
          return;
        }

        if (hasProEntitlement(entitlements)) {
          setStatus('success');
          setSyncMessage('Pro is attached to this Mac. Open MacClipper and the unlock toast should appear right away.');
          return;
        }

        setStatus('syncing');
        setSyncMessage('Payment confirmed. Your Mac is still syncing Pro access...');
      } catch (err) {
        if (!active) {
          return;
        }

        setStatus('syncing');
        setSyncMessage('Payment confirmed. We are still waiting for your Mac entitlement snapshot to update...');
      }
    };

    void syncEntitlements();
    pollHandle = window.setInterval(() => {
      void syncEntitlements();
    }, 2500);

    return () => {
      active = false;
      if (pollHandle) {
        window.clearInterval(pollHandle);
      }
    };
  }, [appUuid, status]);

  useEffect(() => {
    if (!appUuid || launchAttemptedRef.current || typeof window === 'undefined') {
      return;
    }

    if (status !== 'syncing' && status !== 'pending' && status !== 'success') {
      return;
    }

    const launchTimer = window.setTimeout(() => {
      openMacClipper();
    }, status === 'success' ? 900 : 500);

    return () => window.clearTimeout(launchTimer);
  }, [status, appUuid, currentUser?.id]);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#130d04] px-6 py-16 text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_12%,rgba(255,226,150,0.32),transparent_28%),radial-gradient(circle_at_15%_20%,rgba(255,170,70,0.18),transparent_35%),radial-gradient(circle_at_85%_18%,rgba(255,200,120,0.18),transparent_32%),linear-gradient(180deg,#1a1105_0%,#120c04_44%,#0b0805_100%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-60 [background-image:radial-gradient(rgba(255,245,214,0.18)_1px,transparent_1px)] [background-size:22px_22px]" />
      <div className="pointer-events-none absolute left-1/2 top-20 h-64 w-64 -translate-x-1/2 rounded-full bg-amber-300/20 blur-3xl" />

      <div className="relative z-10 w-full max-w-lg">
        {status === 'loading' && (
          <div className="rounded-[2rem] border border-amber-200/20 bg-white/8 p-10 text-center shadow-[0_30px_120px_rgba(255,185,70,0.18)] backdrop-blur-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.42em] text-amber-100/70">MacClipper</p>
            <div className="mt-8 flex items-center justify-center">
              <div className="h-12 w-12 animate-spin rounded-full border-4 border-amber-100/20 border-t-amber-300 shadow-[0_0_40px_rgba(255,208,110,0.35)]" />
            </div>
            <p className="mt-5 text-base font-semibold text-white">Charging the skybox...</p>
            <p className="mt-1 text-sm text-amber-50/70">We are confirming your payment and finding your Mac.</p>
          </div>
        )}

        {status === 'syncing' && (
          <div className="rounded-[2rem] border border-amber-200/20 bg-white/8 p-8 text-center shadow-[0_30px_120px_rgba(255,185,70,0.18)] backdrop-blur-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.42em] text-amber-100/70">MacClipper Pro</p>

            <div className="relative mx-auto mt-6 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-amber-200/30 via-amber-400/20 to-orange-300/20 shadow-[0_0_90px_rgba(255,195,90,0.25)]">
              <div className="absolute inset-2 rounded-full border border-amber-200/20" />
              <div className="h-12 w-12 animate-spin rounded-full border-[3px] border-amber-100/15 border-t-amber-300" />
            </div>

            <h1 className="mt-6 text-3xl font-black tracking-tight text-white">Payment landed.</h1>
            <p className="mt-2 text-sm leading-6 text-amber-50/78">{syncMessage}</p>

            {orderId && (
              <div className="mt-5 rounded-2xl border border-amber-200/15 bg-black/15 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-200/70">Order ID</p>
                <p className="mt-2 font-mono text-sm font-semibold text-white">{orderId}</p>
              </div>
            )}

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={openMacClipper}
                className="rounded-xl bg-gradient-to-r from-amber-300 via-yellow-300 to-orange-300 px-5 py-3 text-sm font-black text-[#2d1900] shadow-[0_18px_60px_rgba(255,189,74,0.28)] transition-transform hover:-translate-y-0.5"
              >
                Open MacClipper Now
              </button>
              <Link
                to="/dashboard"
                className="rounded-xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                Return to Dashboard
              </Link>
            </div>

            <p className="mt-4 text-xs text-amber-50/58">
              Keep MacClipper open for a few seconds after launching so the unlock toast can arrive.
            </p>
          </div>
        )}

        {status === 'success' && (
          <div className="rounded-[2rem] border border-amber-200/25 bg-white/10 p-8 text-center shadow-[0_30px_120px_rgba(255,185,70,0.22)] backdrop-blur-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.42em] text-amber-100/70">MacClipper Pro</p>

            <div className="relative mx-auto mt-4 h-28 w-28">
              <div className="absolute inset-0 rounded-full bg-amber-200/20 blur-2xl" />
              <div className="absolute inset-0 animate-pulse rounded-full border border-amber-100/20" />
              <div className="relative flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br from-[#fff1b2] via-[#ffd45a] to-[#ffb21f] shadow-[0_20px_70px_rgba(255,196,66,0.45)]">
                <svg className="h-10 w-10 text-[#2f1a00]" fill="none" stroke="currentColor" strokeWidth={2.8} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            </div>

            <h1 className="mt-5 bg-gradient-to-b from-[#fff7d5] via-[#ffe58a] to-[#ffc83d] bg-clip-text text-4xl font-black tracking-tight text-transparent">
              Pro just ignited.
            </h1>
            <p className="mt-3 text-sm leading-6 text-amber-50/80">
              Your payment is confirmed and Pro is attached to this Mac. Open MacClipper now and it should pull the unlock immediately.
            </p>

            <div className="mt-5 rounded-2xl border border-white/12 bg-black/15 p-4 text-left">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-200/70">What happens next</p>
              <p className="mt-2 text-sm leading-6 text-amber-50/75">
                MacClipper refreshes its entitlement snapshot, then shows the Pro unlock toast inside the app. If the app was closed, opening it from this page triggers that handoff.
              </p>
            </div>

            {orderId && (
              <div className="mt-5 rounded-2xl border border-amber-200/15 bg-[#1a1206]/80 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-200/70">Order ID</p>
                <p className="mt-2 font-mono text-sm font-semibold text-white">{orderId}</p>
                <p className="mt-1 text-xs text-amber-50/55">Keep this for support, refunds, or manual recovery.</p>
              </div>
            )}

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={openMacClipper}
                className="rounded-xl bg-gradient-to-r from-amber-300 via-yellow-300 to-orange-300 px-5 py-3 text-sm font-black text-[#2d1900] shadow-[0_18px_60px_rgba(255,189,74,0.28)] transition-transform hover:-translate-y-0.5"
              >
                {didAttemptOpenApp ? 'Open MacClipper Again' : 'Open MacClipper'}
              </button>
              <Link
                to="/settings"
                className="rounded-xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                Manage Subscription
              </Link>
            </div>
          </div>
        )}

        {status === 'pending' && (
          <div className="rounded-[2rem] border border-amber-200/20 bg-white/8 p-8 text-center shadow-[0_30px_120px_rgba(255,185,70,0.18)] backdrop-blur-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.42em] text-amber-100/70">MacClipper</p>

            <div className="mx-auto mt-6 flex h-16 w-16 items-center justify-center rounded-full border-2 border-amber-200/30 bg-amber-100/10">
              <svg className="h-8 w-8 text-amber-300" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>

            <h1 className="mt-5 text-2xl font-black tracking-tight text-white">Payment received</h1>
            <p className="mt-2 text-sm leading-6 text-amber-50/76">
              {syncMessage}
            </p>

            {orderId && (
              <div className="mt-5 rounded-2xl border border-white/12 bg-black/15 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-200/70">Order ID</p>
                <p className="mt-2 font-mono text-sm font-semibold text-white">{orderId}</p>
              </div>
            )}

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={openMacClipper}
                className="rounded-xl bg-gradient-to-r from-amber-300 via-yellow-300 to-orange-300 px-5 py-3 text-sm font-black text-[#2d1900] shadow-[0_18px_60px_rgba(255,189,74,0.28)] transition-transform hover:-translate-y-0.5"
              >
                Open MacClipper Now
              </button>
              <Link
                to="/dashboard"
                className="rounded-xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                Go to Dashboard
              </Link>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="rounded-[2rem] border border-red-200/15 bg-white/8 p-8 text-center shadow-[0_30px_120px_rgba(255,80,80,0.12)] backdrop-blur-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.42em] text-amber-100/70">MacClipper</p>

            <div className="mx-auto mt-6 flex h-16 w-16 items-center justify-center rounded-full border-2 border-red-200/20 bg-red-300/10">
              <svg className="h-8 w-8 text-red-200" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>

            <h1 className="mt-5 text-2xl font-black tracking-tight text-white">Something went wrong</h1>
            <p className="mt-2 text-sm text-amber-50/74">
              We could not confirm your order automatically.
            </p>

            {errorMessage && (
              <div className="mt-4 rounded-2xl border border-white/12 bg-black/15 p-3 text-xs text-amber-50/68">
                {errorMessage}
              </div>
            )}

            <p className="mt-4 text-sm text-amber-50/68">
              If you completed payment, your Pro access may still activate within a few minutes. Contact support with your email or order details if it does not.
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <Link
                to="/support"
                className="rounded-xl bg-gradient-to-r from-amber-300 via-yellow-300 to-orange-300 px-5 py-3 text-sm font-black text-[#2d1900] shadow-[0_18px_60px_rgba(255,189,74,0.28)] transition-transform hover:-translate-y-0.5"
              >
                Contact Support
              </Link>
              <Link
                to="/dashboard"
                className="rounded-xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                Go to Dashboard
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default OrderConfirmation;
