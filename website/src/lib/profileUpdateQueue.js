import { supabase } from '../supabaseClient';
import { syncSupabaseProfile } from './profileSync';

const PROFILE_UPDATE_QUEUE_KEY = 'macclipper.profile-update-queue.v1';

function readQueue() {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(PROFILE_UPDATE_QUEUE_KEY);
    const parsed = JSON.parse(String(raw || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(items) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(PROFILE_UPDATE_QUEUE_KEY, JSON.stringify(items));
  } catch (error) {
    console.error('Could not persist profile update queue:', error);
  }
}

function buildMetadata(currentUser, update) {
  const nextMetadata = {
    ...(currentUser?.user_metadata || {})
  };

  if (typeof update.displayName === 'string' && update.displayName.trim()) {
    const normalizedDisplayName = update.displayName.trim();
    nextMetadata.full_name = normalizedDisplayName;
    nextMetadata.name = normalizedDisplayName;
    nextMetadata.user_name = normalizedDisplayName;
  }

  if (Object.prototype.hasOwnProperty.call(update, 'avatarURL')) {
    nextMetadata.avatar_url = update.avatarURL || null;
  }

  return nextMetadata;
}

export function enqueueProfileUpdate(update) {
  if (!update?.userId) {
    return;
  }

  const nextItem = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    userId: String(update.userId).trim(),
    email: update.email || null,
    displayName: typeof update.displayName === 'string' ? update.displayName.trim() : undefined,
    avatarURL: Object.prototype.hasOwnProperty.call(update, 'avatarURL') ? (update.avatarURL || null) : undefined,
    createdAt: new Date().toISOString()
  };

  const existing = readQueue();
  const deduped = existing.filter((item) => item.userId !== nextItem.userId);
  writeQueue([...deduped, nextItem]);
}

export async function flushProfileUpdateQueue(currentUser) {
  if (!currentUser?.id) {
    return { flushed: 0, pending: 0 };
  }

  const queue = readQueue();
  if (queue.length === 0) {
    return { flushed: 0, pending: 0 };
  }

  let flushed = 0;
  let rollingUser = currentUser;
  const remaining = [];

  for (const item of queue) {
    if (item.userId !== currentUser.id) {
      remaining.push(item);
      continue;
    }

    try {
      const nextMetadata = buildMetadata(rollingUser, item);
      const nextDisplayName = typeof item.displayName === 'string' && item.displayName.trim()
        ? item.displayName.trim()
        : null;

      const profilePayload = {
        id: currentUser.id,
        email: currentUser.email ?? item.email ?? null,
        last_seen_at: new Date().toISOString()
      };

      if (nextDisplayName) {
        profilePayload.display_name = nextDisplayName;
      }

      if (Object.prototype.hasOwnProperty.call(item, 'avatarURL')) {
        profilePayload.avatar_url = item.avatarURL || null;
      }

      await supabase
        .from('profiles')
        .upsert(profilePayload, { onConflict: 'id' })
        .select('id')
        .maybeSingle();

      const { data, error } = await supabase.auth.updateUser({ data: nextMetadata });
      if (error) {
        throw error;
      }

      const syncedUser = data?.user || {
        ...rollingUser,
        user_metadata: nextMetadata
      };

      await syncSupabaseProfile(syncedUser);
      rollingUser = syncedUser;
      flushed += 1;
    } catch (error) {
      console.error('Deferred profile update failed, will retry later:', error);
      remaining.push(item);
    }
  }

  writeQueue(remaining);
  return {
    flushed,
    pending: remaining.length
  };
}
