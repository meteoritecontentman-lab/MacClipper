export function shouldUseHashRouting() {
  if (typeof window === 'undefined') {
    return false;
  }

  const { hostname, pathname } = window.location;
  return hostname.endsWith('github.io') || pathname.startsWith('/macclipper-site/');
}

const DEFAULT_PRODUCTION_CLOUD_API_BASE_URL = 'https://macclipper-ce502.web.app/api';
const DEFAULT_LOCAL_CLOUD_API_BASE_URL = 'http://127.0.0.1:5005/api';

function normalizedBasePath() {
  if (typeof window === 'undefined') {
    return '';
  }

  const pathname = window.location.pathname.replace(/\/$/, '');
  if (!shouldUseHashRouting()) {
    return '';
  }

  return pathname || '';
}

const AUTH_REDIRECT_PENDING_KEY = 'macclipper-auth-redirect-pending';
const AUTH_REDIRECT_PATH_KEY = 'macclipper-auth-redirect-path';

export function buildAppURL(path = '/') {
  if (typeof window === 'undefined') {
    return path;
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const origin = window.location.origin;
  const basePath = normalizedBasePath();

  if (shouldUseHashRouting()) {
    return `${origin}${basePath}/#${normalizedPath}`;
  }

  return `${origin}${normalizedPath}`;
}

export function buildOAuthRedirectURL() {
  if (typeof window === 'undefined') {
    return '/';
  }

  const origin = window.location.origin;
  const basePath = normalizedBasePath();

  return `${origin}${basePath || ''}/`;
}

export function buildCloudAPIBaseURL() {
  const configuredBaseURL = String(process.env.REACT_APP_MACCLIPPER_CLOUD_API_BASE_URL || '').trim().replace(/\/+$/, '');
  if (configuredBaseURL) {
    return configuredBaseURL;
  }

  if (typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    return DEFAULT_LOCAL_CLOUD_API_BASE_URL;
  }

  if (typeof window !== 'undefined' && !shouldUseHashRouting()) {
    return `${window.location.origin}/api`;
  }

  return DEFAULT_PRODUCTION_CLOUD_API_BASE_URL;
}

export function buildCloudAPIURL(path = '/') {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${buildCloudAPIBaseURL()}${normalizedPath}`;
}

export function rememberAuthRedirect(path = '/dashboard') {
  if (typeof window === 'undefined') {
    return;
  }

  const normalizedPath = path.startsWith('/') ? path : '/dashboard';
  window.localStorage.setItem(AUTH_REDIRECT_PENDING_KEY, 'true');
  window.localStorage.setItem(AUTH_REDIRECT_PATH_KEY, normalizedPath);
}

export function clearAuthRedirect() {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(AUTH_REDIRECT_PENDING_KEY);
  window.localStorage.removeItem(AUTH_REDIRECT_PATH_KEY);
  window.sessionStorage.removeItem(AUTH_REDIRECT_PENDING_KEY);
  window.sessionStorage.removeItem(AUTH_REDIRECT_PATH_KEY);
}

export function consumeAuthRedirect() {
  if (typeof window === 'undefined') {
    return null;
  }

  const hasPendingRedirect = window.localStorage.getItem(AUTH_REDIRECT_PENDING_KEY) === 'true';
  if (!hasPendingRedirect) {
    return null;
  }

  const path = window.localStorage.getItem(AUTH_REDIRECT_PATH_KEY) || '/dashboard';
  clearAuthRedirect();

  return path.startsWith('/') ? path : '/dashboard';
}