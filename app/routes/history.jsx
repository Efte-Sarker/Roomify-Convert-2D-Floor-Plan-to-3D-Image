import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router';
import {
  Box, Clock, ArrowLeft, Image, LayoutDashboard,
  ImageOff, FolderOpen, Trash2, AlertTriangle,
} from 'lucide-react';
import { getProjects, getAllRenders, deleteProject, deleteRender } from '../../lib/puter.action';

export function meta() {
  return [{ title: 'History — Roomify' }];
}

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ─── Navbar ───────────────────────────────────────────────────────────────────
function HistoryNavbar() {
  const { isSignedIn, userName, signOut } = useOutletContext();
  const navigate = useNavigate();
  const handleSignOut = async () => { try { await signOut(); navigate('/login'); } catch (e) { console.error(e); } };
  const btnBase = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, transition: 'background 0.15s' };
  return (
    <header className="navbar">
      <nav className="inner">
        <div className="left">
          <div className="brand" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
            <Box className="logo" />
            <span className="name">Roomify</span>
          </div>
        </div>
        <div className="actions">
          {isSignedIn ? (
            <>
              <span className="greeting">{userName ? `Hi, ${userName}` : 'Signed in'}</span>
              <button onClick={handleSignOut} style={{ ...btnBase, background: '#000', color: '#fff' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#27272a')}
                onMouseLeave={e => (e.currentTarget.style.background = '#000')}>
                Log Out
              </button>
            </>
          ) : (
            <>
              <button onClick={() => navigate('/login')} style={{ ...btnBase, background: 'transparent', color: '#374151', border: '1px solid #e4e4e7' }}>Log In</button>
              <button onClick={() => navigate('/signup')} style={{ ...btnBase, background: '#000', color: '#fff' }}>Sign Up</button>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}

// ─── Delete Confirmation Modal — matches RoomEditor popup style exactly ───────
function DeleteModal({ target, type, onConfirm, onCancel }) {
  const label = type === 'render' ? (target?.projectName || 'this render') : (target?.name || 'this plan');
  const btnBase = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 24px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, transition: 'background 0.15s' };
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
      onClick={onCancel}
    >
      <div
        style={{ background: '#fff', borderRadius: 12, padding: '32px 36px', width: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.18)' }}
        onClick={e => e.stopPropagation()}
      >
        <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: '#000' }}>
          Delete {type === 'render' ? 'Render' : 'Plan'}?
        </h3>
        <p style={{ margin: '0 0 28px', fontSize: 14, color: '#71717a', lineHeight: 1.5 }}>
          Are you sure you want to delete <strong>"{label}"</strong>? This action cannot be undone.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ ...btnBase, background: '#f4f4f5', color: '#000' }}>
            No
          </button>
          <button onClick={onConfirm} style={{ ...btnBase, background: '#dc2626', color: '#fff' }}>
            Yes, Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────
function EmptyState({ icon: Icon, title, body }) {
  return (
    <div className="history-empty">
      <div className="history-empty__icon"><Icon size={28} strokeWidth={1.5} /></div>
      <p className="history-empty__title">{title}</p>
      <p className="history-empty__body">{body}</p>
    </div>
  );
}

// ─── Render Image Card ────────────────────────────────────────────────────────
function RenderCard({ render, onClick, onDelete }) {
  return (
    <div className="history-card" onClick={onClick} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && onClick()}>
      <div className="history-card__preview">
        {render.renderedImage
          ? <img src={render.renderedImage} alt={render.projectName || 'Render'} />
          : <div className="history-card__no-img"><ImageOff size={24} /></div>}
      </div>
      <div className="history-card__body">
        <div className="history-card__info">
          <h3 className="history-card__name">{render.projectName || 'Untitled'}</h3>
          <div className="history-card__meta">
            <Clock size={11} />
            <span>{formatDate(render.timestamp)}</span>
          </div>
        </div>
        <button className="history-card__delete" title="Delete render" onClick={e => { e.stopPropagation(); onDelete(); }}>
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
}

// ─── Plan Card ────────────────────────────────────────────────────────────────
function PlanCard({ project, onClick, onDelete }) {
  return (
    <div className="history-card" onClick={onClick} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && onClick()}>
      <div className="history-card__preview">
        {project.sourceImage
          ? <img src={project.sourceImage} alt={project.name || 'Floor Plan'} />
          : <div className="history-card__no-img"><FolderOpen size={24} /></div>}
      </div>
      <div className="history-card__body">
        <div className="history-card__info">
          <h3 className="history-card__name">{project.name || 'Untitled'}</h3>
          <div className="history-card__meta">
            <Clock size={11} />
            <span>{formatDate(project.timestamp)}</span>
            {project.layoutJson && <span className="history-card__badge">Editable</span>}
          </div>
        </div>
        <button className="history-card__delete" title="Delete plan" onClick={e => { e.stopPropagation(); onDelete(); }}>
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function HistoryPage() {
  const navigate = useNavigate();
  const { isSignedIn } = useOutletContext();

  const [tab, setTab]               = useState('renders');
  const [planProjects, setPlanProjects] = useState([]);
  const [renders, setRenders]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      setLoading(true);
      const [plans, allRenders] = await Promise.all([getProjects({ type: 'created' }), getAllRenders()]);
      if (!cancelled) { setPlanProjects(plans); setRenders(allRenders); setLoading(false); }
    };
    fetchData();
    return () => { cancelled = true; };
  }, []);

  const openRender = (render) => {
    navigate(`/visualizer/${render.projectId}`, {
      state: { initialImage: render.sourceImage || null, initialRendered: render.renderedImage || null, name: render.projectName },
    });
  };

  const openPlan = (project) => {
    let editorState = null;
    if (project.layoutJson) {
      try {
        const parsed = JSON.parse(project.layoutJson);
        if (Array.isArray(parsed?.rooms) && parsed.rooms.length > 0) editorState = parsed;
      } catch { /* corrupt */ }
    }
    navigate('/editor', { state: { ...(editorState ? { editorState } : {}), projectId: project.id, from: 'history' } });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    const { item, type } = deleteTarget;
    setDeleteTarget(null);
    if (type === 'render') {
      const ok = await deleteRender({ renderId: item.id });
      if (ok) setRenders(prev => prev.filter(r => r.id !== item.id));
    } else {
      const ok = await deleteProject({ id: item.id });
      if (ok) setPlanProjects(prev => prev.filter(p => p.id !== item.id));
    }
  };

  return (
    <div className="history-page">
      <HistoryNavbar />

      {deleteTarget && (
        <DeleteModal
          target={deleteTarget.item}
          type={deleteTarget.type}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      <div className="history-content">

        {/* #2: Header row — title+back on LEFT, tabs on RIGHT via space-between */}
        <div className="history-header">
          <div className="history-header__left">
            <button className="history-back" onClick={() => navigate('/')}>
              <ArrowLeft size={15} />
              Back
            </button>
            <div>
              <h1 className="history-title">History</h1>
              <p className="history-subtitle">Your saved renders and floor plan projects.</p>
            </div>
          </div>

          {/* Tabs — right side of the header row */}
          <div className="history-tabs">
            <button className={`history-tab${tab === 'renders' ? ' active' : ''}`} onClick={() => setTab('renders')}>
              <Image size={14} />
              Render Images
              {renders.length > 0 && <span className="history-tab__count">{renders.length}</span>}
            </button>
            <button className={`history-tab${tab === 'plans' ? ' active' : ''}`} onClick={() => setTab('plans')}>
              <LayoutDashboard size={14} />
              My Plan
              {planProjects.length > 0 && <span className="history-tab__count">{planProjects.length}</span>}
            </button>
          </div>
        </div>

        <div className="history-grid-area">
          {loading ? (
            <div className="history-loading">
              <div className="history-spinner" />
              <span>Loading…</span>
            </div>
          ) : tab === 'renders' ? (
            renders.length === 0 ? (
              <EmptyState icon={Image} title="No renders yet" body="Generate a 3D render from a floor plan to see it here." />
            ) : (
              <div className="history-grid">
                {renders.map(r => (
                  <RenderCard key={r.id} render={r} onClick={() => openRender(r)} onDelete={() => setDeleteTarget({ item: r, type: 'render' })} />
                ))}
              </div>
            )
          ) : (
            planProjects.length === 0 ? (
              <EmptyState icon={FolderOpen} title="No saved plans" body="Draw a floor plan in the Editor and it will appear here." />
            ) : (
              <div className="history-grid">
                {planProjects.map(p => (
                  <PlanCard key={p.id} project={p} onClick={() => openPlan(p)} onDelete={() => setDeleteTarget({ item: p, type: 'plan' })} />
                ))}
              </div>
            )
          )}
        </div>

      </div>
    </div>
  );
}