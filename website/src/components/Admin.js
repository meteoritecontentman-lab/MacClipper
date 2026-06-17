import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Ban,
  CheckCircle,
  CreditCard,
  IdCard,
  Flame,
  Link2,
  Mail,
  MessageSquare,
  Smartphone,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  TrendingUp,
  Unlink,
  UserCheck,
  Users
} from 'lucide-react';
import { buildCloudAPIURL } from '../lib/appRuntime';
import { fetchClipComments, fetchClipLikeSummary } from '../lib/clipSocial';
import { fetchPublicCommunityClips, fetchPublicProfiles } from '../lib/publicSupabase';
import { supabase } from '../supabaseClient';
import { avatarStyleFromSeed, initialsFromName } from '../lib/avatarTheme';
import { resolveSupabaseSession } from '../lib/supabaseSession';

const VERIFICATION_FOLLOWER_THRESHOLD = 10000;
const SUPABASE_SESSION_LOOKUP_TIMEOUT_MS = 5000;
const ADMIN_OVERVIEW_CACHE_KEY = 'macclipper.admin.overview.v1';
const ADMIN_OVERVIEW_CACHE_TTL_MS = 5 * 60 * 1000;

const moderationAreas = [
  {
    title: 'Moderation Queue',
    points: ['Review the newest comments first', 'Watch clips with rising engagement for abuse spikes', 'Use creator history before taking action']
  },
  {
    title: 'Growth Signals',
    points: ['Track which public clips are actually earning likes and comments', 'Spot active creators early and keep them unblocked', 'Watch verification candidates before they ask']
  },
  {
    title: 'Operational Health',
    points: ['Refresh this page after launches or drops', 'Check for stalled creator activity every week', 'Use quick links to validate live clip and profile pages']
  }
];

function formatAdminTime(value) {
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return 'No timestamp yet';
  }

  return parsedDate.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function formatCompactNumber(value) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) {
    return '0';
  }

  if (Math.abs(numericValue) < 1000) {
    return `${Math.round(numericValue)}`;
  }

  return new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(numericValue);
}

function matchesSearch(value, query) {
  return String(value || '').toLowerCase().includes(query);
}

function truncateText(value, limit = 120) {
  const normalizedValue = String(value || '').trim();
  if (normalizedValue.length <= limit) {
    return normalizedValue;
  }

  return `${normalizedValue.slice(0, limit - 1).trimEnd()}...`;
}

function normalizeClipId(value) {
  return String(value ?? '').trim();
}

function emptySectionMessage(hasActiveFilter, emptyMessage = 'Nothing yet.') {
  return hasActiveFilter ? 'No matches for this filter.' : emptyMessage;
}

function buildCountMap(rows) {
  const counts = new Map();

  for (const row of rows || []) {
    const clipId = normalizeClipId(row?.clip_id);
    if (!clipId) {
      continue;
    }

    counts.set(clipId, Number(counts.get(clipId) || 0) + 1);
  }

  return counts;
}

function sortByNewest(leftValue, rightValue) {
  return new Date(rightValue || 0).getTime() - new Date(leftValue || 0).getTime();
}

function accountTypeLabel(accountType) {
  return accountType === 'app' ? 'App account' : 'Website account';
}

function ownerIdForClip(clip) {
  return String(clip?.owner_profile_id || clip?.user_id || '').trim();
}

function creatorFallbackLabel(userId) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) {
    return 'Unknown creator';
  }

  return `Creator ${normalizedUserId.slice(0, 8)}`;
}

function mostRecentTimestamp(values) {
  return (values || [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .sort(sortByNewest)[0] || '';
}

function hasAdminOverviewData(payload) {
  const stats = payload?.stats || {};
  return Number(stats.publicClips || 0) > 0
    || Number(stats.comments || 0) > 0
    || Number(stats.creators || 0) > 0
    || Number(stats.payments || 0) > 0
    || (Array.isArray(payload?.accounts) && payload.accounts.length > 0)
    || (Array.isArray(payload?.recentClips) && payload.recentClips.length > 0)
    || (Array.isArray(payload?.recentComments) && payload.recentComments.length > 0)
    || (Array.isArray(payload?.recentProfiles) && payload.recentProfiles.length > 0);
}

function readCachedAdminOverview() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const rawValue = window.sessionStorage.getItem(ADMIN_OVERVIEW_CACHE_KEY);
    if (!rawValue) {
      return null;
    }

    const parsedValue = JSON.parse(rawValue);
    const cachedAt = Number(parsedValue?.cachedAt || 0);
    if (!cachedAt || (Date.now() - cachedAt) > ADMIN_OVERVIEW_CACHE_TTL_MS) {
      return null;
    }

    return parsedValue?.payload || null;
  } catch {
    return null;
  }
}

function writeCachedAdminOverview(payload) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.sessionStorage.setItem(ADMIN_OVERVIEW_CACHE_KEY, JSON.stringify({
      cachedAt: Date.now(),
      payload
    }));
  } catch {
    // Ignore storage errors and continue.
  }
}

async function loadPublicAdminOverview() {
  const publicClips = await fetchPublicCommunityClips(96).catch((error) => {
    console.error('Error loading public clips for admin fallback:', error);
    return [];
  });

  const clipIds = publicClips
    .map((clip) => normalizeClipId(clip?.id))
    .filter(Boolean);

  const clipSummaryResults = await Promise.all(publicClips.map(async (clip) => {
    const clipId = normalizeClipId(clip?.id);
    const [commentSummary, likeSummary] = await Promise.all([
      fetchClipComments(clipId, 4).catch((error) => {
        console.error(`Error loading admin fallback comments for clip ${clipId}:`, error);
        return { clipId, commentCount: 0, comments: [] };
      }),
      fetchClipLikeSummary(clipId).catch((error) => {
        console.error(`Error loading admin fallback likes for clip ${clipId}:`, error);
        return { clipId, likeCount: 0, liked: false };
      })
    ]);

    return {
      clipId,
      commentCount: Number(commentSummary?.commentCount || 0),
      comments: Array.isArray(commentSummary?.comments) ? commentSummary.comments : [],
      likeCount: Number(likeSummary?.likeCount || 0)
    };
  }));

  const fallbackCommentAuthors = clipSummaryResults.flatMap((summary) => summary.comments.map((comment) => comment?.user_id));
  const profileIds = Array.from(new Set([
    ...publicClips.map((clip) => ownerIdForClip(clip)),
    ...fallbackCommentAuthors
  ].filter(Boolean)));

  const profiles = await fetchPublicProfiles(profileIds).catch((error) => {
    console.error('Error loading public profiles for admin fallback:', error);
    return [];
  });

  const profileById = new Map((profiles || []).map((profile) => [profile.id, profile]));
  const clipById = new Map(publicClips.map((clip) => [normalizeClipId(clip.id), clip]));
  const clipSummaryById = new Map(clipSummaryResults.map((summary) => [summary.clipId, summary]));

  const recentComments = clipSummaryResults
    .flatMap((summary) => summary.comments.map((comment) => ({
      id: comment.id,
      clip_id: normalizeClipId(comment.clip_id),
      user_id: String(comment.user_id || '').trim(),
      body: String(comment.body || '').trim(),
      created_at: String(comment.created_at || '').trim(),
      authorName: profileById.get(comment.user_id)?.display_name || creatorFallbackLabel(comment.user_id),
      clipTitle: clipById.get(normalizeClipId(comment.clip_id))?.title || `Clip #${comment.clip_id}`
    })))
    .sort((leftComment, rightComment) => sortByNewest(leftComment.created_at, rightComment.created_at))
    .slice(0, 8);

  const creatorActivity = new Map();
  (profiles || []).forEach((profile) => {
    creatorActivity.set(profile.id, [profile.last_seen_at, profile.created_at].filter(Boolean));
  });
  publicClips.forEach((clip) => {
    const ownerId = ownerIdForClip(clip);
    if (!ownerId) {
      return;
    }

    const existing = creatorActivity.get(ownerId) || [];
    existing.push(String(clip.created_at || '').trim());
    creatorActivity.set(ownerId, existing);
  });
  recentComments.forEach((comment) => {
    const existing = creatorActivity.get(comment.user_id) || [];
    existing.push(comment.created_at);
    creatorActivity.set(comment.user_id, existing);
  });

  const recentProfiles = profileIds
    .map((profileId) => {
      const existingProfile = profileById.get(profileId);
      if (existingProfile) {
        return {
          id: existingProfile.id,
          email: existingProfile.email || '',
          display_name: existingProfile.display_name || existingProfile.email || creatorFallbackLabel(existingProfile.id),
          avatar_url: existingProfile.avatar_url || '',
          created_at: existingProfile.created_at || '',
          last_seen_at: existingProfile.last_seen_at || '',
          follower_count: Number(existingProfile.follower_count || 0),
          verified: existingProfile.verified === true
        };
      }

      const activityAt = mostRecentTimestamp(creatorActivity.get(profileId) || []);
      return {
        id: profileId,
        email: '',
        display_name: creatorFallbackLabel(profileId),
        avatar_url: '',
        created_at: activityAt,
        last_seen_at: activityAt,
        follower_count: 0,
        verified: false
      };
    })
    .sort((leftProfile, rightProfile) => sortByNewest(
      mostRecentTimestamp([leftProfile.last_seen_at, leftProfile.created_at]),
      mostRecentTimestamp([rightProfile.last_seen_at, rightProfile.created_at])
    ));

  const recentClips = publicClips.slice(0, 24).map((clip) => ({
    ...clip,
    ownerName: profileById.get(ownerIdForClip(clip))?.display_name || creatorFallbackLabel(ownerIdForClip(clip))
  }));

  const topClips = publicClips
    .map((clip) => {
      const clipId = normalizeClipId(clip.id);
      const clipSummary = clipSummaryById.get(clipId) || { likeCount: 0, commentCount: 0 };
      const likeCount = Number(clipSummary.likeCount || 0);
      const commentCount = Number(clipSummary.commentCount || 0);

      return {
        ...clip,
        ownerName: profileById.get(ownerIdForClip(clip))?.display_name || creatorFallbackLabel(ownerIdForClip(clip)),
        likeCount,
        commentCount,
        score: (likeCount * 3) + (commentCount * 2)
      };
    })
    .sort((leftClip, rightClip) => {
      if (rightClip.score !== leftClip.score) {
        return rightClip.score - leftClip.score;
      }

      if (rightClip.likeCount !== leftClip.likeCount) {
        return rightClip.likeCount - leftClip.likeCount;
      }

      return sortByNewest(leftClip.created_at, rightClip.created_at);
    })
    .slice(0, 6);

  let subscriptionCount = 0;
  try {
    const { count } = await supabase.from('profile_subscriptions').select('*', { count: 'exact', head: true });
    subscriptionCount = Number(count || 0);
  } catch (error) {
    console.error('Error loading admin fallback subscriptions count:', error);
  }

  const verificationQueue = recentProfiles
    .filter((profile) => !profile.verified && Number(profile.follower_count || 0) >= VERIFICATION_FOLLOWER_THRESHOLD)
    .sort((leftProfile, rightProfile) => Number(rightProfile.follower_count || 0) - Number(leftProfile.follower_count || 0))
    .slice(0, 12)
    .map((profile) => ({
      ...profile,
      displayLabel: profile.display_name || profile.email || creatorFallbackLabel(profile.id)
    }));

  const activeWindowStart = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const activeCreators = recentProfiles.filter((profile) => {
    const activityAt = mostRecentTimestamp([profile.last_seen_at, profile.created_at]);
    return activityAt && new Date(activityAt).getTime() >= activeWindowStart;
  }).length;

  return {
    stats: {
      creators: recentProfiles.length,
      publicClips: publicClips.length,
      comments: clipSummaryResults.reduce((totalCount, summary) => totalCount + Number(summary.commentCount || 0), 0),
      subscriptions: subscriptionCount,
      verifiedCreators: recentProfiles.filter((profile) => profile.verified).length,
      activeCreators,
      pendingVerification: verificationQueue.length
    },
    recentProfiles,
    recentClips,
    verificationQueue,
    recentComments,
    topClips
  };
}

function extractStoredSupabaseAccessToken(rawValue) {
  if (!rawValue) {
    return '';
  }

  try {
    const parsedValue = JSON.parse(rawValue);
    const session = parsedValue?.currentSession || parsedValue?.session || parsedValue;
    return String(session?.access_token || parsedValue?.access_token || '').trim();
  } catch {
    return '';
  }
}

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
      const accessToken = extractStoredSupabaseAccessToken(storage.getItem(key));
      if (accessToken) {
        return accessToken;
      }
    }
  } catch (error) {
    console.error('Error reading stored Supabase auth token for admin panel:', error);
  }

  return '';
}

async function resolveAccessToken() {
  const resolvedSession = await resolveSupabaseSession();
  return {
    accessToken: String(resolvedSession?.accessToken || '').trim(),
    source: resolvedSession?.source || 'unavailable',
    error: resolvedSession?.error || null
  };
}

function Admin({ currentUser = null, authResolved = false, canAccessAdmin = false }) {
  const [loading, setLoading] = useState(false);
  const [adminError, setAdminError] = useState('');
  const [accountActionError, setAccountActionError] = useState('');
  const [accountActionBusy, setAccountActionBusy] = useState('');
  const [search, setSearch] = useState('');
  const [stats, setStats] = useState({
    creators: 0,
    publicClips: 0,
    comments: 0,
    subscriptions: 0,
    payments: 0,
    verifiedCreators: 0,
    proUsers: 0,
    activeCreators: 0,
    pendingVerification: 0
  });
  const [accounts, setAccounts] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [recentClips, setRecentClips] = useState([]);
  const [verificationQueue, setVerificationQueue] = useState([]);
  const [recentComments, setRecentComments] = useState([]);
  const [topClips, setTopClips] = useState([]);

  const applyOverview = useCallback((payload) => {
    const nextAccounts = Array.isArray(payload?.accounts)
      ? payload.accounts
      : (Array.isArray(payload?.recentProfiles) ? payload.recentProfiles : []);

    setAccounts(nextAccounts);

    const rawStats = payload?.stats || {};
    setStats({
      creators: Math.max(Number(rawStats.creators || 0), nextAccounts.length),
      publicClips: Number(rawStats.publicClips || 0),
      comments: Number(rawStats.comments || 0),
      subscriptions: Number(rawStats.subscriptions || 0),
      payments: Number(rawStats.payments || 0),
      verifiedCreators: Number(rawStats.verifiedCreators || 0),
      proUsers: Math.max(Number(rawStats.proUsers || 0), nextAccounts.filter((a) => String(a.subscriptionTier || '').toLowerCase() === 'pro').length),
      activeCreators: Number(rawStats.activeCreators || 0),
      pendingVerification: Number(rawStats.pendingVerification || 0)
    });

    setRecentClips(Array.isArray(payload?.recentClips) ? payload.recentClips : []);
    setVerificationQueue(Array.isArray(payload?.verificationQueue) ? payload.verificationQueue : []);
    setRecentComments(Array.isArray(payload?.recentComments) ? payload.recentComments : []);
    setTopClips(Array.isArray(payload?.topClips) ? payload.topClips : []);

    writeCachedAdminOverview({
      stats: payload?.stats || {},
      accounts: nextAccounts,
      recentClips: Array.isArray(payload?.recentClips) ? payload.recentClips : [],
      verificationQueue: Array.isArray(payload?.verificationQueue) ? payload.verificationQueue : [],
      recentComments: Array.isArray(payload?.recentComments) ? payload.recentComments : [],
      topClips: Array.isArray(payload?.topClips) ? payload.topClips : []
    });
  }, []);

  const loadAdminData = useCallback(async ({ silent = false } = {}) => {
    if (!canAccessAdmin) {
      return;
    }

    if (!silent) {
      setLoading(true);
      setAdminError('');
      setAccountActionError('');
    }

    try {
      const sessionResolution = await resolveAccessToken();
      const accessToken = String(sessionResolution?.accessToken || '').trim();
      if (!accessToken) {
        throw new Error('Admin owner session is missing. Sign out and sign back in, then refresh Admin.');
      }

      const response = await fetch(buildCloudAPIURL('/admin/community-overview'), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`
        },
        cache: 'no-store'
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(payload?.message || payload?.error || `Admin overview request failed with ${response.status}`));
      }

      applyOverview(payload);

      if (!hasAdminOverviewData(payload)) {
        setAdminError('No account data came back from the admin API yet. If you just signed up users, press Refresh data.');
      }
    } catch (error) {
      console.error('Unexpected admin loading error:', error);
      setAdminError(error instanceof Error ? error.message : 'Admin data is not available right now.');
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [applyOverview, canAccessAdmin]);

  const runAccountAction = useCallback(async (actionType) => {
    const targetAccount = accounts.find((account) => account.id === selectedAccountId) || null;
    if (!targetAccount) {
      return;
    }

    const accountLabel = targetAccount.display_name || targetAccount.email || targetAccount.id;

    if (actionType === 'delete') {
      const confirmed = window.confirm(`Delete account ${accountLabel}? This removes account data and cannot be undone.`);
      if (!confirmed) {
        return;
      }
    }

    if (actionType === 'ban') {
      const nextBanState = String(selectedAccount.accountStatus || '').toLowerCase() !== 'banned';
      const confirmed = window.confirm(`${nextBanState ? 'Ban' : 'Unban'} account ${accountLabel}?`);
      if (!confirmed) {
        return;
      }
    }

    setAccountActionBusy(actionType);
    setAccountActionError('');

    try {
      const sessionResolution = await resolveAccessToken();
      const accessToken = String(sessionResolution?.accessToken || '').trim();
      if (!accessToken) {
        throw new Error('Admin owner session is missing. Sign in again and retry.');
      }

      if (actionType === 'ban') {
        const shouldBan = String(targetAccount.accountStatus || '').toLowerCase() !== 'banned';
        const response = await fetch(buildCloudAPIURL(`/admin/accounts/${encodeURIComponent(String(targetAccount.id || '').trim())}/ban`), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            accountType: targetAccount.accountType || 'website',
            enabled: shouldBan,
            appUuid: targetAccount.appUuid || '',
            email: targetAccount.email || ''
          })
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(String(payload?.message || payload?.error || `Account moderation failed (${response.status}).`));
        }
      }

      if (actionType === 'delete') {
        const query = new URLSearchParams();
        query.set('accountType', String(targetAccount.accountType || 'website'));
        if (targetAccount.appUuid) {
          query.set('appUuid', String(targetAccount.appUuid));
        }
        if (targetAccount.email) {
          query.set('email', String(targetAccount.email));
        }

        const response = await fetch(buildCloudAPIURL(`/admin/accounts/${encodeURIComponent(String(targetAccount.id || '').trim())}${query.toString() ? `?${query.toString()}` : ''}`), {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(String(payload?.message || payload?.error || `Account deletion failed (${response.status}).`));
        }
      }

      if (actionType === 'ban') {
        const nextStatus = String(targetAccount.accountStatus || '').toLowerCase() === 'banned' ? 'active' : 'banned';
        setAccounts((existingAccounts) => existingAccounts.map((account) => (
          account.id === targetAccount.id
            ? { ...account, accountStatus: nextStatus }
            : account
        )));
      }

      if (actionType === 'delete') {
        setAccounts((existingAccounts) => existingAccounts.filter((account) => account.id !== targetAccount.id));
        setSelectedAccountId((currentId) => (currentId === targetAccount.id ? '' : currentId));
      }

      void loadAdminData({ silent: true });
    } catch (error) {
      console.error('Account action failed:', error);
      setAccountActionError(error instanceof Error ? error.message : 'Account action failed.');
    } finally {
      setAccountActionBusy('');
    }
  }, [accounts, loadAdminData, selectedAccountId]);

  useEffect(() => {
    if (!authResolved || !canAccessAdmin) {
      return;
    }

    const cachedOverview = readCachedAdminOverview();
    if (cachedOverview) {
      applyOverview(cachedOverview);
    }

    loadAdminData();
  }, [applyOverview, authResolved, canAccessAdmin, loadAdminData]);

  useEffect(() => {
    if (accounts.length === 0) {
      if (selectedAccountId) {
        setSelectedAccountId('');
      }
      return;
    }

    const selectedExists = accounts.some((account) => account.id === selectedAccountId);
    if (!selectedAccountId || !selectedExists) {
      setSelectedAccountId(accounts[0].id);
    }
  }, [accounts, selectedAccountId]);

  if (!authResolved) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800"></div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <Shield className="mb-4 h-16 w-16 text-muted-foreground opacity-30" />
        <h2 className="text-xl font-bold text-foreground">Access Denied</h2>
        <p className="mt-2 text-muted-foreground">You need admin privileges to view this page.</p>
      </div>
    );
  }

  if (!canAccessAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <Shield className="mb-4 h-16 w-16 text-muted-foreground opacity-30" />
        <h2 className="text-xl font-bold text-foreground">Access Denied</h2>
        <p className="mt-2 text-muted-foreground">You need admin privileges to view this page.</p>
      </div>
    );
  }

  const normalizedQuery = search.trim().toLowerCase();
  const filteredAccounts = accounts.filter((account) => {
    if (!normalizedQuery) {
      return true;
    }

    return matchesSearch(account.display_name, normalizedQuery)
      || matchesSearch(account.email, normalizedQuery)
      || matchesSearch(account.accountType, normalizedQuery)
      || matchesSearch(account.appUuid, normalizedQuery)
      || matchesSearch(account.machineName, normalizedQuery)
      || matchesSearch(account.isLinked ? 'linked' : 'unlinked', normalizedQuery)
      || matchesSearch(account.source, normalizedQuery)
      || matchesSearch(account.role, normalizedQuery)
      || matchesSearch(account.accountStatus, normalizedQuery)
      || matchesSearch(account.subscriptionTier, normalizedQuery);
  });
  const selectedAccount = filteredAccounts.find((account) => account.id === selectedAccountId)
    || accounts.find((account) => account.id === selectedAccountId)
    || accounts[0]
    || null;
  const filteredClips = recentClips.filter((clip) => {
    if (!normalizedQuery) {
      return true;
    }

    return matchesSearch(clip.title, normalizedQuery)
      || matchesSearch(clip.ownerName, normalizedQuery)
      || matchesSearch(clip.game_title, normalizedQuery);
  });
  const filteredVerificationQueue = verificationQueue.filter((profile) => {
    if (!normalizedQuery) {
      return true;
    }

    return matchesSearch(profile.displayLabel, normalizedQuery)
      || matchesSearch(profile.email, normalizedQuery);
  });
  const filteredComments = recentComments.filter((comment) => {
    if (!normalizedQuery) {
      return true;
    }

    return matchesSearch(comment.authorName, normalizedQuery)
      || matchesSearch(comment.body, normalizedQuery)
      || matchesSearch(comment.clipTitle, normalizedQuery);
  });

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="page-heading">Admin Panel</h1>
            <p className="page-subtitle">Community operations, creator watchlists, and moderation triage.</p>
          </div>
        </div>

        <button
          type="button"
          onClick={loadAdminData}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh data
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <div className="glass-card p-5">
          <div className="flex items-center gap-3">
            <Users className="h-8 w-8 text-primary" />
            <div>
              <p className="text-2xl font-bold text-foreground">{formatCompactNumber(stats.creators)}</p>
              <p className="text-xs text-muted-foreground">Accounts</p>
            </div>
          </div>
        </div>
        <div className="glass-card p-5">
          <div className="flex items-center gap-3">
            <CheckCircle className="h-8 w-8 text-emerald-600" />
            <div>
              <p className="text-2xl font-bold text-foreground">{formatCompactNumber(stats.publicClips)}</p>
              <p className="text-xs text-muted-foreground">Public community clips</p>
            </div>
          </div>
        </div>
        <div className="glass-card p-5">
          <div className="flex items-center gap-3">
            <MessageSquare className="h-8 w-8 text-sky-600" />
            <div>
              <p className="text-2xl font-bold text-foreground">{formatCompactNumber(stats.comments)}</p>
              <p className="text-xs text-muted-foreground">Comments</p>
            </div>
          </div>
        </div>
        <div className="glass-card p-5">
          <div className="flex items-center gap-3">
            <TrendingUp className="h-8 w-8 text-amber-600" />
            <div>
              <p className="text-2xl font-bold text-foreground">{formatCompactNumber(stats.subscriptions)}</p>
              <p className="text-xs text-muted-foreground">Subscriptions</p>
            </div>
          </div>
        </div>
        <div className="glass-card p-5">
          <div className="flex items-center gap-3">
            <CreditCard className="h-8 w-8 text-cyan-600" />
            <div>
              <p className="text-2xl font-bold text-foreground">{formatCompactNumber(stats.payments)}</p>
              <p className="text-xs text-muted-foreground">Payments</p>
            </div>
          </div>
        </div>
        <div className="glass-card p-5">
          <div className="flex items-center gap-3">
            <Sparkles className="h-8 w-8 text-violet-600" />
            <div>
              <p className="text-2xl font-bold text-foreground">{formatCompactNumber(stats.proUsers)}</p>
              <p className="text-xs text-muted-foreground">Pro users</p>
            </div>
          </div>
        </div>
        <div className="glass-card p-5">
          <div className="flex items-center gap-3">
            <UserCheck className="h-8 w-8 text-rose-600" />
            <div>
              <p className="text-2xl font-bold text-foreground">{formatCompactNumber(stats.activeCreators)}</p>
              <p className="text-xs text-muted-foreground">Active in the last 7 days</p>
            </div>
          </div>
        </div>
      </div>

      {adminError ? <p className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">{adminError}</p> : null}

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="glass-card">
          <div className="border-b border-border p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-foreground">Verification Queue</h2>
                <p className="mt-1 text-sm text-muted-foreground">Creators above {formatCompactNumber(VERIFICATION_FOLLOWER_THRESHOLD)} followers who are still unverified.</p>
              </div>
              <div className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-foreground">
                {formatCompactNumber(stats.pendingVerification)} pending
              </div>
            </div>
          </div>
          <div className="p-6">
            {filteredVerificationQueue.length === 0 ? (
              <p className="text-sm text-muted-foreground">{emptySectionMessage(Boolean(normalizedQuery), 'Nothing waiting here yet.')}</p>
            ) : (
              <div className="space-y-3">
                {filteredVerificationQueue.map((profile) => (
                  <div key={profile.id} className="rounded-xl border border-border p-4 transition-colors hover:bg-muted/30">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{profile.displayLabel}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{profile.email || 'No email on file'}</p>
                        <p className="mt-2 text-xs text-muted-foreground">{formatCompactNumber(profile.follower_count)} followers • Last seen {formatAdminTime(profile.last_seen_at || profile.created_at)}</p>
                      </div>
                      <Link to={`/profile/${profile.id}`} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted">
                        Open profile
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="glass-card">
          <div className="border-b border-border p-6">
            <div className="flex items-center gap-3">
              <Flame className="h-5 w-5 text-amber-600" />
              <div>
                <h2 className="text-lg font-bold text-foreground">Top Community Clips</h2>
                <p className="mt-1 text-sm text-muted-foreground">Public clips ranked by visible likes and comments.</p>
              </div>
            </div>
          </div>
          <div className="p-6">
            {topClips.length === 0 ? (
              <p className="text-sm text-muted-foreground">{emptySectionMessage(Boolean(normalizedQuery))}</p>
            ) : (
              <div className="space-y-3">
                {topClips.map((clip, index) => (
                  <div key={clip.id} className="rounded-xl border border-border p-4 transition-colors hover:bg-muted/30">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">#{index + 1}</p>
                        <p className="mt-1 truncate text-sm font-semibold text-foreground">{clip.title || 'Untitled clip'}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{clip.ownerName} • {clip.game_title || 'No game tag'}</p>
                        <p className="mt-2 text-xs text-muted-foreground">{formatCompactNumber(clip.likeCount)} likes • {formatCompactNumber(clip.commentCount)} comments</p>
                      </div>
                      <Link to={`/clip/${clip.id}`} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted">
                        Open clip
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="glass-card">
        <div className="border-b border-border p-6">
          <h2 className="text-lg font-bold text-foreground">Comment Feed</h2>
          <p className="mt-1 text-sm text-muted-foreground">Newest visible comments across community clips.</p>
          <div className="relative mt-4">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search users, clips, comments, or games..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full rounded-lg border border-input bg-background px-10 py-2.5 text-sm text-foreground outline-none ring-0 transition-colors placeholder:text-muted-foreground focus:border-primary"
            />
          </div>
        </div>
        <div className="p-6">
          {filteredComments.length === 0 ? (
            <p className="text-sm text-muted-foreground">{emptySectionMessage(Boolean(normalizedQuery))}</p>
          ) : (
            <div className="space-y-3">
              {filteredComments.map((comment) => (
                <div key={comment.id} className="rounded-xl border border-border p-4 transition-colors hover:bg-muted/30">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground">{comment.authorName}</p>
                      <p className="mt-1 text-xs text-muted-foreground">On {comment.clipTitle} • {formatAdminTime(comment.created_at)}</p>
                      <p className="mt-3 text-sm text-foreground/90">{truncateText(comment.body, 180)}</p>
                    </div>
                    <Link to={`/clip/${comment.clip_id}`} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted">
                      Open clip
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="border-b border-border p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-foreground">All Accounts</h2>
              <p className="mt-1 text-sm text-muted-foreground">Every auth user, Firestore user, and standalone installation. Click one to inspect.</p>
            </div>
            <div className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-foreground">
              {formatCompactNumber(filteredAccounts.length)} shown
            </div>
          </div>
          <div className="relative mt-4">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search accounts, emails, app UUIDs, or sources..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full rounded-lg border border-input bg-background px-10 py-2.5 text-sm text-foreground outline-none ring-0 transition-colors placeholder:text-muted-foreground focus:border-primary"
            />
          </div>
        </div>
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">  
            <div className="border-b border-border p-6 lg:border-b-0 lg:border-r">
              {filteredAccounts.length === 0 ? (
                <p className="py-8 text-center text-muted-foreground">{emptySectionMessage(Boolean(normalizedQuery), 'No accounts found.')}</p>
              ) : (
                <div className="max-h-[36rem] space-y-2 overflow-y-auto pr-1">
                  {filteredAccounts.map((account) => {
                    const isSelected = account.id === selectedAccount?.id;
                    return (
                      <button
                        key={account.id}
                        type="button"
                        onClick={() => setSelectedAccountId(account.id)}
                        className={`flex w-full items-center gap-4 rounded-lg border p-3 text-left transition-colors ${isSelected ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/30'}`}
                      >
                        {account.avatar_url ? (
                          <img src={account.avatar_url} alt={account.display_name || account.email || 'Account'} className="h-10 w-10 rounded-full border border-border object-cover" />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white" style={avatarStyleFromSeed(account.id || account.email || account.display_name || 'account')}>
                            {initialsFromName(account.display_name || account.email || account.machineName || 'User')}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-foreground">{account.display_name || 'Unknown account'}</p>
                          <p className="truncate text-xs text-muted-foreground">{account.email || account.machineName || 'No email on file'}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                            <span className="rounded-full border border-border px-2 py-0.5">{accountTypeLabel(account.accountType)}</span>
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${account.isLinked ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                              {account.isLinked ? <Link2 className="h-3 w-3" /> : <Unlink className="h-3 w-3" />}
                              {account.isLinked ? 'Linked' : 'Not linked'}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {account.appUuid ? `App UUID ${account.appUuid.slice(0, 8).toUpperCase()}` : 'No app UUID'}
                            {account.subscriptionTier ? ` • ${String(account.subscriptionTier).toUpperCase()}` : ''}
                            {account.accountStatus ? ` • ${String(account.accountStatus).toUpperCase()}` : ''}
                          </p>
                        </div>
                        <span className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted">
                          View
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="p-6">
              {selectedAccount ? (
                <div className="space-y-5">
                  <div className="flex items-start gap-4">
                    {selectedAccount.avatar_url ? (
                      <img src={selectedAccount.avatar_url} alt={selectedAccount.display_name || selectedAccount.email || 'Account'} className="h-16 w-16 rounded-2xl border border-border object-cover" />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded-2xl text-lg font-bold text-white" style={avatarStyleFromSeed(selectedAccount.id || selectedAccount.email || selectedAccount.display_name || 'account')}>
                        {initialsFromName(selectedAccount.display_name || selectedAccount.email || selectedAccount.machineName || 'User')}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xl font-bold text-foreground">{selectedAccount.display_name || 'Unknown account'}</p>
                      <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                        <Mail className="h-3.5 w-3.5" />
                        <span className="truncate">{selectedAccount.email || 'No email on file'}</span>
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">Source: {selectedAccount.source || 'unknown'}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="rounded-full border border-border px-2.5 py-1">{accountTypeLabel(selectedAccount.accountType)}</span>
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${selectedAccount.isLinked ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                          {selectedAccount.isLinked ? <Link2 className="h-3.5 w-3.5" /> : <Unlink className="h-3.5 w-3.5" />}
                          {selectedAccount.isLinked ? 'Linked' : 'Not linked'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => runAccountAction('ban')}
                      disabled={Boolean(accountActionBusy)}
                      className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {accountActionBusy === 'ban'
                        ? 'Updating...'
                        : (String(selectedAccount.accountStatus || '').toLowerCase() === 'banned' ? 'Unban Account' : 'Ban Account')}
                    </button>
                    <button
                      type="button"
                      onClick={() => runAccountAction('delete')}
                      disabled={Boolean(accountActionBusy)}
                      className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {accountActionBusy === 'delete' ? 'Deleting...' : 'Delete Account'}
                    </button>
                  </div>

                  {accountActionError ? (
                    <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
                      {accountActionError}
                    </p>
                  ) : null}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-border p-4">
                      <p className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                        <IdCard className="h-3.5 w-3.5" />
                        Account ID
                      </p>
                      <p className="mt-1 break-all text-sm font-medium text-foreground">{selectedAccount.id}</p>
                    </div>
                    <div className="rounded-xl border border-border p-4">
                      <p className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                        <Link2 className="h-3.5 w-3.5" />
                        Link status
                      </p>
                      <p className="mt-1 text-sm font-medium text-foreground">
                        {selectedAccount.isLinked ? 'Linked to another root account' : 'Standalone root account'}
                      </p>
                      {selectedAccount.linkedAccountId ? (
                        <p className="mt-2 break-all text-xs text-muted-foreground">Linked account ID: {selectedAccount.linkedAccountId}</p>
                      ) : null}
                      {selectedAccount.linkedAppUuid ? (
                        <p className="mt-2 break-all text-xs text-muted-foreground">Linked App UUID: {selectedAccount.linkedAppUuid}</p>
                      ) : null}
                      <Link
                        to={`/profile/${selectedAccount.profileId || selectedAccount.id}`}
                        className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
                      >
                        Open profile
                      </Link>
                      {selectedAccount.hasPublicProfile && selectedAccount.profileId ? null : (
                        <p className="mt-2 text-xs text-muted-foreground">No public clipping profile detected yet, opening fallback profile route.</p>
                      )}
                    </div>
                    <div className="rounded-xl border border-border p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Created</p>
                      <p className="mt-1 text-sm font-medium text-foreground">{formatAdminTime(selectedAccount.created_at)}</p>
                    </div>
                    <div className="rounded-xl border border-border p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Last seen</p>
                      <p className="mt-1 text-sm font-medium text-foreground">{formatAdminTime(selectedAccount.last_seen_at)}</p>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-border p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Role / status</p>
                      <p className="mt-1 text-sm font-medium text-foreground">
                        {selectedAccount.role || 'user'} / {selectedAccount.accountStatus || 'active'}
                      </p>
                    </div>
                    <div className="rounded-xl border border-border p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Subscription</p>
                      <p className="mt-1 text-sm font-medium text-foreground">{selectedAccount.subscriptionTier || 'free'}</p>
                    </div>
                    <div className="rounded-xl border border-border p-4 sm:col-span-2">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Paid features</p>
                      <p className="mt-1 text-sm font-medium text-foreground">{Array.isArray(selectedAccount.paidFeatures) && selectedAccount.paidFeatures.length > 0 ? selectedAccount.paidFeatures.join(', ') : 'None'}</p>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-border p-4">
                      <p className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                        <Smartphone className="h-3.5 w-3.5" />
                        App UUID
                      </p>
                      <p className="mt-1 break-all text-sm font-medium text-foreground">{selectedAccount.appUuid || 'None'}</p>
                    </div>
                    <div className="rounded-xl border border-border p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Machine</p>
                      <p className="mt-1 text-sm font-medium text-foreground">{selectedAccount.machineName || 'None'}</p>
                    </div>
                    <div className="rounded-xl border border-border p-4 sm:col-span-2">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Machine identifier</p>
                      <p className="mt-1 break-all text-sm font-medium text-foreground">{selectedAccount.machineIdentifier || 'None'}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Select an account to inspect its email, clipping profile, and linked app information.</p>
              )}
            </div>
          </div>
        </div>

      <div className="glass-card">
        <div className="border-b border-border p-6">
          <h2 className="text-lg font-bold text-foreground">Recent Public Clips</h2>
            <p className="mt-1 text-sm text-muted-foreground">Latest clips currently visible in the community feed.</p>
          </div>
          <div className="p-6">
            {filteredClips.length === 0 ? (
              <p className="text-muted-foreground">{emptySectionMessage(Boolean(normalizedQuery))}</p>
            ) : (
              <div className="space-y-2">
                {filteredClips.map((clip) => (
                  <div key={clip.id} className="rounded-lg border border-border p-3 transition-colors hover:bg-muted/30">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground">{clip.title || 'Untitled clip'}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{clip.ownerName} • {clip.game_title || 'No game tag'}</p>
                        <p className="mt-2 text-xs text-muted-foreground">Published {formatAdminTime(clip.created_at)}</p>
                      </div>
                      <Link to={`/clip/${clip.id}`} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted">
                        Open clip
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      <div className="grid gap-4 md:grid-cols-3">
        {moderationAreas.map((section) => (
          <section key={section.title} className="glass-card p-6">
            <div className="flex items-center gap-2">
              <Ban className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-lg font-bold text-foreground">{section.title}</h3>
            </div>
            <ul className="mt-4 space-y-2 pl-5 text-sm text-muted-foreground">
              {section.points.map((point) => <li key={point}>{point}</li>)}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

export default Admin;