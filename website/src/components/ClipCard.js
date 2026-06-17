import React, { useEffect, useState } from 'react';
import { Copy, ExternalLink, Play, Star, Pencil } from 'lucide-react';
import { isVerifiedProfile } from '../lib/avatarTheme';
import { supabase } from '../supabaseClient';
import ActionMenu from './ActionMenu';

function clipTitle(clip) {
  if (typeof clip.title === 'string' && clip.title.trim()) {
    return clip.title.trim();
  }

  if (typeof clip.content === 'string' && clip.content.trim()) {
    const fileName = clip.content.split('/').pop()?.split('?')[0] || 'MacClipper Clip';
    return fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ');
  }

  return 'MacClipper Clip';
}

function formatClipDate(value) {
  const parsedDate = new Date(value || Date.now());
  if (Number.isNaN(parsedDate.getTime())) {
    return 'Just now';
  }

  return parsedDate.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function ClipCard({
  clip,
  isFavorite = false,
  onToggleFavorite,
  onDelete,
  onPublish,
  onRename,
  onCopyLink,
  showOpenButton = true,
  showActionMenu = true,
  openHref
}) {
  const [showRename, setShowRename] = useState(false);
  const [renameValue, setRenameValue] = useState(clipTitle(clip));
  const [renaming, setRenaming] = useState(false);
  const [showPlayer, setShowPlayer] = useState(false);
  const ownerName = [
    clip.owner_profile?.display_name,
    clip.owner_display_name,
    clip.ownerName,
    clip.owner_name
  ].find((value) => typeof value === 'string' && value.trim().length > 0)?.trim() || '';
  const ownerProfile = clip.owner_profile || clip.profile || null;
  const ownerVerified = ownerName ? isVerifiedProfile(ownerProfile, ownerName) : false;
  const resolvedVideoSrc = String(clip.videoURL || clip.videoUrl || clip.content || '').trim();
  const resolvedOpenHref = openHref || clip.pageURL || clip.shareURL || resolvedVideoSrc || '';
  const resolvedCopyValue = clip.shareURL || clip.pageURL || clip.content || '';

  const handleCopy = async () => {
    try {
      if (typeof onCopyLink === 'function') {
        await onCopyLink(clip);
        return;
      }

      await navigator.clipboard.writeText(resolvedCopyValue);
    } catch (error) {
      console.error('Error copying clip URL:', error);
    }
  };

  useEffect(() => {
    setRenameValue(clipTitle(clip));
  }, [clip]);

  const actionItems = [
    typeof onToggleFavorite === 'function' ? {
      label: isFavorite ? 'Remove Favorite' : 'Favorite',
      icon: Star,
      onSelect: () => onToggleFavorite(clip.id)
    } : null,
    {
      label: 'Rename',
      icon: Pencil,
      onSelect: () => setShowRename(true)
    },
    typeof onPublish === 'function' ? {
      label: clip.visibility === 'public' ? 'Make Unlisted' : 'Post Online',
      onSelect: () => onPublish(clip)
    } : null,
    typeof onDelete === 'function' ? {
      label: 'Delete',
      onSelect: () => onDelete(clip),
      destructive: true
    } : null
  ].filter(Boolean);

  const handleRename = async () => {
    const nextTitle = renameValue.trim();
    if (!nextTitle) {
      return;
    }

    setRenaming(true);
    try {
      if (typeof onRename === 'function') {
        await onRename(clip, nextTitle);
        setShowRename(false);
        return;
      }

      const { data, error } = await supabase
        .from('clips')
        .update({ title: nextTitle })
        .eq('id', clip.id)
        .select('*')
        .maybeSingle();

      if (error) {
        console.error('Error renaming clip:', error);
        return;
      }

      if (data) {
        setRenameValue(clipTitle(data));
      }

      setShowRename(false);
    } finally {
      setRenaming(false);
    }
  };

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-all duration-300 hover:border-primary/20 hover:shadow-lg">
      {resolvedVideoSrc ? (
        <div className="relative aspect-video overflow-hidden bg-muted">
          {showPlayer ? (
            <video src={resolvedVideoSrc} className="h-full w-full object-contain" controls autoPlay playsInline onEnded={() => setShowPlayer(false)} />
          ) : (
            <>
              <video src={resolvedVideoSrc} className="h-full w-full object-cover" muted playsInline preload="metadata" />
              <button
                type="button"
                className="absolute inset-0 flex items-center justify-center bg-black/10 focus:outline-none"
                aria-label="Play clip"
                onClick={() => setShowPlayer(true)}
                style={{ zIndex: 2 }}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/55 text-white">
                  <Play className="ml-1 h-5 w-5" />
                </div>
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="flex aspect-video items-center justify-center bg-muted text-muted-foreground">
          No preview
        </div>
      )}

      <div className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {showRename ? (
              <div className="flex items-center gap-2">
                <input
                  className="rounded border px-2 py-1 text-base font-bold text-foreground"
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  maxLength={160}
                  disabled={renaming}
                  autoFocus
                />
                <button
                  className="rounded bg-primary px-2 py-1 text-white"
                  onClick={handleRename}
                  disabled={renaming || !renameValue.trim()}
                >
                  {renaming ? 'Saving...' : 'Save'}
                </button>
                <button
                  className="rounded bg-muted px-2 py-1 text-foreground"
                  onClick={() => setShowRename(false)}
                  disabled={renaming}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <h3 className="truncate text-base font-bold text-foreground">{clipTitle(clip)}</h3>
            )}
            {ownerName ? (
              <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{ownerName}</span>
                {ownerVerified ? <span className="clip-verified-badge" title="Verified creator">✓</span> : null}
              </p>
            ) : null}
            <p className="mt-1 text-xs text-muted-foreground">{formatClipDate(clip.created_at || clip.created_date)}</p>
          </div>
          <div className="flex items-center gap-2">
            {typeof onToggleFavorite === 'function' ? (
              <button
                type="button"
                onClick={() => onToggleFavorite(clip.id)}
                className={[
                  'flex h-9 w-9 items-center justify-center rounded-lg border transition-colors',
                  isFavorite ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-background text-muted-foreground hover:bg-muted'
                ].join(' ')}
                aria-label="Toggle favorite"
              >
                <Star className={['h-4 w-4', isFavorite ? 'fill-current' : ''].join(' ')} />
              </button>
            ) : null}
            {showActionMenu ? <ActionMenu items={actionItems} /> : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {clip.game_title ? <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">{clip.game_title}</span> : null}
          {clip.category_label ? <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">{clip.category_label}</span> : null}
          {clip.visibility ? <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium capitalize text-muted-foreground">{clip.visibility}</span> : null}
        </div>

        <div className="flex items-center gap-2">
          {showOpenButton && resolvedOpenHref ? (
            <a
              href={resolvedOpenHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <ExternalLink className="h-4 w-4" />
              Open
            </a>
          ) : null}
          <button
            type="button"
            onClick={handleCopy}
            className={[
              'inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted',
              !showOpenButton || !resolvedOpenHref ? 'flex-1' : ''
            ].join(' ')}
          >
            <Copy className="h-4 w-4" />
            Copy Link
          </button>
        </div>
      </div>
    </article>
  );
}

export default ClipCard;