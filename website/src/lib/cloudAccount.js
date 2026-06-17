import { buildCloudAPIBaseURL, buildCloudAPIURL } from './appRuntime';

function normalizeTier(value) {
  return String(value || 'free').trim().toLowerCase() === 'pro' ? 'pro' : 'free';
}

function normalizeFeatures(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(value.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean))).sort();
}

export function hasProEntitlement(entitlements) {
  const tier = normalizeTier(entitlements?.subscriptionTier);
  const features = normalizeFeatures(entitlements?.paidFeatures);
  return tier === 'pro' || features.includes('4k-pro');
}

export async function fetchEntitlementsByAppUuid(appUuid) {
  const normalizedAppUuid = String(appUuid || '').trim().toLowerCase();
  if (!normalizedAppUuid) {
    throw new Error('appUuid is required.');
  }

  const endpoint = new URL(buildCloudAPIURL('/entitlements/by-user-id'));
  endpoint.searchParams.set('appUuid', normalizedAppUuid);

  const response = await fetch(endpoint.toString(), { cache: 'no-store' });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Entitlement lookup failed with ${response.status}`);
  }

  const payload = await response.json();
  const user = payload?.user || {};

  return {
    accountStatus: String(user.accountStatus || 'active').trim().toLowerCase(),
    subscriptionTier: normalizeTier(user.subscriptionTier),
    paidFeatures: normalizeFeatures(user.paidFeatures),
    updatedAt: String(user.updatedAt || '').trim()
  };
}

export async function fetchAccountSummaryByAppUuid(appUuid) {
  const normalizedAppUuid = String(appUuid || '').trim().toLowerCase();
  if (!normalizedAppUuid) {
    throw new Error('appUuid is required.');
  }

  const endpoint = new URL(buildCloudAPIURL('/account-summary'));
  endpoint.searchParams.set('appUuid', normalizedAppUuid);

  const response = await fetch(endpoint.toString(), { cache: 'no-store' });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Account summary failed with ${response.status}`);
  }

  const payload = await response.json();
  return payload?.summary || null;
}

export async function fetchLinkStatus(websiteUserId) {
  const normalizedUserId = String(websiteUserId || '').trim();
  if (!normalizedUserId) {
    throw new Error('websiteUserId is required.');
  }

  const endpoint = new URL(buildCloudAPIURL('/link-status'));
  endpoint.searchParams.set('websiteUserId', normalizedUserId);

  const response = await fetch(endpoint.toString(), { cache: 'no-store' });
  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  return {
    appUuid: payload?.appUuid ? String(payload.appUuid).trim().toLowerCase() : '',
    linkedAt: String(payload?.linkedAt || '').trim(),
    isLinked: payload?.isLinked === true,
    attemptId: String(payload?.attemptId || '').trim()
  };
}

export function subscriptionLabelFromEntitlements(entitlements) {
  return hasProEntitlement(entitlements) ? 'Pro' : 'Free';
}

export async function createStripeCheckoutSession({ websiteUserId, email }) {
  const normalizedUserId = String(websiteUserId || '').trim();
  if (!normalizedUserId) {
    throw new Error('websiteUserId is required.');
  }

  const endpoint = new URL(buildCloudAPIURL('/billing/create-checkout-session'));
  const response = await fetch(endpoint.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      websiteUserId: normalizedUserId,
      email: String(email || '').trim()
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Checkout failed with ${response.status}`);
  }

  return {
    url: String(payload.url || '').trim()
  };
}

export async function createStripePortalSession({ websiteUserId }) {
  const normalizedUserId = String(websiteUserId || '').trim();
  if (!normalizedUserId) {
    throw new Error('websiteUserId is required.');
  }

  const endpoint = new URL(buildCloudAPIURL('/billing/create-portal-session'));
  const response = await fetch(endpoint.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ websiteUserId: normalizedUserId })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Portal failed with ${response.status}`);
  }

  return {
    url: String(payload.url || '').trim()
  };
}

export async function verifyStripeCheckout({ sessionId, websiteUserId }) {
  const endpoint = new URL(buildCloudAPIURL('/billing/verify-checkout'));
  const response = await fetch(endpoint.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: String(sessionId || '').trim(),
      websiteUserId: String(websiteUserId || '').trim()
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Checkout verification failed with ${response.status}`);
  }

  return payload;
}

export async function unlinkApp({ websiteUserId }) {
  const normalizedUserId = String(websiteUserId || '').trim();
  if (!normalizedUserId) {
    throw new Error('websiteUserId is required.');
  }

  const apiBaseCandidates = Array.from(new Set([
    buildCloudAPIBaseURL(),
    'https://macclipper-ce502.web.app/api',
    'https://us-central1-macclipper-ce502.cloudfunctions.net/api'
  ].filter(Boolean)));

  let lastError = null;

  for (const apiBase of apiBaseCandidates) {
    const unlinkViaDelete = new URL('/app-link', `${String(apiBase).replace(/\/+$/, '')}/`).toString();
    const unlinkViaPost = new URL('/app-link/unlink', `${String(apiBase).replace(/\/+$/, '')}/`).toString();

    // Try DELETE first for modern API stacks.
    const deleteResponse = await fetch(unlinkViaDelete, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteUserId: normalizedUserId })
    }).catch((error) => ({ ok: false, status: 0, _error: error }));

    if (deleteResponse.ok || deleteResponse.status === 204) {
      return;
    }

    // Fall back to POST for hosts/proxies that do not route DELETE.
    const postResponse = await fetch(unlinkViaPost, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteUserId: normalizedUserId })
    }).catch((error) => ({ ok: false, status: 0, _error: error }));

    if (postResponse.ok || postResponse.status === 204) {
      return;
    }

    const deletePayload = deleteResponse._error ? {} : await deleteResponse.json().catch(() => ({}));
    const postPayload = postResponse._error ? {} : await postResponse.json().catch(() => ({}));
    const errorMessage = postPayload.error || deletePayload.error || `Unlink failed with ${postResponse.status || deleteResponse.status || 0}`;
    lastError = new Error(errorMessage);
  }

  throw lastError || new Error('Unlink failed.');
}

export async function fetchBillingSubscription(websiteUserId) {
  const normalizedUserId = String(websiteUserId || '').trim();
  if (!normalizedUserId) {
    return null;
  }

  const endpoint = new URL(buildCloudAPIURL('/billing/subscription'));
  endpoint.searchParams.set('websiteUserId', normalizedUserId);

  try {
    const response = await fetch(endpoint.toString(), { cache: 'no-store' });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}
