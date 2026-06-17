import React, { useEffect, useMemo, useState } from 'react';
import { Film, RefreshCw, Search, SlidersHorizontal } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { buildCloudAPIURL } from '../lib/appRuntime';
import { hydrateClipsWithSharedLinks } from '../lib/cloudSharedClips';
import ClipSocialCard from './ClipSocialCard';
import { featuredGames } from '../lib/gameCatalog';
import { fetchPublicCommunityClips, fetchPublicProfiles } from '../lib/publicSupabase';

function normalizePostedClipPreview(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const preview = value;
  const resolvedVideoURL = String(preview.videoURL || preview.videoUrl || preview.content || '').trim();
  if (!resolvedVideoURL) {
    return null;
  }

  return {
    ...preview,
    id: preview.id ?? null,
    user_id: preview.user_id ?? null,
    owner_profile_id: preview.owner_profile_id ?? preview.user_id ?? null,
    content: preview.content || resolvedVideoURL,
    videoURL: preview.videoURL || resolvedVideoURL,
    title: String(preview.title || 'MacClipper Clip').trim() || 'MacClipper Clip',
    description: String(preview.description || '').trim(),
    game_title: String(preview.game_title || '').trim() || null,
    category_label: String(preview.category_label || '').trim() || null,
    visibility: String(preview.visibility || 'public').trim() || 'public',
    created_at: preview.created_at || new Date().toISOString(),
    view_count: Number(preview.view_count || 0),
    owner_profile: preview.owner_profile || null,
    owner_display_name: preview.owner_display_name || null
  };
}

function clipIdValue(clip) {
  return clip?.id == null ? '' : String(clip.id).trim();
}

async function fetchCommunityClipViewCounts(clipRows) {
  const clipIds = Array.from(new Set((clipRows || []).map((clip) => clipIdValue(clip)).filter(Boolean)));
  if (clipIds.length === 0) {
    return new Map();
  }

  const response = await fetch(buildCloudAPIURL('/community-clips/views/batch'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ clipIds })
  });

  if (!response.ok) {
    throw new Error(`View summary request failed with ${response.status}`);
  }

  const payload = await response.json().catch(() => ({}));
  const rawViewCounts = payload?.viewCounts && typeof payload.viewCounts === 'object'
    ? payload.viewCounts
    : {};

  return new Map(clipIds.map((clipId) => [clipId, Number(rawViewCounts[clipId] || 0)]));
}

function applyViewCounts(clipRows, viewCounts) {
  return (clipRows || []).map((clip) => ({
    ...clip,
    view_count: viewCounts.get(clipIdValue(clip)) ?? Number(clip?.view_count || 0)
  }));
}

function mergeFeedClips(existingClips, incomingClips) {
  const mergedClips = Array.isArray(existingClips) ? [...existingClips] : [];

  for (const clip of Array.isArray(incomingClips) ? incomingClips : []) {
    if (!clip) {
      continue;
    }

    const clipId = clip.id == null ? '' : String(clip.id).trim();
    const clipContent = String(clip.content || clip.videoURL || '').trim();
    const existingIndex = mergedClips.findIndex((candidate) => {
      const candidateId = candidate?.id == null ? '' : String(candidate.id).trim();
      const candidateContent = String(candidate?.content || candidate?.videoURL || '').trim();

      return (clipId && candidateId === clipId)
        || (clipContent && candidateContent && candidateContent === clipContent);
    });

    if (existingIndex === -1) {
      mergedClips.push(clip);
      continue;
    }

    mergedClips[existingIndex] = {
      ...mergedClips[existingIndex],
      ...clip
    };
  }

  return mergedClips.sort((left, right) => {
    const leftDate = new Date(left?.created_at || 0).getTime();
    const rightDate = new Date(right?.created_at || 0).getTime();
    return rightDate - leftDate;
  });
}

function Watch({ currentUser = null, authResolved = false }) {
  const location = useLocation();
  const [clips, setClips] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedGame, setSelectedGame] = useState('all');
  const [loading, setLoading] = useState(true);
  const [pageNotice, setPageNotice] = useState('');
  const [highlightedClipId, setHighlightedClipId] = useState('');

  const postedClipId = location.state?.postedClipId == null
    ? ''
    : String(location.state.postedClipId).trim();
  const postedClipPreview = useMemo(
    () => normalizePostedClipPreview(location.state?.postedClipPreview),
    [location.state?.postedClipPreview]
  );

  useEffect(() => {
    if (!authResolved) {
      return;
    }

    if (postedClipId) {
      setSearch('');
      setSelectedGame('all');
      setHighlightedClipId(postedClipId);
    }

    if (postedClipPreview) {
      setClips((existingClips) => mergeFeedClips(existingClips, [postedClipPreview]));
    }

    void loadWatchCatalog();
    setPageNotice(typeof location.state?.postNotice === 'string' ? location.state.postNotice : '');
  }, [authResolved, currentUser?.id, postedClipId, postedClipPreview]);

  useEffect(() => {
    const nextNotice = typeof location.state?.postNotice === 'string' ? location.state.postNotice : '';
    if (!nextNotice) {
      return;
    }

    setPageNotice(nextNotice);
  }, [location.state]);

  useEffect(() => {
    if (!postedClipId) {
      return;
    }

    setHighlightedClipId(postedClipId);
    setSearch('');
    setSelectedGame('all');
  }, [postedClipId]);

  async function loadWatchCatalog(showRefresh = false) {
    if (showRefresh) setRefreshing(true);
    setLoading(true);

    let publicClipRows = [];

    try {
      publicClipRows = await fetchPublicCommunityClips();
    } catch (error) {
      console.error('Error loading watch clips:', error);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const rawClipRows = publicClipRows.map((clip) => ({
      ...clip,
      view_count: Number(clip.view_count || 0),
      owner_profile: clip.owner_profile || null,
      owner_display_name: clip.owner_display_name || null
    }));
    setClips((existingClips) => mergeFeedClips(existingClips, rawClipRows));
    setLoading(false);
    setRefreshing(false);

    const viewCountsPromise = fetchCommunityClipViewCounts(publicClipRows).catch((error) => {
      console.error('Error loading community clip view counts:', error);
      return new Map();
    });

    void (async () => {
      const viewCounts = await viewCountsPromise;
      setClips((existingClips) => mergeFeedClips(existingClips, applyViewCounts(rawClipRows, viewCounts)));
    })();

    const [clipRows, viewCounts] = await Promise.all([
      hydrateClipsWithSharedLinks(publicClipRows).catch((error) => {
        console.error('Error resolving shared clip links for watch feed:', error);
        return publicClipRows;
      }),
      viewCountsPromise
    ]);
    const ownerIds = Array.from(new Set(clipRows.map((clip) => clip.owner_profile_id || clip.user_id).filter(Boolean)));
    let profiles = [];

    if (ownerIds.length > 0) {
      try {
        profiles = await fetchPublicProfiles(ownerIds);
      } catch (error) {
        console.error('Error loading watch profiles:', error);
      }
    }

    const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
    setClips((existingClips) => mergeFeedClips(existingClips, applyViewCounts(clipRows.map((clip) => {
      const ownerId = clip.owner_profile_id || clip.user_id;
      return {
        ...clip,
        owner_profile: profileMap.get(ownerId) || null,
        owner_display_name: profileMap.get(ownerId)?.display_name || null
      };
    }), viewCounts)));
  }

  const filteredClips = useMemo(() => {
    const query = search.trim().toLowerCase();

    return clips.filter((clip) => {
      const matchesSearch = !query
        || String(clip.title || '').toLowerCase().includes(query)
        || String(clip.description || '').toLowerCase().includes(query)
        || String(clip.game_title || '').toLowerCase().includes(query);
      const matchesGame = selectedGame === 'all' || clip.game_title === selectedGame;

      return matchesSearch && matchesGame;
    }).sort((left, right) => {
      if (!highlightedClipId) {
        return 0;
      }

      if (String(left.id) === highlightedClipId) {
        return -1;
      }

      if (String(right.id) === highlightedClipId) {
        return 1;
      }

      return 0;
    });
  }, [clips, search, selectedGame, highlightedClipId]);

  const handleClipUpdated = (nextClip) => {
    setClips((existingClips) => mergeFeedClips(existingClips, [nextClip]));
  };

  return (
    <div className="space-y-6">
      <section className="rounded-[1.8rem] border border-border bg-card px-5 py-5 shadow-sm sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Community</p>
            <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">Public clips</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Small thumbnail cards, direct watch pages, and no comment UI stuffed into the feed.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center rounded-full bg-muted px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {filteredClips.length} clips
            </span>
            <button
              type="button"
              onClick={() => void loadWatchCatalog(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
      </section>

      {pageNotice ? (
        <div className="rounded-[1.4rem] border border-emerald-400/35 bg-emerald-500/10 p-4">
          <div className="flex items-start justify-between gap-4">
            <p className="text-sm font-medium text-emerald-100">{pageNotice}</p>
            <button
              type="button"
              onClick={() => setPageNotice('')}
              className="rounded-md border border-emerald-300/40 px-2 py-1 text-xs text-emerald-200 hover:bg-emerald-500/20"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[280px,minmax(0,1fr)]">
        <aside className="xl:sticky xl:top-24 xl:self-start">
          <div className="glass-card overflow-hidden p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <SlidersHorizontal className="h-4 w-4 text-primary" />
              Filters
            </div>

            <div className="mt-5 space-y-4">
              <label className="block space-y-2 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Search clips</span>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search clips, games, or titles..."
                    className="w-full rounded-xl border border-input bg-background px-10 py-3 text-sm text-foreground placeholder:text-muted-foreground"
                  />
                </div>
              </label>

              <label className="block space-y-2 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Game</span>
                <select
                  value={selectedGame}
                  onChange={(event) => setSelectedGame(event.target.value)}
                  className="w-full rounded-xl border border-input bg-background px-3 py-3 text-sm text-foreground"
                >
                  <option value="all">All Games</option>
                  {featuredGames.map((game) => (
                    <option key={game} value={game}>{game}</option>
                  ))}
                </select>
              </label>

            </div>
          </div>
        </aside>

        <section className="space-y-5">
          {loading && filteredClips.length === 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((index) => (
                <div key={index} className="overflow-hidden rounded-[1.35rem] border border-border bg-card p-4 shadow-sm">
                  <div className="aspect-video animate-pulse rounded-[1rem] bg-muted" />
                  <div className="mt-4 space-y-3">
                    <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                    <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
                    <div className="h-4 w-4/5 animate-pulse rounded bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredClips.length === 0 ? (
            <div className="rounded-[1.8rem] border border-dashed border-border bg-card px-6 py-16 text-center text-muted-foreground shadow-sm">
              <Film className="mx-auto mb-4 h-16 w-16 opacity-25" />
              <p className="text-lg font-semibold text-foreground">No clips match this view yet</p>
              <p className="mt-2 text-sm">Try another game filter or clear search to bring the full feed back.</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {filteredClips.map((clip) => (
                <div
                  key={clip.id}
                  className={String(clip.id) === highlightedClipId ? 'rounded-[1.35rem] ring-2 ring-primary/35 ring-offset-2 ring-offset-background' : ''}
                >
                  <ClipSocialCard
                    clip={clip}
                    currentUser={currentUser}
                    onClipUpdated={handleClipUpdated}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default Watch;