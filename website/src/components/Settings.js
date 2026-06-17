import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { avatarStyleFromSeed, avatarURLFromUser, displayNameFromUser, initialsFromName } from '../lib/avatarTheme';
import { readLinkedAppState, saveLinkedAppState, clearLinkedAppState, subscribeToLinkedAppState } from '../lib/appLinkState';
import { canAccessAdminPortal, subscriptionLabelForTier, subscriptionLabelForUser } from '../lib/accountState';
import { createStripePortalSession, fetchBillingSubscription, fetchEntitlementsByAppUuid, unlinkApp } from '../lib/cloudAccount';
import { enqueueProfileUpdate, flushProfileUpdateQueue } from '../lib/profileUpdateQueue';

function Settings({ currentUser = null }) {
  const [linkedAppState, setLinkedAppState] = useState(() => readLinkedAppState(currentUser?.id));
  const [avatarStatus, setAvatarStatus] = useState('');
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [avatarHover, setAvatarHover] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState('');
  const [displayNameDraft, setDisplayNameDraft] = useState('');
  const [savingIdentity, setSavingIdentity] = useState(false);
  const [identityStatus, setIdentityStatus] = useState('');
  const [subscription, setSubscription] = useState(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  const [clearCacheStatus, setClearCacheStatus] = useState('');
  const [unlinkLoading, setUnlinkLoading] = useState(false);
  const [unlinkStatus, setUnlinkStatus] = useState('');
  const [unlinkConfirm, setUnlinkConfirm] = useState(false);
  const [signOutStatus, setSignOutStatus] = useState('');
  const [signingOut, setSigningOut] = useState(false);

  const queueAndFlushProfileUpdate = (update, optimisticUser) => {
    enqueueProfileUpdate(update);
    void flushProfileUpdateQueue(optimisticUser || currentUser)
      .catch((error) => {
        console.error('Background profile sync failed:', error);
      });
  };

  const emitUserProfileUpdate = (nextUser) => {
    if (typeof window === 'undefined' || !nextUser?.id) {
      return;
    }

    window.dispatchEvent(new CustomEvent('macclipper:user-profile-updated', {
      detail: { user: nextUser }
    }));
  };

  const handleUnlink = async () => {
    if (!unlinkConfirm) {
      setUnlinkConfirm(true);
      return;
    }

    if (!currentUser?.id || unlinkLoading) {
      return;
    }

    setUnlinkLoading(true);
    setUnlinkStatus('');
    try {
      await unlinkApp({ websiteUserId: currentUser.id });
      clearLinkedAppState(currentUser.id);
      setUnlinkStatus('App unlinked. You can relink anytime from the Link App page.');
    } catch (err) {
      console.error('Unlink error:', err);
      setUnlinkStatus('Could not unlink. Try again.');
    } finally {
      setUnlinkLoading(false);
      setUnlinkConfirm(false);
    }
  };

  const handleClearCache = () => {
    try {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('macclipper.')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key));
      setClearCacheStatus(`Cleared ${keysToRemove.length} cached item${keysToRemove.length !== 1 ? 's' : ''}. Reloading…`);
      setTimeout(() => window.location.reload(), 800);
    } catch {
      setClearCacheStatus('Could not clear cache. Try refreshing manually.');
    }
  };

  const openMacClipper = () => {
    window.location.assign('macclipper://connect');
  };

  const handleSignOut = async () => {
    if (signingOut) {
      return;
    }

    setSigningOut(true);
    setSignOutStatus('');

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

      // Final fallback: clear local Supabase session keys for this origin.
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

      setSignOutStatus('Signed out locally. Reloading...');
      window.location.assign('/signin');
      return;
    } finally {
      setSigningOut(false);
    }
  };

  const handleManageSubscription = async () => {
    if (!currentUser?.id || portalLoading) {
      return;
    }
    setPortalLoading(true);
    try {
      const result = await createStripePortalSession({ websiteUserId: currentUser.id });
      if (result?.url) {
        window.location.href = result.url;
      }
    } catch (err) {
      console.error('Portal error:', err);
    } finally {
      setPortalLoading(false);
    }
  };

  const displayName = displayNameDraft.trim() || displayNameFromUser(currentUser);
  const initials = initialsFromName(displayName);
  const avatarStyle = avatarStyleFromSeed(currentUser?.id || currentUser?.email || displayName);
  const avatarURL = avatarPreview || avatarURLFromUser(currentUser);
  const websiteSubscriptionLabel = subscriptionLabelForUser(currentUser);
  const linkedAppPlanLabel = subscriptionLabelForTier(linkedAppState.subscriptionTier);
  const subscriptionLabel = linkedAppState.linked
    ? linkedAppPlanLabel
    : websiteSubscriptionLabel;
  const adminPortalEnabled = canAccessAdminPortal(currentUser);

  useEffect(() => {
    const nextState = readLinkedAppState(currentUser?.id);
    setLinkedAppState(nextState);

    return subscribeToLinkedAppState(currentUser?.id, setLinkedAppState);
  }, [currentUser?.id]);

  useEffect(() => {
    if (!currentUser?.id || !linkedAppState.linked || !linkedAppState.appUuid) {
      return;
    }

    let active = true;

    const syncEntitlements = async () => {
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
      } catch (error) {
        console.error('Error syncing entitlements on Settings page:', error);
      }
    };

    void syncEntitlements();

    return () => {
      active = false;
    };
  }, [currentUser?.id, linkedAppState.linked, linkedAppState.appUuid, linkedAppState.linkedAt]);

  useEffect(() => {
    setDisplayNameDraft(displayNameFromUser(currentUser));
    setAvatarPreview(avatarURLFromUser(currentUser));
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser?.id) {
      return;
    }

    let active = true;
    setSubscriptionLoading(true);

    fetchBillingSubscription(currentUser.id)
      .then((data) => {
        if (active) {
          setSubscription(data);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) {
          setSubscriptionLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [currentUser?.id]);

  const handleAvatarFileChange = async (event) => {
    if (!currentUser) {
      return;
    }

    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      setAvatarStatus('Please choose an image file.');
      event.target.value = '';
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setAvatarStatus('Please use an image smaller than 5 MB.');
      event.target.value = '';
      return;
    }

    setSavingAvatar(true);
    setAvatarStatus('');

    try {
      const localPreviewURL = URL.createObjectURL(file);
      setAvatarPreview(localPreviewURL);

      const sanitizedFileName = String(file.name || 'avatar')
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .slice(-80);
      const storagePath = `${currentUser.id}/avatars/${Date.now()}-${sanitizedFileName || 'avatar'}`;

      const { error: uploadError } = await supabase.storage
        .from('clips')
        .upload(storagePath, file, {
          contentType: file.type || 'image/jpeg',
          cacheControl: '3600',
          upsert: true
        });

      if (uploadError) {
        console.error('Error uploading avatar:', uploadError);
        URL.revokeObjectURL(localPreviewURL);
        setAvatarPreview(avatarURLFromUser(currentUser));
        setAvatarStatus('Could not upload that picture. Try another image.');
        return;
      }

      const { data: avatarURLData } = supabase.storage
        .from('clips')
        .getPublicUrl(storagePath);
      const nextAvatarURL = String(avatarURLData?.publicUrl || '').trim();

      if (!nextAvatarURL) {
        URL.revokeObjectURL(localPreviewURL);
        setAvatarPreview(avatarURLFromUser(currentUser));
        setAvatarStatus('Could not finalize the picture URL. Please try again.');
        return;
      }

      URL.revokeObjectURL(localPreviewURL);
      setAvatarPreview(nextAvatarURL);

      const nextMetadata = {
        ...(currentUser.user_metadata || {}),
        avatar_url: nextAvatarURL
      };

      const nextUserSnapshot = {
        ...currentUser,
        user_metadata: nextMetadata
      };

      emitUserProfileUpdate(nextUserSnapshot);
      queueAndFlushProfileUpdate({
        userId: currentUser.id,
        email: currentUser.email ?? null,
        displayName: displayNameDraft.trim() || displayNameFromUser(currentUser),
        avatarURL: nextAvatarURL
      }, nextUserSnapshot);

      setAvatarStatus('Profile picture updated instantly. Syncing in background...');
    } catch (error) {
      console.error('Unexpected avatar update error:', error);
      setAvatarStatus('Profile picture update failed.');
      setAvatarPreview(avatarURLFromUser(currentUser));
    } finally {
      setSavingAvatar(false);
      event.target.value = '';
    }
  };

  const handleSaveIdentity = async () => {
    if (!currentUser?.id || savingIdentity) {
      return;
    }

    const nextDisplayName = displayNameDraft.trim();
    if (!nextDisplayName) {
      setIdentityStatus('Username cannot be empty.');
      return;
    }

    setSavingIdentity(true);
    setIdentityStatus('');

    const nextMetadata = {
      ...(currentUser.user_metadata || {}),
      full_name: nextDisplayName,
      name: nextDisplayName,
      user_name: nextDisplayName,
      avatar_url: avatarURL || null
    };
    const nextUserSnapshot = {
      ...currentUser,
      user_metadata: nextMetadata
    };

    emitUserProfileUpdate(nextUserSnapshot);
    queueAndFlushProfileUpdate({
      userId: currentUser.id,
      email: currentUser.email ?? null,
      displayName: nextDisplayName,
      avatarURL: avatarURL || null
    }, nextUserSnapshot);

    setIdentityStatus('Username updated instantly. Syncing in background...');
    setSavingIdentity(false);
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="page-heading">Settings</h1>
        <p className="page-subtitle">Manage your profile and preferences.</p>
      </div>

      <section className="glass-card p-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-center">
          <label
            className="group relative cursor-pointer"
            onMouseEnter={() => setAvatarHover(true)}
            onMouseLeave={() => setAvatarHover(false)}
            title="Click to change profile picture"
          >
            {avatarURL ? (
              <img src={avatarURL} alt={displayName} className="h-20 w-20 rounded-full border-2 border-border object-cover" />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-border text-2xl font-bold text-white" style={avatarStyle}>
                {initials}
              </div>
            )}
            <input
              className="hidden"
              type="file"
              accept="image/*"
              onChange={handleAvatarFileChange}
              disabled={savingAvatar}
            />
            <span className={[
              'absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-[10px] font-semibold uppercase tracking-[0.12em] text-white transition-opacity',
              avatarHover || savingAvatar ? 'opacity-100' : 'opacity-0'
            ].join(' ')}>
              {savingAvatar ? 'Saving…' : 'Change'}
            </span>
          </label>
          <div className="space-y-1">
            <h2 className="text-2xl font-bold tracking-tight text-foreground">{displayName}</h2>
            <p className="text-sm text-muted-foreground">{currentUser?.email || 'Signed in with Google'}</p>
          </div>
        </div>
        <div className="mt-6 rounded-2xl border border-border bg-muted/20 p-4">
          <p className="text-sm font-semibold text-foreground">Profile picture</p>
          <p className="mt-1 text-sm text-muted-foreground">Hover your avatar and click it to upload a new picture.</p>
          {avatarStatus ? <p className="mt-3 text-sm text-muted-foreground">{avatarStatus}</p> : null}
        </div>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="glass-card p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Account Info</p>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Full Name</span>
              <span className="font-medium text-foreground">{displayName}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Email</span>
              <span className="font-medium text-foreground">{currentUser?.email || '—'}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Plan</span>
              <span className="font-medium text-foreground">{subscriptionLabel}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Linked App Plan</span>
              <span className="font-medium text-foreground">{linkedAppState.linked ? linkedAppPlanLabel : 'Not linked'}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Mac link</span>
              <span className="font-medium text-foreground">{linkedAppState.linked ? 'Connected' : 'Not linked'}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Linked App UUID</span>
              <span className="font-medium text-foreground">{linkedAppState.appUuid ? linkedAppState.appUuid.slice(0, 8).toUpperCase() : '—'}</span>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-border bg-muted/20 p-4">
            <label className="block text-sm font-medium text-foreground" htmlFor="settings-display-name">Username</label>
            <input
              id="settings-display-name"
              type="text"
              value={displayNameDraft}
              onChange={(event) => setDisplayNameDraft(event.target.value)}
              maxLength={40}
              className="mt-3 w-full rounded-xl border border-input bg-background px-3 py-3 text-sm text-foreground"
              placeholder="Your creator name"
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleSaveIdentity}
                disabled={savingIdentity || displayNameDraft.trim().length === 0}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
              >
                {savingIdentity ? 'Saving…' : 'Save Username'}
              </button>
              {identityStatus ? <p className="text-sm text-muted-foreground">{identityStatus}</p> : null}
            </div>
          </div>
        </section>

        <section className="glass-card p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Link the app</p>
          <h2 className="mt-3 text-xl font-bold tracking-tight text-foreground">Mac connection</h2>
          {linkedAppState.linked ? (
            <div className="mt-4 rounded-2xl border border-emerald-400/40 bg-emerald-500/10 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/20">
                  <svg className="h-4 w-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Already Linked</p>
                  <p className="text-xs text-muted-foreground">MacClipper is connected to this account.{linkedAppState.appUuid ? ` UUID: ${linkedAppState.appUuid.slice(0, 8).toUpperCase()}` : ''}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-3">
                <button type="button" onClick={openMacClipper} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">Open MacClipper</button>
                {unlinkConfirm ? (
                  <>
                    <button type="button" onClick={handleUnlink} disabled={unlinkLoading} className="rounded-lg border border-red-500/70 bg-red-600/25 px-4 py-2 text-sm font-semibold text-red-100 shadow-sm transition-colors hover:bg-red-600/35 disabled:opacity-60">{unlinkLoading ? 'Unlinking…' : 'Confirm Unlink'}</button>
                    <button type="button" onClick={() => setUnlinkConfirm(false)} className="rounded-lg border border-white/25 bg-black/25 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-black/35">Cancel</button>
                  </>
                ) : (
                  <button type="button" onClick={handleUnlink} className="rounded-lg border border-red-500/70 bg-red-600/20 px-4 py-2 text-sm font-semibold text-red-100 shadow-sm transition-colors hover:bg-red-600/30">Unlink App</button>
                )}
              </div>
              {unlinkStatus ? <p className="mt-3 text-sm text-muted-foreground">{unlinkStatus}</p> : null}
            </div>
          ) : (
            <>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">This account still needs a MacClipper connection.</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <button type="button" onClick={openMacClipper} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">Open MacClipper</button>
                <Link to="/link-app" className="rounded-lg border border-amber-400/60 bg-gradient-to-r from-amber-500/20 to-orange-500/20 px-4 py-2 text-sm font-semibold text-amber-200 transition-colors hover:from-amber-500/30 hover:to-orange-500/30">Link MacClipper first</Link>
              </div>
            </>
          )}
        </section>

        <section className="glass-card p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Membership</p>
          <h2 className="mt-3 text-xl font-bold tracking-tight text-foreground">Subscription</h2>

          {subscriptionLoading ? (
            <div className="mt-4 flex items-center gap-3 text-sm text-muted-foreground">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary" />
              Loading subscription…
            </div>
          ) : subscription?.hasPro ? (
            <div className="mt-4 space-y-3">
              <div className="rounded-2xl border border-amber-400/30 bg-amber-500/8 p-4 space-y-3">
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-muted-foreground">Plan</span>
                  <span className="font-semibold text-foreground">{subscription.planName || 'MacClipper Pro'}</span>
                </div>
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-muted-foreground">Status</span>
                  <span className={[
                    'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
                    subscription.status === 'active' ? 'bg-emerald-500/15 text-emerald-400' :
                    subscription.status === 'trialing' ? 'bg-sky-500/15 text-sky-400' :
                    subscription.status === 'past_due' ? 'bg-red-500/15 text-red-400' :
                    'bg-muted text-muted-foreground'
                  ].join(' ')}>
                    {subscription.status === 'active' ? 'Active' :
                     subscription.status === 'trialing' ? 'Trial' :
                     subscription.status === 'past_due' ? 'Past Due' :
                     subscription.status}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-muted-foreground">Billing amount</span>
                  <span className="font-semibold text-foreground">
                    {subscription.amountCents > 0
                      ? new Intl.NumberFormat('en-US', { style: 'currency', currency: subscription.currency || 'usd' }).format(subscription.amountCents / 100) + ' / mo'
                      : '—'}
                  </span>
                </div>
                {subscription.currentPeriodEnd && (
                  <div className="flex items-center justify-between gap-4 text-sm">
                    <span className="text-muted-foreground">
                      {subscription.cancelAtPeriodEnd ? 'Ends on' : 'Next billing'}
                    </span>
                    <span className={['font-semibold', subscription.cancelAtPeriodEnd ? 'text-amber-400' : 'text-foreground'].join(' ')}>
                      {new Date(subscription.currentPeriodEnd).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                    </span>
                  </div>
                )}
                {subscription.startedAt && (
                  <div className="flex items-center justify-between gap-4 text-sm">
                    <span className="text-muted-foreground">Member since</span>
                    <span className="font-medium text-foreground">
                      {new Date(subscription.startedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                    </span>
                  </div>
                )}
                {subscription.orderNumber && (
                  <div className="flex items-center justify-between gap-4 text-sm">
                    <span className="text-muted-foreground">Order #</span>
                    <span className="font-mono text-foreground">{subscription.orderNumber}</span>
                  </div>
                )}
                {subscription.cancelAtPeriodEnd && (
                  <p className="text-xs text-amber-400/80 mt-1">Cancels at the end of the current billing period.</p>
                )}
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleManageSubscription}
                  disabled={portalLoading}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
                >
                  {portalLoading ? 'Opening…' : 'Manage Subscription'}
                </button>
                {adminPortalEnabled ? <Link to="/admin" className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted">Open Admin Portal</Link> : null}
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <p className="text-sm leading-relaxed text-muted-foreground">
                {subscription?.status && subscription.status !== 'none'
                  ? `Your subscription is ${subscription.status}. Upgrade to Pro for more creator headroom.`
                  : 'You\'re on the Free plan. Upgrade to Pro to unlock full 4K uploads and more.'}
              </p>
              <div className="flex flex-wrap gap-3">
                <Link to="/support" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">Upgrade to Pro</Link>
                {adminPortalEnabled ? <Link to="/admin" className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted">Open Admin Portal</Link> : null}
              </div>
            </div>
          )}
        </section>

        <section className="glass-card p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">App Data</p>
          <h2 className="mt-3 text-xl font-bold tracking-tight text-foreground">Clear Cache</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Reset locally cached app state — linked Mac connection, stored preferences, and session data. Your account and clips are not affected.</p>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <button type="button" onClick={handleClearCache} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted">Clear Cache</button>
            {clearCacheStatus ? <p className="text-sm text-muted-foreground">{clearCacheStatus}</p> : null}
          </div>
        </section>

        <section className="glass-card border-destructive/30 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-destructive">Sign Out</p>
          <h2 className="mt-3 text-xl font-bold tracking-tight text-foreground">Sign out of your MacClipper account on this device.</h2>
          <div className="mt-6">
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              className="rounded-lg border border-destructive/30 px-4 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60"
            >
              {signingOut ? 'Signing out...' : 'Sign Out'}
            </button>
            {signOutStatus ? <p className="mt-3 text-sm text-muted-foreground">{signOutStatus}</p> : null}
          </div>
        </section>
      </div>
    </div>
  );
}

export default Settings;