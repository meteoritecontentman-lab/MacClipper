import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Clipboard, Cloud, Globe2, Shield, Star } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { displayNameFromUser } from '../lib/avatarTheme';
import { readLinkedAppState, saveLinkedAppState, subscribeToLinkedAppState } from '../lib/appLinkState';
import { canAccessAdminPortal, subscriptionLabelForUser } from '../lib/accountState';
import { fetchEntitlementsByAppUuid, hasProEntitlement } from '../lib/cloudAccount';
import { fetchSharedClips, subscribeToSharedClips } from '../lib/cloudSharedClips';

function formatShortDate(value) {
  const parsedDate = new Date(value || Date.now());
  if (Number.isNaN(parsedDate.getTime())) {
    return '';
  }

  return parsedDate.toLocaleDateString([], {
    month: 'short',
    day: 'numeric'
  });
}

function clipLabel(clip) {
  if (typeof clip.title === 'string' && clip.title.trim()) {
    return clip.title.trim();
  }

  if (typeof clip.content === 'string') {
    return clip.content.split('/').pop()?.split('?')[0]?.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ') || 'Untitled Clip';
  }

  return 'Untitled Clip';
}

function clipTimestamp(value) {
  const parsedDate = new Date(value || 0);
  const timestamp = parsedDate.getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function buildRecentActivityItems(clips, sharedClips) {
  const normalizedItems = [
    ...(Array.isArray(clips) ? clips : []).map((clip) => ({
      id: `clip-${clip.id}`,
      dedupeKey: String(clip.content || clip.videoURL || clip.id || '').trim(),
      label: clipLabel(clip),
      createdAt: clip.created_at || clip.created_date || null,
      href: clip.id ? `/clip/${clip.id}` : '/clips',
      isExternal: false,
      gameTitle: clip.game_title || '',
      categoryLabel: clip.category_label || '',
      statusLabel: clip.visibility || 'private',
      sourceLabel: 'My clip'
    })),
    ...(Array.isArray(sharedClips) ? sharedClips : []).map((share) => ({
      id: `share-${share.id}`,
      dedupeKey: String(share.videoURL || share.id || '').trim(),
      label: clipLabel(share),
      createdAt: share.uploadedAt || null,
      href: String(share.pageURL || share.shareURL || '/clips').trim() || '/clips',
      isExternal: /^https?:\/\//i.test(String(share.pageURL || share.shareURL || '').trim()),
      gameTitle: '',
      categoryLabel: '',
      statusLabel: 'cloud',
      sourceLabel: 'Cloud upload'
    }))
  ];

  const seen = new Set();

  return normalizedItems
    .filter((item) => {
      const dedupeKey = item.dedupeKey || item.id;
      if (seen.has(dedupeKey)) {
        return false;
      }

      seen.add(dedupeKey);
      return true;
    })
    .sort((left, right) => clipTimestamp(right.createdAt) - clipTimestamp(left.createdAt))
    .slice(0, 5);
}

function Dashboard({ currentUser }) {
  const [clips, setClips] = useState([]);
  const [sharedClips, setSharedClips] = useState([]);
  const [favoriteCount, setFavoriteCount] = useState(0);
  const [linkedCloudCount, setLinkedCloudCount] = useState(0);
  const [linkedAppState, setLinkedAppState] = useState(() => readLinkedAppState(currentUser?.id));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isCancelled = false;

    async function loadDashboard() {
      if (!currentUser?.id) {
        setLoading(false);
        return;
      }

      const [clipsResult, favoritesResult] = await Promise.all([
        supabase.from('clips').select('*').or(`user_id.eq.${currentUser.id},owner_profile_id.eq.${currentUser.id}`).order('created_at', { ascending: false }).limit(50),
        supabase.from('favourites').select('*', { count: 'exact', head: true }).eq('user_id', currentUser.id)
      ]);

      let linkedCloudTotal = 0;
      let nextSharedClips = [];
      try {
        nextSharedClips = await fetchSharedClips(currentUser.id);
        linkedCloudTotal = nextSharedClips.length;
      } catch (error) {
        console.error('Error loading linked cloud clips for dashboard:', error);
      }

      if (isCancelled) {
        return;
      }

      if (clipsResult.error) {
        console.error('Error loading dashboard clips:', clipsResult.error);
      }

      if (favoritesResult.error) {
        console.error('Error loading favorite count:', favoritesResult.error);
      }

      setClips(clipsResult.data || []);
      setSharedClips(nextSharedClips);
      setFavoriteCount(favoritesResult.count || 0);
      setLinkedCloudCount(linkedCloudTotal);
      setLoading(false);
    }

    loadDashboard();

    return () => {
      isCancelled = true;
    };
  }, [currentUser?.id]);

  useEffect(() => {
    if (!currentUser?.id) {
      return undefined;
    }

    return subscribeToSharedClips(currentUser.id, {
      onShares: (shares) => {
        setSharedClips(shares);
        setLinkedCloudCount(shares.length);
      },
      onError: (error) => {
        console.error('Error streaming dashboard cloud clips:', error);
      }
    });
  }, [currentUser?.id]);

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
        console.error('Error syncing entitlements on Dashboard page:', error);
      }
    };

    void syncEntitlements();

    return () => {
      active = false;
    };
  }, [currentUser?.id, linkedAppState.linked, linkedAppState.appUuid, linkedAppState.linkedAt]);

  const publicClips = clips.filter((clip) => clip.visibility === 'public').length;
  const recentClips = useMemo(() => buildRecentActivityItems(clips, sharedClips), [clips, sharedClips]);
  const subscriptionLabel = linkedAppState.linked
    ? (hasProEntitlement(linkedAppState) ? 'Pro' : 'Free')
    : subscriptionLabelForUser(currentUser);
  const adminPortalEnabled = canAccessAdminPortal(currentUser);
  const stats = [
    { label: 'Total Clips', value: clips.length, icon: Clipboard, colorClassName: 'text-primary' },
    { label: 'Cloud Links', value: linkedCloudCount, icon: Cloud, colorClassName: 'text-sky-600' },
    { label: 'Favorites', value: favoriteCount, icon: Star, colorClassName: 'text-accent' },
    { label: 'Public Clips', value: publicClips, icon: Globe2, colorClassName: 'text-emerald-600' }
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="page-heading">Welcome back{currentUser ? `, ${displayNameFromUser(currentUser)}` : ''}</h1>
        <p className="page-subtitle">Here is your clipper overview.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat, index) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.08 }}
            className="glass-card"
          >
            <div className="flex items-center gap-4 p-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                <stat.icon className={[stat.colorClassName, 'h-6 w-6'].join(' ')} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
                <p className="text-2xl font-bold text-foreground">{stat.value}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="glass-card p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Account Status</p>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-foreground">Your account at a glance.</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {linkedAppState.linked ? 'MacClipper is connected to this account.' : 'Connect MacClipper to start receiving cloud clips here.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">Plan: {subscriptionLabel}</span>
            <span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-secondary-foreground">
              {linkedAppState.linked ? 'Mac linked' : 'Mac link missing'}
            </span>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          {!linkedAppState.linked ? (
            <Link to="/link-app" className="rounded-lg border border-amber-400/60 bg-gradient-to-r from-amber-500/20 to-orange-500/20 px-4 py-2 text-sm font-semibold text-amber-200 transition-colors hover:from-amber-500/30 hover:to-orange-500/30">
              Link MacClipper to unlock Pro checkout
            </Link>
          ) : null}
          <Link to="/support" className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted">
            Subscription Plans
          </Link>
          {adminPortalEnabled ? (
            <Link to="/admin" className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted">
              <Shield className="h-4 w-4" />
              Admin Portal
            </Link>
          ) : null}
        </div>
      </div>

      <div className="glass-card">
        <div className="flex items-center justify-between border-b border-border p-6">
          <div>
            <h2 className="text-lg font-bold text-foreground">Recent Clips</h2>
            <p className="mt-1 text-sm text-muted-foreground">Your latest clips, public posts, and linked cloud uploads.</p>
          </div>
          <Link to="/clips" className="text-sm font-medium text-primary hover:underline">View All →</Link>
        </div>
        <div className="p-6">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((index) => (
                <div key={index} className="h-16 animate-pulse rounded-lg bg-muted"></div>
              ))}
            </div>
          ) : recentClips.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Clipboard className="mx-auto mb-3 h-12 w-12 opacity-30" />
              <p className="font-medium">No clips yet</p>
              <p className="mt-1 text-sm">Save or upload a clip and it will show up here.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentClips.map((clip) => {
                const content = (
                  <div className="flex items-center gap-4 rounded-lg border border-transparent p-3 transition-colors hover:border-border hover:bg-muted/40">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Clipboard className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{clip.label}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{clip.sourceLabel}</span>
                        {clip.gameTitle ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">{clip.gameTitle}</span> : null}
                        {clip.categoryLabel ? <span className="rounded-full bg-secondary px-2 py-0.5 text-secondary-foreground">{clip.categoryLabel}</span> : null}
                        {clip.statusLabel ? <span className="rounded-full bg-muted px-2 py-0.5 capitalize text-muted-foreground">{clip.statusLabel}</span> : null}
                      </div>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatShortDate(clip.createdAt)}</span>
                  </div>
                );

                if (clip.isExternal) {
                  return (
                    <a key={clip.id} href={clip.href} target="_blank" rel="noreferrer" className="block">
                      {content}
                    </a>
                  );
                }

                return (
                  <Link key={clip.id} to={clip.href} className="block">
                    {content}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>

      
    </div>
  );
}

export default Dashboard;