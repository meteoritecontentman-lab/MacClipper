const GOOGLE_TRANSLATE_SCRIPT_ID = 'macclipper-google-translate-script';
const GOOGTRANS_COOKIE_KEY = 'googtrans';

function setCookie(name, value) {
  if (typeof document === 'undefined') {
    return;
  }

  const secure = window?.location?.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=${value}; path=/; SameSite=Lax${secure}`;
}

function languageToGoogtrans(language) {
  const normalized = String(language || 'en').trim().toLowerCase();
  if (!normalized || normalized === 'en') {
    return '/auto/en';
  }

  return `/auto/${normalized}`;
}

export function applySiteLanguage(language, { reload = true } = {}) {
  if (typeof window === 'undefined') {
    return;
  }

  const normalized = String(language || 'en').trim().toLowerCase() || 'en';
  window.localStorage.setItem('macclipper.ui.language', normalized);
  setCookie(GOOGTRANS_COOKIE_KEY, languageToGoogtrans(normalized));

  if (reload) {
    window.location.reload();
  }
}

export function initGoogleTranslateWidget() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  if (window.google?.translate?.TranslateElement) {
    return;
  }

  if (!document.getElementById('google_translate_element')) {
    const host = document.createElement('div');
    host.id = 'google_translate_element';
    host.style.display = 'none';
    document.body.appendChild(host);
  }

  window.googleTranslateElementInit = () => {
    if (!window.google?.translate?.TranslateElement) {
      return;
    }

    // Use Google page-level translation to cover the whole SPA content.
    // eslint-disable-next-line no-new
    new window.google.translate.TranslateElement(
      {
        pageLanguage: 'en',
        autoDisplay: false,
        multilanguagePage: true
      },
      'google_translate_element'
    );
  };

  if (document.getElementById(GOOGLE_TRANSLATE_SCRIPT_ID)) {
    return;
  }

  const script = document.createElement('script');
  script.id = GOOGLE_TRANSLATE_SCRIPT_ID;
  script.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
  script.async = true;
  document.head.appendChild(script);
}
