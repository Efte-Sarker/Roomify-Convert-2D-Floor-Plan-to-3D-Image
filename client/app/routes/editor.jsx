import { useRef, useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate, useOutletContext, useLocation } from 'react-router';
import { ArrowLeft, Plus, Trash2, X } from 'lucide-react';
import RoomEditor from '../../components/RoomEditor';
import FloorPlan3DViewer from '../../components/FloorPlan3DViewer';
import { createProject, updateProject, deleteProject } from '../../lib/puter.action';

// User-scoped localStorage key for editor draft — prevents cross-user leakage
const DRAFT_PREFIX = 'roomify_editor_draft';
const LAST_USER_KEY = 'roomify_last_user_id';
const getDraftKey = (uid) => uid ? `${DRAFT_PREFIX}_${uid}` : DRAFT_PREFIX;

// Auto-save to DB interval (ms) — debounce so we don't flood the server
const DB_SAVE_DEBOUNCE = 3000;

export function meta() {
  return [{ title: 'Floor Plan Editor — Roomify' }];
}

export default function EditorPage() {
  const navigate           = useNavigate();
  const location           = useLocation();
  const { isSignedIn, userId } = useOutletContext();
  const editorRef          = useRef(null);

  // Compute user-scoped draft key. On first render userId may be null (auth
  // hasn't resolved yet), so fall back to the persisted last-user-id which is
  // available synchronously from localStorage.
  const resolvedUid = userId || (() => { try { return localStorage.getItem(LAST_USER_KEY); } catch { return null; } })();
  const draftKey = getDraftKey(resolvedUid);

  // ── Source-aware back navigation ──────────────────────────────────────────
  // If opened from History → My Plan, go back to /history.
  // Otherwise (Home buttons, direct URL) go back to /.
  const backDestination = location.state?.from === 'history' ? '/history' : '/';

  // ── Active project ID tracking ────────────────────────────────────────────
  // If opened from History with an existing project, use that ID.
  // If opened fresh (Draw Floor Plan / New Floor Plan), start with null.
  // A new DB record is created on first auto-save and the ID is stored here.
  const [activeProjectId, setActiveProjectId] = useState(() => {
    // Prefer the projectId explicitly passed via router state (History → My Plan)
    if (location.state?.projectId) return location.state.projectId;
    // Fall back to the projectId stamped inside the localStorage draft so that
    // resuming via "Continue Planning" reuses the existing DB record instead of
    // creating a duplicate project on the first auto-save cycle.
    try {
      const raw = localStorage.getItem(getDraftKey(resolvedUid));
      if (raw) {
        const d = JSON.parse(raw);
        if (d?.projectId) return d.projectId;
      }
    } catch { /* ignore */ }
    return null;
  });
  const activeProjectIdRef = useRef(activeProjectId);
  useEffect(() => { activeProjectIdRef.current = activeProjectId; }, [activeProjectId]);

  // ── Sync projectId into localStorage draft ─────────────────────────────────
  // Stamp the draft so "Continue Planning" on Home reuses the same project
  // instead of creating a duplicate (fix #3).
  useEffect(() => {
    if (!activeProjectId) return;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const d = JSON.parse(raw);
        d.projectId = activeProjectId;
        localStorage.setItem(draftKey, JSON.stringify(d));
      }
    } catch { /* ignore */ }
  }, [activeProjectId, draftKey]);

  const [layout,      setLayout]    = useState(null);
  const [show3D,      setShow3D]    = useState(false);
  const [saving,      setSaving]    = useState(false);
  const [saveError,   setSaveErr]   = useState(null);
  const [autoSaved,   setAutoSaved] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Track whether a DB auto-save is pending (dirty since last server save)
  const dirtyRef        = useRef(false);
  const dbSaveTimerRef  = useRef(null);
  const isSavingToDbRef = useRef(false);

  // ── Resolve initialState once on mount ──────────────────────────────────────
  const initialState = useMemo(() => {
    // 1. Prefer the snapshot passed explicitly via router state (from History or Continue Planning)
    if (location.state?.editorState) {
      const state = location.state.editorState;
      // Stamp the projectId from router state into the state object so it persists correctly
      if (location.state?.projectId && !state.projectId) {
        return { ...state, projectId: location.state.projectId };
      }
      return state;
    }
    // 2. Fall back to user-scoped localStorage draft
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) return JSON.parse(raw);
    } catch {
      // Corrupt or missing draft — start fresh
    }
    return null;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — intentionally run once

  const hasRooms = layout?.rooms?.length > 0;

  // ── DB auto-save ──────────────────────────────────────────────────────────
  const saveToDb = useCallback(async () => {
    if (isSavingToDbRef.current || !isSignedIn) return;
    if (!dirtyRef.current) return;

    const editorState = editorRef.current?.getEditorState?.();
    if (!editorState) return;
    // Allow saving empty rooms for existing projects (reflects removal actions)
    // but don't create brand-new projects with zero rooms.
    const currentId = activeProjectIdRef.current;
    if (!editorState.rooms?.length && !currentId) return;

    // Clear dirty flag BEFORE the async operation so that if state changes
    // during the save, handleAutoSave will set it back to true and trigger
    // another save cycle — preventing the race condition where intermediate
    // changes (e.g. adding a bathroom) were silently dropped.
    dirtyRef.current = false;
    isSavingToDbRef.current = true;

    try {
      const layoutJson = JSON.stringify(editorState);
      const png = editorRef.current?.exportPNG?.();

      if (currentId) {
        // Update existing project
        await updateProject({
          id: currentId,
          changes: {
            layoutJson,
            sourceImage: png || undefined,
            name: `Floor Plan ${currentId}`,
          },
        });
      } else {
        // First save — create a new project record
        const newId = Date.now().toString();
        const name  = `Floor Plan ${newId}`;
        const saved = await createProject({
          item: {
            id: newId,
            name,
            type: 'created',
            sourceImage: png || null,
            renderedImage: null,
            layoutJson,
            timestamp: Date.now(),
          },
          visibility: 'private',
        });
        if (saved) {
          setActiveProjectId(saved.id);
          activeProjectIdRef.current = saved.id;
        }
      }
    } catch (e) {
      // On failure, re-mark dirty so the next cycle retries
      dirtyRef.current = true;
      console.error('[editor] DB auto-save failed:', e);
    } finally {
      isSavingToDbRef.current = false;
    }
  }, [isSignedIn]);

  // Schedule periodic DB saves when dirty
  useEffect(() => {
    dbSaveTimerRef.current = setInterval(() => {
      if (dirtyRef.current && isSignedIn) {
        saveToDb();
      }
    }, DB_SAVE_DEBOUNCE);
    return () => clearInterval(dbSaveTimerRef.current);
  }, [saveToDb, isSignedIn]);

  // ── Flush pending changes on page unload ──────────────────────────────────
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!dirtyRef.current || !isSignedIn) return;
      const currentId = activeProjectIdRef.current;
      if (!currentId) return;
      const editorState = editorRef.current?.getEditorState?.();
      if (!editorState) return;
      const layoutJson = JSON.stringify(editorState);
      // keepalive lets the request outlive the page
      try {
        fetch(`/api/projects/${encodeURIComponent(currentId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          keepalive: true,
          body: JSON.stringify({ layoutJson }),
        });
      } catch { /* best effort */ }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isSignedIn]);

  // ── Render handler ────────────────────────────────────────────────────────
  const handleSave = async (navigateAfter = true) => {
    if (!hasRooms || saving) return;
    if (!isSignedIn) { setSaveErr('auth_required'); return; }
    setSaving(true); setSaveErr(null);
    try {
      const png = editorRef.current?.exportPNG();
      if (!png) throw new Error('Failed to export floor plan image.');

      const editorState = editorRef.current?.getEditorState?.();
      const layoutJson = editorState ? JSON.stringify(editorState) : null;

      // Persist draft to localStorage
      if (editorState) {
        try { localStorage.setItem(draftKey, JSON.stringify(editorState)); } catch { /* quota */ }
      }

      let projectId = activeProjectIdRef.current;

      if (projectId) {
        // Update the existing project
        await updateProject({
          id: projectId,
          changes: { layoutJson, sourceImage: png },
        });
      } else {
        // Create a new project
        projectId = Date.now().toString();
        const name = `Floor Plan ${projectId}`;
        const saved = await createProject({
          item: {
            id: projectId,
            name,
            type: 'created',
            sourceImage: png,
            renderedImage: null,
            layoutJson,
            timestamp: Date.now(),
          },
          visibility: 'private',
        });
        if (!saved) throw new Error('Failed to save project.');
        projectId = saved.id;
        setActiveProjectId(projectId);
        activeProjectIdRef.current = projectId;
      }

      if (navigateAfter) {
        navigate(`/visualizer/${projectId}`, {
          state: {
            initialImage: png,
            initialRendered: null,
            name: `Floor Plan ${projectId}`,
            editorLayout: layout,
            projectId,
          },
        });
      }
    } catch (e) {
      setSaveErr(e.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  // ── Auto-save visual feedback + mark dirty for DB save ────────────────────
  const handleAutoSave = useCallback((editorState) => {
    setAutoSaved(true);
    const timer = setTimeout(() => setAutoSaved(false), 2000);
    // Only mark dirty when there is actual content worth saving:
    // — at least one room has been drawn, OR
    // — an existing project record is open (so removals are persisted too).
    // This prevents a blank canvas (floor area set, no rooms) from ever
    // triggering a DB write and appearing in History.
    if (editorState?.rooms?.length > 0 || activeProjectIdRef.current) {
      dirtyRef.current = true;
    }
    return () => clearTimeout(timer);
  }, []);

  // ── Clear handler (with confirmation) ──────────────────────────────────────
  const handleClear = () => setShowClearConfirm(true);
  const cancelClear = () => setShowClearConfirm(false);
  const confirmClear = async () => {
    const projectId = activeProjectIdRef.current;

    // Delete the project from the database if it exists so it no longer
    // appears in History. Do this before resetting local state.
    if (projectId && isSignedIn) {
      try {
        await deleteProject({ id: projectId });
      } catch (e) {
        console.error('[editor] Failed to delete project on clear:', e);
      }
    }

    // Clear localStorage draft
    try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
    // Reset editor state via ref — no page reload needed
    editorRef.current?.fullClear?.();
    // Reset project tracking so next save creates a fresh record
    setActiveProjectId(null);
    activeProjectIdRef.current = null;
    dirtyRef.current = false;
    setLayout(null);
    setShowClearConfirm(false);
  };

  // ── New handler (save current project first, then start fresh) ─────────────
  const handleNew = async () => {
    // If there are rooms on canvas, persist them to DB before resetting
    if (hasRooms && isSignedIn) {
      setSaving(true); setSaveErr(null);
      try {
        await saveToDb();
      } catch (e) {
        setSaveErr(e.message || 'Save failed. Your current project was not saved.');
        setSaving(false);
        return;
      }
      setSaving(false);
    }
    // Clear draft, reset project ID, and reload into a fresh editor
    try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
    // Navigate to editor without any state — fresh session
    navigate('/editor', { replace: true });
    window.location.reload();
  };

  const btnBase = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, fontFamily: '"Instrument Serif", serif', transition: 'background 0.15s' };

  return (
    <div style={{ height: '100vh', background: '#fff', display: 'flex', flexDirection: 'column', fontFamily: '"Instrument Serif", serif', overflow: 'hidden' }}>

      {/* Header */}
      <header style={{ borderBottom: '1px solid #e4e4e7', padding: '0 24px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button onClick={() => navigate(backDestination)} style={{ ...btnBase, background: 'transparent', color: '#374151', padding: '6px 0 6px 10px' }}>
            <ArrowLeft size={15} />
            Back
          </button>
          <div style={{ width: 1, height: 20, background: '#e4e4e7' }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: '#000' }}>Floor Plan Editor</span>
          {/* Auto-save indicator */}
          {autoSaved && (
            <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 500, transition: 'opacity 0.3s', opacity: 1 }}>
              Saved!
            </span>
          )}
          {/* Resume indicator — shown when a draft was loaded */}
          {initialState && (
            <span style={{ fontSize: 11, color: '#6b7280', background: '#f4f4f5', padding: '2px 8px', borderRadius: 12 }}>
              Resumed draft
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={handleNew}
            disabled={saving}
            style={{ ...btnBase, background: '#f4f4f5', color: '#000', opacity: saving ? 0.4 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}
          >
            <Plus size={14} />
            New
          </button>
          <button
            onClick={() => hasRooms && setShow3D(true)}
            disabled={!hasRooms}
            style={{ ...btnBase, background: '#f4f4f5', color: '#000', opacity: hasRooms ? 1 : 0.4, cursor: hasRooms ? 'pointer' : 'not-allowed' }}
          >
            Preview 3D
          </button>
          <button
            onClick={() => handleSave(true)}
            disabled={!hasRooms || saving}
            style={{ ...btnBase, background: '#f4f4f5', color: '#000', opacity: hasRooms && !saving ? 1 : 0.4, cursor: hasRooms && !saving ? 'pointer' : 'not-allowed' }}
          >
            Render
          </button>
          <button
            onClick={handleClear}
            disabled={!hasRooms}
            style={{ ...btnBase, background: '#000', color: '#fff', opacity: hasRooms ? 1 : 0.4, cursor: hasRooms ? 'pointer' : 'not-allowed' }}
          >
            <Trash2 size={14} />
            Clear
          </button>
        </div>
      </header>

      {/* Error bar */}
      {saveError && (
        <div style={{ background: '#fef2f2', color: '#dc2626', padding: '10px 24px', fontSize: 13, borderBottom: '1px solid #fecaca', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span>
            {saveError === 'auth_required' ? (
              <>
                Please{' '}
                <strong
                  style={{ cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={() => navigate('/login')}
                >
                  log in
                </strong>
                {' '}to render your plan.
              </>
            ) : saveError}
          </span>
          <button
            onClick={() => setSaveErr(null)}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#dc2626', padding: '2px 4px', display: 'flex', alignItems: 'center', flexShrink: 0 }}
            title="Dismiss"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* Canvas area — pass initialState so RoomEditor seeds its state from the draft */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <RoomEditor ref={editorRef} onLayoutChange={setLayout} onAutoSave={handleAutoSave} initialState={initialState} draftKey={draftKey} onSetupCancel={() => navigate('/')} />
      </div>

      {/* 3D viewer */}
      {show3D && layout && (
        <FloorPlan3DViewer layout={layout} mode="fullscreen" onClose={() => setShow3D(false)} />
      )}

      {/* Clear confirmation popup */}
      {showClearConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: '32px 36px', width: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.18)', fontFamily: '"Instrument Serif", serif' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: '#000' }}>Clear Floor Plan?</h3>
            <p style={{ margin: '0 0 28px', fontSize: 14, color: '#71717a', lineHeight: 1.5 }}>
              This will remove all rooms, furniture, doors, and windows from the canvas. This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={cancelClear} style={{ ...btnBase, background: '#f4f4f5', color: '#000', padding: '10px 24px' }}>
                No
              </button>
              <button onClick={confirmClear} style={{ ...btnBase, background: '#dc2626', color: '#fff', padding: '10px 24px' }}>
                Yes, Clear
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes edSpin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}