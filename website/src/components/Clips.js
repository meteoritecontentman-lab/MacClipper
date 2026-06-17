import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Upload, Cloud, Copy, Trash2, Pencil, Play } from 'lucide-react';
import { supabase } from '../supabaseClient';
import ClipCard from './ClipCard';
import ActionMenu from './ActionMenu';
import { categoriesForGame, defaultGameTitle, featuredGames, gameDisplayNameWithIcon, gameIconForTitle } from '../lib/gameCatalog';
import { clearLinkedAppState, readLinkedAppState, saveLinkedAppState, subscribeToLinkedAppState } from '../lib/appLinkState';
import { hasPaidSubscription } from '../lib/accountState';
import { fetchEntitlementsByAppUuid, hasProEntitlement } from '../lib/cloudAccount';
import { syncSupabaseProfile } from '../lib/profileSync';
import { resolveSupabaseSession } from '../lib/supabaseSession';
import {
  copyTextToClipboard,
  deleteSharedClipForUser,
  fetchSharedClips,
  hydrateClipsWithSharedLinks,
  publishCommunityClip,
  resolveClipShareLink,
  subscribeToSharedClips
} from '../lib/cloudSharedClips';

const FREE_UPLOAD_LIMIT = 10;
const CLOUD_POST_TIMEOUT_MS = 45000;
function formatCloudClipTime(value) {
  const parsedDate = new Date(value);
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

function formatCloudClipSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return 'Unknown size';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const roundedSize = size >= 100 || unitIndex === 0 ? Math.round(size) : Math.round(size * 10) / 10;
  return `${roundedSize} ${units[unitIndex]}`;
}

function resolveCloudShareVideoURL(share) {
  return String(share?.videoURL || share?.videoUrl || share?.content || '').trim();
}

function formatPostLogEntry(message, details) {
  const timestamp = new Date().toISOString();

  if (details === undefined) {
    return `[${timestamp}] ${message}`;
  }

  try {
    return `[${timestamp}] ${message} ${JSON.stringify(details)}`;
  } catch {
    return `[${timestamp}] ${message}`;
  }
}

function resolveClientBundleSource() {
  if (typeof document === 'undefined') {
    return null;
  }

  const scripts = Array.from(document.scripts || []);
  const bundleScript = scripts
    .map((script) => String(script?.src || '').trim())
    .find((src) => src.includes('/static/js/main.'));

  return bundleScript || null;
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
    console.error('Error reading stored Supabase auth token:', error);
  }

  return '';
}

async function resolveSupabaseAccessToken() {
  const sessionResolution = await resolveSupabaseSession();
  const accessToken = String(sessionResolution?.accessToken || '').trim();

  if (accessToken) {
    return {
      accessToken,
      source: sessionResolution?.source || 'unavailable',
      error: sessionResolution?.error || null
    };
  }

  return {
    accessToken: '',
    source: sessionResolution?.source || 'unavailable',
    error: sessionResolution?.error || null
  };
}

function profileDisplayName(user) {
  const metadata = user?.user_metadata ?? {};
  const fullName = [metadata.full_name, metadata.name, metadata.user_name]
    .find((value) => typeof value === 'string' && value.trim().length > 0);

  if (fullName) {
    return fullName.trim();
  }

  if (typeof user?.email === 'string' && user.email.includes('@')) {
    return user.email.split('@')[0];
  }

  return 'MacClipper User';
}

async function retrySupabase(operation, {
  retries = 2,
  baseDelayMs = 500,
  timeoutMs = 8000,
  onAttemptError
} = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    let result;
    try {
      result = await operation(controller.signal);
    } catch (error) {
      const isAbortError = error instanceof Error && error.name === 'AbortError';
      result = {
        data: null,
        error: {
          message: isAbortError
            ? `Request timed out after ${timeoutMs}ms.`
            : (error instanceof Error ? error.message : 'Request failed.'),
          code: isAbortError ? 'request_timeout' : 'request_exception'
        }
      };
    } finally {
      window.clearTimeout(timeoutId);
    }

    if (!result?.error) {
      return result;
    }

    lastError = result.error;
    if (typeof onAttemptError === 'function') {
      onAttemptError(lastError, attempt, retries);
    }

    if (attempt < retries) {
      await new Promise((resolve) => window.setTimeout(resolve, baseDelayMs * attempt));
    }
  }

  return { data: null, error: lastError };
}

function isSchemaError(error) {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();

  return code === '42703' || code === '42p01' || message.includes('column') || message.includes('does not exist') || message.includes('could not find the table');
}

function Clips({ currentUser = null, authResolved = false }) {
  const navigate = useNavigate();
  const [clips, setClips] = useState([]);
  const [favoriteIds, setFavoriteIds] = useState([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [linkedCloudClips, setLinkedCloudClips] = useState([]);
  const [linkedCloudStatus, setLinkedCloudStatus] = useState('idle');
  const [lastLinkedCloudSync, setLastLinkedCloudSync] = useState('');
  const [uploading, setUploading] = useState(false);
  const [selectedGame, setSelectedGame] = useState(defaultGameTitle);
  const [selectedCategory, setSelectedCategory] = useState(categoriesForGame(defaultGameTitle)[0]);
  const [titleDraft, setTitleDraft] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [visibility, setVisibility] = useState('unlisted');
  const [uploadStatus, setUploadStatus] = useState('');
  const [linkedAppState, setLinkedAppState] = useState(() => readLinkedAppState(currentUser?.id));
  const [selectedCloudShareId, setSelectedCloudShareId] = useState('');
  const [postDialogOpen, setPostDialogOpen] = useState(false);
  const [postingCloudClip, setPostingCloudClip] = useState(false);
  const [postTargetShare, setPostTargetShare] = useState(null);
  const [postTitleDraft, setPostTitleDraft] = useState('');
  const [postDescriptionDraft, setPostDescriptionDraft] = useState('');
  const [postGameDraft, setPostGameDraft] = useState(defaultGameTitle);
  const [postCategoryDraft, setPostCategoryDraft] = useState(categoriesForGame(defaultGameTitle)[0]);
  const [playingCloudShareId, setPlayingCloudShareId] = useState('');
  const [postLogs, setPostLogs] = useState([]);
  const [postLogsOpen, setPostLogsOpen] = useState(false);
  const lastLinkedCloudIdsRef = useRef([]);
  const user = authResolved ? currentUser : undefined;

  const appendPostLog = useCallback((message, details) => {
    setPostLogs((existingLogs) => [...existingLogs, formatPostLogEntry(message, details)].slice(-80));
  }, []);

  const fetchClips = useCallback(async (userId) => {
    setLoading(true);
    const { data, error } = await supabase
      .from('clips')
      .select('*')
      .or(`user_id.eq.${userId},owner_profile_id.eq.${userId}`)
      .order('created_at', { ascending: false });
    if (error) console.error('Error fetching clips:', error);
    else {
      const hydratedClips = await hydrateClipsWithSharedLinks(data || []).catch((resolveError) => {
        console.error('Error resolving shared clip links for My Clips:', resolveError);
        return data || [];
      });
      setClips(hydratedClips);
    }

    const favouritesResult = await supabase
      .from('favourites')
      .select('clip_id')
      .eq('user_id', userId);

    if (favouritesResult.error) {
      console.error('Error fetching favourites:', favouritesResult.error);
    } else {
      setFavoriteIds((favouritesResult.data || []).map((item) => item.clip_id));
    }

    setLoading(false);
  }, []);

  const fetchLinkedCloudClips = useCallback(async (websiteUserId, { background = false } = {}) => {
    if (!websiteUserId) {
      return { ok: false, newShareCount: 0, totalShares: 0 };
    }

    setLinkedCloudStatus((currentStatus) => {
      if (background && (currentStatus === 'ready' || currentStatus === 'refreshing')) {
        return 'refreshing';
      }

      return 'loading';
    });

    try {
      const nextShares = await fetchSharedClips(websiteUserId);
      const nextShareIds = nextShares.map((share) => share.id).filter(Boolean);
      const previousShareIds = lastLinkedCloudIdsRef.current;
      const newShareCount = previousShareIds.length > 0
        ? nextShareIds.filter((shareId) => !previousShareIds.includes(shareId)).length
        : 0;

      lastLinkedCloudIdsRef.current = nextShareIds;
      setLinkedCloudClips(nextShares);
      setLinkedCloudStatus('ready');
      setLastLinkedCloudSync(new Date().toISOString());

      if (background && newShareCount > 0) {
        setUploadStatus(newShareCount === 1 ? 'A fresh Mac cloud clip just landed.' : `${newShareCount} fresh Mac cloud clips just landed.`);
      }

      return {
        ok: true,
        newShareCount,
        totalShares: nextShares.length
      };
    } catch (error) {
      console.error('Error fetching linked cloud clips:', error);

      if (!background) {
        setLinkedCloudClips([]);
        setLinkedCloudStatus('error');
      } else {
        setLinkedCloudStatus((currentStatus) => currentStatus === 'idle' ? 'error' : 'ready');
      }

      return { ok: false, newShareCount: 0, totalShares: linkedCloudClips.length };
    }
  }, [linkedCloudClips.length]);

  useEffect(() => {
    if (!authResolved) {
      return;
    }

    if (currentUser?.id) {
      fetchClips(currentUser.id);
      fetchLinkedCloudClips(currentUser.id);
      return;
    }

    setClips([]);
    setLinkedCloudClips([]);
    setLinkedCloudStatus('idle');
    setLastLinkedCloudSync('');
    lastLinkedCloudIdsRef.current = [];
  }, [authResolved, currentUser, fetchClips, fetchLinkedCloudClips]);

  useEffect(() => {
    const nextState = readLinkedAppState(currentUser?.id);
    setLinkedAppState(nextState);

    return subscribeToLinkedAppState(currentUser?.id, setLinkedAppState);
  }, [currentUser?.id]);

  useEffect(() => {
    if (!linkedAppState.appUuid || !currentUser?.id) {
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
        console.error('Error syncing linked app entitlements:', error);
      }
    };

    void syncEntitlements();

    return () => {
      active = false;
    };
  }, [currentUser?.id, linkedAppState.appUuid, linkedAppState.linkedAt]);

  useEffect(() => {
    if (!authResolved || !currentUser?.id) {
      return undefined;
    }

    return subscribeToSharedClips(currentUser.id, {
      onShares: (shares) => {
        const nextShareIds = shares.map((share) => share.id).filter(Boolean);
        const previousShareIds = lastLinkedCloudIdsRef.current;
        const newShareCount = previousShareIds.length > 0
          ? nextShareIds.filter((shareId) => !previousShareIds.includes(shareId)).length
          : 0;

        lastLinkedCloudIdsRef.current = nextShareIds;
        setLinkedCloudClips(shares);
        setLinkedCloudStatus('ready');
        setLastLinkedCloudSync(new Date().toISOString());

        if (newShareCount > 0) {
          setUploadStatus(newShareCount === 1 ? 'A fresh Mac cloud clip just landed.' : `${newShareCount} fresh Mac cloud clips just landed.`);
        }
      },
      onError: (error) => {
        console.error('Error streaming linked cloud clips:', error);
        setLinkedCloudStatus((currentStatus) => currentStatus === 'idle' ? 'error' : currentStatus);
      }
    });
  }, [authResolved, currentUser?.id, fetchLinkedCloudClips]);

  useEffect(() => {
    const nextCategories = categoriesForGame(selectedGame);
    setSelectedCategory((currentValue) => nextCategories.includes(currentValue) ? currentValue : nextCategories[0]);
  }, [selectedGame]);

  useEffect(() => {
    const nextCategories = categoriesForGame(postGameDraft);
    setPostCategoryDraft((currentValue) => nextCategories.includes(currentValue) ? currentValue : nextCategories[0]);
  }, [postGameDraft]);

  useEffect(() => {
    if (!postDialogOpen) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        closePostCloudDialog();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [postDialogOpen, postingCloudClip]);

  const handleToggleFavorite = async (clipId) => {
    if (!user?.id) {
      return;
    }

    const alreadyFavorited = favoriteIds.includes(clipId);
    if (alreadyFavorited) {
      const { error } = await supabase.from('favourites').delete().eq('clip_id', clipId).eq('user_id', user.id);
      if (error) {
        console.error('Error removing favourite:', error);
        return;
      }
      setFavoriteIds((existingIds) => existingIds.filter((value) => value !== clipId));
      return;
    }

    const { error } = await supabase.from('favourites').insert([{ clip_id: clipId, user_id: user.id }]);
    if (error) {
      console.error('Error adding favourite:', error);
      return;
    }
    setFavoriteIds((existingIds) => [...existingIds, clipId]);
  };

  const handleCopyCloudLink = async (share) => {
    const didCopy = await copyTextToClipboard(share.shareURL || share.pageURL);
    setUploadStatus(didCopy ? 'Cloud link copied.' : 'Copy failed in this browser.');
  };

  const handleDeleteCloudLink = async (share) => {
    if (!user?.id) {
      return;
    }

    const confirmed = window.confirm(`Delete ${share.title || 'this cloud clip'}?`);
    if (!confirmed) {
      return;
    }

    const previousShares = linkedCloudClips;
    setLinkedCloudClips((existingShares) => existingShares.filter((item) => item.id !== share.id));

    try {
      await deleteSharedClipForUser(share.id, user.id);
      setUploadStatus('Cloud clip deleted.');
    } catch (error) {
      console.error('Error deleting linked cloud clip:', error);
      setLinkedCloudClips(previousShares);
      setUploadStatus('That cloud clip could not be deleted right now.');
    }
  };

  const handleRenameCloudLink = async (share) => {
    if (!user?.id) {
      return;
    }

    const currentTitle = String(share?.title || share?.fileName || 'MacClipper Cloud Clip').trim();
    const requestedTitle = window.prompt('Rename clip', currentTitle);
    if (requestedTitle == null) {
      return;
    }

    const trimmedTitle = requestedTitle.trim();
    if (!trimmedTitle) {
      setUploadStatus('Clip title cannot be empty.');
      return;
    }

    setLinkedCloudClips((existingShares) => existingShares.map((item) => item.id === share.id ? { ...item, title: trimmedTitle } : item));
    setUploadStatus('Cloud clip renamed.');

    const videoURL = resolveCloudShareVideoURL(share);
    if (!videoURL) {
      return;
    }

    const updateResult = await supabase
      .from('clips')
      .update({ title: trimmedTitle })
      .eq('user_id', user.id)
      .eq('content', videoURL)
      .select('id, title, content');

    if (updateResult.error) {
      console.error('Error syncing cloud clip rename to posted clips:', updateResult.error);
      return;
    }

    const updatedRows = Array.isArray(updateResult.data) ? updateResult.data : [];
    if (updatedRows.length > 0) {
      setClips((existingClips) => existingClips.map((clip) => {
        const updated = updatedRows.find((row) => row.id === clip.id);
        return updated ? { ...clip, ...updated } : clip;
      }));
    }
  };

  const openPostCloudDialog = (share) => {
    const videoURL = resolveCloudShareVideoURL(share);
    if (!videoURL) {
      setUploadStatus('This cloud clip is still syncing and has no video URL yet. Try again in a moment.');
      return;
    }

    setPostLogs([
      formatPostLogEntry('Post logger ready.', {
        clientMarker: 'post-log-v2',
        origin: typeof window !== 'undefined' ? window.location.origin : null,
        path: typeof window !== 'undefined' ? `${window.location.pathname || ''}${window.location.search || ''}${window.location.hash || ''}` : null,
        bundle: resolveClientBundleSource()
      }),
      formatPostLogEntry('Opened post dialog.', {
        shareId: share.id || null,
        title: share.title || share.fileName || 'MacClipper Cloud Clip',
        videoURL,
        shareURL: resolveClipShareLink(share) || null
      })
    ]);
    setPostLogsOpen(false);
    const fallbackTitle = (share.title || share.fileName || 'MacClipper Cloud Clip').trim();
    setPostTargetShare(share);
    setPostTitleDraft(fallbackTitle);
    setPostDescriptionDraft('Posted from MacClipper Cloud');
    setPostGameDraft(selectedGame);
    setPostCategoryDraft(selectedCategory);
    setPostDialogOpen(true);
  };

  const closePostCloudDialog = () => {
    if (postingCloudClip) {
      return;
    }

    setPostDialogOpen(false);
    setPostTargetShare(null);
  };

  const handlePostCloudShare = async (share, metadata = {}) => {
    const videoURL = resolveCloudShareVideoURL(share);
    if (!user?.id || !videoURL) {
      appendPostLog('Blocked post because required context was missing.', {
        hasUserId: Boolean(user?.id),
        hasVideoURL: Boolean(videoURL)
      });
      setUploadStatus('This cloud clip is missing a video URL and cannot be posted right now.');
      return false;
    }

    const clipTitle = String(metadata.title || share.title || share.fileName || 'MacClipper Cloud Clip').trim();
    const description = String(metadata.description || '').trim();
    const gameTitle = String(metadata.gameTitle || selectedGame || defaultGameTitle).trim() || defaultGameTitle;
    const categoryLabel = String(metadata.categoryLabel || '').trim() || categoriesForGame(gameTitle)[0];
    try {
      appendPostLog('Starting clip post.', {
        shareId: share.id || null,
        clipTitle,
        gameTitle,
        categoryLabel,
        videoURL
      });

      // Do not block clip posting on profile sync. The social feed already falls back
      // to clip.user_id when owner_profile_id is missing, and App.js syncs profiles on auth.
      appendPostLog('Refreshing Supabase profile in the background.');
      void syncSupabaseProfile(user)
        .then(({ data, error }) => {
          if (error) {
            console.error('Error ensuring profile before posting:', error);
            appendPostLog('Background profile sync returned an error.', {
              message: error.message || 'unknown error',
              code: error.code || null
            });
            return;
          }

          appendPostLog('Background profile sync completed.', {
            ownerProfileId: data?.id || null
          });
        })
        .catch((profileError) => {
          console.error('Unexpected profile sync error before posting:', profileError);
          appendPostLog('Background profile sync threw unexpectedly.', {
            message: profileError instanceof Error ? profileError.message : 'Unknown error'
          });
        });

      const localDuplicate = clips.find((clip) => clip.user_id === user.id && clip.content === videoURL);

      appendPostLog('Checked local clip cache.', {
        duplicateClipId: localDuplicate?.id || null,
        duplicateVisibility: localDuplicate?.visibility || null
      });

      appendPostLog('Resolving Supabase publish session.');
      const sessionResolution = await resolveSupabaseAccessToken();
      const accessToken = sessionResolution.accessToken || '';
      if (!accessToken) {
        appendPostLog('Missing Supabase session for API publish.', {
          source: sessionResolution.source,
          hasSessionError: Boolean(sessionResolution.error),
          message: sessionResolution.error instanceof Error ? sessionResolution.error.message : sessionResolution.error?.message || null,
          code: sessionResolution.error instanceof Error ? null : sessionResolution.error?.code || null
        });
        setUploadStatus('Your session expired. Sign in again and retry.');
        return false;
      }

      appendPostLog('Resolved Supabase publish session.', {
        source: sessionResolution.source
      });

      appendPostLog('Sending publish request through MacClipper API.', {
        shareId: share.id || null,
        hasLocalDuplicate: Boolean(localDuplicate)
      });

      const publishResult = await publishCommunityClip({
        accessToken,
        userId: user.id,
        content: videoURL,
        title: clipTitle,
        description,
        gameTitle,
        categoryLabel
      });

      appendPostLog('Publish API completed.', {
        mode: publishResult.mode || null,
        clipId: publishResult.clip?.id || null
      });

      const postedClipId = publishResult.clip?.id || localDuplicate?.id || null;

      if (publishResult.mode === 'already-public') {
        setUploadStatus('That cloud clip is already live in the community feed.');
        return {
          ok: true,
          alreadyPublic: true,
          clipId: postedClipId,
          clip: publishResult.clip || localDuplicate || null
        };
      }

      if (publishResult.clip?.id) {
        const nextClip = {
          ...publishResult.clip,
          pageURL: share.pageURL,
          shareURL: share.shareURL || share.pageURL,
          sharedClipId: share.id
        };

        setClips((existingClips) => {
          const existingIndex = existingClips.findIndex((clip) => clip.id === nextClip.id || (clip.user_id === user.id && clip.content === videoURL));
          if (existingIndex === -1) {
            return [nextClip, ...existingClips];
          }

          return existingClips.map((clip, index) => index === existingIndex ? { ...clip, ...nextClip } : clip);
        });
      } else {
        void fetchClips(user.id);
      }

      setUploadStatus('Posted to the public website feed.');
      return {
        ok: true,
        clipId: postedClipId,
        clip: publishResult.clip || null
      };
    } catch (error) {
      console.error('Error posting cloud clip:', error);
      appendPostLog('Publish API request failed.', {
        message: error instanceof Error ? error.message : 'Unknown error'
      });
      setUploadStatus(`Posting failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  };

  const submitPostCloudDialog = async () => {
    if (!postTargetShare || postingCloudClip) {
      return;
    }

    setPostingCloudClip(true);
    setUploadStatus('');
    appendPostLog('Submitting post dialog.', {
      shareId: postTargetShare.id || null,
      title: postTitleDraft,
      game: postGameDraft,
      category: postCategoryDraft
    });
    const failsafeId = window.setTimeout(() => {
      setPostingCloudClip(false);
      appendPostLog('Posting timed out after the failsafe window.');
      setUploadStatus('Posting timed out. Please try again.');
    }, CLOUD_POST_TIMEOUT_MS + 500);

    try {
      const postResult = await handlePostCloudShare(postTargetShare, {
        title: postTitleDraft,
        description: postDescriptionDraft,
        gameTitle: postGameDraft,
        categoryLabel: postCategoryDraft
      });

      if (postResult?.ok) {
        const postedTitle = String(postTitleDraft || postTargetShare?.title || 'your clip').trim();
        const resolvedVideoURL = resolveCloudShareVideoURL(postTargetShare);
        const postedClipPreview = {
          ...(postResult.clip || {}),
          id: postResult.clipId || postResult.clip?.id || postTargetShare.id || null,
          user_id: user?.id || postResult.clip?.user_id || null,
          owner_profile_id: postResult.clip?.owner_profile_id || user?.id || null,
          content: postResult.clip?.content || resolvedVideoURL,
          videoURL: postResult.clip?.videoURL || resolvedVideoURL,
          title: postedTitle || postResult.clip?.title || postTargetShare?.title || 'MacClipper Clip',
          description: String(postDescriptionDraft || postResult.clip?.description || '').trim(),
          game_title: String(postGameDraft || postResult.clip?.game_title || '').trim() || null,
          category_label: String(postCategoryDraft || postResult.clip?.category_label || '').trim() || null,
          visibility: 'public',
          created_at: postResult.clip?.created_at || new Date().toISOString(),
          pageURL: postTargetShare?.pageURL || postResult.clip?.pageURL || '',
          shareURL: postTargetShare?.shareURL || postTargetShare?.pageURL || postResult.clip?.shareURL || '',
          sharedClipId: postTargetShare?.id || null
        };
        const notice = postResult.alreadyPublic
          ? (postedTitle
            ? `That clip is already live in Community: ${postedTitle}. Jumped to it for you.`
            : 'That clip is already live in Community. Jumped to it for you.')
          : (postedTitle
            ? `Your clip was posted: ${postedTitle}. You can now watch it in Community and visit the creator profile.`
            : 'Your clip was posted. You can now watch it in Community and visit the creator profile.');
        appendPostLog(postResult.alreadyPublic ? 'Clip was already public.' : 'Post completed successfully.', {
          shareId: postTargetShare.id || null,
          postedTitle: postedTitle || null,
          clipId: postResult.clipId || null,
          alreadyPublic: Boolean(postResult.alreadyPublic)
        });
        setPostDialogOpen(false);
        setPostTargetShare(null);
        navigate('/community', {
          state: {
            postNotice: notice,
            postedClipId: postResult.clipId || null,
            postedClipPreview
          }
        });
      }
    } catch (err) {
      console.error('Unexpected post error:', err);
      appendPostLog('submitPostCloudDialog caught an unexpected error.', {
        message: err instanceof Error ? err.message : 'Unknown error'
      });
      setUploadStatus('An unexpected error occurred. Please try again.');
    } finally {
      window.clearTimeout(failsafeId);
      setPostingCloudClip(false);
    }
  };

  const handlePostSelectedCloudClip = () => {
    const selected = linkedCloudClips.find((share) => share.id === selectedCloudShareId);
    if (!selected) {
      setUploadStatus('Select one cloud clip first, then post it.');
      return;
    }

    openPostCloudDialog(selected);
  };

  const handleDeleteHostedClip = async (clip) => {
    if (!user?.id) {
      return;
    }

    const confirmed = window.confirm(`Delete ${clip.title || 'this clip'}?`);
    if (!confirmed) {
      return;
    }

    const previousClips = clips;
    const previousFavoriteIds = favoriteIds;
    setClips((existingClips) => existingClips.filter((item) => item.id !== clip.id));
    setFavoriteIds((existingIds) => existingIds.filter((value) => value !== clip.id));

    const storageMarker = '/storage/v1/object/public/clips/';
    let storagePath = '';

    try {
      const clipURL = new URL(clip.content || '');
      const markerIndex = clipURL.pathname.indexOf(storageMarker);
      if (markerIndex >= 0) {
        storagePath = decodeURIComponent(clipURL.pathname.slice(markerIndex + storageMarker.length));
      }
    } catch {
      storagePath = '';
    }

    const deleteResult = await supabase.from('clips').delete().eq('id', clip.id).eq('user_id', user.id);
    if (deleteResult.error) {
      console.error('Error deleting hosted clip:', deleteResult.error);
      setClips(previousClips);
      setFavoriteIds(previousFavoriteIds);
      return;
    }

    if (storagePath) {
      const storageResult = await supabase.storage.from('clips').remove([storagePath]);
      if (storageResult.error) {
        console.error('Error removing hosted clip asset:', storageResult.error);
      }
    }
  };

  const handlePublishHostedClip = async (clip) => {
    if (!user?.id) {
      return;
    }

    const nextVisibility = clip.visibility === 'public' ? 'unlisted' : 'public';
    const updateResult = await supabase
      .from('clips')
      .update({ visibility: nextVisibility })
      .eq('id', clip.id)
      .eq('user_id', user.id)
      .select('*')
      .maybeSingle();

    if (updateResult.error) {
      console.error('Error updating clip visibility:', updateResult.error);
      return;
    }

    if (updateResult.data) {
      setClips((existingClips) => existingClips.map((item) => item.id === clip.id ? { ...item, ...updateResult.data } : item));
    }
  };

  const handleRenameHostedClip = async (clip, nextTitle) => {
    if (!user?.id) {
      return;
    }

    const trimmedTitle = String(nextTitle || '').trim();
    if (!trimmedTitle) {
      return;
    }

    const updateResult = await supabase
      .from('clips')
      .update({ title: trimmedTitle })
      .eq('id', clip.id)
      .eq('user_id', user.id)
      .select('*')
      .maybeSingle();

    if (updateResult.error) {
      console.error('Error renaming hosted clip:', updateResult.error);
      return;
    }

    if (updateResult.data) {
      setClips((existingClips) => existingClips.map((item) => item.id === clip.id ? { ...item, ...updateResult.data } : item));
    }
  };

  const uploadClip = async (event) => {
    const file = event.target.files[0];
    if (!file || !user) return;

    if (!linkedAppState.linked) {
      setUploadStatus('Link MacClipper and save your App UUID before uploading a hosted clip.');
      event.target.value = '';
      return;
    }

    const persistedClipCount = clips.filter((clip) => !String(clip.id).startsWith('draft-')).length;
    const uploadBlocked = !hasProAccess(user) && persistedClipCount >= FREE_UPLOAD_LIMIT;

    if (uploadBlocked) {
      setUploadStatus('You have used the 10 hosted uploads in the free plan. Pro removes the cap once billing is live.');
      event.target.value = '';
      return;
    }

    setUploading(true);
    setUploadStatus('Clip landed. Finalizing share page.');
    const fileExt = file.name.split('.').pop();
    const fileName = `${user.id}/${Date.now()}.${fileExt}`;
    const fallbackTitle = titleDraft.trim() || file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim() || 'MacClipper Clip';
    const previewURL = URL.createObjectURL(file);
    const optimisticId = `draft-${Date.now()}`;

    setClips((existingClips) => ([
      {
        id: optimisticId,
        content: previewURL,
        user_id: user.id,
        owner_profile_id: user.id,
        title: fallbackTitle,
        description: descriptionDraft.trim(),
        visibility,
        game_title: selectedGame,
        category_label: selectedCategory,
        created_at: new Date().toISOString()
      },
      ...existingClips
    ]));

    const { error } = await supabase.storage
      .from('clips')
      .upload(fileName, file);

    if (error) {
      console.error('Error uploading:', error);
      setClips((existingClips) => existingClips.filter((clip) => clip.id !== optimisticId));
      URL.revokeObjectURL(previewURL);
      setUploadStatus('The upload missed this time. Try again in a moment.');
      event.target.value = '';
      setUploading(false);
      return;
    }

    const { data: urlData } = supabase.storage
      .from('clips')
      .getPublicUrl(fileName);

    let dbError;
    let insertedClip = null;

    const primaryInsert = await supabase
      .from('clips')
      .insert([{
        content: urlData.publicUrl,
        user_id: user.id,
        owner_profile_id: user.id,
        title: fallbackTitle,
        description: descriptionDraft.trim() || null,
        visibility,
        game_title: selectedGame,
        category_label: selectedCategory
      }])
      .select('*')
      .maybeSingle();

    dbError = primaryInsert.error;
    insertedClip = primaryInsert.data;

    if (dbError && /column .* does not exist|could not find the table/i.test(String(dbError.message || ''))) {
      const fallbackInsert = await supabase
        .from('clips')
        .insert([{ content: urlData.publicUrl, user_id: user.id }]);
      dbError = fallbackInsert.error;
    }

    if (dbError) {
      console.error('Error saving to DB:', dbError);
      setClips((existingClips) => existingClips.filter((clip) => clip.id !== optimisticId));
      setUploadStatus('Upload finished, but the dashboard card failed.');
    } else if (insertedClip) {
      setClips((existingClips) => existingClips.map((clip) => clip.id === optimisticId ? insertedClip : clip));
      setUploadStatus('Your clip is live and ready to share.');
    } else {
      await fetchClips(user.id);
      setUploadStatus('Your clip is live and ready to share.');
    }

    URL.revokeObjectURL(previewURL);
    setTitleDraft('');
    setDescriptionDraft('');
    setVisibility('unlisted');
    event.target.value = '';
    setUploading(false);
  };

  const persistedClipCount = clips.filter((clip) => !String(clip.id).startsWith('draft-')).length;
  const proAccess = linkedAppState.linked
    ? hasProEntitlement(linkedAppState)
    : hasPaidSubscription(user);
  const freeUploadsRemaining = Math.max(0, FREE_UPLOAD_LIMIT - persistedClipCount);
  const uploadBlocked = !proAccess && freeUploadsRemaining <= 0;
  const hasLinkedApp = Boolean(linkedAppState.linked);
  const filteredClips = clips.filter((clip) => {
    const query = search.toLowerCase();
    const matchesSearch = !query || (clip.title || '').toLowerCase().includes(query) || (clip.content || '').toLowerCase().includes(query);
    const matchesType = typeFilter === 'all' || (clip.visibility || 'unlisted') === typeFilter;
    return matchesSearch && matchesType;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-heading">My Clips</h1>
        <p className="page-subtitle">Browse your clip library and publish cloud clips.</p>
      </div>

      <div className="glass-card p-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Cloud Posting</p>
            <h2 className="text-2xl font-bold tracking-tight text-foreground">Post from MacClipper Cloud.</h2>
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">Direct file uploads are removed here. Publish clips from your linked Mac cloud feed below.</p>
          </div>
        </div>

        <div className={[
          'mt-4 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between',
          hasLinkedApp
            ? 'border-primary/20 bg-primary/5'
            : 'border-amber-500/30 bg-amber-500/8'
        ].join(' ')}>
          <div>
            <p className="text-sm font-semibold text-foreground">
              {hasLinkedApp ? 'MacClipper connected' : 'Connect MacClipper to unlock cloud uploads'}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {hasLinkedApp ? 'Cloud clips will appear here automatically when the app posts them.' : 'Your account still needs a MacClipper link.'}
            </p>
          </div>
          {!hasLinkedApp ? (
            <Link
              to="/link-app"
              className="inline-flex items-center justify-center rounded-lg border border-amber-400/60 bg-gradient-to-r from-amber-500/20 to-orange-500/20 px-4 py-2 text-sm font-semibold text-amber-200 transition-colors hover:from-amber-500/30 hover:to-orange-500/30"
            >
              Link MacClipper to continue
            </Link>
          ) : null}
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <div className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground">
            <Cloud className="h-4 w-4" />
            {linkedCloudStatus === 'loading' ? 'Connecting to MacClipper Cloud…' : 'MacClipper Cloud live'}
          </div>
        </div>

        {uploadStatus ? <p className="mt-4 text-sm text-muted-foreground">{uploadStatus}</p> : null}
      </div>

      {linkedCloudClips.length > 0 ? (
        <div className="glass-card p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-foreground">Linked Cloud Clips</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {lastLinkedCloudSync ? `Last sync ${formatCloudClipTime(lastLinkedCloudSync)}.` : 'Mac cloud shares land here.'}
              </p>
            </div>
            <button
              type="button"
              onClick={handlePostSelectedCloudClip}
              aria-haspopup="dialog"
              aria-controls="cloud-post-dialog"
              aria-expanded={postDialogOpen}
              className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Post Selected
            </button>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {linkedCloudClips.map((share) => (
              <article key={share.id} className={[
                'overflow-visible rounded-2xl border bg-card',
                selectedCloudShareId === share.id ? 'border-primary/40 ring-1 ring-primary/30' : 'border-border'
              ].join(' ')}>
                <div className="relative aspect-video overflow-hidden rounded-t-2xl bg-muted">
                  {playingCloudShareId === share.id ? (
                    <video
                      src={resolveCloudShareVideoURL(share)}
                      className="h-full w-full object-contain"
                      controls
                      autoPlay
                      playsInline
                      onEnded={() => setPlayingCloudShareId('')}
                    />
                  ) : (
                    <>
                      <video src={resolveCloudShareVideoURL(share)} className="h-full w-full object-cover" muted playsInline preload="metadata" />
                      <button
                        type="button"
                        className="absolute inset-0 flex items-center justify-center bg-black/10 focus:outline-none"
                        aria-label="Play clip"
                        onClick={() => setPlayingCloudShareId(share.id)}
                      >
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/55 text-white">
                          <Play className="ml-1 h-5 w-5" />
                        </div>
                      </button>
                    </>
                  )}
                </div>
                <div className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-semibold text-foreground">{share.title}</h3>
                    <ActionMenu
                      label="Cloud clip actions"
                      items={[
                        {
                          label: selectedCloudShareId === share.id ? 'Selected' : 'Select to Post',
                          onSelect: () => setSelectedCloudShareId(share.id)
                        },
                        {
                          label: 'Rename',
                          icon: Pencil,
                          onSelect: () => {
                            void handleRenameCloudLink(share);
                          }
                        },
                        {
                          label: 'Copy Link',
                          icon: Copy,
                          onSelect: () => {
                            void handleCopyCloudLink(share);
                          }
                        },
                        {
                          label: 'Delete',
                          onSelect: () => {
                            void handleDeleteCloudLink(share);
                          },
                          destructive: true
                        }
                      ]}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">{share.orientation === 'vertical' ? '9:16 vertical' : '16:9 landscape'}</span>
                    <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">{formatCloudClipSize(share.fileSize)}</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedCloudShareId(share.id)}
                      className={[
                        'inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        selectedCloudShareId === share.id
                          ? 'bg-primary text-primary-foreground'
                          : 'border border-border text-foreground hover:bg-muted'
                      ].join(' ')}
                    >
                      {selectedCloudShareId === share.id ? 'Selected for Post' : 'Select'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void handleCopyCloudLink(share);
                      }}
                      aria-label="Copy clip link"
                      title="Copy Link"
                      className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border text-foreground transition-colors hover:bg-muted"
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCloudShareId(share.id);
                        openPostCloudDialog(share);
                      }}
                      aria-haspopup="dialog"
                      aria-controls="cloud-post-dialog"
                      aria-expanded={postDialogOpen}
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary/90 px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary"
                    >
                      Post
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      <div
        className={[
          'fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 transition-opacity',
          postDialogOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        ].join(' ')}
        aria-hidden={postDialogOpen ? 'false' : 'true'}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            closePostCloudDialog();
          }
        }}
      >
        <div
          id="cloud-post-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cloud-post-dialog-title"
          aria-describedby="cloud-post-dialog-description"
          data-state={postDialogOpen ? 'open' : 'closed'}
          className={[
            'w-full max-w-xl rounded-2xl border border-border bg-background p-5 shadow-2xl transition-all',
            postDialogOpen ? 'translate-y-0 scale-100' : 'translate-y-2 scale-[0.98]'
          ].join(' ')}
        >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Post Clip</p>
                <h3 id="cloud-post-dialog-title" className="mt-1 text-xl font-bold text-foreground">Add details before publishing</h3>
                <p id="cloud-post-dialog-description" className="mt-1 text-sm text-muted-foreground">Set title, description, and game for this community post.</p>
              </div>
              <button
                type="button"
                onClick={closePostCloudDialog}
                className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted"
                disabled={postingCloudClip}
              >
                Close
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <label className="block space-y-2 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Title</span>
                <input
                  type="text"
                  value={postTitleDraft}
                  onChange={(event) => setPostTitleDraft(event.target.value)}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground"
                  placeholder="Give this clip a title"
                />
              </label>

              <label className="block space-y-2 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Description</span>
                <textarea
                  rows="3"
                  value={postDescriptionDraft}
                  onChange={(event) => setPostDescriptionDraft(event.target.value)}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground"
                  placeholder="Describe this moment"
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-2 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Game</span>
                  <select
                    value={postGameDraft}
                    onChange={(event) => setPostGameDraft(event.target.value)}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground"
                  >
                    {featuredGames.map((game) => (
                      <option key={game} value={game}>{gameDisplayNameWithIcon(game)}</option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-2 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Category</span>
                  <select
                    value={postCategoryDraft}
                    onChange={(event) => setPostCategoryDraft(event.target.value)}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground"
                  >
                    {categoriesForGame(postGameDraft).map((category) => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary">
                  {gameIconForTitle(postGameDraft)}
                </span>
                Posting to
                <span className="ml-1 font-semibold text-foreground">{postGameDraft}</span>
              </div>

              <div className="rounded-xl border border-border bg-muted/20">
                <div className="flex items-center justify-between gap-3 px-3 py-2">
                  <p className="text-sm font-medium text-foreground">Post Logs</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setPostLogsOpen((open) => !open)}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                    >
                      {postLogsOpen ? 'Hide Logs' : 'Logs'}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const didCopy = await copyTextToClipboard(postLogs.length > 0 ? postLogs.join('\n') : 'No post logs yet.');
                        setUploadStatus(didCopy ? 'Post logs copied.' : 'Copy failed in this browser.');
                      }}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                    >
                      <span className="inline-flex items-center gap-1">
                        <Copy className="h-3.5 w-3.5" />
                        Copy Logs
                      </span>
                    </button>
                  </div>
                </div>
                {postLogsOpen ? (
                  <div className="border-t border-border px-3 py-3">
                    <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background px-3 py-2 text-xs leading-5 text-muted-foreground">
                      {postLogs.length > 0 ? postLogs.join('\n') : 'No post logs yet. Open the post dialog and try a post to capture the flow here.'}
                    </pre>
                  </div>
                ) : null}
              </div>
            </div>

            {uploadStatus ? (
              <p className="mt-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{uploadStatus}</p>
            ) : null}

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={closePostCloudDialog}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
                disabled={postingCloudClip}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void submitPostCloudDialog();
                }}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={postingCloudClip}
              >
                {postingCloudClip ? 'Posting...' : 'Post Clip'}
              </button>
            </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search clips..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full rounded-lg border border-input bg-background px-10 py-2.5 text-sm text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value)}
          className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground sm:w-40"
        >
          <option value="all">All Types</option>
          <option value="unlisted">Unlisted</option>
          <option value="followers">Followers</option>
          <option value="public">Public</option>
        </select>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((index) => (
            <div key={index} className="h-32 animate-pulse rounded-xl bg-muted"></div>
          ))}
        </div>
      ) : filteredClips.length === 0 ? (
        <div className="py-20 text-center text-muted-foreground">
          <Upload className="mx-auto mb-4 h-16 w-16 opacity-20" />
          <p className="text-lg font-semibold">No clips found</p>
          <p className="mt-1 text-sm">{search ? 'Try a different search term.' : 'Upload a clip to start filling the library.'}</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredClips.map((clip) => (
            <ClipCard
              key={clip.id}
              clip={clip}
              isFavorite={favoriteIds.includes(clip.id)}
              onToggleFavorite={handleToggleFavorite}
              onDelete={handleDeleteHostedClip}
              onPublish={handlePublishHostedClip}
              onRename={handleRenameHostedClip}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default Clips;