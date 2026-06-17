const avatarPalettes = [
  ['#2e6d61', '#7bc9aa'],
  ['#db6b3d', '#f2b27d'],
  ['#274a78', '#7ca6f5'],
  ['#7a4d9b', '#d4a9ff'],
  ['#8d5a2b', '#f1cd8b'],
  ['#9b375b', '#f4a1bf'],
  ['#305a46', '#8dd7b0'],
  ['#4b5ca8', '#adc2ff']
];

export const MACCLIPPER_OWNER_EMAIL = 'meteoritecontentman@gmail.com';
export const MACCLIPPER_OWNER_NAME = 'MacClipper';
export const MACCLIPPER_OWNER_AVATAR_URL = 'https://media.base44.com/images/public/user_69840c94143af1fbc044bd6f/cf2d115fa_AppIcon_1024x1024x32.png';

function hashSeed(seed) {
  const value = String(seed || 'macclipper');
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
}

export function displayNameFromUser(user) {
  if (String(user?.email || '').trim().toLowerCase() === MACCLIPPER_OWNER_EMAIL) {
    return MACCLIPPER_OWNER_NAME;
  }

  const metadata = user?.user_metadata ?? {};
  const candidate = [metadata.full_name, metadata.name, metadata.user_name]
    .find((value) => typeof value === 'string' && value.trim().length > 0);

  if (candidate) {
    return candidate.trim();
  }

  if (typeof user?.email === 'string' && user.email.includes('@')) {
    return user.email.split('@')[0];
  }

  return 'MacClipper User';
}

export function avatarURLFromUser(user) {
  if (String(user?.email || '').trim().toLowerCase() === MACCLIPPER_OWNER_EMAIL) {
    return MACCLIPPER_OWNER_AVATAR_URL;
  }

  const metadata = user?.user_metadata ?? {};
  const candidate = [metadata.avatar_url, metadata.picture]
    .find((value) => typeof value === 'string' && value.trim().length > 0);

  return candidate ? candidate.trim() : '';
}

export function initialsFromName(name) {
  const normalized = String(name || 'MacClipper User').trim();
  if (!normalized) {
    return 'MC';
  }

  return normalized
    .split(/\s+/)
    .slice(0, 2)
    .map((segment) => segment[0]?.toUpperCase() || '')
    .join('') || 'MC';
}

export function avatarStyleFromSeed(seed) {
  const [start, end] = avatarPalettes[hashSeed(seed) % avatarPalettes.length];

  return {
    background: `linear-gradient(135deg, ${start} 0%, ${end} 100%)`,
    boxShadow: `0 18px 34px ${start}33`
  };
}

export function isVerifiedProfile(profile, fallbackName = '') {
  if (String(profile?.email || '').trim().toLowerCase() === MACCLIPPER_OWNER_EMAIL) {
    return true;
  }

  if (profile?.verified === true) {
    return true;
  }

  const followerCount = Number(profile?.follower_count || profile?.followers || 0);
  if (Number.isFinite(followerCount) && followerCount >= 10000) {
    return true;
  }

  return String(fallbackName).trim().toLowerCase() === 'macclipper';
}

export function ownerTagLabel(profile, fallbackName = '', fallbackEmail = '') {
  const normalizedEmail = String(profile?.email || fallbackEmail || '').trim().toLowerCase();
  const normalizedName = String(profile?.display_name || fallbackName || '').trim().toLowerCase();

  if (normalizedEmail === MACCLIPPER_OWNER_EMAIL || normalizedName === 'macclipper') {
    return 'Owner';
  }

  if (profile?.verified === true) {
    return 'Creator';
  }

  return '';
}