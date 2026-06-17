import { MACCLIPPER_OWNER_EMAIL } from './avatarTheme';

const PRO_TIERS = new Set(['pro', 'creator', 'studio', 'founder']);

function normalizedPlanValue(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizedEmailValue(value) {
  return String(value || '').trim().toLowerCase();
}

export function subscriptionTierForUser(user) {
  const tier = [
    user?.user_metadata?.subscription_tier,
    user?.user_metadata?.plan,
    user?.app_metadata?.subscription_tier,
    user?.app_metadata?.plan
  ]
    .map(normalizedPlanValue)
    .find(Boolean);

  return tier || 'free';
}

export function subscriptionLabelForUser(user) {
  return subscriptionLabelForTier(subscriptionTierForUser(user));
}

export function subscriptionLabelForTier(tierValue) {
  const tier = normalizedPlanValue(tierValue) || 'free';

  switch (tier) {
    case 'founder':
      return 'Founder';
    case 'studio':
      return 'Studio';
    case 'creator':
      return 'Creator Pro';
    case 'pro':
      return 'Pro';
    default:
      return 'Free';
  }
}

export function hasPaidSubscription(user) {
  return PRO_TIERS.has(subscriptionTierForUser(user));
}

export function canAccessAdminPortal(user) {
  return Boolean(user && normalizedEmailValue(user?.email) === normalizedEmailValue(MACCLIPPER_OWNER_EMAIL));
}