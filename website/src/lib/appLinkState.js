const STORAGE_PREFIX = 'macclipper.linked-app';
const LINK_STATE_EVENT = 'macclipper:linked-app-updated';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function storageKey(userId) {
  return `${STORAGE_PREFIX}:${String(userId || 'guest').trim()}`;
}

function defaultState(userId) {
  return {
    linked: false,
    websiteUserId: String(userId || '').trim(),
    appUuid: '',
    linkedAt: '',
    subscriptionTier: 'free',
    paidFeatures: [],
    verifiedAt: ''
  };
}

function normalizeAppUuid(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeSubscriptionTier(value) {
  const tier = String(value || 'free').trim().toLowerCase();
  return tier === 'pro' ? 'pro' : 'free';
}

function normalizePaidFeatures(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(value.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean))).sort();
}

function emitLinkStateUpdate(userId) {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(LINK_STATE_EVENT, {
    detail: { userId: String(userId || '').trim() }
  }));
}

export function isValidAppUuid(value) {
  return UUID_PATTERN.test(normalizeAppUuid(value));
}

export function formatLinkedAppLabel(value) {
  const normalized = normalizeAppUuid(value);
  if (!normalized) {
    return 'Not linked';
  }

  return `${normalized.slice(0, 8).toUpperCase()}...`;
}

export function readLinkedAppState(userId) {
  const fallbackState = defaultState(userId);

  if (!fallbackState.websiteUserId || typeof window === 'undefined') {
    return fallbackState;
  }

  try {
    const rawValue = window.localStorage.getItem(storageKey(fallbackState.websiteUserId));
    if (!rawValue) {
      return fallbackState;
    }

    const parsedValue = JSON.parse(rawValue);
    const appUuid = normalizeAppUuid(parsedValue?.appUuid);
    const linkedAt = String(parsedValue?.linkedAt || '').trim();

    return {
      linked: Boolean(appUuid),
      websiteUserId: fallbackState.websiteUserId,
      appUuid,
      linkedAt,
      subscriptionTier: normalizeSubscriptionTier(parsedValue?.subscriptionTier),
      paidFeatures: normalizePaidFeatures(parsedValue?.paidFeatures),
      verifiedAt: String(parsedValue?.verifiedAt || '').trim()
    };
  } catch (error) {
    console.error('Error reading linked app state:', error);
    return fallbackState;
  }
}

export function saveLinkedAppState(userId, value) {
  const nextUserId = String(userId || '').trim();
  if (!nextUserId || typeof window === 'undefined') {
    return defaultState(nextUserId);
  }

  const appUuid = normalizeAppUuid(value?.appUuid);
  const linkedAt = appUuid
    ? String(value?.linkedAt || new Date().toISOString()).trim()
    : '';
  const nextState = {
    linked: Boolean(appUuid),
    websiteUserId: nextUserId,
    appUuid,
    linkedAt,
    subscriptionTier: normalizeSubscriptionTier(value?.subscriptionTier),
    paidFeatures: normalizePaidFeatures(value?.paidFeatures),
    verifiedAt: String(value?.verifiedAt || '').trim()
  };

  try {
    window.localStorage.setItem(storageKey(nextUserId), JSON.stringify(nextState));
    emitLinkStateUpdate(nextUserId);
  } catch (error) {
    console.error('Error saving linked app state:', error);
  }

  return nextState;
}

export function clearLinkedAppState(userId) {
  const nextUserId = String(userId || '').trim();
  const nextState = defaultState(nextUserId);

  if (!nextUserId || typeof window === 'undefined') {
    return nextState;
  }

  try {
    window.localStorage.removeItem(storageKey(nextUserId));
    emitLinkStateUpdate(nextUserId);
  } catch (error) {
    console.error('Error clearing linked app state:', error);
  }

  return nextState;
}

export function subscribeToLinkedAppState(userId, callback) {
  const nextUserId = String(userId || '').trim();

  if (!nextUserId || typeof window === 'undefined' || typeof callback !== 'function') {
    return () => {};
  }

  const notify = () => callback(readLinkedAppState(nextUserId));

  const handleStorage = (event) => {
    if (event.key && event.key !== storageKey(nextUserId)) {
      return;
    }

    notify();
  };

  const handleCustomUpdate = (event) => {
    if (event?.detail?.userId && event.detail.userId !== nextUserId) {
      return;
    }

    notify();
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(LINK_STATE_EVENT, handleCustomUpdate);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(LINK_STATE_EVENT, handleCustomUpdate);
  };
}