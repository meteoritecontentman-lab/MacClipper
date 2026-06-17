import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { fetchEntitlementsByAppUuid, hasProEntitlement, createStripeCheckoutSession, createStripePortalSession, verifyStripeCheckout } from '../lib/cloudAccount';
import { readLinkedAppState, saveLinkedAppState, subscribeToLinkedAppState } from '../lib/appLinkState';

const planCards = [
  {
    title: 'Free',
    price: '$0',
    emphasis: 'Start with 10 hosted clip uploads for fast embeds and link sharing.',
    features: [
      '10 hosted clip uploads',
      'Unlisted clip pages',
      'Game + category tagging',
      'Google account channel identity'
    ],
    cta: 'Use Free'
  },
  {
    title: 'Pro',
    price: '$6.99/mo',
    emphasis: 'Built for creators who want faster uploads, richer channels, and priority support.',
    features: [
      'Unlimited hosted uploads',
      'Channel polish and creator pages',
      'Priority upload and share queue',
      'Verification review after 10,000 followers'
    ],
    cta: 'Choose Pro'
  }
];

const PRO_CHECKOUT_DISABLED = true;

function Support({ currentUser }) {
  const location = useLocation();
  const [linkedAppState, setLinkedAppState] = useState(() => readLinkedAppState(currentUser?.id));
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [portalBusy, setPortalBusy] = useState(false);
  const [billingStatus, setBillingStatus] = useState('');

  useEffect(() => {
    setLinkedAppState(readLinkedAppState(currentUser?.id));
    return subscribeToLinkedAppState(currentUser?.id, setLinkedAppState);
  }, [currentUser?.id]);

  const linkedPro = hasProEntitlement(linkedAppState);

  useEffect(() => {
    const params = new URLSearchParams(location.search || '');
    const billingResult = params.get('billing');

    if (billingResult === 'cancel') {
      setBillingStatus('Checkout canceled. You can restart anytime.');
      return;
    }

    if (billingResult !== 'success' || !currentUser?.id || !linkedAppState.appUuid) {
      return;
    }

    let active = true;
    const syncEntitlements = async () => {
      // First, actively verify and fulfill the checkout session so Pro is granted
      // immediately without depending on webhooks.
      const params = new URLSearchParams(location.search || '');
      const sessionId = params.get('session_id');
      if (sessionId) {
        try {
          await verifyStripeCheckout({ sessionId, websiteUserId: currentUser.id });
        } catch (verifyError) {
          console.error('Checkout verification error (will still poll):', verifyError);
        }
      }

      // Now poll up to 6 times for the entitlement to reflect in the read path.
      for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
          const entitlements = await fetchEntitlementsByAppUuid(linkedAppState.appUuid);
          if (!active) {
            return;
          }

          saveLinkedAppState(currentUser.id, {
            appUuid: linkedAppState.appUuid,
            linkedAt: linkedAppState.linkedAt,
            subscriptionTier: entitlements.subscriptionTier,
            paidFeatures: entitlements.paidFeatures,
            verifiedAt: new Date().toISOString()
          });

          if (hasProEntitlement(entitlements)) {
            setBillingStatus('Payment complete. Pro unlocked for your account. Open MacClipper to see Pro activation there too.');
            return;
          }
        } catch (error) {
          console.error('Error refreshing entitlements after checkout:', error);
        }

        await new Promise((resolve) => setTimeout(resolve, 1500));
      }

      if (active) {
        setBillingStatus('Payment received. Entitlement sync is still processing. Refresh in a few seconds.');
      }
    };

    void syncEntitlements();

    return () => {
      active = false;
    };
  }, [location.search, currentUser?.id, linkedAppState.appUuid, linkedAppState.linkedAt]);

  const canStartCheckout = Boolean(!PRO_CHECKOUT_DISABLED && currentUser?.id && linkedAppState.linked && !linkedPro);

  const proPlanActionLabel = useMemo(() => {
    if (PRO_CHECKOUT_DISABLED) {
      return 'Pro checkout disabled';
    }

    if (!currentUser) {
      return 'Sign in to subscribe';
    }

    if (!linkedAppState.linked) {
      return 'Link MacClipper first';
    }

    if (linkedPro) {
      return 'Already Pro';
    }

    return 'Choose Pro';
  }, [currentUser, linkedAppState.linked, linkedPro]);

  const startCheckout = async () => {
    if (PRO_CHECKOUT_DISABLED) {
      setBillingStatus('Pro checkout is temporarily disabled.');
      return;
    }

    if (!currentUser?.id) {
      setBillingStatus('Sign in first to start subscription.');
      return;
    }

    if (!linkedAppState.linked) {
      setBillingStatus('Link your MacClipper app first, then subscribe.');
      return;
    }

    setCheckoutBusy(true);
    setBillingStatus('Opening secure checkout...');

    try {
      const { url } = await createStripeCheckoutSession({
        websiteUserId: currentUser.id,
        email: currentUser.email
      });

      if (!url) {
        throw new Error('Stripe checkout URL is missing.');
      }

      window.location.assign(url);
    } catch (error) {
      console.error('Error starting checkout:', error);
      setBillingStatus(error instanceof Error ? error.message : 'Could not open checkout right now.');
      setCheckoutBusy(false);
    }
  };

  const openPortal = async () => {
    if (!currentUser?.id) {
      setBillingStatus('Sign in first to manage billing.');
      return;
    }

    setPortalBusy(true);
    setBillingStatus('Opening billing portal...');

    try {
      const { url } = await createStripePortalSession({ websiteUserId: currentUser.id });
      if (!url) {
        throw new Error('Billing portal URL is missing.');
      }

      window.location.assign(url);
    } catch (error) {
      console.error('Error opening billing portal:', error);
      setBillingStatus(error instanceof Error ? error.message : 'Could not open billing portal.');
      setPortalBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background font-inter">
      <div className="mx-auto max-w-7xl px-6 py-16 md:px-12">
        <div className="max-w-3xl">
          <h1 className="text-4xl font-extrabold tracking-tight text-foreground">Need help, want updates, or want to find the community?</h1>
          <p className="mt-4 text-lg text-muted-foreground">
            The support side should feel as welcoming as the product. If you hit a snag, want rollout news, or want to see what other MacClipper players are posting, the Discord is the fastest lane.
          </p>
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <section className="glass-card p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Discord</p>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-foreground">Join the MacClipper server</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Share bugs, feature requests, upload feedback, and clips with the community. This is also where the first support replies should land.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href="https://discord.gg/NxSWS3yQzh" target="_blank" rel="noreferrer" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">Open Discord</a>
              {!currentUser ? (
                <Link to="/signup" className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted">
                  Create Account
                </Link>
              ) : !linkedAppState.linked ? (
                <Link to="/link-app" className="rounded-lg border border-amber-400/60 bg-gradient-to-r from-amber-500/20 to-orange-500/20 px-4 py-2 text-sm font-semibold text-amber-200 transition-colors hover:from-amber-500/30 hover:to-orange-500/30">
                  Link MacClipper first
                </Link>
              ) : null}
            </div>
          </section>

          <section className="glass-card p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">What Pro unlocks</p>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-foreground">Free to start. Pro at $6.99/month.</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Pick a plan below. Pro goes directly to secure Stripe monthly checkout.
            </p>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
            {planCards.map((plan) => (
              <article
                key={plan.title}
                className={[
                  'rounded-2xl border border-border bg-muted/30 p-5',
                  plan.title === 'Pro' ? 'pro-plan-card' : ''
                ].join(' ')}
              >
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">
                  {plan.title}
                  {plan.title === 'Pro' ? <span className="ml-2 pro-chip">Most Popular</span> : null}
                </p>
                <strong className="mt-3 block text-2xl font-bold text-foreground">{plan.price}</strong>
                <p className="mt-3 text-sm text-muted-foreground">{plan.emphasis}</p>
                <ul className="mt-4 space-y-2 pl-5 text-sm text-muted-foreground">
                  {plan.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <div className="mt-5">
                  {plan.title === 'Pro' ? (
                    <button
                      type="button"
                      onClick={startCheckout}
                      disabled={!canStartCheckout || checkoutBusy}
                      className={[
                        'rounded-lg px-4 py-2 text-sm font-semibold',
                        canStartCheckout && !checkoutBusy
                          ? 'pro-cta'
                          : 'cursor-not-allowed pro-cta-disabled'
                      ].join(' ')}
                    >
                      {checkoutBusy ? 'Opening checkout...' : proPlanActionLabel}
                    </button>
                  ) : (
                    <button type="button" disabled className="cursor-default rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground">
                      {plan.cta}
                    </button>
                  )}
                </div>
              </article>
            ))}
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={openPortal}
                disabled={!currentUser || portalBusy}
                className={[
                  'rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors',
                  currentUser && !portalBusy
                    ? 'text-foreground hover:bg-muted'
                    : 'cursor-not-allowed bg-muted text-muted-foreground'
                ].join(' ')}
              >
                {portalBusy ? 'Opening portal...' : 'Manage Subscription'}
              </button>
              {!linkedAppState.linked ? (
                <Link to="/link-app" className="rounded-lg border border-amber-400/60 bg-gradient-to-r from-amber-500/20 to-orange-500/20 px-4 py-2 text-sm font-semibold text-amber-200 transition-colors hover:from-amber-500/30 hover:to-orange-500/30">
                  Link MacClipper first
                </Link>
              ) : null}
            </div>
            {billingStatus ? <p className="mt-4 text-sm text-muted-foreground">{billingStatus}</p> : null}
          </section>

          <section className="glass-card p-6 lg:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Trust</p>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-foreground">Creator counts should be real.</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Follows, likes, comments, and upload limits need to be enforced server-side so nobody can spoof growth from the browser. The site is being shaped around that rule, not around fake counters.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">10 free hosted uploads</span>
              <span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-secondary-foreground">Verification at 10,000 followers</span>
              <span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-secondary-foreground">Moderation-first admin flow</span>
            </div>
          </section>
        </div>

        <div className="mt-8 rounded-2xl border border-border bg-muted/30 p-6">
          <p className="text-sm font-semibold text-foreground">Subscriptions run through Stripe secure checkout.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Pro billing is monthly at $6.99. After payment, your linked app account is upgraded automatically.
          </p>
        </div>
      </div>
    </div>
  );
}

export default Support;