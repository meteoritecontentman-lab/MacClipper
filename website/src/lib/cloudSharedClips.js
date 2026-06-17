import { buildCloudAPIURL } from './appRuntime';

const COMMUNITY_PUBLISH_TIMEOUT_MS = 15000;

function sharedClipsURL(path = '/shared-clips') {
  return new URL(buildCloudAPIURL(path));
}

export function resolveClipVideoURL(value) {
  return String(value?.videoURL || value?.videoUrl || value?.content || '').trim();
}

export function resolveClipShareLink(value) {
  return String(value?.shareURL || value?.pageURL || '').trim();
}

export async function copyTextToClipboard(value) {
  const text = String(value || '').trim();
  if (!text || typeof window === 'undefined') {
    return false;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }

    const input = document.createElement('textarea');
    input.value = text;
    input.setAttribute('readonly', 'true');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
    return true;
  } catch (error) {
    console.error('Error copying text:', error);
    return false;
  }
}

export async function fetchSharedClips(websiteUserId) {
  if (!websiteUserId) {
    return [];
  }

  const requestURL = sharedClipsURL();
  requestURL.searchParams.set('websiteUserId', websiteUserId);
  requestURL.searchParams.set('cacheBust', String(Date.now()));

  const response = await fetch(requestURL.toString(), {
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`Cloud lookup failed with ${response.status}`);
  }

  const payload = await response.json();
  return Array.isArray(payload.shares) ? payload.shares : [];
}

export async function resolveSharedClipLinks(videoURLs) {
  const normalizedVideoURLs = Array.from(new Set(
    (Array.isArray(videoURLs) ? videoURLs : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  )).slice(0, 120);

  if (normalizedVideoURLs.length === 0) {
    return {};
  }

  const requestURL = sharedClipsURL('/shared-clips/resolve-links');
  const response = await fetch(requestURL.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ videoURLs: normalizedVideoURLs })
  });

  if (!response.ok) {
    throw new Error(`Shared clip link lookup failed with ${response.status}`);
  }

  const payload = await response.json();
  return payload && typeof payload.linksByVideoURL === 'object' && payload.linksByVideoURL
    ? payload.linksByVideoURL
    : {};
}

export function mergeResolvedLinksIntoClips(clips, linksByVideoURL) {
  return (Array.isArray(clips) ? clips : []).map((clip) => {
    const resolvedVideoURL = resolveClipVideoURL(clip);
    const matchedShare = resolvedVideoURL ? linksByVideoURL?.[resolvedVideoURL] : null;

    if (!matchedShare) {
      return clip;
    }

    return {
      ...clip,
      videoURL: clip.videoURL || matchedShare.videoURL || resolvedVideoURL,
      sharedClipId: clip.sharedClipId || matchedShare.id,
      pageURL: clip.pageURL || matchedShare.pageURL,
      shareURL: clip.shareURL || matchedShare.shareURL || matchedShare.pageURL
    };
  });
}

export async function hydrateClipsWithSharedLinks(clips) {
  const linksByVideoURL = await resolveSharedClipLinks((Array.isArray(clips) ? clips : []).map(resolveClipVideoURL));
  return mergeResolvedLinksIntoClips(clips, linksByVideoURL);
}

export function subscribeToSharedClips(websiteUserId, { onShares, onError } = {}) {
  if (!websiteUserId || typeof window === 'undefined') {
    return () => {};
  }

  let active = true;
  let knownIds = [];

  const pollForChanges = async () => {
    while (active) {
      try {
        const requestURL = sharedClipsURL('/shared-clips/wait');
        requestURL.searchParams.set('websiteUserId', websiteUserId);
        if (knownIds.length > 0) {
          requestURL.searchParams.set('knownIds', knownIds.join(','));
        }

        const response = await fetch(requestURL.toString(), {
          cache: 'no-store'
        });

        if (!response.ok) {
          throw new Error(`Shared clip wait failed with ${response.status}`);
        }

        const payload = await response.json();
        const shares = Array.isArray(payload.shares) ? payload.shares : [];
        knownIds = shares.map((share) => share.id).filter(Boolean);
        onShares?.(shares);
      } catch (error) {
        if (active) {
          onError?.(error instanceof Error ? error : new Error('Shared clip wait failed.'));
        }
      }
    }
  };

  void pollForChanges();

  return () => {
    active = false;
  };
}

export async function deleteSharedClipForUser(shareId, websiteUserId) {
  if (!shareId || !websiteUserId) {
    throw new Error('Missing shared clip context.');
  }

  const requestURL = sharedClipsURL(`/shared-clips/${encodeURIComponent(shareId)}`);
  requestURL.searchParams.set('websiteUserId', websiteUserId);

  const response = await fetch(requestURL.toString(), {
    method: 'DELETE'
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Delete failed with ${response.status}`);
  }
}

export async function publishCommunityClip(input) {
  const accessToken = String(input?.accessToken || '').trim();
  if (!accessToken) {
    throw new Error('Missing Supabase access token.');
  }

  const requestURL = sharedClipsURL('/community-clips/publish');
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, COMMUNITY_PUBLISH_TIMEOUT_MS);

  try {
    const response = await fetch(requestURL.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        userId: String(input?.userId || '').trim(),
        content: resolveClipVideoURL(input),
        title: String(input?.title || '').trim(),
        description: String(input?.description || '').trim(),
        gameTitle: String(input?.gameTitle || '').trim(),
        categoryLabel: String(input?.categoryLabel || '').trim()
      }),
      signal: controller.signal
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Community publish failed with ${response.status}`);
    }

    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Community publish timed out after ${COMMUNITY_PUBLISH_TIMEOUT_MS}ms.`);
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}