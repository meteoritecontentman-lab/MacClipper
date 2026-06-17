import { supabase } from '../supabaseClient';
import {
  MACCLIPPER_OWNER_AVATAR_URL,
  MACCLIPPER_OWNER_EMAIL,
  MACCLIPPER_OWNER_NAME
} from './avatarTheme';

function isMacClipperOwner(user) {
  return String(user?.email || '').trim().toLowerCase() === MACCLIPPER_OWNER_EMAIL;
}

function normalizedDisplayName(user) {
  if (isMacClipperOwner(user)) {
    return MACCLIPPER_OWNER_NAME;
  }

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

function normalizedAvatarURL(user) {
  if (isMacClipperOwner(user)) {
    return MACCLIPPER_OWNER_AVATAR_URL;
  }

  const metadata = user?.user_metadata ?? {};
  const avatarURL = [metadata.avatar_url, metadata.picture]
    .find((value) => typeof value === 'string' && value.trim().length > 0);

  return avatarURL ? avatarURL.trim() : null;
}

function normalizedProvider(user) {
  const providers = Array.isArray(user?.app_metadata?.providers)
    ? user.app_metadata.providers
    : [];

  return providers.find((value) => typeof value === 'string' && value.trim().length > 0) ?? 'email';
}

export async function syncSupabaseProfile(user) {
  if (!user?.id) {
    return { data: null, error: null };
  }

  const payload = {
    id: user.id,
    email: user.email ?? null,
    display_name: normalizedDisplayName(user),
    avatar_url: normalizedAvatarURL(user),
    verified: isMacClipperOwner(user),
    auth_provider: normalizedProvider(user),
    last_seen_at: new Date().toISOString()
  };

  return supabase
    .from('profiles')
    .upsert(payload, { onConflict: 'id' })
    .select('id, email, display_name, avatar_url, verified, auth_provider')
    .maybeSingle();
}