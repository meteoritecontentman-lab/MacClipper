import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Eye, Gamepad2, MessageCircle, PlayCircle, Share2, ThumbsDown, ThumbsUp, Timer, UserRoundCheck } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { buildAppURL, buildCloudAPIURL } from '../lib/appRuntime';
import { avatarStyleFromSeed, avatarURLFromUser, displayNameFromUser, initialsFromName, isVerifiedProfile, ownerTagLabel } from '../lib/avatarTheme';
import { hydrateClipsWithSharedLinks } from '../lib/cloudSharedClips';
import { fetchClipDislikeSummary, setClipDislikePreference } from '../lib/clipDislikes';
import { fetchClipComments, fetchClipLikeSummary, postClipComment, setClipLikePreference, setCommentReaction } from '../lib/clipSocial';
import { fetchPublicClipById, fetchPublicProfiles } from '../lib/publicSupabase';

function formatRelativeTime(value) {
  if (!value) {
    return 'Recently posted';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Recently posted';
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

  return 'Recently posted';
}

function formatDuration(seconds) {
  const numericSeconds = Number(seconds || 0);
  if (!Number.isFinite(numericSeconds) || numericSeconds <= 0) {
    return 'Duration loading';
  }

  const rounded = Math.round(numericSeconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;

  if (hours > 0) {
    return [hours, minutes, remainingSeconds].map((value) => String(value).padStart(2, '0')).join(':');
  }

  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function formatCompactNumber(value) {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value || 0));
}

function normalizeOwnerName(profile, clip) {
  if (typeof profile?.display_name === 'string' && profile.display_name.trim()) {
    return profile.display_name.trim();
  }

  if (typeof clip?.owner_display_name === 'string' && clip.owner_display_name.trim()) {
    return clip.owner_display_name.trim();
  }

  return 'MacClipper Creator';
}

function resolveDisplayedOwnerProfile(ownerProfile, currentUser, ownerId) {
  if (!ownerId || ownerId !== currentUser?.id) {
    return ownerProfile || null;
  }

  return {
    ...(ownerProfile || {}),
    email: currentUser?.email || ownerProfile?.email || '',
    display_name: displayNameFromUser(currentUser),
    avatar_url: avatarURLFromUser(currentUser) || ownerProfile?.avatar_url || ''
  };
}

function decorateComments(commentRows, profiles, currentUser) {
  const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]));

  return (commentRows || []).map((comment) => {
    const isOwnComment = Boolean(comment.user_id && comment.user_id === currentUser?.id);
    const authorProfile = isOwnComment
      ? {
          id: currentUser?.id || comment.user_id,
          display_name: displayNameFromUser(currentUser),
          avatar_url: avatarURLFromUser(currentUser)
        }
      : (profileMap.get(comment.user_id) || null);

    return {
      ...comment,
      authorName: String(authorProfile?.display_name || 'MacClipper User').trim() || 'MacClipper User',
      authorAvatarURL: String(authorProfile?.avatar_url || '').trim(),
      isOwnComment
    };
  });
}

function makePendingCommentId() {
  return `pending-comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function updateCommentReactionState(existingComments, commentId, updater) {
  return existingComments.map((comment) => {
    if (comment.id !== commentId) {
      return comment;
    }

    return typeof updater === 'function' ? updater(comment) : comment;
  });
}

function ClipDetailPage({ currentUser = null }) {
  const { clipId } = useParams();
  const [clip, setClip] = useState(null);
  const [ownerProfile, setOwnerProfile] = useState(null);
  const [commentRows, setCommentRows] = useState([]);
  const [commentCount, setCommentCount] = useState(0);
  const [commentProfiles, setCommentProfiles] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentSubmitProgress, setCommentSubmitProgress] = useState(0);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [viewCount, setViewCount] = useState(0);
  const [viewsLoading, setViewsLoading] = useState(true);
  const [likeCount, setLikeCount] = useState(0);
  const [liked, setLiked] = useState(false);
  const [dislikeCount, setDislikeCount] = useState(0);
  const [disliked, setDisliked] = useState(false);
  const [reactionsLoading, setReactionsLoading] = useState(true);
  const [reactionBusy, setReactionBusy] = useState('');
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [pendingCommentReactionIds, setPendingCommentReactionIds] = useState({});

  useEffect(() => {
    if (!commentBusy) {
      setCommentSubmitProgress(0);
      return undefined;
    }

    setCommentSubmitProgress(14);
    const intervalId = window.setInterval(() => {
      setCommentSubmitProgress((currentValue) => {
        if (currentValue >= 90) {
          return currentValue;
        }

        return Math.min(90, currentValue + 8);
      });
    }, 120);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [commentBusy]);

  useEffect(() => {
    let active = true;

    async function loadClipPage() {
      setLoading(true);
      setErrorMessage('');
      setCommentRows([]);
      setCommentCount(0);
      setCommentProfiles([]);
      setCommentsLoading(true);
      setViewsLoading(true);
      setLikeCount(0);
      setLiked(false);
      setDislikeCount(0);
      setDisliked(false);
      setReactionsLoading(true);
      setStatusMessage('');
      setOwnerProfile(null);

      try {
        const clipRow = await fetchPublicClipById(clipId);
        if (!clipRow) {
          throw new Error('Clip not found.');
        }

        const [hydratedClip] = await hydrateClipsWithSharedLinks([clipRow]).catch(() => [clipRow]);
        if (!active) {
          return;
        }

        const nextClip = hydratedClip || clipRow;
        setClip(nextClip);
        setLoading(false);

        const ownerId = nextClip?.owner_profile_id || nextClip?.user_id;
        if (ownerId) {
          void (async () => {
            const profiles = await fetchPublicProfiles([ownerId]).catch((error) => {
              console.error('Error loading clip owner profile:', error);
              return [];
            });

            if (active) {
              setOwnerProfile(profiles[0] || null);
            }
          })();
        }

        void (async () => {
          try {
            const commentPayload = await fetchClipComments(clipRow.id, 24, currentUser?.id || '').catch((error) => {
              console.error('Error loading clip comments:', error);
              return { commentCount: 0, comments: [] };
            });
            const nextCommentRows = Array.isArray(commentPayload?.comments) ? commentPayload.comments : [];
            const authorIds = Array.from(new Set(nextCommentRows.map((comment) => comment.user_id).filter(Boolean)));
            const nextCommentProfiles = authorIds.length > 0
              ? await fetchPublicProfiles(authorIds).catch((error) => {
                  console.error('Error loading clip comment authors:', error);
                  return [];
                })
              : [];

            if (!active) {
              return;
            }

            setCommentRows(Array.isArray(nextCommentRows) ? nextCommentRows : []);
            setCommentCount(Number(commentPayload?.commentCount || 0));
            setCommentProfiles(Array.isArray(nextCommentProfiles) ? nextCommentProfiles : []);
          } finally {
            if (active) {
              setCommentsLoading(false);
            }
          }
        })();

        void (async () => {
          try {
            const viewsResponse = await fetch(buildCloudAPIURL(`/community-clips/${encodeURIComponent(String(clipRow.id))}/views`), {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              }
            }).catch(() => null);
            const viewsPayload = viewsResponse ? await viewsResponse.json().catch(() => ({})) : {};

            if (active) {
              setViewCount(Number(viewsPayload?.viewCount || 0));
            }
          } finally {
            if (active) {
              setViewsLoading(false);
            }
          }
        })();
      } catch (error) {
        if (active) {
          setClip(null);
          setOwnerProfile(null);
          setCommentRows([]);
          setCommentProfiles([]);
          setViewCount(0);
          setErrorMessage(error instanceof Error ? error.message : 'Unable to load this clip right now.');
          setCommentsLoading(false);
          setViewsLoading(false);
          setLoading(false);
        }
      }
    }

    void loadClipPage();

    return () => {
      active = false;
    };
  }, [clipId, currentUser?.id]);

  useEffect(() => {
    if (!clip?.id) {
      return undefined;
    }

    let active = true;

    async function loadReactions() {
      setReactionsLoading(true);

      try {
        const [likeSummary, dislikeSummary] = await Promise.all([
          fetchClipLikeSummary(clip.id, currentUser?.id || '').catch((error) => {
            console.error('Error loading clip likes:', error);
            return { likeCount: 0, liked: false };
          }),
          fetchClipDislikeSummary(clip.id, currentUser?.id || '').catch((error) => {
            console.error('Error loading clip dislikes:', error);
            return { dislikeCount: 0, disliked: false };
          })
        ]);

        if (!active) {
          return;
        }

        setLikeCount(Number(likeSummary?.likeCount || 0));
        setLiked(Boolean(likeSummary?.liked));
        setDislikeCount(Number(dislikeSummary?.dislikeCount || 0));
        setDisliked(Boolean(dislikeSummary?.disliked));
      } finally {
        if (active) {
          setReactionsLoading(false);
        }
      }
    }

    void loadReactions();

    return () => {
      active = false;
    };
  }, [clip?.id, currentUser?.id]);

  useEffect(() => {
    if (!clip?.title || typeof document === 'undefined') {
      return undefined;
    }

    const previousTitle = document.title;
    document.title = `${clip.title} | MacClipper`;
    return () => {
      document.title = previousTitle;
    };
  }, [clip?.title]);

  const ownerId = clip?.owner_profile_id || clip?.user_id || null;
  const displayedOwnerProfile = useMemo(() => resolveDisplayedOwnerProfile(ownerProfile, currentUser, ownerId), [ownerProfile, currentUser, ownerId]);
  const ownerName = useMemo(() => normalizeOwnerName(displayedOwnerProfile, clip), [displayedOwnerProfile, clip]);
  const ownerVerified = useMemo(() => isVerifiedProfile(displayedOwnerProfile, ownerName), [displayedOwnerProfile, ownerName]);
  const ownerTag = useMemo(() => ownerTagLabel(displayedOwnerProfile, ownerName, currentUser?.email), [displayedOwnerProfile, ownerName, currentUser?.email]);
  const ownerAvatarURL = useMemo(() => String(displayedOwnerProfile?.avatar_url || '').trim(), [displayedOwnerProfile]);
  const ownerAvatarStyle = useMemo(() => avatarStyleFromSeed(displayedOwnerProfile?.id || ownerName || ownerId || clip?.id || 'macclipper'), [displayedOwnerProfile?.id, ownerName, ownerId, clip?.id]);
  const viewerAvatarURL = useMemo(() => avatarURLFromUser(currentUser), [currentUser]);
  const viewerAvatarStyle = useMemo(() => avatarStyleFromSeed(currentUser?.id || currentUser?.email || 'viewer'), [currentUser?.email, currentUser?.id]);
  const comments = useMemo(() => decorateComments(commentRows, commentProfiles, currentUser), [commentRows, commentProfiles, currentUser]);

  async function handleCommentSubmit(event) {
    event.preventDefault();
    const body = commentDraft.trim();
    if (!body || !currentUser?.id || !clip?.id || commentBusy) {
      return;
    }

    const pendingComment = {
      id: makePendingCommentId(),
      clip_id: String(clip.id),
      user_id: currentUser.id,
      body,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      like_count: 0,
      dislike_count: 0,
      liked: false,
      disliked: false,
      pending: true
    };

    setCommentBusy(true);
    setStatusMessage('');
    setCommentRows((existingComments) => [pendingComment, ...existingComments]);
    setCommentCount((existingCount) => existingCount + 1);
    setCommentDraft('');

    try {
      const result = await postClipComment(clip.id, body);
      if (result?.comment) {
        setCommentRows((existingComments) => existingComments.map((comment) => (
          comment.id === pendingComment.id
            ? result.comment
            : comment
        )));
      }
      setCommentSubmitProgress(100);
      setCommentCount(Number(result?.commentCount || 0));
      setStatusMessage('Comment posted.');
    } catch (error) {
      console.error('Error posting clip comment:', error);
      setCommentRows((existingComments) => existingComments.filter((comment) => comment.id !== pendingComment.id));
      setCommentCount((existingCount) => Math.max(0, existingCount - 1));
      setCommentDraft(body);
      setStatusMessage(error instanceof Error ? error.message : 'Comment failed to send.');
    } finally {
      setCommentBusy(false);
    }
  }

  async function handleToggleLike() {
    if (!clip?.id || !currentUser?.id || reactionBusy) {
      if (!currentUser?.id) {
        setStatusMessage('Sign in to react to this clip.');
      }
      return;
    }

    setReactionBusy('like');
    setStatusMessage('');

    const previousState = {
      liked,
      likeCount,
      disliked,
      dislikeCount
    };
    const nextLiked = !liked;
    const nextLikeCount = Math.max(0, likeCount + (nextLiked ? 1 : -1));
    const nextDisliked = nextLiked ? false : disliked;
    const nextDislikeCount = nextLiked && disliked ? Math.max(0, dislikeCount - 1) : dislikeCount;

    setLiked(nextLiked);
    setLikeCount(nextLikeCount);
    if (nextLiked && disliked) {
      setDisliked(false);
      setDislikeCount(nextDislikeCount);
    }

    try {
      if (disliked) {
        const clearedDislike = await setClipDislikePreference(clip.id, currentUser.id, false);
        setDisliked(Boolean(clearedDislike.disliked));
        setDislikeCount(Number(clearedDislike.dislikeCount || 0));
      }

      const payload = await setClipLikePreference(clip.id, !liked);
      setLiked(Boolean(payload?.liked));
      setLikeCount(Number(payload?.likeCount || 0));
      setStatusMessage(payload?.liked ? 'Clip liked.' : 'Like removed.');
    } catch (error) {
      setLiked(previousState.liked);
      setLikeCount(previousState.likeCount);
      setDisliked(previousState.disliked);
      setDislikeCount(previousState.dislikeCount);
      console.error('Error toggling clip like:', error);
      setStatusMessage(error instanceof Error ? error.message : 'Like update failed.');
    } finally {
      setReactionBusy('');
    }
  }

  async function handleToggleDislike() {
    if (!clip?.id || !currentUser?.id || reactionBusy) {
      if (!currentUser?.id) {
        setStatusMessage('Sign in to react to this clip.');
      }
      return;
    }

    setReactionBusy('dislike');
    setStatusMessage('');

    const previousState = {
      liked,
      likeCount,
      disliked,
      dislikeCount
    };
    const nextDisliked = !disliked;
    const nextDislikeCount = Math.max(0, dislikeCount + (nextDisliked ? 1 : -1));
    const nextLiked = nextDisliked ? false : liked;
    const nextLikeCount = nextDisliked && liked ? Math.max(0, likeCount - 1) : likeCount;

    setDisliked(nextDisliked);
    setDislikeCount(nextDislikeCount);
    if (nextDisliked && liked) {
      setLiked(false);
      setLikeCount(nextLikeCount);
    }

    try {
      if (liked) {
        const unlikeResult = await setClipLikePreference(clip.id, false).catch((error) => {
          console.error('Error clearing existing like before dislike:', error);
          return null;
        });

        if (unlikeResult) {
          setLiked(Boolean(unlikeResult?.liked));
          setLikeCount(Number(unlikeResult?.likeCount || 0));
        }
      }

      const payload = await setClipDislikePreference(clip.id, currentUser.id, !disliked);
      setDisliked(Boolean(payload?.disliked));
      setDislikeCount(Number(payload?.dislikeCount || 0));
      setStatusMessage(payload?.disliked ? 'Clip disliked.' : 'Dislike removed.');
    } catch (error) {
      setLiked(previousState.liked);
      setLikeCount(previousState.likeCount);
      setDisliked(previousState.disliked);
      setDislikeCount(previousState.dislikeCount);
      console.error('Error toggling clip dislike:', error);
      setStatusMessage('Dislike update failed.');
    } finally {
      setReactionBusy('');
    }
  }

  async function handleCommentReaction(commentId, nextReaction) {
    if (!currentUser?.id || !clip?.id) {
      setStatusMessage('Sign in to react to this comment.');
      return;
    }

    const existingComment = comments.find((comment) => comment.id === commentId);
    if (!existingComment || existingComment.pending) {
      return;
    }

    const previousState = {
      liked: Boolean(existingComment.liked),
      disliked: Boolean(existingComment.disliked),
      like_count: Number(existingComment.like_count || 0),
      dislike_count: Number(existingComment.dislike_count || 0)
    };
    const optimisticReaction = nextReaction === 'like'
      ? (existingComment.liked ? 'none' : 'like')
      : (existingComment.disliked ? 'none' : 'dislike');

    setPendingCommentReactionIds((existingMap) => ({
      ...existingMap,
      [commentId]: optimisticReaction === 'like' ? 'like' : (optimisticReaction === 'dislike' ? 'dislike' : 'clear')
    }));

    setCommentRows((existingComments) => updateCommentReactionState(existingComments, commentId, (comment) => {
      const wasLiked = Boolean(comment.liked);
      const wasDisliked = Boolean(comment.disliked);
      const likeCountValue = Number(comment.like_count || 0);
      const dislikeCountValue = Number(comment.dislike_count || 0);
      const nextLiked = optimisticReaction === 'like';
      const nextDisliked = optimisticReaction === 'dislike';

      return {
        ...comment,
        liked: nextLiked,
        disliked: nextDisliked,
        like_count: Math.max(0, likeCountValue + (nextLiked ? 1 : 0) - (wasLiked ? 1 : 0)),
        dislike_count: Math.max(0, dislikeCountValue + (nextDisliked ? 1 : 0) - (wasDisliked ? 1 : 0))
      };
    }));

    try {
      const payload = await setCommentReaction(clip.id, commentId, optimisticReaction);
      setCommentRows((existingComments) => updateCommentReactionState(existingComments, commentId, (comment) => ({
        ...comment,
        liked: Boolean(payload?.liked),
        disliked: Boolean(payload?.disliked),
        like_count: Number(payload?.likeCount || 0),
        dislike_count: Number(payload?.dislikeCount || 0)
      })));
    } catch (error) {
      console.error('Error reacting to comment:', error);
      setCommentRows((existingComments) => updateCommentReactionState(existingComments, commentId, (comment) => ({
        ...comment,
        liked: previousState.liked,
        disliked: previousState.disliked,
        like_count: previousState.like_count,
        dislike_count: previousState.dislike_count
      })));
      setStatusMessage(error instanceof Error ? error.message : 'Comment reaction failed.');
    } finally {
      setPendingCommentReactionIds((existingMap) => {
        const nextMap = { ...existingMap };
        delete nextMap[commentId];
        return nextMap;
      });
    }
  }

  async function handleShareClip() {
    const shareURL = buildAppURL(`/clip/${clip?.id || clipId}`);

    try {
      if (navigator.share) {
        await navigator.share({
          title: clip?.title || 'MacClipper Clip',
          text: clip?.description || 'Watch this MacClipper clip.',
          url: shareURL
        });
        setStatusMessage('Clip shared.');
        return;
      }

      await navigator.clipboard.writeText(shareURL);
      setStatusMessage('Clip link copied.');
    } catch (error) {
      console.error('Error sharing clip:', error);
      setStatusMessage('Share failed in this browser.');
    }
  }

  if (loading && !clip) {
    return (
      <div className="space-y-6">
        <div className="aspect-video animate-pulse rounded-[1.8rem] border border-border bg-muted/60" />
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr),280px]">
          <div className="space-y-3 rounded-[1.8rem] border border-border bg-card p-5 shadow-sm">
            <div className="h-8 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-4 w-full animate-pulse rounded bg-muted" />
            <div className="h-4 w-5/6 animate-pulse rounded bg-muted" />
          </div>
          <div className="rounded-[1.8rem] border border-border bg-card p-5 shadow-sm">
            <div className="h-5 w-28 animate-pulse rounded bg-muted" />
            <div className="mt-4 space-y-3">
              <div className="h-4 w-full animate-pulse rounded bg-muted" />
              <div className="h-4 w-full animate-pulse rounded bg-muted" />
              <div className="h-4 w-4/5 animate-pulse rounded bg-muted" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!clip || errorMessage) {
    return (
      <div className="space-y-5">
        <Link to="/community" className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted">
          <ArrowLeft className="h-4 w-4" />
          Back to Community
        </Link>
        <div className="rounded-[1.8rem] border border-border bg-card p-8 shadow-sm">
          <p className="text-lg font-semibold text-foreground">{errorMessage || 'Clip not found.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link to="/community" className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted">
        <ArrowLeft className="h-4 w-4" />
        Back to Community
      </Link>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr),320px]">
        <section className="space-y-5">
          <div className="overflow-hidden rounded-[1.8rem] border border-border bg-card shadow-sm">
            <video
              src={String(clip.videoURL || clip.videoUrl || clip.content || '').trim()}
              className="aspect-video w-full bg-black object-contain"
              controls
              playsInline
              autoPlay
              onLoadedMetadata={(event) => {
                setDurationSeconds(event.currentTarget.duration || 0);
              }}
            />
          </div>

          <div className="rounded-[1.8rem] border border-border bg-card p-5 shadow-sm">
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground">{clip.title || 'MacClipper Clip'}</h1>

            <div className="mt-5 flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex items-center gap-3">
                {ownerAvatarURL ? (
                  <img src={ownerAvatarURL} alt={ownerName} className="h-12 w-12 rounded-2xl border border-border object-cover" />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl text-sm font-bold text-white" style={ownerAvatarStyle}>
                    {initialsFromName(ownerName)}
                  </div>
                )}
                <div>
                  <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    {ownerId ? <Link to={`/profile/${ownerId}`} className="hover:text-primary">{ownerName}</Link> : ownerName}
                    {ownerVerified ? <span className="clip-verified-badge" title="Verified creator">✓</span> : null}
                    {ownerTag ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-primary">{ownerTag}</span> : null}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {(viewsLoading ? '—' : `${formatCompactNumber(viewCount)} views`)} · {formatRelativeTime(clip.created_at)}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex items-center overflow-hidden rounded-full border border-border bg-background/70 shadow-sm">
                  <button
                    type="button"
                    onClick={handleToggleLike}
                    disabled={!currentUser || reactionBusy.length > 0}
                    className={[
                      'inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold transition-all duration-200',
                      reactionBusy === 'like' ? 'scale-[0.97]' : 'scale-100',
                      liked ? 'bg-foreground text-background' : 'text-foreground hover:bg-muted',
                      !currentUser ? 'opacity-70' : ''
                    ].join(' ')}
                  >
                    <ThumbsUp className="h-4 w-4" />
                    {reactionsLoading ? '—' : formatCompactNumber(likeCount)}
                  </button>
                  <span className="h-6 w-px bg-border" />
                  <button
                    type="button"
                    onClick={handleToggleDislike}
                    disabled={!currentUser || reactionBusy.length > 0}
                    className={[
                      'inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold transition-all duration-200',
                      reactionBusy === 'dislike' ? 'scale-[0.97]' : 'scale-100',
                      disliked ? 'bg-foreground text-background' : 'text-foreground hover:bg-muted',
                      !currentUser ? 'opacity-70' : ''
                    ].join(' ')}
                  >
                    <ThumbsDown className="h-4 w-4" />
                    {reactionsLoading ? '—' : formatCompactNumber(dislikeCount)}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleShareClip}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-background/70 px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
                >
                  <Share2 className="h-4 w-4" />
                  Share
                </button>

                {ownerId ? (
                  <Link to={`/profile/${ownerId}`} className="inline-flex items-center gap-2 rounded-full border border-border bg-background/70 px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted">
                    <UserRoundCheck className="h-4 w-4" />
                    View profile
                  </Link>
                ) : null}
              </div>
            </div>

            <div className="mt-5 rounded-[1.35rem] border border-border bg-background/70 p-4">
              <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5">
                  <Eye className="h-3.5 w-3.5" />
                  {viewsLoading ? '—' : `${formatCompactNumber(viewCount)} views`}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5">
                  <Timer className="h-3.5 w-3.5" />
                  {formatDuration(durationSeconds)}
                </span>
                {clip.game_title ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5">
                    <Gamepad2 className="h-3.5 w-3.5" />
                    {clip.game_title}
                  </span>
                ) : null}
                {clip.category_label ? <span className="inline-flex items-center rounded-full bg-card px-3 py-1.5">{clip.category_label}</span> : null}
              </div>

              <p className="mt-4 whitespace-pre-line text-sm leading-7 text-muted-foreground">
                {clip.description || 'Posted from MacClipper Cloud'}
              </p>

              {statusMessage ? <p className="mt-4 text-sm font-medium text-primary">{statusMessage}</p> : null}
            </div>
          </div>

          <div className="rounded-[1.8rem] border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <MessageCircle className="h-4 w-4 text-primary" />
              Comments
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{formatCompactNumber(commentCount)} public comments on this clip.</p>

            <div className="mt-5 flex gap-3">
              {viewerAvatarURL ? (
                <img src={viewerAvatarURL} alt={displayNameFromUser(currentUser)} className="h-11 w-11 rounded-full border border-border object-cover" />
              ) : (
                <div className="flex h-11 w-11 items-center justify-center rounded-full text-sm font-bold text-white" style={viewerAvatarStyle}>
                  {initialsFromName(displayNameFromUser(currentUser))}
                </div>
              )}

              <form className="flex-1 space-y-3" onSubmit={handleCommentSubmit}>
                <textarea
                  value={commentDraft}
                  onChange={(event) => setCommentDraft(event.target.value)}
                  placeholder={currentUser ? 'Add a comment…' : 'Sign in to join the conversation.'}
                  rows={4}
                  maxLength={1500}
                  disabled={!currentUser || commentBusy}
                  className="min-h-[112px] w-full rounded-[1.2rem] border border-input bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground"
                />
                {commentBusy ? (
                  <div className="overflow-hidden rounded-full bg-muted/80">
                    <div
                      className="h-1.5 rounded-full bg-primary transition-[width] duration-150"
                      style={{ width: `${commentSubmitProgress}%` }}
                    />
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {currentUser ? null : (
                    <Link to="/signin" className="text-xs font-semibold uppercase tracking-[0.18em] text-primary hover:opacity-80">
                      Sign in to comment
                    </Link>
                  )}

                  <div className="flex items-center gap-2">
                    {commentDraft.trim() ? (
                      <button
                        type="button"
                        onClick={() => setCommentDraft('')}
                        className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
                      >
                        Cancel
                      </button>
                    ) : null}
                    <button
                      type="submit"
                      disabled={!currentUser || commentBusy || commentDraft.trim().length === 0}
                      className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-60"
                    >
                      {commentBusy ? 'Posting…' : 'Comment'}
                    </button>
                  </div>
                </div>
              </form>
            </div>

            <div className="mt-5 space-y-3">
              {commentsLoading ? (
                <div className="space-y-4">
                  <div className="flex gap-3">
                    <div className="h-11 w-11 animate-pulse rounded-full bg-muted" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="h-4 w-40 animate-pulse rounded bg-muted" />
                      <div className="h-4 w-full animate-pulse rounded bg-muted" />
                      <div className="h-4 w-4/5 animate-pulse rounded bg-muted" />
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="h-11 w-11 animate-pulse rounded-full bg-muted" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="h-4 w-32 animate-pulse rounded bg-muted" />
                      <div className="h-4 w-full animate-pulse rounded bg-muted" />
                    </div>
                  </div>
                </div>
              ) : comments.length === 0 ? (
                <div className="rounded-xl border border-border bg-background/70 px-4 py-3 text-sm text-muted-foreground">
                  No comments yet. Start the thread.
                </div>
              ) : comments.map((comment) => (
                <article key={comment.id} className="flex gap-3 rounded-[1.15rem] border border-border bg-background/70 px-4 py-4">
                  {comment.authorAvatarURL ? (
                    <img src={comment.authorAvatarURL} alt={comment.authorName} className="h-11 w-11 rounded-full border border-border object-cover" />
                  ) : (
                    <div className="flex h-11 w-11 items-center justify-center rounded-full text-xs font-bold text-white" style={avatarStyleFromSeed(comment.user_id || comment.authorName || comment.id)}>
                      {initialsFromName(comment.authorName)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <strong className="text-sm text-foreground">{comment.isOwnComment ? 'You' : comment.authorName}</strong>
                      <span className="text-xs text-muted-foreground">{formatRelativeTime(comment.created_at)}</span>
                      {comment.pending ? <span className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-primary">Sending</span> : null}
                    </div>
                    <p className="whitespace-pre-line text-sm leading-6 text-muted-foreground">{comment.body}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleCommentReaction(comment.id, 'like')}
                        disabled={!currentUser || Boolean(comment.pending) || Boolean(pendingCommentReactionIds[comment.id])}
                        className={[
                          'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all duration-200',
                          comment.liked ? 'border-foreground bg-foreground text-background' : 'border-border text-foreground hover:bg-muted',
                          pendingCommentReactionIds[comment.id] === 'like' ? 'scale-[0.97]' : 'scale-100',
                          !currentUser ? 'opacity-70' : ''
                        ].join(' ')}
                      >
                        <ThumbsUp className="h-3.5 w-3.5" />
                        {formatCompactNumber(comment.like_count || 0)}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCommentReaction(comment.id, 'dislike')}
                        disabled={!currentUser || Boolean(comment.pending) || Boolean(pendingCommentReactionIds[comment.id])}
                        className={[
                          'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all duration-200',
                          comment.disliked ? 'border-foreground bg-foreground text-background' : 'border-border text-foreground hover:bg-muted',
                          pendingCommentReactionIds[comment.id] === 'dislike' ? 'scale-[0.97]' : 'scale-100',
                          !currentUser ? 'opacity-70' : ''
                        ].join(' ')}
                      >
                        <ThumbsDown className="h-3.5 w-3.5" />
                        {formatCompactNumber(comment.dislike_count || 0)}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
          <div className="rounded-[1.8rem] border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <PlayCircle className="h-4 w-4 text-primary" />
              About this clip
            </div>
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">Visibility</span>
                <span className="font-medium capitalize text-foreground">{clip.visibility || 'public'}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">Posted</span>
                <span className="font-medium text-foreground">{formatRelativeTime(clip.created_at)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">Likes</span>
                <span className="font-medium text-foreground">{reactionsLoading ? '—' : formatCompactNumber(likeCount)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">Dislikes</span>
                <span className="font-medium text-foreground">{reactionsLoading ? '—' : formatCompactNumber(dislikeCount)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">Category</span>
                <span className="font-medium text-foreground">{clip.category_label || 'Highlight'}</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default ClipDetailPage;