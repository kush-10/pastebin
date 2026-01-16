import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import toast, { Toaster } from 'react-hot-toast';
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
import TextScaleControl from './components/TextScaleControl.js';

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

const formatError = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
};


const App = () => {
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
  const scaleMin = 0.8;
  const scaleMax = 1.6;
  const scaleStep = 0.1;
  const modKey = useMemo(() => {
    if (typeof navigator === 'undefined') return 'cmd';
    const platform = navigator.platform ?? '';
    return /Mac|iPhone|iPad|iPod/.test(platform) ? 'cmd' : 'ctrl';
  }, []);

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
    setDocId(data.id);
    setDocContent(emptyDoc);
    setExpiresAt(null);
    setPassword('');
    setHasPassword(false);
    setDocStatus('ready');
  }, []);

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
    const match = window.location.pathname.match(/^\/d\/([A-Za-z0-9_-]+)$/);
    if (!match) {
      createDoc().catch((error) => {
        setDocStatus('error');
        setErrorMessage(formatError(error));
      });
      return;
    }
    const id = match[1];
    setDocId(id);
    loadDoc(id).catch((error) => {
      setDocStatus('error');
      setErrorMessage(formatError(error));
    });
  }, [createDoc, fetchConfig, loadDoc]);

  useEffect(() => {
    if (!editor || docStatus !== 'ready') return;
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
  }, [docStatus, editor, saveDoc]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
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
  }, [decreaseScale, hasPassword, increaseScale, openLinkModal, resetScale, saveDoc]);

  useEffect(() => {
    if (!menuOpen) return;
    generateQr().catch(() => {
      // ignore QR errors
    });
  }, [generateQr, menuOpen]);

  const menuItems: SidebarItem[] = useMemo(
    () => [
      { label: 'New Doc', action: () => createDoc('new-window') },
      { label: 'Copy Link', action: () => copyLink() },
      { label: hasPassword ? 'Password Set' : 'Set Password', action: () => setPasswordModalOpen(true), disabled: hasPassword },
      { label: 'Set Expiry', action: () => setExpiryModalOpen(true) },
      { label: 'Shortcuts', action: () => setShortcutsOpen((open) => !open) }
    ],
    [copyLink, createDoc, hasPassword]
  );


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
            scaleControl={
              <TextScaleControl
                scale={editorScale}
                min={scaleMin}
                max={scaleMax}
                step={scaleStep}
                onChange={persistScale}
              />
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

      <Sidebar
        open={menuOpen}
        items={menuItems}
        qrDataUrl={qrDataUrl}
        onClose={() => setMenuOpen(false)}
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
