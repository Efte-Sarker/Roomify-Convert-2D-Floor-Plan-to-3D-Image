import { useRef, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router';
import { ArrowLeft, Eye, ImagePlay, Save } from 'lucide-react';
import RoomEditor from '../../components/RoomEditor';
import FloorPlan3DViewer from '../../components/FloorPlan3DViewer';
import { createProject } from '../../lib/puter.action';

export function meta() {
  return [{ title: 'Floor Plan Editor — Roomify' }];
}

export default function EditorPage() {
  const navigate       = useNavigate();
  const { isSignedIn } = useOutletContext();
  const editorRef      = useRef(null);

  const [layout,    setLayout]  = useState(null);
  const [show3D,    setShow3D]  = useState(false);
  const [saving,    setSaving]  = useState(false);
  const [saveError, setSaveErr] = useState(null);

  const hasRooms = (layout?.rooms?.length ?? 0) > 0;

  const doSave = async (navigateAfter) => {
    if (!hasRooms || saving) return;
    if (!isSignedIn) { setSaveErr('Please sign in to save projects.'); return; }
    setSaving(true); setSaveErr(null);
    try {
      const png   = editorRef.current?.exportPNG();
      if (!png) throw new Error('Failed to export floor plan image.');
      const newId = Date.now().toString();
      const name  = `Residence ${newId}`;
      const saved = await createProject({
        item: { id: newId, name, sourceImage: png, renderedImage: null, timestamp: Date.now() },
        visibility: 'private',
      });
      if (!saved) throw new Error('Failed to save project.');
      if (navigateAfter) {
        navigate(`/visualizer/${newId}`, {
          state: { initialImage: png, initialRendered: null, name, editorLayout: layout },
        });
      }
    } catch (e) {
      setSaveErr(e.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const F = 'Inter, sans-serif';

  /* ── Navbar button base ── */
  const navBtn = (primary) => ({
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '7px 14px', borderRadius: 7, fontFamily: F,
    fontSize: 13, fontWeight: primary ? 600 : 500,
    border: primary ? 'none' : '1px solid #e4e4e7',
    background: primary ? '#18181b' : '#fff',
    color: primary ? '#fff' : '#374151',
    cursor: saving ? 'not-allowed' : 'pointer',
    opacity: (!hasRooms && primary) ? 0.4 : (saving && primary ? 0.6 : 1),
    transition: 'opacity .15s',
  });

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      fontFamily: F, background: '#fff', overflow: 'hidden',
    }}>

      {/* ── Top Navigation Bar ───────────────────────────────────────────────── */}
      <header style={{
        height: 52, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px', borderBottom: '1px solid #e8e8e8',
        background: '#fff', zIndex: 50,
      }}>

        {/* Left — Back + separator + title, all equally spaced */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => navigate('/')} style={navBtn(false)}>
            <ArrowLeft size={14} />
            Back
          </button>
          <div style={{ width: 1, height: 20, background: '#e4e4e7' }} />
          <span style={{ fontSize: 15, fontWeight: 700, color: '#111', letterSpacing: '-0.3px' }}>
            Floor Plan Editor
          </span>
        </div>

        {/* Right — action buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>

          {/* Preview 3D */}
          <button disabled={!hasRooms} onClick={() => hasRooms && setShow3D(true)} style={navBtn(false)}>
            <Eye size={14} />
            Preview 3D
          </button>

          {/* Render Image */}
          <button disabled={!hasRooms || saving} onClick={() => doSave(true)} style={navBtn(false)}>
            <ImagePlay size={14} />
            Render Image
          </button>

          {/* Save */}
          <button disabled={!hasRooms || saving} onClick={() => doSave(false)} style={navBtn(true)}>
            {saving ? (
              <>
                <div style={{
                  width: 12, height: 12,
                  border: '2px solid rgba(255,255,255,0.3)',
                  borderTopColor: '#fff', borderRadius: '50%',
                  animation: 'edSpin 0.8s linear infinite',
                }} />
                Saving…
              </>
            ) : (
              <><Save size={14} /> Save</>
            )}
          </button>
        </div>
      </header>

      {/* ── Error bar ── */}
      {saveError && (
        <div style={{
          background: '#fef2f2', color: '#dc2626',
          padding: '8px 20px', fontSize: 12,
          borderBottom: '1px solid #fecaca', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          {saveError}
          <button onClick={() => setSaveErr(null)} style={{
            background: 'none', border: 'none', color: '#dc2626',
            cursor: 'pointer', fontSize: 14, lineHeight: 1,
          }}>✕</button>
        </div>
      )}

      {/* ── Editor (fills remaining height) ── */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <RoomEditor
          ref={editorRef}
          onLayoutChange={setLayout}
          onPreview3D={() => hasRooms && setShow3D(true)}
          onRender={() => doSave(true)}
          onSave={() => doSave(false)}
          saving={saving}
        />
      </div>

      {/* ── 3D viewer overlay ── */}
      {show3D && layout && (
        <FloorPlan3DViewer layout={layout} mode="fullscreen" onClose={() => setShow3D(false)} />
      )}

      <style>{`
        @keyframes edSpin { to { transform: rotate(360deg); } }
        *, *::before, *::after { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 4px; }
      `}</style>
    </div>
  );
}