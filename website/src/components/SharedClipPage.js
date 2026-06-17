import React, { useEffect, useMemo, useState } from 'react';
import { Copy, Home, LoaderCircle } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { buildCloudAPIURL } from '../lib/appRuntime';
import { copyTextToClipboard } from '../lib/cloudSharedClips';

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return 'Unknown size';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const rounded = value >= 100 || unitIndex === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
}

function formatUploadDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Just now';
  }

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

export default function SharedClipPage({ currentUser }) {
  const { shareId } = useParams();
  const [share, setShare] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [copyStatus, setCopyStatus] = useState('');

  useEffect(() => {
    let isActive = true;

    async function loadShare() {
      setIsLoading(true);
      setErrorMessage('');

      try {
        const response = await fetch(buildCloudAPIURL(`/shared-clips/${encodeURIComponent(shareId)}.json`));
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(payload.error || 'Unable to load this clip right now.');
        }

        if (!isActive) {
          return;
        }

        setShare(payload.share || null);
      } catch (error) {
        if (!isActive) {
          return;
        }

        setShare(null);
        setErrorMessage(error instanceof Error ? error.message : 'Unable to load this clip right now.');
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    if (shareId) {
      void loadShare();
    } else {
      setShare(null);
      setErrorMessage('Clip not found.');
      setIsLoading(false);
    }

    return () => {
      isActive = false;
    };
  }, [shareId]);

  const homePath = currentUser ? '/dashboard' : '/';
  const title = useMemo(() => share?.title || 'MacClipper Clip', [share]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${title} | MacClipper`;

    return () => {
      document.title = previousTitle;
    };
  }, [title]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(41,138,113,0.16),transparent_28%),radial-gradient(circle_at_85%_12%,rgba(232,124,63,0.14),transparent_24%),linear-gradient(180deg,transparent_0%,rgba(0,0,0,0.08)_100%)]" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between gap-4 rounded-3xl border border-border bg-card/90 px-4 py-3 shadow-sm backdrop-blur sm:px-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">MacClipper Cloud</p>
            <h1 className="text-lg font-semibold text-foreground">Shared clip</h1>
          </div>
          <Link
            to={homePath}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
          >
            <Home className="h-4 w-4" />
            Open MacClipper
          </Link>
        </div>

        {isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-5 py-4 text-foreground shadow-sm">
              <LoaderCircle className="h-5 w-5 animate-spin" />
              Loading clip...
            </div>
          </div>
        ) : errorMessage ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="w-full max-w-xl rounded-3xl border border-destructive/30 bg-destructive/10 p-6 text-center shadow-sm">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.28em] text-destructive">Cloud error</p>
              <h2 className="mb-3 text-2xl font-semibold text-foreground">This clip could not be opened.</h2>
              <p className="text-sm text-muted-foreground">{errorMessage}</p>
            </div>
          </div>
        ) : share ? (
          <div className="grid flex-1 gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.8fr)]">
            <section className="overflow-hidden rounded-[2rem] border border-border bg-card shadow-sm">
              <div className="border-b border-border bg-gradient-to-br from-card via-card to-primary/5 px-5 py-4 sm:px-6">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">Clip preview</p>
                <h2 className="mt-2 text-2xl font-semibold text-foreground sm:text-3xl">{share.title}</h2>
                <p className="mt-2 text-sm text-muted-foreground">Open the original MacClipper share in the current site theme with the full-quality hosted video.</p>
              </div>
              <div className="bg-black p-2 sm:p-3">
                <video
                  className="w-full rounded-[1.5rem] bg-black object-contain"
                  src={share.videoURL}
                  controls
                  playsInline
                  preload="auto"
                  style={{ aspectRatio: share.orientation === 'vertical' ? '9 / 16' : '16 / 9' }}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 px-5 pb-5 pt-4 text-xs text-muted-foreground sm:px-6">
                <span className="rounded-full bg-primary/10 px-3 py-1 font-medium text-primary">{share.orientation === 'vertical' ? '9:16 vertical' : '16:9 landscape'}</span>
                <span className="rounded-full bg-secondary px-3 py-1 font-medium text-secondary-foreground">{formatFileSize(share.fileSize)}</span>
                <span className="rounded-full bg-secondary px-3 py-1 font-medium text-secondary-foreground">Uploaded {formatUploadDate(share.uploadedAt)}</span>
              </div>
            </section>

            <aside className="flex flex-col gap-4">
              <div className="glass-card rounded-[2rem] p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">Clip info</p>
                <dl className="mt-4 space-y-4 text-sm text-foreground">
                  <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
                    <dt className="text-muted-foreground">Uploaded</dt>
                    <dd className="text-right">{formatUploadDate(share.uploadedAt)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
                    <dt className="text-muted-foreground">Orientation</dt>
                    <dd className="text-right capitalize">{share.orientation}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
                    <dt className="text-muted-foreground">File</dt>
                    <dd className="max-w-[16rem] truncate text-right">{share.fileName}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">Size</dt>
                    <dd className="text-right">{formatFileSize(share.fileSize)}</dd>
                  </div>
                </dl>
              </div>

              <div className="rounded-[2rem] border border-border bg-card p-5 shadow-sm">
                <div className="flex items-center gap-3 text-foreground">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">Share clip</p>
                    <h3 className="mt-1 text-lg font-semibold">Copy the embeddable link.</h3>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-6 text-muted-foreground">
                  Use the share link when you want Discord to preview the video before someone opens it.
                </p>
                <button
                  type="button"
                  onClick={async () => {
                    const didCopy = await copyTextToClipboard(share.shareURL || share.pageURL);
                    setCopyStatus(didCopy ? 'Share link copied.' : 'Copy failed in this browser.');
                  }}
                  className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
                >
                  <Copy className="h-4 w-4" />
                  Copy Link
                </button>
                {copyStatus ? <p className="mt-3 text-sm text-muted-foreground">{copyStatus}</p> : null}
                <div className="mt-4 rounded-2xl border border-border bg-muted/30 px-4 py-3 text-xs leading-5 text-muted-foreground break-all">
                  {share.shareURL || share.pageURL}
                </div>
              </div>

              <div className="glass-card rounded-[2rem] p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-primary">MacClipper flow</p>
                <h3 className="mt-2 text-lg font-semibold text-foreground">Same clip, current website theme.</h3>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  Shared links now open in the main website experience instead of the older standalone preview layout, while Discord and chat apps still keep the embed metadata they need.
                </p>
              </div>
            </aside>
          </div>
        ) : null}
      </div>
    </div>
  );
}