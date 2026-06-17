import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Clipboard, Film, LayoutDashboard, LogOut, Settings, Shield, Star, ChevronDown, Sun, Moon, Languages, UserRound } from 'lucide-react';
import { avatarURLFromUser, displayNameFromUser, initialsFromName, isVerifiedProfile } from '../lib/avatarTheme';
import { readLinkedAppState, subscribeToLinkedAppState } from '../lib/appLinkState';
import { applySiteLanguage } from '../lib/siteTranslation';
import NotificationsMenu from './NotificationsMenu';

const BRAND_ICON_URL = 'https://media.base44.com/images/public/user_69840c94143af1fbc044bd6f/cf2d115fa_AppIcon_1024x1024x32.png';
const THEME_STORAGE_KEY = 'macclipper.ui.theme';
const LANGUAGE_STORAGE_KEY = 'macclipper.ui.language';

const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Espanol' },
  { code: 'fr', label: 'Francais' },
  { code: 'de', label: 'Deutsch' },
  { code: 'pt', label: 'Portugues' },
  { code: 'it', label: 'Italiano' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'ru', label: 'Russkiy' },
  { code: 'uk', label: 'Ukrainska' },
  { code: 'tr', label: 'Turkce' },
  { code: 'ar', label: 'Arabic' },
  { code: 'hi', label: 'Hindi' },
  { code: 'bn', label: 'Bangla' },
  { code: 'ja', label: 'Nihongo' },
  { code: 'ko', label: 'Hangugeo' },
  { code: 'zh', label: 'Zhongwen' },
  { code: 'id', label: 'Bahasa Indonesia' },
  { code: 'vi', label: 'Tieng Viet' }
];

const TRANSLATIONS = {
  en: {
    dashboard: 'Dashboard',
    clips: 'My Clips',
    favorites: 'Favorites',
    community: 'Community',
    settings: 'Settings',
    adminPanel: 'Admin Panel',
    signOut: 'Sign Out',
    linked: 'Mac linked',
    missing: 'Mac link missing',
    theme: 'Theme',
    language: 'Language'
  },
  es: { dashboard: 'Panel', clips: 'Mis Clips', favorites: 'Favoritos', community: 'Comunidad', settings: 'Ajustes', adminPanel: 'Panel Admin', signOut: 'Cerrar sesion', linked: 'Mac vinculada', missing: 'Falta vinculo Mac', theme: 'Tema', language: 'Idioma' },
  fr: { dashboard: 'Tableau', clips: 'Mes Clips', favorites: 'Favoris', community: 'Communaute', settings: 'Parametres', adminPanel: 'Admin', signOut: 'Deconnexion', linked: 'Mac liee', missing: 'Lien Mac manquant', theme: 'Theme', language: 'Langue' },
  de: { dashboard: 'Dashboard', clips: 'Meine Clips', favorites: 'Favoriten', community: 'Community', settings: 'Einstellungen', adminPanel: 'Admin', signOut: 'Abmelden', linked: 'Mac verknupft', missing: 'Mac-Link fehlt', theme: 'Design', language: 'Sprache' },
  pt: { dashboard: 'Painel', clips: 'Meus Clipes', favorites: 'Favoritos', community: 'Comunidade', settings: 'Configuracoes', adminPanel: 'Admin', signOut: 'Sair', linked: 'Mac vinculada', missing: 'Falta vinculo Mac', theme: 'Tema', language: 'Idioma' },
  it: { dashboard: 'Dashboard', clips: 'I miei clip', favorites: 'Preferiti', community: 'Community', settings: 'Impostazioni', adminPanel: 'Admin', signOut: 'Esci', linked: 'Mac collegato', missing: 'Link Mac mancante', theme: 'Tema', language: 'Lingua' },
  nl: { dashboard: 'Dashboard', clips: 'Mijn clips', favorites: 'Favorieten', community: 'Community', settings: 'Instellingen', adminPanel: 'Beheer', signOut: 'Uitloggen', linked: 'Mac gekoppeld', missing: 'Mac-link ontbreekt', theme: 'Thema', language: 'Taal' },
  ru: { dashboard: 'Panel', clips: 'Moi klipy', favorites: 'Izbrannoe', community: 'Soobshchestvo', settings: 'Nastroiki', adminPanel: 'Admin', signOut: 'Vyti', linked: 'Mac podklyuchena', missing: 'Net svyazi s Mac', theme: 'Tema', language: 'Yazyk' },
  uk: { dashboard: 'Panel', clips: 'Moi klipy', favorites: 'Ulyublene', community: 'Spilnota', settings: 'Nalashtuvannya', adminPanel: 'Admin', signOut: 'Vyity', linked: 'Mac pidklyucheno', missing: 'Nemaie zviazku Mac', theme: 'Tema', language: 'Mova' },
  tr: { dashboard: 'Panel', clips: 'Kliplerim', favorites: 'Favoriler', community: 'Topluluk', settings: 'Ayarlar', adminPanel: 'Yonetici', signOut: 'Cikis', linked: 'Mac bagli', missing: 'Mac baglantisi eksik', theme: 'Tema', language: 'Dil' },
  ar: { dashboard: 'Lohat al-tahakkum', clips: 'Maqati', favorites: 'Almufaddala', community: 'Almujtama', settings: 'Al-iidadat', adminPanel: 'Al-idara', signOut: 'Tسجيل الخروج', linked: 'Mac marbuta', missing: 'Rabt Mac ghayr mawjud', theme: 'Alnamat', language: 'Allugha' },
  hi: { dashboard: 'Dashboard', clips: 'Mere Clips', favorites: 'Pasandida', community: 'Samuday', settings: 'Settings', adminPanel: 'Admin', signOut: 'Sign Out', linked: 'Mac linked', missing: 'Mac link missing', theme: 'Theme', language: 'Bhasha' },
  bn: { dashboard: 'Dashboard', clips: 'Amar clips', favorites: 'Prio', community: 'Community', settings: 'Settings', adminPanel: 'Admin', signOut: 'Sign Out', linked: 'Mac linked', missing: 'Mac link missing', theme: 'Theme', language: 'Bhasha' },
  ja: { dashboard: 'Dashibodo', clips: 'My Clips', favorites: 'Okiniiri', community: 'Komyuniti', settings: 'Settei', adminPanel: 'Admin', signOut: 'Sign Out', linked: 'Mac linked', missing: 'Mac link missing', theme: 'Theme', language: 'Gengo' },
  ko: { dashboard: 'Daesibodeu', clips: 'Nae keullip', favorites: 'Jeulgyeochatgi', community: 'Keomyuniti', settings: 'Seoljeong', adminPanel: 'Admin', signOut: 'Sign Out', linked: 'Mac linked', missing: 'Mac link missing', theme: 'Theme', language: 'Eoneo' },
  zh: { dashboard: 'Yibiaopan', clips: 'Wo de clip', favorites: 'Shoucang', community: 'Shequ', settings: 'Shezhi', adminPanel: 'Guanli', signOut: 'Tuichu', linked: 'Mac yi lianjie', missing: 'Mac wei lianjie', theme: 'Zhuti', language: 'Yuyan' },
  id: { dashboard: 'Dasbor', clips: 'Klip Saya', favorites: 'Favorit', community: 'Komunitas', settings: 'Pengaturan', adminPanel: 'Admin', signOut: 'Keluar', linked: 'Mac terhubung', missing: 'Tautan Mac belum ada', theme: 'Tema', language: 'Bahasa' },
  vi: { dashboard: 'Bang dieu khien', clips: 'Clip cua toi', favorites: 'Yeu thich', community: 'Cong dong', settings: 'Cai dat', adminPanel: 'Admin', signOut: 'Dang xuat', linked: 'Mac da lien ket', missing: 'Thieu lien ket Mac', theme: 'Giao dien', language: 'Ngon ngu' }
};

function detectLanguage() {
  if (typeof window === 'undefined') {
    return 'en';
  }

  const stored = String(window.localStorage.getItem(LANGUAGE_STORAGE_KEY) || '').trim().toLowerCase();
  if (SUPPORTED_LANGUAGES.some((item) => item.code === stored)) {
    return stored;
  }

  const browser = String(window.navigator.language || 'en').toLowerCase().split('-')[0];
  return SUPPORTED_LANGUAGES.some((item) => item.code === browser) ? browser : 'en';
}

function detectTheme() {
  if (typeof window === 'undefined') {
    return 'dark';
  }

  const stored = String(window.localStorage.getItem(THEME_STORAGE_KEY) || '').trim().toLowerCase();
  if (stored === 'dark' || stored === 'light') {
    return stored;
  }

  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function navClassName({ isActive }) {
  return [
    'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
    isActive ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
  ].join(' ');
}

function TopNav({ currentUser, canAccessAdmin = false, onSignOut }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [linkedAppState, setLinkedAppState] = useState(() => readLinkedAppState(currentUser?.id));
  const [theme, setTheme] = useState(() => detectTheme());
  const [language, setLanguage] = useState(() => detectLanguage());
  const menuRef = useRef(null);
  const displayName = displayNameFromUser(currentUser);
  const initials = initialsFromName(displayName);
  const avatarURL = avatarURLFromUser(currentUser);
  const verifiedProfile = isVerifiedProfile(currentUser?.user_metadata, displayName);

  const t = useMemo(() => TRANSLATIONS[language] || TRANSLATIONS.en, [language]);

  const primaryNavItems = useMemo(() => ([
      { label: t.dashboard, icon: LayoutDashboard, path: '/dashboard' },
      { label: t.clips, icon: Clipboard, path: '/clips' },
      { label: t.favorites, icon: Star, path: '/favorites' },
      { label: t.community, icon: Film, path: '/community' }
    ]), [t]);

  const menuItems = useMemo(() => {
    const items = [
      ...primaryNavItems
    ];

    if (currentUser?.id) {
      items.push({ label: 'Profile', icon: UserRound, path: `/profile/${currentUser.id}` });
    }

    items.push({ label: t.settings, icon: Settings, path: '/settings' });

    if (canAccessAdmin) {
      items.push({ label: t.adminPanel, icon: Shield, path: '/admin' });
    }

    return items;
  }, [canAccessAdmin, currentUser?.id, primaryNavItems, t]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.documentElement.setAttribute('data-theme', theme);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  }, [theme]);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('lang', language);
      document.documentElement.setAttribute('dir', ['ar', 'he', 'fa', 'ur'].includes(language) ? 'rtl' : 'ltr');
    }

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    }
  }, [language]);

  const handleLanguageChange = (event) => {
    const nextLanguage = String(event.target.value || 'en').trim().toLowerCase();
    setLanguage(nextLanguage);
    applySiteLanguage(nextLanguage, { reload: true });
  };

  useEffect(() => {
    const handleClick = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    const nextState = readLinkedAppState(currentUser?.id);
    setLinkedAppState(nextState);

    return subscribeToLinkedAppState(currentUser?.id, setLinkedAppState);
  }, [currentUser?.id]);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-card/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 md:px-8">
        <Link to="/" className="flex shrink-0 items-center gap-2.5 transition-opacity hover:opacity-80">
          <img src={BRAND_ICON_URL} alt="MacClipper" className="h-8 w-8 rounded-lg" />
          <span className="text-base font-bold tracking-tight text-foreground">MacClipper</span>
        </Link>

        <nav className="hidden flex-1 items-center gap-1 md:flex">
          {primaryNavItems.map((item) => (
            <NavLink key={item.path} to={item.path} className={navClassName}>
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden items-center gap-2 md:flex">
            <button
              type="button"
              onClick={() => setTheme((currentTheme) => currentTheme === 'dark' ? 'light' : 'dark')}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-2 text-xs font-medium text-foreground hover:bg-muted"
              title={t.theme}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
            </button>
            <div className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1.5">
              <Languages className="h-4 w-4 text-muted-foreground" />
              <select
                value={language}
                onChange={handleLanguageChange}
                className="bg-transparent text-xs text-foreground outline-none"
                aria-label={t.language}
              >
                {SUPPORTED_LANGUAGES.map((item) => (
                  <option key={item.code} value={item.code}>{item.label}</option>
                ))}
              </select>
            </div>
          </div>

          <NotificationsMenu currentUser={currentUser} />

          <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((currentValue) => !currentValue)}
            className="flex items-center gap-2 transition-opacity hover:opacity-80 focus:outline-none"
          >
            {avatarURL ? (
              <img src={avatarURL} alt={displayName} className="h-9 w-9 rounded-full border-2 border-border object-cover" />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-border bg-primary/15 text-sm font-bold text-primary">
                {initials}
              </div>
            )}
            <span className="hidden items-center gap-2 text-sm font-medium text-foreground md:inline-flex">
              <span>{displayName}</span>
              {verifiedProfile ? <span className="clip-verified-badge" title="Verified MacClipper owner">✓</span> : null}
            </span>
            <ChevronDown className="hidden h-4 w-4 text-muted-foreground md:block" />
          </button>

          {menuOpen ? (
            <div className="absolute right-0 top-12 z-50 w-56 overflow-hidden rounded-xl border border-border bg-card shadow-xl">
              <div className="border-b border-border px-4 py-3">
                <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <span>{displayName}</span>
                  {verifiedProfile ? <span className="clip-verified-badge" title="Verified MacClipper owner">✓</span> : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">{currentUser?.email}</p>
                <p className="mt-1 text-[11px] font-medium text-primary">
                  {linkedAppState.linked ? t.linked : t.missing}
                </p>
              </div>
              <div className="py-1">
                {menuItems.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-muted"
                  >
                    <item.icon className="h-4 w-4 text-muted-foreground" />
                    {item.label}
                  </NavLink>
                ))}
              </div>
              <div className="border-t border-border py-1">
                <button
                  type="button"
                  onClick={onSignOut}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-destructive transition-colors hover:bg-destructive/10"
                >
                  <LogOut className="h-4 w-4" />
                  {t.signOut}
                </button>
              </div>
            </div>
          ) : null}
          </div>
        </div>
      </div>

      <nav className="flex items-center justify-around border-t border-border bg-card py-1 md:hidden">
        {primaryNavItems.map((item) => (
          <NavLink key={item.path} to={item.path} className={({ isActive }) => [
            'flex flex-col items-center gap-0.5 px-3 py-2 text-xs transition-colors',
            isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
          ].join(' ')}>
            <item.icon className="h-5 w-5" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </header>
  );
}

export default TopNav;