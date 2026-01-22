import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { toast, Toaster } from 'react-hot-toast';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import { Extension, type JSONContent } from '@tiptap/core';
import QRCode from 'qrcode';
import Sidebar, { type SidebarItem } from './components/Sidebar.js';
import StatusHud from './components/StatusHud.js';
import PasswordModal from './components/PasswordModal.js';
import ExpiryModal from './components/ExpiryModal.js';
import ShortcutsModal from './components/ShortcutsModal.js';
import LinkModal from './components/LinkModal.js';

const emptyDoc: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph' }]
};

type DocResponse = {
  id: string;
  content: JSONContent;
  expiresAt: string | null;
  hasPassword: boolean;
};

type DocStatus = 'loading' | 'ready' | 'password' | 'expired' | 'notfound' | 'error';

type AuthUser = {
  id: number;
  email: string;
  createdAt: string;
};

type FavoriteItem = {
  id: number | string;
  url: string;
  title: string;
  createdAt: string;
  source: 'server' | 'local';
};

type FavoriteMeta = {
  hasPassword?: boolean;
  expiresAt?: string | null;
};

type Route =
  | { kind: 'doc'; id?: string }
  | { kind: 'login' }
  | { kind: 'register' };

const parseRoute = (path: string): Route => {
  if (path === '/new') return { kind: 'doc' };
  if (path === '/login') return { kind: 'login' };
  if (path === '/register') return { kind: 'register' };
  const match = path.match(/^\/d\/([A-Za-z0-9_-]+)$/);
  if (match) return { kind: 'doc', id: match[1] };
  return { kind: 'doc' };
};

const formatError = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
};

const extractTitleFromContent = (content: JSONContent | null | undefined) => {
  const walk = (node: JSONContent | undefined): string | null => {
    if (!node) return null;
    if (node.type === 'heading' || node.type === 'paragraph') {
      const text = node.content
        ?.filter((child) => child.type === 'text' && typeof child.text === 'string')
        .map((child) => child.text)
        .join('')
        .trim();
      if (text) return text;
    }
    if (node.content && Array.isArray(node.content)) {
      for (const child of node.content) {
        const found = walk(child);
        if (found) return found;
      }
    }
    return null;
  };
  const title = walk(content ?? undefined);
  if (!title) return null;
  return title.length > 80 ? `${title.slice(0, 77)}…` : title;
};

const LOCAL_FAVORITES_KEY = 'pb_local_favorites';

const normalizeUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed, window.location.origin);
    let href = url.href;
    if (href.endsWith('/') && url.pathname !== '/') {
      href = href.slice(0, -1);
    }
    return href;
  } catch {
    return trimmed;
  }
};

const loadLocalFavorites = (): FavoriteItem[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LOCAL_FAVORITES_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as Array<Partial<FavoriteItem>>;
    if (!Array.isArray(data)) return [];
    const results: FavoriteItem[] = [];
    for (const item of data) {
      const url = typeof item.url === 'string' ? item.url : '';
      if (!url) continue;
      results.push({
        id: item.id ?? normalizeUrl(url),
        url,
        title: typeof item.title === 'string' ? item.title : 'Untitled',
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
        source: 'local'
      });
    }
    return results;
  } catch {
    return [];
  }
};

const saveLocalFavorites = (items: FavoriteItem[]) => {
  if (typeof window === 'undefined') return;
  const payload = items.map((item) => ({
    id: item.id,
    url: item.url,
    title: item.title,
    createdAt: item.createdAt
  }));
  localStorage.setItem(LOCAL_FAVORITES_KEY, JSON.stringify(payload));
};

const App = () => {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  const [docId, setDocId] = useState<string | null>(null);
  const [docStatus, setDocStatus] = useState<DocStatus>('loading');
  const [docContent, setDocContent] = useState<JSONContent>(emptyDoc);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [hasPassword, setHasPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [expiryModalOpen, setExpiryModalOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState<string>('');
  const [expiryPreset, setExpiryPreset] = useState('10m');
  const [customExpiry, setCustomExpiry] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const autosaveTimer = useRef<number | null>(null);
  const pendingSave = useRef(false);
  const [editorScale, setEditorScale] = useState(1);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authIdentifier, setAuthIdentifier] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [favoritesLoading, setFavoritesLoading] = useState(false);
  const [favoritesError, setFavoritesError] = useState('');
  const [favoritesOpen, setFavoritesOpen] = useState(() => window.location.pathname === '/');
  const [editingFavoriteId, setEditingFavoriteId] = useState<number | string | null>(null);
  const [editingFavoriteTitle, setEditingFavoriteTitle] = useState('');
  const [currentUrl, setCurrentUrl] = useState(() => window.location.href);
  const [favoriteMeta, setFavoriteMeta] = useState<Record<string, FavoriteMeta>>({});
  const scaleMin = 0.8;
  const scaleMax = 1.6;
  const scaleStep = 0.1;
  const modKey = useMemo(() => {
    if (typeof navigator === 'undefined') return 'cmd';
    const platform = navigator.platform ?? '';
    return /Mac|iPhone|iPad|iPod/.test(platform) ? 'cmd' : 'ctrl';
  }, []);

  const navigate = useCallback((path: string) => {
    window.history.pushState(null, '', path);
    setRoute(parseRoute(path));
    if (path === '/') {
      setFavoritesOpen(true);
    }
  }, []);

  useEffect(() => {
    const handlePop = () => {
      setRoute(parseRoute(window.location.pathname));
    };
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, []);

  useEffect(() => {
    setCurrentUrl(window.location.href);
  }, [route, docId]);

  const editor = useEditor({
    extensions: [
      Extension.create({
        name: 'markdownBackspace',
        addKeyboardShortcuts() {
          return {
            'Mod-e': () => true,
            Backspace: () => {
              const { state } = this.editor;
              const { selection } = state;
              if (!selection.empty) return false;
              const { $from } = selection;
              if ($from.parentOffset !== 0) return false;

              let marker: string | null = null;
              let needsLiftList = false;

              const parentName = $from.parent.type.name;
              if (parentName === 'heading') {
                const level = $from.parent.attrs.level ?? 1;
                marker = `${'#'.repeat(level)} `;
              } else if (parentName === 'codeBlock') {
                marker = '```';
              }

              for (let depth = $from.depth; depth > 0; depth -= 1) {
                const node = $from.node(depth);
                if (node.type.name === 'blockquote') {
                  marker = '> ';
                  break;
                }
                if (node.type.name === 'bulletList') {
                  marker = '- ';
                  needsLiftList = true;
                  break;
                }
                if (node.type.name === 'orderedList') {
                  marker = '1. ';
                  needsLiftList = true;
                  break;
                }
              }

              if (!marker) return false;

              const chain = this.editor.chain().focus();
              if (needsLiftList) {
                chain.liftListItem('listItem').liftListItem('listItem');
              }
              chain.clearNodes().insertContent(marker).run();
              return true;
            }
          };
        }
      }),
      Link.configure({
        autolink: true,
        linkOnPaste: true,
        openOnClick: false
      }),
      StarterKit,
      Placeholder.configure({
        placeholder: 'Start typing...'
      })
    ],
    content: docContent,
    editorProps: {
      attributes: {
        class:
          'tiptap prose-invert max-w-none text-lg leading-relaxed text-white caret-white'
      }
    }
  });

  useEffect(() => {
    const stored = localStorage.getItem('editor-scale');
    if (!stored) return;
    const value = Number(stored);
    if (!Number.isNaN(value)) {
      setEditorScale(Math.min(scaleMax, Math.max(scaleMin, value)));
    }
  }, []);

  const persistScale = useCallback((value: number) => {
    setEditorScale(value);
    localStorage.setItem('editor-scale', value.toString());
  }, []);

  const increaseScale = useCallback(() => {
    persistScale(Math.min(scaleMax, Number((editorScale + scaleStep).toFixed(2))));
  }, [editorScale, persistScale]);

  const decreaseScale = useCallback(() => {
    persistScale(Math.max(scaleMin, Number((editorScale - scaleStep).toFixed(2))));
  }, [editorScale, persistScale]);

  const resetScale = useCallback(() => {
    persistScale(1);
  }, [persistScale]);


  useEffect(() => {
    if (!editor) return;
    editor.commands.setContent(docContent);
  }, [docContent, editor]);

  const getPublicUrl = useCallback(
    (id: string) => {
      const origin = baseUrl || window.location.origin;
      return `${origin.replace(/\/$/, '')}/d/${id}`;
    },
    [baseUrl]
  );

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/config');
      if (!res.ok) return;
      const data = await res.json();
      if (data.baseUrl) setBaseUrl(data.baseUrl);
    } catch {
      // ignore config errors
    }
  }, []);

  const fetchMe = useCallback(async () => {
    setAuthLoading(true);
    setAuthError('');
    try {
      const res = await fetch('/auth/me');
      if (!res.ok) {
        setAuthUser(null);
        return;
      }
      const data = (await res.json()) as { user: AuthUser | null };
      setAuthUser(data.user ?? null);
    } catch {
      setAuthUser(null);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const fetchServerFavorites = useCallback(async () => {
    const res = await fetch('/api/favorites');
    if (res.status === 401) return [];
    if (!res.ok) {
      throw new Error('Unable to load favorites.');
    }
    const data = (await res.json()) as { favorites: Array<Omit<FavoriteItem, 'source'>> };
    return (data.favorites ?? []).map((favorite) => ({
      ...favorite,
      source: 'server' as const
    }));
  }, []);

  const mergeLocalFavoritesToServer = useCallback(
    async (serverFavorites: FavoriteItem[]) => {
      const localFavorites = loadLocalFavorites();
      if (!localFavorites.length) return false;
      const serverUrls = new Set(serverFavorites.map((fav) => normalizeUrl(fav.url)));
      const toUpload = localFavorites.filter(
        (favorite) => !serverUrls.has(normalizeUrl(favorite.url))
      );
      if (!toUpload.length) {
        localStorage.removeItem(LOCAL_FAVORITES_KEY);
        return true;
      }
      for (const favorite of toUpload) {
        const res = await fetch('/api/favorites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: favorite.url, title: favorite.title })
        });
        if (!res.ok) {
          return false;
        }
      }
      localStorage.removeItem(LOCAL_FAVORITES_KEY);
      return true;
    },
    []
  );

  const submitAuth = useCallback(async () => {
    setAuthSubmitting(true);
    setAuthError('');
    try {
      const endpoint = route.kind === 'register' ? '/auth/register' : '/auth/login';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authIdentifier, password: authPassword })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setAuthError(body.error || 'Unable to sign in');
        return;
      }
      const data = (await res.json()) as { user: AuthUser };
      setAuthUser(data.user);
      setAuthIdentifier('');
      setAuthPassword('');
      navigate('/');
    } finally {
      setAuthSubmitting(false);
    }
  }, [authIdentifier, authPassword, navigate, route.kind]);

  const logout = useCallback(async () => {
    await fetch('/auth/logout', { method: 'POST' });
    setAuthUser(null);
    setFavorites(loadLocalFavorites());
  }, []);

  const loadFavorites = useCallback(async () => {
    setFavoritesLoading(true);
    setFavoritesError('');
    try {
      if (!authUser) {
        setFavorites(loadLocalFavorites());
        return;
      }
      const serverFavorites = await fetchServerFavorites();
      await mergeLocalFavoritesToServer(serverFavorites);
      const refreshed = await fetchServerFavorites();
      setFavorites(refreshed);
    } catch (error) {
      setFavoritesError(formatError(error));
    } finally {
      setFavoritesLoading(false);
    }
  }, [authUser, fetchServerFavorites, mergeLocalFavoritesToServer]);

  useEffect(() => {
    fetchMe().catch(() => {
      // handled in fetchMe
    });
  }, [fetchMe]);

  useEffect(() => {
    if (route.kind === 'login' || route.kind === 'register') {
      setAuthError('');
    }
  }, [route.kind]);

  useEffect(() => {
    loadFavorites().catch(() => {
      // handled in loadFavorites
    });
  }, [authUser, loadFavorites]);

  useEffect(() => {
    if (window.location.pathname === '/') {
      setFavoritesOpen(true);
    }
  }, []);

  const addFavorite = useCallback(
    async (url: string, title: string) => {
      const normalizedUrl = normalizeUrl(url);
      if (!normalizedUrl) return null;
      const now = new Date().toISOString();
      if (!authUser) {
        const favorite: FavoriteItem = {
          id: normalizedUrl,
          url: normalizedUrl,
          title,
          createdAt: now,
          source: 'local'
        };
        setFavorites((prev) => {
          const next = [favorite, ...prev.filter((item) => normalizeUrl(item.url) !== normalizedUrl)];
          saveLocalFavorites(next);
          return next;
        });
        return favorite;
      }
      const res = await fetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, url: normalizedUrl })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setFavoritesError(body.error || 'Unable to add favorite.');
        return null;
      }
      const data = (await res.json()) as { favorite: Omit<FavoriteItem, 'source'> };
      const favorite: FavoriteItem = { ...data.favorite, source: 'server' };
      setFavorites((prev) => [favorite, ...prev.filter((item) => normalizeUrl(item.url) !== normalizedUrl)]);
      return favorite;
    },
    [authUser]
  );

  const removeFavorite = useCallback(
    async (favorite: FavoriteItem) => {
      if (favorite.source === 'local' || !authUser) {
        setFavorites((prev) => {
          const next = prev.filter((item) => item.id !== favorite.id);
          saveLocalFavorites(next);
          return next;
        });
        return true;
      }
      const res = await fetch(`/api/favorites/${favorite.id}`, { method: 'DELETE' });
      if (!res.ok) {
        setFavoritesError('Unable to remove favorite.');
        return false;
      }
      setFavorites((prev) => prev.filter((item) => item.id !== favorite.id));
      return true;
    },
    [authUser]
  );

  const updateFavoriteTitle = useCallback(
    async (favorite: FavoriteItem, title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      if (favorite.source === 'local' || !authUser) {
        setFavorites((prev) => {
          const next = prev.map((item) =>
            item.id === favorite.id ? { ...item, title: trimmed } : item
          );
          saveLocalFavorites(next);
          return next;
        });
        return;
      }
      const created = await addFavorite(favorite.url, trimmed);
      if (!created) return;
      await removeFavorite(favorite);
    },
    [addFavorite, authUser, removeFavorite]
  );

  const normalizedCurrentUrl = useMemo(() => normalizeUrl(currentUrl), [currentUrl]);

  const currentFavorite = useMemo(() => {
    if (!normalizedCurrentUrl) return null;
    return favorites.find((favorite) => normalizeUrl(favorite.url) === normalizedCurrentUrl) ?? null;
  }, [favorites, normalizedCurrentUrl]);

  const getDefaultFavoriteTitle = useCallback(() => {
    if (route.kind === 'doc') {
      const fromDoc = extractTitleFromContent(docContent);
      if (fromDoc) return fromDoc;
      if (docId) return `Paste ${docId}`;
      return 'Untitled paste';
    }
    if (route.kind === 'login') return 'Login';
    if (route.kind === 'register') return 'Register';
    return 'Pastebin';
  }, [docContent, docId, route.kind]);

  const toggleFavorite = useCallback(async () => {
    if (!normalizedCurrentUrl) return;
    if (currentFavorite) {
      await removeFavorite(currentFavorite);
      toast.success('Removed from favorites');
      return;
    }
    const title = getDefaultFavoriteTitle();
    const created = await addFavorite(normalizedCurrentUrl, title);
    if (created) {
      const shouldAutoOpen =
        route.kind !== 'doc' || !extractTitleFromContent(docContent);
      if (shouldAutoOpen) {
        setFavoritesOpen(true);
        setEditingFavoriteId(created.id);
        setEditingFavoriteTitle(created.title);
      }
      toast.success('Added to favorites');
    }
  }, [addFavorite, currentFavorite, getDefaultFavoriteTitle, normalizedCurrentUrl, removeFavorite]);

  useEffect(() => {
    if (!favoritesOpen) {
      setEditingFavoriteId(null);
      setEditingFavoriteTitle('');
    }
  }, [favoritesOpen]);

  useEffect(() => {
    if (!favoritesOpen || favorites.length === 0) return;
    let active = true;
    const fetchMeta = async () => {
      const nextMeta: Record<string, FavoriteMeta> = {};
      for (const favorite of favorites) {
        try {
          const url = new URL(favorite.url, window.location.origin);
          if (url.origin !== window.location.origin) continue;
          const match = url.pathname.match(/^\/d\/([A-Za-z0-9_-]+)$/);
          if (!match) continue;
          const res = await fetch(`/api/docs/${match[1]}`);
          if (res.status === 401) {
            nextMeta[favorite.id.toString()] = { hasPassword: true };
            continue;
          }
          if (!res.ok) continue;
          const data = (await res.json()) as { hasPassword?: boolean; expiresAt?: string | null };
          nextMeta[favorite.id.toString()] = {
            hasPassword: Boolean(data.hasPassword),
            expiresAt: data.expiresAt ?? null
          };
        } catch {
          // ignore metadata errors
        }
      }
      if (active) {
        setFavoriteMeta((prev) => ({ ...prev, ...nextMeta }));
      }
    };
    fetchMeta();
    return () => {
      active = false;
    };
  }, [favorites, favoritesOpen]);

  const createDoc = useCallback(async (mode: 'replace' | 'new-window' = 'replace') => {
    if (mode === 'replace') {
      setDocStatus('loading');
    }
    const res = await fetch('/api/docs', { method: 'POST' });
    if (!res.ok) {
      if (mode === 'replace') {
        setDocStatus('error');
      }
      setErrorMessage('Unable to create doc.');
      return;
    }
    const data = (await res.json()) as { id: string };
    if (mode === 'new-window') {
      window.open(`/d/${data.id}`, '_blank', 'noopener');
      return;
    }
    window.history.replaceState(null, '', `/d/${data.id}`);
    setRoute({ kind: 'doc', id: data.id });
    setDocId(data.id);
    setDocContent(emptyDoc);
    setExpiresAt(null);
    setPassword('');
    setHasPassword(false);
    setDocStatus('ready');
  }, [setRoute]);

  const loadDoc = useCallback(
    async (id: string, providedPassword?: string) => {
      setDocStatus('loading');
      setErrorMessage('');
      const headers: Record<string, string> = {};
      if (providedPassword) headers['x-doc-password'] = providedPassword;
      const res = await fetch(`/api/docs/${id}`, { headers });
      if (res.status === 401) {
        setDocStatus('password');
        return;
      }
      if (res.status === 404) {
        const body = await res.json().catch(() => ({}));
        setDocStatus(body.error === 'expired' ? 'expired' : 'notfound');
        return;
      }
      if (!res.ok) {
        setDocStatus('error');
        return;
      }
      const data = (await res.json()) as DocResponse;
      setDocContent(data.content ?? emptyDoc);
      setExpiresAt(data.expiresAt ?? null);
      setHasPassword(data.hasPassword);
      setDocStatus('ready');
    },
    []
  );

  const saveDoc = useCallback(async (contentOverride?: JSONContent) => {
    if (!docId || !editor) return;
    if (saving) {
      pendingSave.current = true;
      return;
    }
    setSaving(true);
    setErrorMessage('');
    const payload = contentOverride ?? editor.getJSON();
    const res = await fetch(`/api/docs/${docId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(password ? { 'x-doc-password': password } : {})
      },
      body: JSON.stringify({ content: payload })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setErrorMessage(body.error || 'Save failed');
    } else {
      const now = new Date().toLocaleTimeString();
      setSavedAt(now);
    }
    setSaving(false);
    if (pendingSave.current) {
      pendingSave.current = false;
      saveDoc().catch((error) => setErrorMessage(formatError(error)));
    }
  }, [docId, editor, password]);

  const setDocPassword = useCallback(
    async (value: string) => {
      if (!docId) return;
      if (hasPassword) {
        setErrorMessage('Password already set.');
        setPasswordModalOpen(false);
        return;
      }
      setErrorMessage('');
      const res = await fetch(`/api/docs/${docId}/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: value })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorMessage(body.error || 'Unable to set password');
        return;
      }
      setPassword(value);
      setHasPassword(true);
      setPasswordModalOpen(false);
    },
    [docId, hasPassword]
  );

  const setDocExpiry = useCallback(
    async (value: string | null) => {
      if (!docId) return;
      setErrorMessage('');
      const res = await fetch(`/api/docs/${docId}/expiry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresAt: value })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorMessage(body.error || 'Unable to set expiry');
        return;
      }
      setExpiresAt(value);
      setExpiryModalOpen(false);
    },
    [docId]
  );

  const generateQr = useCallback(async () => {
    if (!docId) return;
    const url = getPublicUrl(docId);
    const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 180 });
    setQrDataUrl(dataUrl);
  }, [docId, getPublicUrl]);

  const copyLink = useCallback(async () => {
    if (!docId) return;
    const url = getPublicUrl(docId);
    await navigator.clipboard.writeText(url);
    toast.success('Link copied', { duration: 1400 });
  }, [docId, getPublicUrl]);

  const openLinkModal = useCallback(() => {
    if (!editor) return;
    const current = editor.getAttributes('link')?.href ?? '';
    setLinkValue(current);
    setLinkModalOpen(true);
  }, [editor]);

  const applyLink = useCallback(() => {
    if (!editor) return;
    const trimmed = linkValue.trim();
    if (!trimmed) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      setLinkModalOpen(false);
      return;
    }
    const chain = editor.chain().focus().extendMarkRange('link');
    if (editor.state.selection.empty) {
      chain.insertContent(trimmed).setLink({ href: trimmed }).run();
    } else {
      chain.setLink({ href: trimmed }).run();
    }
    setLinkModalOpen(false);
  }, [editor, linkValue]);

  const handleExpirySubmit = useCallback(async () => {
    if (expiryPreset === 'custom') {
      if (!customExpiry) {
        setErrorMessage('Set a custom date/time.');
        return;
      }
      const value = new Date(customExpiry).toISOString();
      await setDocExpiry(value);
      return;
    }
    const now = Date.now();
    const map: Record<string, number> = {
      '10m': 10 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
      '1w': 7 * 24 * 60 * 60 * 1000
    };
    const value = new Date(now + map[expiryPreset]).toISOString();
    await setDocExpiry(value);
  }, [customExpiry, expiryPreset, setDocExpiry]);

  useEffect(() => {
    fetchConfig();
    if (route.kind !== 'doc') return;
    if (!route.id) {
      createDoc().catch((error) => {
        setDocStatus('error');
        setErrorMessage(formatError(error));
      });
      return;
    }
    const id = route.id;
    setDocId(id);
    loadDoc(id).catch((error) => {
      setDocStatus('error');
      setErrorMessage(formatError(error));
    });
  }, [createDoc, fetchConfig, loadDoc, route]);

  useEffect(() => {
    if (!editor || docStatus !== 'ready' || route.kind !== 'doc') return;
    const handleUpdate = () => {
      if (autosaveTimer.current) {
        window.clearTimeout(autosaveTimer.current);
      }
      autosaveTimer.current = window.setTimeout(() => {
        saveDoc().catch((error) => setErrorMessage(formatError(error)));
      }, 1500);
    };
    editor.on('update', handleUpdate);
    return () => {
      editor.off('update', handleUpdate);
      if (autosaveTimer.current) {
        window.clearTimeout(autosaveTimer.current);
        autosaveTimer.current = null;
      }
    };
  }, [docStatus, editor, route.kind, saveDoc]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (route.kind !== 'doc') return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveDoc().catch((error) => setErrorMessage(formatError(error)));
      }
      if (event.metaKey || event.ctrlKey) {
        if (event.key === '=' || event.key === '+') {
          event.preventDefault();
          increaseScale();
          return;
        }
        if (event.key === '-') {
          event.preventDefault();
          decreaseScale();
          return;
        }
        if (event.key === '0') {
          event.preventDefault();
          resetScale();
          return;
        }
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setMenuOpen((open) => !open);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === '.') {
        event.preventDefault();
        createDoc('new-window').catch((error) => setErrorMessage(formatError(error)));
      }
      if ((event.metaKey || event.ctrlKey) && event.key === '/') {
        event.preventDefault();
        setShortcutsOpen((open) => !open);
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        openLinkModal();
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        if (!hasPassword) {
          setPasswordModalOpen((open) => !open);
        }
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        setExpiryModalOpen((open) => !open);
      }
      if (event.key === 'Escape') {
        setMenuOpen(false);
        setPasswordModalOpen(false);
        setExpiryModalOpen(false);
        setShortcutsOpen(false);
        setLinkModalOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [decreaseScale, hasPassword, increaseScale, openLinkModal, resetScale, route.kind, saveDoc]);

  useEffect(() => {
    if (!menuOpen || route.kind !== 'doc') return;
    generateQr().catch(() => {
      // ignore QR errors
    });
  }, [generateQr, menuOpen, route.kind]);

  const menuItems: SidebarItem[] = useMemo(() => {
    const items: SidebarItem[] = [
      {
        label: 'Favorites',
        action: () => {
          setFavoritesOpen(true);
          setMenuOpen(false);
        }
      }
    ];
    if (route.kind === 'doc') {
      items.push(
        { label: 'New Doc', action: () => createDoc('replace') },
        { label: 'Copy Link', action: () => copyLink(), disabled: !docId },
        {
          label: hasPassword ? 'Password Set' : 'Set Password',
          action: () => setPasswordModalOpen(true),
          disabled: hasPassword || !docId
        },
        { label: 'Set Expiry', action: () => setExpiryModalOpen(true), disabled: !docId },
        { label: 'Shortcuts', action: () => setShortcutsOpen((open) => !open) }
      );
    }
    if (authUser) {
      items.push({
        label: 'Log out',
        action: () => logout().catch(() => null)
      });
    } else {
      items.push(
        { label: 'Log in', action: () => navigate('/login') },
        { label: 'Register', action: () => navigate('/register') }
      );
    }
    return items;
  }, [
    authUser,
    copyLink,
    createDoc,
    docId,
    hasPassword,
    logout,
    navigate,
    route.kind
  ]);


  if (route.kind === 'login' || route.kind === 'register') {
    const heading = route.kind === 'register' ? 'Create account' : 'Welcome back';
    const cta = route.kind === 'register' ? 'Create account' : 'Log in';
    const switchPath = route.kind === 'register' ? '/login' : '/register';
    const switchLabel =
      route.kind === 'register' ? 'Already have an account?' : 'Need an account?';
    const switchAction = route.kind === 'register' ? 'Log in' : 'Register';

    return (
      <div className="min-h-screen bg-black text-white">
        <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-10">
          <button
            className="mb-6 text-xs uppercase tracking-[0.2em] text-neutral-500"
            onClick={() => navigate('/')}
          >
            ← Back
          </button>
          <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-6 shadow-lg">
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-[0.25em] text-neutral-500">
                Minimal Auth
              </div>
              <h1 className="text-2xl font-semibold">{heading}</h1>
              <p className="text-sm text-neutral-400">
                Use your email to sync favourites between devices.
              </p>
            </div>
            <form
              className="mt-6 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                submitAuth().catch((error) => setAuthError(formatError(error)));
              }}
            >
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-neutral-500">
                  Email
                </label>
                <input
                  type="email"
                  value={authIdentifier}
                  onChange={(event) => setAuthIdentifier(event.target.value)}
                  className="w-full rounded-md border border-neutral-800 bg-black px-3 py-2 text-sm text-white"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-neutral-500">
                  Password
                </label>
                <input
                  type="password"
                  value={authPassword}
                  onChange={(event) => setAuthPassword(event.target.value)}
                  className="w-full rounded-md border border-neutral-800 bg-black px-3 py-2 text-sm text-white"
                />
              </div>
              {authError && <div className="text-xs text-red-400">{authError}</div>}
              <button
                type="submit"
                disabled={authSubmitting}
                className="w-full rounded-md border border-neutral-600 px-4 py-2 text-xs uppercase tracking-[0.3em] text-neutral-200 disabled:opacity-50"
              >
                {authSubmitting ? 'Working...' : cta}
              </button>
            </form>
            <div className="mt-6 flex items-center justify-between text-xs text-neutral-500">
              <span>{switchLabel}</span>
              <button
                className="uppercase tracking-[0.25em] text-neutral-200"
                onClick={() => navigate(switchPath)}
              >
                {switchAction}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (docStatus === 'expired') {
    return (
      <div className="min-h-screen bg-black text-white">
        <div className="px-8 py-10 text-sm text-neutral-400">Expired</div>
      </div>
    );
  }

  if (docStatus === 'notfound') {
    return (
      <div className="min-h-screen bg-black text-white">
        <div className="px-8 py-10 text-sm text-neutral-400">Not found</div>
      </div>
    );
  }

  if (docStatus === 'password') {
    return (
      <div className="min-h-screen bg-black text-white">
        <div className="px-8 py-10 max-w-sm space-y-4">
          <div className="text-sm text-neutral-400">Password required</div>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (docId) {
                  loadDoc(docId, password);
                }
              }
            }}
            className="w-full rounded-md bg-neutral-900 border border-neutral-700 px-3 py-2 text-sm text-white"
            autoFocus
          />
          <button
            className="rounded-md border border-neutral-600 px-3 py-2 text-xs uppercase tracking-widest text-neutral-200"
            onClick={() => docId && loadDoc(docId, password)}
          >
            Unlock
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-black text-white">
      <div className="editor-scroll h-full overflow-y-auto px-8 pb-10">
        <div className="sticky top-0 z-20 -mx-8 bg-black px-8 pt-6 pb-4">
          <StatusHud
            saving={saving}
            savedAt={savedAt}
            expiresAt={expiresAt}
            hasPassword={hasPassword}
            passwordSet={Boolean(password)}
            menuOpen={menuOpen}
            onMenuToggle={() => setMenuOpen((open) => !open)}
            leftActions={
              <div className="flex items-center gap-0">
                <button
                  className="flex h-8 w-8 items-center justify-center text-neutral-200"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleFavorite().catch(() => null);
                  }}
                  aria-label={currentFavorite ? 'Remove favorite' : 'Add favorite'}
                  type="button"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill={currentFavorite ? 'currentColor' : 'none'}
                  >
                    <path
                      d="M12 17.3l-5.2 3 1.2-5.9-4.4-4.2 6-.7L12 4l2.4 5.5 6 .7-4.4 4.2 1.2 5.9z"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                {authUser ? (
                  <button
                    className="flex h-8 w-8 items-center justify-center text-neutral-400 transition-colors hover:text-white"
                    onClick={(event) => {
                      event.stopPropagation();
                      setMenuOpen((open) => !open);
                    }}
                    aria-label="Open account menu"
                    type="button"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.4" />
                      <path
                        d="M5 19.5c1.6-3.2 4.1-4.8 7-4.8s5.4 1.6 7 4.8"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                ) : null}
              </div>
            }
          />
        </div>
        <div
          className="w-full space-y-4 editor-shell"
          style={{ '--editor-scale': editorScale } as Record<string, string | number>}
        >
          {docStatus === 'loading' && (
            <div className="text-xs uppercase tracking-widest text-neutral-500">Loading...</div>
          )}
          {docStatus === 'ready' && (
            <EditorContent editor={editor} />
          )}
        </div>
        {errorMessage && <div className="mt-2 text-xs text-red-400">{errorMessage}</div>}
      </div>

      {favoritesOpen && (
        <div
          className="fixed inset-0 z-30 flex items-start justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setFavoritesOpen(false)}
          role="button"
          tabIndex={-1}
        >
          <div
            className="mt-16 w-full max-w-2xl px-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="p-6 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-[0.25em] text-neutral-500">
                    {authUser ? 'Favorites' : 'Favorites (local)'}
                  </div>
                  <div className="text-lg font-semibold text-white">Saved links</div>
                </div>
                <button
                  className="rounded-full border border-neutral-700 p-2 text-neutral-300"
                  onClick={() => setFavoritesOpen(false)}
                  aria-label="Close favorites"
                  type="button"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M6 6l12 12M18 6l-12 12"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>

              <div className="mt-4 space-y-3 text-sm text-neutral-400">
                {authLoading && authUser ? (
                  <div className="text-xs uppercase tracking-[0.2em] text-neutral-500">
                    Checking session...
                  </div>
                ) : null}
                {!authUser && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="rounded-md border border-neutral-700 px-3 py-2 text-xs uppercase tracking-[0.3em] text-neutral-200"
                      onClick={() => {
                        setFavoritesOpen(false);
                        navigate('/login');
                      }}
                    >
                      Log in
                    </button>
                    <button
                      className="rounded-md border border-neutral-700 px-3 py-2 text-xs uppercase tracking-[0.3em] text-neutral-200"
                      onClick={() => {
                        setFavoritesOpen(false);
                        navigate('/register');
                      }}
                    >
                      Register
                    </button>
                  </div>
                )}
                {favoritesError && <div className="text-xs text-red-400">{favoritesError}</div>}
              </div>

              <div className="mt-4 max-h-[60vh] space-y-3 overflow-y-auto pr-1">
                {favoritesLoading ? (
                  <div className="text-xs uppercase tracking-[0.2em] text-neutral-500">
                    Loading...
                  </div>
                ) : favorites.length === 0 ? (
                  <div className="text-sm text-neutral-500">No favorites yet.</div>
                ) : (
                  favorites.map((favorite) => {
                    const isEditing = editingFavoriteId === favorite.id;
                    const meta = favoriteMeta[favorite.id.toString()];
                    return (
                      <div
                        key={favorite.id}
                        className="flex flex-col gap-3 rounded-xl border border-neutral-800 bg-black/40 p-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="space-y-2">
                          {isEditing ? (
                            <input
                              value={editingFavoriteTitle}
                              onChange={(event) => setEditingFavoriteTitle(event.target.value)}
                              className="w-full rounded-md border border-neutral-800 bg-black px-3 py-2 text-sm text-white"
                              autoFocus
                            />
                          ) : (
                            <button
                              className="text-left text-sm font-medium text-white"
                              onClick={() => {
                                setFavoritesOpen(false);
                                window.location.href = favorite.url;
                              }}
                              type="button"
                            >
                              {favorite.title}
                            </button>
                          )}
                          {(meta?.hasPassword || meta?.expiresAt) && (
                            <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-400">
                              {meta?.hasPassword && (
                                <span className="inline-flex items-center gap-1">
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                                    <path
                                      d="M7 10V7a5 5 0 0 1 10 0v3"
                                      stroke="currentColor"
                                      strokeWidth="1.5"
                                      strokeLinecap="round"
                                    />
                                    <rect
                                      x="5"
                                      y="10"
                                      width="14"
                                      height="10"
                                      rx="2"
                                      stroke="currentColor"
                                      strokeWidth="1.5"
                                    />
                                  </svg>
                                  Locked
                                </span>
                              )}
                              {meta?.expiresAt && (
                                <span>Expires {new Date(meta.expiresAt).toLocaleString()}</span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {isEditing ? (
                            <>
                              <button
                                className="rounded-md border border-neutral-700 px-3 py-2 text-xs uppercase tracking-[0.3em] text-neutral-200"
                                onClick={() => {
                                  updateFavoriteTitle(favorite, editingFavoriteTitle).catch(() => null);
                                  setEditingFavoriteId(null);
                                  setEditingFavoriteTitle('');
                                }}
                              >
                                Save
                              </button>
                              <button
                                className="rounded-md border border-transparent px-3 py-2 text-xs uppercase tracking-[0.3em] text-neutral-500"
                                onClick={() => {
                                  setEditingFavoriteId(null);
                                  setEditingFavoriteTitle('');
                                }}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                className="rounded-md border border-neutral-700 px-3 py-2 text-xs uppercase tracking-[0.3em] text-neutral-200"
                                onClick={() => {
                                  setEditingFavoriteId(favorite.id);
                                  setEditingFavoriteTitle(favorite.title);
                                }}
                              >
                                Edit
                              </button>
                              <button
                                className="rounded-md border border-neutral-700 px-3 py-2 text-xs uppercase tracking-[0.3em] text-neutral-200"
                                onClick={() => removeFavorite(favorite).catch(() => null)}
                              >
                                Remove
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <Sidebar
        open={menuOpen}
        items={menuItems}
        qrDataUrl={qrDataUrl}
        onClose={() => setMenuOpen(false)}
        footer={
          authUser ? (
            <div className="mt-4 border-t border-neutral-900 pt-4 text-center text-[10px] uppercase tracking-[0.2em] text-neutral-500">
              {authUser.email}
            </div>
          ) : null
        }
      />
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 1400,
          style: {
            background: 'rgba(20, 20, 20, 0.92)',
            color: '#d7d7d7',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '999px',
            boxShadow: '0 12px 30px rgba(0, 0, 0, 0.4)',
            backdropFilter: 'blur(10px)',
            padding: '8px 14px',
            fontSize: '0.7rem',
            letterSpacing: '0.12em',
            textTransform: 'uppercase'
          },
          success: {
            iconTheme: {
              primary: '#a3f2c2',
              secondary: '#0f1513'
            }
          }
        }}
      />

      <PasswordModal
        open={passwordModalOpen}
        password={password}
        onPasswordChange={setPassword}
        onSave={() => setDocPassword(password)}
        onClose={() => setPasswordModalOpen(false)}
      />
      <ExpiryModal
        open={expiryModalOpen}
        expiryPreset={expiryPreset}
        customExpiry={customExpiry}
        onPresetChange={setExpiryPreset}
        onCustomChange={setCustomExpiry}
        onSave={() => handleExpirySubmit()}
        onClose={() => setExpiryModalOpen(false)}
      />
      <ShortcutsModal open={shortcutsOpen} modKey={modKey} onClose={() => setShortcutsOpen(false)} />
      <LinkModal
        open={linkModalOpen}
        value={linkValue}
        onChange={setLinkValue}
        onSave={applyLink}
        onClose={() => setLinkModalOpen(false)}
      />

    </div>
  );
};

export default App;
