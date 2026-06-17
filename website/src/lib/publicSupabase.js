import { supabasePublishableKey, supabaseURL } from '../supabaseClient';

const DEFAULT_PUBLIC_SUPABASE_TIMEOUT_MS = 12000;

export async function fetchPublicSupabaseRows(pathname, searchParams, options = {}) {
  const requestURL = new URL(`/rest/v1${pathname}`, `${supabaseURL}/`);
  const controller = new AbortController();
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_PUBLIC_SUPABASE_TIMEOUT_MS;
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  Object.entries(searchParams || {}).forEach(([key, value]) => {
    if (value == null || value === '') {
      return;
    }

    requestURL.searchParams.set(key, String(value));
  });

  try {
    const response = await fetch(requestURL.toString(), {
      headers: {
        apikey: supabasePublishableKey,
        Authorization: `Bearer ${supabasePublishableKey}`,
        Accept: 'application/json'
      },
      cache: 'no-store',
      signal: controller.signal
    });

    const payload = await response.json().catch(() => []);
    if (!response.ok) {
      const message = payload?.message || payload?.error || `Supabase REST request failed with ${response.status}`;
      throw new Error(message);
    }

    return Array.isArray(payload) ? payload : [];
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Public data request timed out after ${timeoutMs}ms.`);
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function fetchPublicCommunityClips(limit = 72) {
  return fetchPublicSupabaseRows('/clips', {
    select: '*',
    visibility: 'eq.public',
    order: 'created_at.desc',
    limit: String(limit)
  });
}

export async function fetchPublicClipById(clipId) {
  const rows = await fetchPublicSupabaseRows('/clips', {
    select: '*',
    id: `eq.${encodeURIComponent(String(clipId || '').trim())}`,
    visibility: 'eq.public',
    limit: '1'
  });

  return rows[0] || null;
}

export async function fetchPublicClipComments(clipId, limit = 40) {
  const normalizedClipId = String(clipId || '').trim();
  if (!normalizedClipId) {
    return [];
  }

  return fetchPublicSupabaseRows('/clip_comments', {
    select: 'id,clip_id,user_id,body,created_at',
    clip_id: `eq.${encodeURIComponent(normalizedClipId)}`,
    order: 'created_at.desc',
    limit: String(limit)
  });
}

export async function fetchPublicProfileById(profileId) {
  const normalizedProfileId = String(profileId || '').trim();
  if (!normalizedProfileId) {
    return null;
  }

  const rows = await fetchPublicSupabaseRows('/profiles', {
    select: 'id,email,display_name,avatar_url,verified,follower_count,bio,created_at',
    id: `eq.${normalizedProfileId}`,
    limit: '1'
  });

  return rows[0] || null;
}

export async function fetchPublicClipsByOwnerId(profileId, limit = 48) {
  const normalizedProfileId = String(profileId || '').trim();
  if (!normalizedProfileId) {
    return [];
  }

  return fetchPublicSupabaseRows('/clips', {
    select: '*',
    visibility: 'eq.public',
    or: `(owner_profile_id.eq.${normalizedProfileId},user_id.eq.${normalizedProfileId})`,
    order: 'created_at.desc',
    limit: String(limit)
  });
}

export async function fetchPublicProfiles(ownerIds) {
  const normalizedOwnerIds = Array.from(new Set(
    (Array.isArray(ownerIds) ? ownerIds : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  ));

  if (normalizedOwnerIds.length === 0) {
    return [];
  }

  return fetchPublicSupabaseRows('/profiles', {
    select: 'id,email,display_name,avatar_url,verified,follower_count,bio,created_at',
    id: `in.(${normalizedOwnerIds.join(',')})`
  });
}