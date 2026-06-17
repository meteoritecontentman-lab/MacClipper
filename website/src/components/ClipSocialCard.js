import React, { useEffect, useState } from 'react';
import { ArrowUpRight, Bookmark, Eye, Heart, Link2, MessageCircle, Pencil, Play, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { avatarStyleFromSeed, avatarURLFromUser, initialsFromName, isVerifiedProfile } from '../lib/avatarTheme';
import { fetchClipComments, fetchClipLikeSummary, postClipComment, setClipLikePreference } from '../lib/clipSocial';
import ActionMenu from './ActionMenu';

const SOCIAL_SCHEMA_HINT = 'Likes, comments, and follows are not fully live on this build yet.';

function clipOwnerId(clip) {
  return clip.owner_profile_id || clip.user_id || null;
}

function clipCreatedAt(clip) {
  return clip.created_at || clip.inserted_at || clip.uploaded_at || null;
}

function clipTitleValue(clip) {
  if (typeof clip.title === 'string' && clip.title.trim().length > 0) {
    return clip.title.trim();
  }

  if (typeof clip.content === 'string' && clip.content.length > 0) {
    const fileName = clip.content.split('/').pop()?.split('?')[0] || 'MacClipper Clip';
    const readableName = fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim();
    return readableName || 'MacClipper Clip';
  }

  return 'MacClipper Clip';
}

function clipDescriptionValue(clip) {
  if (typeof clip.description === 'string' && clip.description.trim().length > 0) {
    return clip.description.trim();
  }

  return '';
}

function viewerDisplayName(user) {
  if (typeof user?.user_metadata?.full_name === 'string' && user.user_metadata.full_name.trim().length > 0) {
    return user.user_metadata.full_name.trim();
  }

  if (typeof user?.email === 'string' && user.email.includes('@')) {
    return user.email.split('@')[0];
  }

  return 'MacClipper User';
}

function formatRelativeTime(value) {
  if (!value) {
    return 'Ready to share';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Ready to share';
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

  return 'Ready to share';
}

function formatCompactNumber(value) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) {
    return '0';
  }

  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(numericValue);
}

function isMissingSocialSchema(error) {
  const message = String(error?.message || '').toLowerCase();
  const details = String(error?.details || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();

  return code === '42p01'
    || code === '42703'
    || message.includes('does not exist')
    || message.includes('could not find the table')
    || details.includes('does not exist');
}

function ownerNameForClip(ownerProfile, clip, currentUser) {
  if (typeof ownerProfile?.display_name === 'string' && ownerProfile.display_name.trim().length > 0) {
    return ownerProfile.display_name.trim();
  }
  return 'MacClipper Creator';
}

function ownerAvatarURLForClip(ownerProfile, currentUser, ownerId) {
  return typeof ownerProfile?.avatar_url === 'string' ? ownerProfile.avatar_url.trim() : '';
}

function mergeCommentAuthors(comments, profiles, currentUser) {
  const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]));

  return comments.map((comment) => ({
    ...comment,
    authorName: comment.user_id && comment.user_id === currentUser?.id
      ? viewerDisplayName(currentUser)
      : (profileMap.get(comment.user_id)?.display_name || 'MacClipper User')
  }));
}

function ClipSocialCard({
  clip,
  currentUser,
  onClipUpdated,
  onFavouriteRemoved,
  featured = false
}) {
  const ownerId = clipOwnerId(clip);
  const isOwner = Boolean(currentUser?.id && ownerId && currentUser.id === ownerId);
  const canSubscribe = Boolean(currentUser?.id && ownerId && currentUser.id !== ownerId);

  const [ownerProfile, setOwnerProfile] = useState(clip.owner_profile || null);
  const [likeCount, setLikeCount] = useState(0);
  const [liked, setLiked] = useState(false);
  const [commentCount, setCommentCount] = useState(0);
  const [subscriptionCount, setSubscriptionCount] = useState(0);
  const [subscribed, setSubscribed] = useState(false);
  const [favouriteId, setFavouriteId] = useState(null);
  const [comments, setComments] = useState([]);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [socialError, setSocialError] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [titleDraft, setTitleDraft] = useState(clipTitleValue(clip));
  const [descriptionDraft, setDescriptionDraft] = useState(clipDescriptionValue(clip));
  const [showRename, setShowRename] = useState(false);
  const [renameValue, setRenameValue] = useState(clipTitleValue(clip));
  const [renaming, setRenaming] = useState(false);
  const [showPlayer, setShowPlayer] = useState(false);
  const resolvedVideoSrc = String(clip.videoURL || clip.videoUrl || clip.content || '').trim();
  const resolvedShareHref = String(clip.shareURL || clip.pageURL || '').trim();
  const resolvedOpenHref = String(clip.pageURL || clip.shareURL || '').trim();

  useEffect(() => {
    setTitleDraft(clipTitleValue(clip));
    setDescriptionDraft(clipDescriptionValue(clip));
  }, [clip]);

  useEffect(() => {
    let isCancelled = false;

    async function loadSummary() {
      const ownerRequest = ownerId
        ? supabase.from('profiles').select('id, display_name, avatar_url').eq('id', ownerId).maybeSingle()
        : Promise.resolve({ data: null, error: null });
      const likeSummaryRequest = fetchClipLikeSummary(clip.id, currentUser?.id || '').catch((error) => ({ likeCount: 0, liked: false, error }));
      const commentSummaryRequest = fetchClipComments(clip.id, 1).catch((error) => ({ commentCount: 0, comments: [], error }));
      const favouriteRequest = currentUser?.id
        ? supabase.from('favourites').select('id').eq('clip_id', clip.id).eq('user_id', currentUser.id).limit(1).maybeSingle()
        : Promise.resolve({ data: null, error: null });
      const subscriptionCountRequest = ownerId
        ? supabase.from('profile_subscriptions').select('*', { count: 'exact', head: true }).eq('creator_id', ownerId)
        : Promise.resolve({ count: 0, error: null });
      const subscribedRequest = canSubscribe
        ? supabase.from('profile_subscriptions').select('id').eq('creator_id', ownerId).eq('subscriber_id', currentUser.id).limit(1).maybeSingle()
        : Promise.resolve({ data: null, error: null });

      const [
        ownerResult,
        likeSummaryResult,
        commentSummaryResult,
        favouriteResult,
        subscriptionCountResult,
        subscribedResult
      ] = await Promise.all([
        ownerRequest,
        likeSummaryRequest,
        commentSummaryRequest,
        favouriteRequest,
        subscriptionCountRequest,
        subscribedRequest
      ]);

      if (isCancelled) {
        return;
      }

      const errors = [
        ownerResult.error,
        likeSummaryResult.error,
        commentSummaryResult.error,
        favouriteResult.error,
        subscriptionCountResult.error,
        subscribedResult.error
      ].filter(Boolean);

      const schemaError = errors.find(isMissingSocialSchema);
      if (schemaError) {
        setSocialError(SOCIAL_SCHEMA_HINT);
      } else if (errors.length > 0) {
        console.error('Error loading clip social data:', errors);
        setSocialError('Social data is unavailable right now.');
      } else {
        setSocialError('');
      }

      setOwnerProfile(ownerResult.data || null);
  setLikeCount(Number(likeSummaryResult.likeCount || 0));
  setLiked(Boolean(likeSummaryResult.liked));
  setCommentCount(Number(commentSummaryResult.commentCount || 0));
      setFavouriteId(favouriteResult.data?.id || null);
      setSubscriptionCount(subscriptionCountResult.count || 0);
      setSubscribed(Boolean(subscribedResult.data));
    }

    loadSummary();

    return () => {
      isCancelled = true;
    };
  }, [clip.id, currentUser?.id, ownerId, canSubscribe]);

  useEffect(() => {
    let isCancelled = false;

    async function loadComments() {
      if (!commentsOpen || commentsLoaded) {
        return;
      }

      const commentsResult = await fetchClipComments(clip.id, 12).catch((error) => ({ comments: [], commentCount: 0, error }));

      if (isCancelled) {
        return;
      }

      if (commentsResult.error) {
        console.error('Error loading comments:', commentsResult.error);
        setSocialError('Comments are unavailable right now.');
        return;
      }

      const commentRows = commentsResult.comments || [];
      const uniqueUserIds = Array.from(new Set(commentRows.map((comment) => comment.user_id).filter(Boolean)));
      const profilesResult = uniqueUserIds.length > 0
        ? await supabase.from('profiles').select('id, display_name').in('id', uniqueUserIds)
        : { data: [], error: null };

      if (isCancelled) {
        return;
      }

      if (profilesResult.error) {
        console.error('Error loading comment authors:', profilesResult.error);
      }

      setCommentCount(Number(commentsResult.commentCount || commentRows.length || 0));
      setComments(mergeCommentAuthors(commentRows, profilesResult.data || [], currentUser));
      setCommentsLoaded(true);
    }

    loadComments();

    return () => {
      isCancelled = true;
    };
  }, [clip.id, commentsLoaded, commentsOpen]);

  async function reloadComments() {
    setCommentsLoaded(false);
    setComments([]);

    const commentsResult = await fetchClipComments(clip.id, 12).catch((error) => ({ comments: [], commentCount: 0, error }));

    if (commentsResult.error) {
      console.error('Error reloading comments:', commentsResult.error);
      setSocialError('Comments are unavailable right now.');
      return;
    }

    const commentRows = commentsResult.comments || [];
    const uniqueUserIds = Array.from(new Set(commentRows.map((comment) => comment.user_id).filter(Boolean)));
    const profilesResult = uniqueUserIds.length > 0
      ? await supabase.from('profiles').select('id, display_name').in('id', uniqueUserIds)
      : { data: [], error: null };

    if (profilesResult.error) {
      console.error('Error reloading comment authors:', profilesResult.error);
    }

    setCommentCount(Number(commentsResult.commentCount || commentRows.length || 0));
    setComments(mergeCommentAuthors(commentRows, profilesResult.data || [], currentUser));
    setCommentsLoaded(true);
  }

  async function handleCopyURL() {
    try {
      await navigator.clipboard.writeText(resolvedShareHref || resolvedVideoSrc);
      setStatusMessage(resolvedShareHref ? 'Share link copied.' : 'Raw clip URL copied.');
    } catch {
      setStatusMessage('Copy failed in this browser.');
    }
  }

  async function handleToggleLike() {
    if (!currentUser?.id) {
      setStatusMessage('Sign in to react to this clip.');
      return;
    }

    setBusyAction('like');

    try {
      const result = await setClipLikePreference(clip.id, !liked);
      setLiked(Boolean(result?.liked));
      setLikeCount(Number(result?.likeCount || 0));
      setStatusMessage(result?.liked ? 'Clip liked.' : 'Like removed.');
    } catch (error) {
      console.error('Error toggling like:', error);
      setStatusMessage(error instanceof Error ? error.message : 'Like update failed.');
    }

    setBusyAction('');
  }

  async function handleToggleSubscription() {
    if (!ownerId || !currentUser?.id) {
      return;
    }

    setBusyAction('subscribe');

    const request = subscribed
      ? supabase.from('profile_subscriptions').delete().eq('creator_id', ownerId).eq('subscriber_id', currentUser.id)
      : supabase.from('profile_subscriptions').insert([{ creator_id: ownerId, subscriber_id: currentUser.id }]);

    const { error } = await request;
    if (error) {
      if (isMissingSocialSchema(error)) {
        setSocialError(SOCIAL_SCHEMA_HINT);
      } else {
        console.error('Error toggling subscription:', error);
        setStatusMessage('Subscription update failed.');
      }
      setBusyAction('');
      return;
    }

    setSubscribed(!subscribed);
    setSubscriptionCount((count) => Math.max(0, count + (subscribed ? -1 : 1)));
    setStatusMessage(subscribed ? 'Subscription removed.' : 'Creator followed.');
    setBusyAction('');
  }

  async function handleToggleFavourite() {
    if (!currentUser?.id) {
      return;
    }

    setBusyAction('favourite');

    const request = favouriteId
      ? supabase.from('favourites').delete().eq('id', favouriteId)
      : supabase.from('favourites').insert([{ clip_id: clip.id, user_id: currentUser.id }]).select('id').maybeSingle();

    const { data, error } = await request;
    if (error) {
      console.error('Error toggling favourite:', error);
      setStatusMessage('Favourite update failed.');
      setBusyAction('');
      return;
    }

    const nextFavouriteId = favouriteId ? null : data?.id || 'pending';
    setFavouriteId(nextFavouriteId);
    setStatusMessage(favouriteId ? 'Removed from favourites.' : 'Saved to favourites.');
    setBusyAction('');

    if (favouriteId && typeof onFavouriteRemoved === 'function') {
      onFavouriteRemoved(clip.id);
    }
  }

  async function handleCommentSubmit(event) {
    event.preventDefault();
    const body = commentDraft.trim();
    if (!body || !currentUser?.id) {
      return;
    }

    setBusyAction('comment');

    try {
      const result = await postClipComment(clip.id, body);
      setCommentDraft('');
      setCommentCount(Number(result?.commentCount || (commentCount + 1)));
      setCommentsOpen(true);
      await reloadComments();
      setStatusMessage('Comment posted.');
    } catch (error) {
      console.error('Error creating comment:', error);
      setStatusMessage(error instanceof Error ? error.message : 'Comment failed to send.');
    }

    setBusyAction('');
  }

  async function handleSaveDetails() {
    if (!currentUser?.id) {
      return;
    }

    setBusyAction('details');
    const { data, error } = await supabase
      .from('clips')
      .update({
        title: titleDraft.trim() || clipTitleValue(clip),
        description: descriptionDraft.trim() || null,
        owner_profile_id: ownerId || currentUser.id
      })
      .eq('id', clip.id)
      .select('*')
      .maybeSingle();

    if (error) {
      if (isMissingSocialSchema(error)) {
        setSocialError(SOCIAL_SCHEMA_HINT);
      } else {
        console.error('Error saving clip details:', error);
        setStatusMessage('Clip details failed to save.');
      }
      setBusyAction('');
      return;
    }

    setIsEditingDetails(false);
    setShowRename(false);
    setStatusMessage('Clip details saved.');
    setBusyAction('');

    if (typeof onClipUpdated === 'function' && data) {
      onClipUpdated(data);
    }
  }

  async function handleRename() {
    const nextTitle = renameValue.trim();
    if (!nextTitle) {
      return;
    }

    setRenaming(true);

    const { data, error } = await supabase
      .from('clips')
      .update({ title: nextTitle })
      .eq('id', clip.id)
      .select('*')
      .maybeSingle();

    if (error) {
      console.error('Error renaming clip:', error);
      setStatusMessage('Rename failed.');
      setRenaming(false);
      return;
    }

    setShowRename(false);
    setTitleDraft(nextTitle);
    setStatusMessage('Clip renamed.');
    setRenaming(false);

    if (typeof onClipUpdated === 'function' && data) {
      onClipUpdated(data);
    }
  }

  const ownerName = ownerNameForClip(ownerProfile, clip, currentUser);
  const description = clipDescriptionValue(clip);
  const ownerAvatarStyle = avatarStyleFromSeed(ownerProfile?.id || ownerName || ownerId || clip.id);
  const ownerAvatarURL = ownerAvatarURLForClip(ownerProfile, currentUser, ownerId);
  const ownerVerified = isVerifiedProfile(ownerProfile, ownerName);
  const ownerActionItems = isOwner ? [
    {
      label: 'Rename',
      icon: Pencil,
      onSelect: () => {
        setRenameValue(titleDraft);
        setShowRename(true);
      }
    },
    {
      label: 'Edit Details',
      onSelect: () => setIsEditingDetails(true)
    }
  ] : [];
  const cardLink = `/clip/${clip.id}`;

  return (
    <article className={[
      'group overflow-hidden rounded-[1.35rem] border bg-card shadow-sm transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-lg',
      featured
        ? 'border-primary/20 bg-[radial-gradient(circle_at_top_left,rgba(41,138,113,0.12),transparent_30%),hsl(var(--card))]'
        : 'border-border'
    ].join(' ')}>
      <div className="relative">
        {ownerActionItems.length > 0 ? (
          <div className="absolute right-3 top-3 z-10">
            <ActionMenu items={ownerActionItems} />
          </div>
        ) : null}

        <Link to={cardLink} className="block">
          <div className="relative aspect-video overflow-hidden bg-muted/70">
            <video src={resolvedVideoSrc} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" muted playsInline preload="metadata" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/72 via-black/10 to-transparent" />
            <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
              <div className="flex flex-wrap gap-2 pr-12">
                {clip.game_title ? (
                  <span className="inline-flex items-center rounded-full bg-black/45 px-2 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-white/90 backdrop-blur-sm">
                    {clip.game_title}
                  </span>
                ) : null}
                {clip.category_label ? (
                  <span className="inline-flex items-center rounded-full bg-primary/85 px-2 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-primary-foreground">
                    {clip.category_label}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              <span className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/55 text-white shadow-lg backdrop-blur-sm">
                <Play className="ml-0.5 h-4 w-4" />
              </span>
            </div>
          </div>
        </Link>

        <div className="space-y-3 p-3.5">
          <div className="flex items-start gap-3">
            {ownerAvatarURL ? (
              <img src={ownerAvatarURL} alt={ownerName} className="h-10 w-10 shrink-0 rounded-xl border border-border object-cover shadow-sm" />
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xs font-bold text-white shadow-sm" style={ownerAvatarStyle}>
                {initialsFromName(ownerName)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <Link to={cardLink} className="block hover:text-primary">
                <h3 className="line-clamp-2 text-sm font-bold leading-5 text-foreground">{titleDraft}</h3>
              </Link>
              <div className="mt-1 flex items-center gap-2 text-[0.72rem] text-muted-foreground">
                {ownerId ? <Link to={`/profile/${ownerId}`} className="truncate hover:text-foreground">{ownerName}</Link> : <span className="truncate">{ownerName}</span>}
                {ownerVerified ? <span className="clip-verified-badge" title="Verified creator">✓</span> : null}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.72rem] text-muted-foreground">
                <span>{formatRelativeTime(clipCreatedAt(clip))}</span>
                <span className="inline-flex items-center gap-1">
                  <Eye className="h-3 w-3" />
                  {`${formatCompactNumber(clip.view_count || 0)} views`}
                </span>
                <span>{commentCount} comments</span>
                <span>{likeCount} likes</span>
              </div>
            </div>
          </div>
        </div>

        {showRename ? (
          <div className="border-t border-border bg-background/80 p-3.5">
            <div className="space-y-2.5 rounded-[1rem] border border-border bg-card p-3">
              <input
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm font-semibold text-foreground"
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                maxLength={160}
                disabled={renaming}
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  className="rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
                  type="button"
                  onClick={handleRename}
                  disabled={renaming || !renameValue.trim()}
                >
                  {renaming ? 'Saving…' : 'Save'}
                </button>
                <button
                  className="rounded-xl border border-border px-3 py-2 text-xs font-medium text-foreground"
                  type="button"
                  onClick={() => setShowRename(false)}
                  disabled={renaming}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : isEditingDetails ? (
          <div className="border-t border-border bg-background/80 p-3.5">
            <div className="space-y-2.5 rounded-[1rem] border border-border bg-card p-3">
              <input
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm font-semibold text-foreground"
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                maxLength={160}
                placeholder="Clip title"
              />
              <textarea
                className="min-h-[96px] w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
                value={descriptionDraft}
                onChange={(event) => setDescriptionDraft(event.target.value)}
                maxLength={1500}
                placeholder="Add context to this clip"
              />
              <div className="flex gap-2">
                <button
                  className="rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
                  type="button"
                  onClick={handleSaveDetails}
                  disabled={busyAction === 'details'}
                >
                  {busyAction === 'details' ? 'Saving…' : 'Save Details'}
                </button>
                <button
                  className="rounded-xl border border-border px-3 py-2 text-xs font-medium text-foreground"
                  type="button"
                  onClick={() => setIsEditingDetails(false)}
                  disabled={busyAction === 'details'}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {(socialError || statusMessage || description) && !showRename && !isEditingDetails ? (
          <div className="border-t border-border bg-background/80 px-3.5 py-2 text-xs text-muted-foreground">
            {socialError || statusMessage || description}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export default ClipSocialCard;