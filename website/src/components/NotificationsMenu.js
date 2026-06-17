import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Bookmark, Heart, MessageCircle, UserPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { avatarStyleFromSeed, initialsFromName } from '../lib/avatarTheme';
import { fetchPublicProfiles } from '../lib/publicSupabase';

const MAX_NOTIFICATION_ITEMS = 18;
const NOTIFICATION_REFRESH_MS = 60000;

function formatRelativeTime(value) {
  if (!value) {
    return 'Recently';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Recently';
  }

  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const ranges = [
    ['year', 60 * 60 * 24 * 365],
    ['month', 60 * 60 * 24 * 30],
    ['week', 60 * 60 * 24 * 7],
    ['day', 60 * 60 * 24],
    ['hour', 60 * 60],
    ['minute', 60],
    ['second', 1]
  ];

  for (const [unit, secondsInUnit] of ranges) {
    if (Math.abs(seconds) >= secondsInUnit || unit === 'second') {
      return formatter.format(Math.round(seconds / secondsInUnit), unit);
    }
  }

  return 'Recently';
}

function lastSeenStorageKey(userId) {
  return `macclipper.notifications.last-seen.${String(userId || '').trim()}`;
}

function trimNotificationText(value, maxLength = 120) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trim()}…`;
}

function actorProfileForNotification(actorId, profileMap) {
  return profileMap.get(actorId) || null;
}

function notificationIcon(kind) {
  switch (kind) {
    case 'comment':
      return MessageCircle;
    case 'like':
      return Heart;
    case 'favourite':
      return Bookmark;
    case 'follow':
      return UserPlus;
    default:
      return Bell;
  }
}

function NotificationsMenu({ currentUser }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const containerRef = useRef(null);

  const latestCreatedAt = useMemo(() => items[0]?.createdAt || '', [items]);

  useEffect(() => {
    if (!currentUser?.id) {
      setItems([]);
      setUnreadCount(0);
      setLoading(false);
      return undefined;
    }

    let active = true;

    async function loadNotifications() {
      if (!active) {
        return;
      }

      setLoading(true);

      try {
        const ownedClipsResult = await supabase
          .from('clips')
          .select('id, title, owner_profile_id, user_id')
          .or(`owner_profile_id.eq.${currentUser.id},user_id.eq.${currentUser.id}`)
          .order('created_at', { ascending: false })
          .limit(80);

        const ownedClips = Array.isArray(ownedClipsResult.data) ? ownedClipsResult.data : [];
        const clipIds = ownedClips.map((clip) => clip.id).filter(Boolean);
        const clipTitleById = new Map(ownedClips.map((clip) => [clip.id, clip.title || 'your clip']));

        const [commentsResult, likesResult, favouritesResult, followsResult] = await Promise.all([
          clipIds.length > 0
            ? supabase
                .from('clip_comments')
                .select('id, clip_id, user_id, body, created_at')
                .in('clip_id', clipIds)
                .neq('user_id', currentUser.id)
                .order('created_at', { ascending: false })
                .limit(MAX_NOTIFICATION_ITEMS)
            : Promise.resolve({ data: [], error: null }),
          clipIds.length > 0
            ? supabase
                .from('clip_likes')
                .select('id, clip_id, user_id, created_at')
                .in('clip_id', clipIds)
                .neq('user_id', currentUser.id)
                .order('created_at', { ascending: false })
                .limit(MAX_NOTIFICATION_ITEMS)
            : Promise.resolve({ data: [], error: null }),
          clipIds.length > 0
            ? supabase
                .from('favourites')
                .select('id, clip_id, user_id, created_at')
                .in('clip_id', clipIds)
                .neq('user_id', currentUser.id)
                .order('created_at', { ascending: false })
                .limit(MAX_NOTIFICATION_ITEMS)
            : Promise.resolve({ data: [], error: null }),
          supabase
            .from('profile_subscriptions')
            .select('id, subscriber_id, created_at')
            .eq('creator_id', currentUser.id)
            .neq('subscriber_id', currentUser.id)
            .order('created_at', { ascending: false })
            .limit(MAX_NOTIFICATION_ITEMS)
        ]);

        if (!active) {
          return;
        }

        const queryErrors = [ownedClipsResult.error, commentsResult.error, likesResult.error, favouritesResult.error, followsResult.error].filter(Boolean);
        if (queryErrors.length > 0) {
          console.error('Error loading notifications:', queryErrors);
        }

        const actorIds = Array.from(new Set([
          ...(commentsResult.data || []).map((item) => item.user_id),
          ...(likesResult.data || []).map((item) => item.user_id),
          ...(favouritesResult.data || []).map((item) => item.user_id),
          ...(followsResult.data || []).map((item) => item.subscriber_id)
        ].filter(Boolean)));

        const actorProfiles = actorIds.length > 0
          ? await fetchPublicProfiles(actorIds).catch((error) => {
              console.error('Error loading notification actor profiles:', error);
              return [];
            })
          : [];

        const profileMap = new Map(actorProfiles.map((profile) => [profile.id, profile]));
        const nextItems = [
          ...(commentsResult.data || []).map((item) => ({
            id: `comment-${item.id}`,
            kind: 'comment',
            actorId: item.user_id,
            actorProfile: actorProfileForNotification(item.user_id, profileMap),
            createdAt: item.created_at,
            href: `/clip/${item.clip_id}`,
            title: 'commented on your clip',
            subtitle: trimNotificationText(item.body),
            clipTitle: clipTitleById.get(item.clip_id) || 'your clip'
          })),
          ...(likesResult.data || []).map((item) => ({
            id: `like-${item.id}`,
            kind: 'like',
            actorId: item.user_id,
            actorProfile: actorProfileForNotification(item.user_id, profileMap),
            createdAt: item.created_at,
            href: `/clip/${item.clip_id}`,
            title: 'liked your clip',
            subtitle: clipTitleById.get(item.clip_id) || 'your clip'
          })),
          ...(favouritesResult.data || []).map((item) => ({
            id: `favourite-${item.id}`,
            kind: 'favourite',
            actorId: item.user_id,
            actorProfile: actorProfileForNotification(item.user_id, profileMap),
            createdAt: item.created_at,
            href: `/clip/${item.clip_id}`,
            title: 'saved your clip',
            subtitle: clipTitleById.get(item.clip_id) || 'your clip'
          })),
          ...(followsResult.data || []).map((item) => ({
            id: `follow-${item.id}`,
            kind: 'follow',
            actorId: item.subscriber_id,
            actorProfile: actorProfileForNotification(item.subscriber_id, profileMap),
            createdAt: item.created_at,
            href: item.subscriber_id ? `/profile/${item.subscriber_id}` : '/community',
            title: 'started following you',
            subtitle: 'Your channel picked up a new follower.'
          }))
        ]
          .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime())
          .slice(0, MAX_NOTIFICATION_ITEMS);

        const lastSeenValue = typeof window !== 'undefined'
          ? String(window.localStorage.getItem(lastSeenStorageKey(currentUser.id)) || '').trim()
          : '';
        const lastSeenTime = lastSeenValue ? new Date(lastSeenValue).getTime() : 0;
        const nextUnreadCount = nextItems.filter((item) => new Date(item.createdAt || 0).getTime() > lastSeenTime).length;

        if (active) {
          setItems(nextItems);
          setUnreadCount(nextUnreadCount);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadNotifications();
    const intervalId = window.setInterval(() => {
      void loadNotifications();
    }, NOTIFICATION_REFRESH_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [currentUser?.id]);

  useEffect(() => {
    if (!open || !currentUser?.id || typeof window === 'undefined') {
      return;
    }

    const seenValue = latestCreatedAt || new Date().toISOString();
    window.localStorage.setItem(lastSeenStorageKey(currentUser.id), seenValue);
    setUnreadCount(0);
  }, [open, latestCreatedAt, currentUser?.id]);

  useEffect(() => {
    const handleClick = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  if (!currentUser?.id) {
    return null;
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((currentValue) => !currentValue)}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background text-foreground transition-colors hover:bg-muted"
        aria-label="Notifications"
        title="Notifications"
      >
        <Bell className="h-4.5 w-4.5" />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-12 z-50 w-[min(92vw,24rem)] overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Notifications</p>
              <p className="text-xs text-muted-foreground">Comments, likes, saves, and new followers.</p>
            </div>
            {loading ? <span className="text-xs text-muted-foreground">Refreshing…</span> : null}
          </div>

          <div className="max-h-[28rem] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                Nothing new yet.
              </div>
            ) : items.map((item) => {
              const Icon = notificationIcon(item.kind);
              const actorName = String(item.actorProfile?.display_name || 'MacClipper User').trim() || 'MacClipper User';
              const actorAvatarURL = String(item.actorProfile?.avatar_url || '').trim();
              const actorAvatarStyle = avatarStyleFromSeed(item.actorId || actorName || item.id);

              return (
                <Link
                  key={item.id}
                  to={item.href}
                  onClick={() => setOpen(false)}
                  className="flex gap-3 border-b border-border/80 px-4 py-3 transition-colors hover:bg-muted/70"
                >
                  <div className="relative shrink-0">
                    {actorAvatarURL ? (
                      <img src={actorAvatarURL} alt={actorName} className="h-10 w-10 rounded-full border border-border object-cover" />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-full text-xs font-bold text-white" style={actorAvatarStyle}>
                        {initialsFromName(actorName)}
                      </div>
                    )}
                    <span className="absolute -bottom-1 -right-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-card bg-card text-primary shadow-sm">
                      <Icon className="h-3 w-3" />
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">
                      <span className="font-semibold">{actorName}</span>{' '}
                      <span className="text-muted-foreground">{item.title}</span>
                    </p>
                    {item.subtitle ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.subtitle}</p> : null}
                    <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{formatRelativeTime(item.createdAt)}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default NotificationsMenu;