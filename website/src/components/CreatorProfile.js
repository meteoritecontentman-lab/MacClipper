import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { buildCloudAPIURL } from '../lib/appRuntime';
import { canAccessAdminPortal } from '../lib/accountState';
import { resolveSupabaseSession } from '../lib/supabaseSession';
import { hydrateClipsWithSharedLinks } from '../lib/cloudSharedClips';
import { avatarStyleFromSeed, avatarURLFromUser, displayNameFromUser, initialsFromName, isVerifiedProfile, ownerTagLabel } from '../lib/avatarTheme';
import { fetchPublicClipsByOwnerId, fetchPublicProfileById } from '../lib/publicSupabase';
import ClipSocialCard from './ClipSocialCard';

function formatCompactNumber(value) {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value || 0));
}

function profileHandle(displayName, profileId) {
  const normalizedName = String(displayName || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (normalizedName) {
    return `@${normalizedName}`;
  }

  return `@creator${String(profileId || '').replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase()}`;
}

function formatJoinDate(value) {
  if (!value) {
    return 'Joined recently';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Joined recently';
  }

  return `Joined ${date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown time';
  }

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function fallbackProfileFromContext(profileId, profile, clips, currentUser) {
  if (profile) {
    return profile;
  }

  const firstClip = Array.isArray(clips) ? clips[0] : null;
  const isOwnProfile = Boolean(currentUser?.id && currentUser.id === profileId);
  const derivedDisplayName = isOwnProfile
    ? displayNameFromUser(currentUser)
    : String(firstClip?.owner_display_name || '').trim() || 'MacClipper Creator';
  const derivedAvatarURL = isOwnProfile
    ? avatarURLFromUser(currentUser)
    : '';

  if (!derivedDisplayName && !derivedAvatarURL && !firstClip && !isOwnProfile) {
    return null;
  }

  return {
    id: profileId,
    display_name: derivedDisplayName || 'MacClipper Creator',
    avatar_url: derivedAvatarURL,
    bio: '',
    verified: false,
    follower_count: 0,
    created_at: firstClip?.created_at || null
  };
}

function CreatorProfile({ currentUser = null, authResolved = false }) {
  const { profileId } = useParams();
  const [activeTab, setActiveTab] = useState('videos');
  const [profile, setProfile] = useState(null);
  const [clips, setClips] = useState([]);
  const [unlistedClips, setUnlistedClips] = useState([]);
  const [unlistedLoading, setUnlistedLoading] = useState(false);
  const [unlistedError, setUnlistedError] = useState('');
  const [loading, setLoading] = useState(true);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [counts, setCounts] = useState({ followers: 0, following: 0, clips: 0, likes: 0, favourites: 0 });
  const [status, setStatus] = useState('');

  const isOwnProfile = Boolean(currentUser?.id && currentUser.id === profileId);
  const ownerCanViewUnlisted = canAccessAdminPortal(currentUser);

  useEffect(() => {
    setActiveTab('videos');
    setUnlistedClips([]);
    setUnlistedError('');
  }, [profileId]);

  useEffect(() => {
    if (!profileId) {
      return;
    }

    let active = true;

    async function loadProfile() {
      setLoading(true);
      setMetricsLoading(true);
      setStatus('');
      setCounts({ followers: 0, following: 0, clips: 0, likes: 0, favourites: 0 });
      setIsFollowing(false);

      try {
        const [profileRow, publicClipRows] = await Promise.all([
          fetchPublicProfileById(profileId).catch((error) => {
            console.error('Error loading public profile row:', error);
            return null;
          }),
          fetchPublicClipsByOwnerId(profileId).catch((error) => {
            console.error('Error loading public profile clips:', error);
            return [];
          })
        ]);

        if (!active) {
          return;
        }

        let hydratedClips = [];
        hydratedClips = await hydrateClipsWithSharedLinks(publicClipRows || []).catch((error) => {
          console.error('Error resolving shared clip links for creator profile:', error);
          return publicClipRows || [];
        });
        setClips(hydratedClips);

        const fallbackProfile = fallbackProfileFromContext(
          profileId,
          profileRow || null,
          hydratedClips,
          currentUser
        );

        setProfile(fallbackProfile);

        const publicClipCount = Array.isArray(publicClipRows) ? publicClipRows.length : hydratedClips.length;
        setCounts((currentCounts) => ({
          ...currentCounts,
          clips: publicClipCount
        }));
        setLoading(false);

        const clipIds = (publicClipRows || []).map((clip) => clip.id);
        void (async () => {
          try {
            const [followersResult, followingResult, likesResult, favouritesResult, followingStateResult] = await Promise.all([
              supabase.from('profile_subscriptions').select('id').eq('creator_id', profileId),
              supabase.from('profile_subscriptions').select('id').eq('subscriber_id', profileId),
              clipIds.length > 0
                ? supabase.from('clip_likes').select('id').in('clip_id', clipIds)
                : Promise.resolve({ data: [], error: null }),
              clipIds.length > 0
                ? supabase.from('favourites').select('id').in('clip_id', clipIds)
                : Promise.resolve({ data: [], error: null }),
              currentUser?.id && !isOwnProfile
                ? supabase
                    .from('profile_subscriptions')
                    .select('id')
                    .eq('creator_id', profileId)
                    .eq('subscriber_id', currentUser.id)
                    .limit(1)
                    .maybeSingle()
                : Promise.resolve({ data: null, error: null })
            ]);

            if (!active) {
              return;
            }

            if (followersResult.error || followingResult.error || likesResult.error || favouritesResult.error || followingStateResult.error) {
              console.error('Error loading profile metrics:', {
                followersError: followersResult.error,
                followingError: followingResult.error,
                likesError: likesResult.error,
                favouritesError: favouritesResult.error,
                followingStateError: followingStateResult.error
              });
            }

            setCounts({
              followers: Array.isArray(followersResult.data) ? followersResult.data.length : 0,
              following: Array.isArray(followingResult.data) ? followingResult.data.length : 0,
              clips: publicClipCount,
              likes: Array.isArray(likesResult.data) ? likesResult.data.length : 0,
              favourites: Array.isArray(favouritesResult.data) ? favouritesResult.data.length : 0
            });
            setIsFollowing(Boolean(followingStateResult.data));
          } finally {
            if (active) {
              setMetricsLoading(false);
            }
          }
        })();
      } catch (error) {
        if (!active) {
          return;
        }

        console.error('Unexpected error loading creator profile page:', error);
        setProfile(null);
        setClips([]);
        setCounts({ followers: 0, following: 0, clips: 0, likes: 0, favourites: 0 });
        setStatus('Could not load this profile right now.');
        setLoading(false);
        setMetricsLoading(false);
      }
    }

    void loadProfile();

    return () => {
      active = false;
    };
  }, [profileId, currentUser?.id, isOwnProfile]);

  useEffect(() => {
    if (!ownerCanViewUnlisted || !profileId || activeTab !== 'unlisted') {
      return;
    }

    let active = true;

    async function loadUnlistedClips() {
      setUnlistedLoading(true);
      setUnlistedError('');

      try {
        const sessionResult = await resolveSupabaseSession();
        const accessToken = String(sessionResult?.accessToken || '').trim();
        if (!accessToken) {
          throw new Error('Owner session is missing. Sign in again to view unlisted clips.');
        }

        const response = await fetch(buildCloudAPIURL(`/admin/accounts/${encodeURIComponent(profileId)}/unlisted-clips`), {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`
          },
          cache: 'no-store'
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(String(payload?.message || payload?.error || `Unlisted clips request failed (${response.status})`));
        }

        if (!active) {
          return;
        }

        setUnlistedClips(Array.isArray(payload?.clips) ? payload.clips : []);
      } catch (error) {
        if (!active) {
          return;
        }

        console.error('Error loading owner-only unlisted clips:', error);
        setUnlistedError(error instanceof Error ? error.message : 'Could not load unlisted clips.');
        setUnlistedClips([]);
      } finally {
        if (active) {
          setUnlistedLoading(false);
        }
      }
    }

    void loadUnlistedClips();

    return () => {
      active = false;
    };
  }, [activeTab, ownerCanViewUnlisted, profileId]);

  const displayName = useMemo(() => {
    if (profile?.display_name && String(profile.display_name).trim()) {
      return String(profile.display_name).trim();
    }

    return 'MacClipper Creator';
  }, [profile]);
  const profileVerified = isVerifiedProfile(profile, displayName);
  const profileTag = ownerTagLabel(profile, displayName);
  const profileAvatarStyle = avatarStyleFromSeed(profile?.id || displayName || profileId);
  const creatorHandle = useMemo(() => profileHandle(displayName, profileId), [displayName, profileId]);
  const creatorMetaLine = useMemo(() => ([
    `${formatCompactNumber(counts.followers)} followers`,
    `${formatCompactNumber(counts.clips)} videos`,
    formatJoinDate(profile?.created_at)
  ].join(' · ')), [counts.clips, counts.followers, profile?.created_at]);

  async function handleToggleFollow() {
    if (!currentUser?.id || isOwnProfile || followLoading) {
      return;
    }

    setFollowLoading(true);
    setStatus('');

    const request = isFollowing
      ? supabase
          .from('profile_subscriptions')
          .delete()
          .eq('creator_id', profileId)
          .eq('subscriber_id', currentUser.id)
      : supabase
          .from('profile_subscriptions')
          .insert([{ creator_id: profileId, subscriber_id: currentUser.id }]);

    const { error } = await request;

    if (error) {
      console.error('Error toggling follow:', error);
      setStatus('Could not update follow status right now.');
      setFollowLoading(false);
      return;
    }

    setIsFollowing(!isFollowing);
    setCounts((currentCounts) => ({
      ...currentCounts,
      followers: Math.max(0, currentCounts.followers + (isFollowing ? -1 : 1))
    }));
    setStatus(isFollowing ? 'Unfollowed creator.' : 'Following creator.');
    setFollowLoading(false);
  }

  if (loading && !profile && clips.length === 0) {
    return (
      <div className="space-y-6">
        <div className="overflow-hidden rounded-[2rem] border border-border bg-card shadow-sm">
          <div className="h-44 animate-pulse bg-muted" />
          <div className="px-6 pb-6 sm:px-8">
            <div className="-mt-14 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                <div className="h-28 w-28 animate-pulse rounded-full border-4 border-background bg-muted" />
                <div className="space-y-3 pb-2">
                  <div className="h-9 w-56 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-40 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-72 animate-pulse rounded bg-muted" />
                </div>
              </div>
              <div className="h-11 w-32 animate-pulse rounded-full bg-muted" />
            </div>
          </div>
        </div>
        <div className="grid gap-6 xl:grid-cols-[320px,minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="h-44 animate-pulse rounded-[1.6rem] bg-muted" />
            <div className="h-44 animate-pulse rounded-[1.6rem] bg-muted" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <div className="aspect-[1.08] animate-pulse rounded-[1.6rem] bg-muted" />
            <div className="aspect-[1.08] animate-pulse rounded-[1.6rem] bg-muted" />
            <div className="aspect-[1.08] animate-pulse rounded-[1.6rem] bg-muted" />
            <div className="aspect-[1.08] animate-pulse rounded-[1.6rem] bg-muted" />
          </div>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="space-y-4">
        <h1 className="page-heading">Creator profile</h1>
        <p className="text-sm text-muted-foreground">Profile not found.</p>
        <Link to="/community" className="inline-flex rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted">
          Back to Community
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[2rem] border border-border bg-card shadow-sm">
        <div className="h-44 bg-[linear-gradient(120deg,rgba(22,163,74,0.18),rgba(15,23,42,0.92)_48%,rgba(249,115,22,0.18))] sm:h-56" />
        <div className="px-6 pb-6 sm:px-8">
          <div className="-mt-14 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt={displayName} className="h-28 w-28 rounded-full border-4 border-background object-cover shadow-xl" />
              ) : (
                <div className="flex h-28 w-28 items-center justify-center rounded-full border-4 border-background text-3xl font-bold text-white shadow-xl" style={profileAvatarStyle}>
                  {initialsFromName(displayName)}
                </div>
              )}

              <div className="pb-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">{displayName}</h1>
                  {profileVerified ? <span className="clip-verified-badge" title="Verified creator">✓</span> : null}
                  {profileTag ? <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-primary">{profileTag}</span> : null}
                </div>
                <p className="mt-1 text-sm font-medium text-muted-foreground">{creatorHandle}</p>
                <p className="mt-2 text-sm text-muted-foreground">{creatorMetaLine}</p>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground">
                  {profile.bio || 'MacClipper creator profile.'}
                </p>
              </div>
            </div>

            {!isOwnProfile ? (
              <button
                type="button"
                onClick={handleToggleFollow}
                disabled={followLoading}
                className="rounded-full bg-foreground px-6 py-3 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {followLoading ? 'Updating…' : isFollowing ? 'Following' : 'Follow'}
              </button>
            ) : (
              <Link to="/settings" className="rounded-full border border-border bg-background px-6 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted">
                Customize channel
              </Link>
            )}
          </div>

          <div className="mt-6 flex flex-wrap gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={() => setActiveTab('videos')}
              className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] transition-colors ${activeTab === 'videos' ? 'bg-foreground text-background' : 'border border-border text-muted-foreground hover:bg-muted/70'}`}
            >
              Videos
            </button>
            {ownerCanViewUnlisted ? (
              <button
                type="button"
                onClick={() => setActiveTab('unlisted')}
                className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] transition-colors ${activeTab === 'unlisted' ? 'bg-foreground text-background' : 'border border-border text-muted-foreground hover:bg-muted/70'}`}
              >
                Unlisted clips
              </button>
            ) : null}
            <span className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Home</span>
            <span className="rounded-full border border-border px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">About</span>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[320px,minmax(0,1fr)]">
        <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
          <div className="rounded-[1.6rem] border border-border bg-card p-5 shadow-sm">
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Channel stats</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <div className="rounded-[1.15rem] border border-border bg-background/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Followers</p>
                <p className="mt-2 text-2xl font-bold tracking-tight text-foreground">{metricsLoading ? '—' : formatCompactNumber(counts.followers)}</p>
              </div>
              <div className="rounded-[1.15rem] border border-border bg-background/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Following</p>
                <p className="mt-2 text-2xl font-bold tracking-tight text-foreground">{metricsLoading ? '—' : formatCompactNumber(counts.following)}</p>
              </div>
              <div className="rounded-[1.15rem] border border-border bg-background/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Likes</p>
                <p className="mt-2 text-2xl font-bold tracking-tight text-foreground">{metricsLoading ? '—' : formatCompactNumber(counts.likes)}</p>
              </div>
              <div className="rounded-[1.15rem] border border-border bg-background/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Saves</p>
                <p className="mt-2 text-2xl font-bold tracking-tight text-foreground">{metricsLoading ? '—' : formatCompactNumber(counts.favourites)}</p>
              </div>
            </div>
          </div>

          <div className="rounded-[1.6rem] border border-border bg-card p-5 shadow-sm">
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">About</p>
            <p className="mt-4 text-sm leading-7 text-muted-foreground">{profile.bio || 'This creator posts public MacClipper uploads here.'}</p>
            <div className="mt-4 border-t border-border pt-4 text-sm text-muted-foreground">
              <p>{formatJoinDate(profile?.created_at)}</p>
              <p className="mt-2">{formatCompactNumber(counts.clips)} public videos live.</p>
            </div>
            {status ? <p className="mt-4 rounded-xl border border-border bg-background/70 px-3 py-2 text-xs text-muted-foreground">{status}</p> : null}
          </div>
        </aside>

        <div className="space-y-4">
          {activeTab === 'unlisted' && ownerCanViewUnlisted ? (
            <>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Owner only</p>
                  <h2 className="mt-2 text-3xl font-bold tracking-tight text-foreground">Unlisted clips</h2>
                </div>
                <p className="text-sm text-muted-foreground">Only you can see these cloud uploads that were not posted publicly.</p>
              </div>

              {unlistedError ? (
                <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{unlistedError}</p>
              ) : null}

              {unlistedLoading ? (
                <div className="rounded-[1.6rem] border border-border bg-card p-8 text-sm text-muted-foreground shadow-sm">Loading unlisted clips...</div>
              ) : unlistedClips.length === 0 ? (
                <div className="rounded-[1.6rem] border border-border bg-card p-8 text-sm text-muted-foreground shadow-sm">No unlisted clips found for this profile.</div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {unlistedClips.map((clip) => (
                    <article key={clip.id} className="overflow-hidden rounded-[1.2rem] border border-border bg-card p-4 shadow-sm">
                      {clip.videoURL ? (
                        <video src={clip.videoURL} controls preload="metadata" className="aspect-video w-full rounded-lg border border-border bg-black/70" />
                      ) : (
                        <div className="flex aspect-video w-full items-center justify-center rounded-lg border border-border bg-muted text-xs text-muted-foreground">
                          Video preview unavailable
                        </div>
                      )}
                      <h3 className="mt-3 truncate text-sm font-semibold text-foreground">{clip.title || clip.fileName || 'Unlisted clip'}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">Uploaded {formatDateTime(clip.uploadedAt)}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {clip.pageURL ? (
                          <a href={clip.pageURL} target="_blank" rel="noreferrer" className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted">
                            Open share page
                          </a>
                        ) : null}
                        {clip.videoURL ? (
                          <a href={clip.videoURL} target="_blank" rel="noreferrer" className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted">
                            Open video
                          </a>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-[0.72rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Uploads</p>
                  <h2 className="mt-2 text-3xl font-bold tracking-tight text-foreground">Latest videos</h2>
                </div>
                <p className="text-sm text-muted-foreground">{formatCompactNumber(counts.clips)} clips published publicly.</p>
              </div>

              {clips.length === 0 ? (
                <div className="rounded-[1.6rem] border border-border bg-card p-8 text-sm text-muted-foreground shadow-sm">No public clips from this creator yet.</div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {clips.map((clip) => (
                    <ClipSocialCard
                      key={clip.id}
                      clip={clip}
                      currentUser={currentUser}
                      onClipUpdated={(nextClip) => {
                        setClips((existing) => existing.map((item) => item.id === nextClip.id ? { ...item, ...nextClip } : item));
                      }}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

export default CreatorProfile;
