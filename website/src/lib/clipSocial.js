import { supabase } from '../supabaseClient';
import { buildCloudAPIURL } from './appRuntime';
import { resolveSupabaseSession } from './supabaseSession';

const SUPABASE_SESSION_LOOKUP_TIMEOUT_MS = 3500;
const TOKEN_CACHE_TTL_MS = 60000;

let cachedAccessToken = '';
let cachedAccessTokenExpiresAt = 0;

function likeEndpoint(clipId) {
  return buildCloudAPIURL(`/community-clips/${encodeURIComponent(String(clipId || '').trim())}/likes`);
}

function commentEndpoint(clipId) {
  return buildCloudAPIURL(`/community-clips/${encodeURIComponent(String(clipId || '').trim())}/comments`);
}

function commentReactionEndpoint(clipId, commentId) {
  return buildCloudAPIURL(`/community-clips/${encodeURIComponent(String(clipId || '').trim())}/comments/${encodeURIComponent(String(commentId || '').trim())}/reactions`);
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
    console.error('Error reading stored Supabase auth token for social actions:', error);
  }

  return '';
}

async function resolveSupabaseAccessToken() {
  const now = Date.now();
  if (cachedAccessToken && cachedAccessTokenExpiresAt > now) {
    return {
      accessToken: cachedAccessToken,
      source: 'memory-cache',
      error: null
    };
  }

  const sessionResult = await resolveSupabaseSession();
  const sessionAccessToken = String(sessionResult?.accessToken || '').trim();
  if (sessionAccessToken) {
    cachedAccessToken = sessionAccessToken;
    cachedAccessTokenExpiresAt = Date.now() + TOKEN_CACHE_TTL_MS;
    return {
      accessToken: sessionAccessToken,
      source: sessionResult?.source || 'unavailable',
      error: sessionResult?.error || null
    };
  }

  return {
    accessToken: '',
    source: sessionResult?.source || 'unavailable',
    error: sessionResult?.error || null
  };
}

async function readJSONResponse(response) {
  return response.json().catch(() => ({}));
}

async function performAuthorizedSocialRequest(requestURL, body, options = {}) {
  const sessionResolution = await resolveSupabaseAccessToken();
  if (!sessionResolution.accessToken) {
    throw new Error(sessionResolution.error?.message || 'Sign in to continue.');
  }

  const response = await fetch(requestURL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionResolution.accessToken}`
    },
    body: JSON.stringify(body),
    keepalive: options.keepalive !== false
  });

  const payload = await readJSONResponse(response);
  if (!response.ok) {
    throw new Error(String(payload?.message || payload?.error || `Request failed with ${response.status}`));
  }

  return payload;
}

export async function fetchClipLikeSummary(clipId, websiteUserId = '') {
  const requestURL = new URL(likeEndpoint(clipId));
  if (websiteUserId) {
    requestURL.searchParams.set('websiteUserId', String(websiteUserId || '').trim());
  }

  const response = await fetch(requestURL.toString(), {
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`Like summary request failed with ${response.status}`);
  }

  return response.json().catch(() => ({ clipId: String(clipId || '').trim(), likeCount: 0, liked: false }));
}

export async function setClipLikePreference(clipId, shouldLike) {
  return performAuthorizedSocialRequest(likeEndpoint(clipId), {
    shouldLike
  });
}

export async function fetchClipComments(clipId, limit = 24, websiteUserId = '') {
  const requestURL = new URL(commentEndpoint(clipId));
  requestURL.searchParams.set('limit', String(limit || 24));
  if (websiteUserId) {
    requestURL.searchParams.set('websiteUserId', String(websiteUserId || '').trim());
  }

  const response = await fetch(requestURL.toString(), {
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`Comment list request failed with ${response.status}`);
  }

  return response.json().catch(() => ({ clipId: String(clipId || '').trim(), commentCount: 0, comments: [] }));
}

export async function postClipComment(clipId, body) {
  return performAuthorizedSocialRequest(commentEndpoint(clipId), {
    body
  });
}

export async function setCommentReaction(clipId, commentId, reaction) {
  return performAuthorizedSocialRequest(commentReactionEndpoint(clipId, commentId), {
    reaction
  });
}