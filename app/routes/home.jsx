import Navbar from "../../components/Navbar";
import { ArrowRight, Layers, PenLine, Plus } from "lucide-react";
import Upload from "../../components/Upload";
import { useNavigate, useOutletContext } from "react-router";
import { useEffect, useRef, useState } from "react";
import { createProject, updateProject, getProjects } from "../../lib/puter.action";

// User-scoped localStorage key for editor draft
const DRAFT_PREFIX = 'roomify_editor_draft';
const LAST_USER_KEY = 'roomify_last_user_id';
const getDraftKey = (uid) => uid ? `${DRAFT_PREFIX}_${uid}` : DRAFT_PREFIX;

export function meta() {
  return [
    { title: "Roomify — Design, Visualize & Render Spaces" },
    { name: "description", content: "From layout to lifelike render in one seamless flow" },
  ];
}

export default function Home() {
  const navigate = useNavigate();
  const { isSignedIn, userId } = useOutletContext();
  const isCreatingProjectRef = useRef(false);
  const [savingNewPlan, setSavingNewPlan] = useState(false);
  const [hasProjects, setHasProjects] = useState(false);
  const [latestProject, setLatestProject] = useState(null);

  // Compute user-scoped draft key.
  const resolvedUid = userId || (() => { try { return localStorage.getItem(LAST_USER_KEY); } catch { return null; } })();
  const draftKey = getDraftKey(resolvedUid);

  // ── Draft & DB Project detection ─────────────────────────────────────────────
  const [draft, setDraft] = useState(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.rooms) && parsed.rooms.length > 0) {
          setDraft(parsed);
        } else {
          setDraft(null);
        }
      } else {
        setDraft(null);
      }
    } catch {
      setDraft(null);
    }
  }, [draftKey]);

  useEffect(() => {
    if (isSignedIn) {
      getProjects({ type: 'created' }).then(projects => {
        setHasProjects(projects.length > 0);
        if (projects.length > 0) {
          // Find the newest project by timestamp
          const latest = [...projects].sort((a, b) => b.timestamp - a.timestamp)[0];
          setLatestProject(latest);
        } else {
          setLatestProject(null);
        }
      });
    } else {
      setHasProjects(false);
      setLatestProject(null);
    }
  }, [isSignedIn]);

  const handleContinuePlanning = () => {
    if (draft) {
      // Resolve the best known projectId: prefer the one stamped in the draft,
      // fall back to the latest DB project so we never create a duplicate.
      const resolvedProjectId = draft.projectId || (latestProject?.id ?? null);
      navigate('/editor', {
        state: { editorState: draft, projectId: resolvedProjectId, from: 'home' },
      });
    } else if (latestProject) {
      // Fallback: no local draft, but user has a project in DB
      try {
        const editorState = JSON.parse(latestProject.layoutJson);
        navigate('/editor', { state: { editorState, projectId: latestProject.id, from: 'home' } });
      } catch (e) {
        console.error("Failed to parse latest project layoutJson", e);
      }
    }
  };

  // ── "New Floor Plan" handler ─────────────────────────────────────────────────
  const handleNewFloorPlan = async () => {
    if (savingNewPlan) return;

    // Only save the existing draft to DB if it actually has content (rooms drawn).
    // An empty draft (floor area set but no rooms) must NOT create a history entry.
    const draftHasContent = draft && Array.isArray(draft.rooms) && draft.rooms.length > 0;

    if (draftHasContent && isSignedIn) {
      setSavingNewPlan(true);
      try {
        if (draft.projectId) {
          // Project already exists in DB — update it (no duplicate creation)
          await updateProject({
            id: draft.projectId,
            changes: { layoutJson: JSON.stringify(draft) },
          });
        } else {
          // No DB record yet — create one
          const newId = Date.now().toString();
          const name  = `Floor Plan ${newId}`;
          const placeholderPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQABNjN9GQAAAAlwSFlzAAAWJQAAFiUBSVIk8AAAABl0RVh0U29mdHdhcmUAcGFpbnQubmV0IDQuMC4xMkMEa+wAAAANSURBVBhXY/j//z8DAAj8Av6IXwbgAAAAAElFTkSuQmCC';
          await createProject({
            item: {
              id: newId, name, type: 'created',
              sourceImage: placeholderPng, renderedImage: null,
              layoutJson: JSON.stringify(draft), timestamp: Date.now(),
            },
            visibility: 'private',
          });
        }
      } catch (e) {
        console.error('Failed to save current draft before starting new plan:', e);
      } finally {
        setSavingNewPlan(false);
      }
    }

    // Clear the global draft and navigate to a fresh editor
    try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
    navigate('/editor', { state: { from: 'home' } });
  };

  const handleUploadComplete = async (base64Image) => {
    try {
      if (isCreatingProjectRef.current) return false;
      isCreatingProjectRef.current = true;
      const newId = Date.now().toString();
      const name = `Residence ${newId}`;

      const newItem = {
        id: newId,
        name,
        type: 'uploaded',
        sourceImage: base64Image,
        renderedImage: undefined,
        timestamp: Date.now(),
      };

      const saved = await createProject({ item: newItem, visibility: "private" });

      if (!saved) {
        console.error("Failed to create project");
        return false;
      }

      navigate(`/visualizer/${newId}`, {
        state: {
          initialImage: saved.sourceImage,
          initialRendered: saved.renderedImage || null,
          name,
        },
      });

      return true;
    } finally {
      isCreatingProjectRef.current = false;
    }
  };

  const canContinue = draft || latestProject;

  return (
    <div className="home">
      <Navbar />

      <section className="hero">
        <h1>Render, Design, and Visualize Spaces Effortlessly</h1>

        <p className="subtitle">
          From layout to lifelike render in one seamless flow
        </p>

        <div className="home-grid">
          <div className="home-card home-card--upload">
            <h2 className="home-card__title">Upload 2D Image</h2>
            <Upload onComplete={handleUploadComplete} />
          </div>

          <div className="home-card home-card--floorplan">
            <h2 className="home-card__title home-card__title--light">Floor Plan</h2>

            <div className="floorplan-buttons">
              <button
                className="floorplan-btn"
                onClick={handleNewFloorPlan}
                disabled={savingNewPlan}
              >
                {savingNewPlan ? 'Saving…' : 'Draw'}
              </button>

              <button
                className="floorplan-btn"
                onClick={handleContinuePlanning}
                disabled={!canContinue}
                title={draft
                  ? `Resume local draft saved ${new Date(draft.savedAt).toLocaleString()}`
                  : latestProject
                    ? `Continue planning from your latest project`
                    : 'No saved floor plan draft found'}
              >
                Continue
              </button>
            </div>
            
            <p className="floorplan-subtext">Start building your floor plan from<br /> Scratch & Continue anytime</p>
          </div>
        </div>
      </section>
    </div>
  );
}