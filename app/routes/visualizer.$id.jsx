import { useNavigate, useOutletContext, useParams } from "react-router";
import { useEffect, useRef, useState } from "react";
import { generate3DView } from "../../lib/ai.action";
import { ArrowLeft, Download, RefreshCcw, Share2 } from "lucide-react";
import Button from "../../components/ui/Button";
import { createProject, getProjectById, saveProjectRender } from "../../lib/puter.action";
import { ReactCompareSlider, ReactCompareSliderImage } from "react-compare-slider";

// Inline button style matching RoomEditor navbar buttons
const navBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '6px 0 6px 10px', background: 'transparent', border: 'none',
  color: '#374151', fontSize: 13, fontWeight: 500,
  cursor: 'pointer', fontFamily: 'Inter, sans-serif',
};

const VisualizerId = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { userId } = useOutletContext();

  const hasInitialGenerated = useRef(false);

  const [project, setProject] = useState(null);
  const [isProjectLoading, setIsProjectLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentImage, setCurrentImage] = useState(null);
  const [renderError, setRenderError] = useState(null);

  const handleBack = () => navigate("/");
  const handleExport = () => {
    if (!currentImage) return;
    const link = document.createElement("a");
    link.href = currentImage;
    link.download = `roomify-${id || "design"}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const runGeneration = async (item) => {
    if (isProcessing || !id || !item.sourceImage) return;
    try {
      setIsProcessing(true);
      setRenderError(null);
      // Pass layoutJson when available (editor-drawn plans) so the AI gets
      // the exact structured layout data and renders precisely.
      const result = await generate3DView({
        sourceImage: item.sourceImage,
        layoutJson:  item.layoutJson || null,
      });
      if (result.renderedImage) {
        setCurrentImage(result.renderedImage);
        await saveProjectRender({ projectId: id, renderedImage: result.renderedImage });
        const refreshed = await getProjectById({ id });
        if (refreshed) {
          setProject(refreshed);
          setCurrentImage(refreshed.renderedImage || result.renderedImage);
        }
      }
    } catch (error) {
      console.error("Generation failed:", error);
      const msg = error?.message || "";
      if (msg.includes("INSUFFICIENT_FUNDS")) {
        setRenderError("insufficient_funds");
      } else if (msg.includes("AUTH_REQUIRED")) {
        setRenderError("auth_required");
      } else {
        setRenderError(msg.replace(/^[A-Z_]+: /, "") || "AI render failed. Please try again.");
      }
    } finally {
      setIsProcessing(false);
    }
  };

  useEffect(() => {
    let isMounted = true;
    const loadProject = async () => {
      if (!id) { setIsProjectLoading(false); return; }
      setIsProjectLoading(true);
      console.log("[visualizer] Loading project:", id);
      const fetched = await getProjectById({ id });
      if (!isMounted) return;

      console.log("[visualizer] Loaded project:", {
        id: fetched?.id,
        hasSource: !!fetched?.sourceImage,
        hasRendered: !!fetched?.renderedImage,
        renderedLen: fetched?.renderedImage?.length || 0,
        name: fetched?.name,
      });

      setProject(fetched);
      setCurrentImage(fetched?.renderedImage || null);
      setIsProjectLoading(false);
      hasInitialGenerated.current = false;
    };
    loadProject();
    return () => { isMounted = false; };
  }, [id]);

  useEffect(() => {
    if (isProjectLoading || hasInitialGenerated.current || !project?.sourceImage) {
      if (!isProjectLoading && !project?.sourceImage) {
        console.log("[visualizer] Skipping generation — no sourceImage on project");
      }
      return;
    }
    if (project.renderedImage) {
      console.log("[visualizer] ✅ Using CACHED rendered image — skipping AI generation", {
        renderedLen: project.renderedImage.length,
      });
      setCurrentImage(project.renderedImage);
      hasInitialGenerated.current = true;
      return;
    }
    console.log("[visualizer] ⚡ No cached render found — triggering AI generation");
    hasInitialGenerated.current = true;
    void runGeneration(project);
  }, [project, isProjectLoading]);

  const renderedSrc   = currentImage || project?.renderedImage || null;
  const sliderAfterSrc = renderedSrc || project?.sourceImage || null;

  return (
    <div className="visualizer">

      {/* ── Top navigation bar — matches RoomEditor navbar pattern ── */}
      <nav className="topbar">
        {/* Left: Back → divider → "AI Render" label */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button onClick={handleBack} style={navBtn}>
            <ArrowLeft size={15} />
            Back
          </button>
          <div style={{ width: 1, height: 20, background: '#e4e4e7' }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: '#000', fontFamily: 'Inter, sans-serif' }}>
            AI Render
          </span>
        </div>

        {/* Right: Export + Share */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button
            size="sm"
            onClick={handleExport}
            className="export"
            disabled={!currentImage}
          >
            <Download className="w-4 h-4 mr-1" /> Export
          </Button>
          <Button size="sm" onClick={() => {}} className="share">
            <Share2 className="w-4 h-4 mr-1" /> Share
          </Button>
        </div>
      </nav>

      {/* ── Main content ── */}
      <section className="content">

        <div className="project-title">
          <h2>{project?.name || `Residence ${id}`}</h2>
        </div>

        {/* ── View panel — always shows AI render slider ── */}
        <div className="panel view-panel">
          <div className={`render-area ${isProcessing ? "is-processing" : ""}`}>
            {project?.sourceImage && sliderAfterSrc ? (
              <div style={{ position: "relative", width: "100%", height: "100%" }}>
                <ReactCompareSlider
                  defaultValue={50}
                  style={{ width: "100%", height: "100%", display: "block" }}
                  itemOne={
                    <ReactCompareSliderImage
                      src={project.sourceImage}
                      alt="Original 2D"
                      style={{ width: "100%", height: "100%", objectFit: "contain" }}
                    />
                  }
                  itemTwo={
                    <ReactCompareSliderImage
                      src={sliderAfterSrc}
                      alt="AI Render"
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                        filter: isProcessing ? "blur(4px)" : "none",
                        transition: "filter 0.4s",
                      }}
                    />
                  }
                />

                {isProcessing && (
                  <div className="render-overlay">
                    <div className="rendering-card">
                      <RefreshCcw className="spinner" />
                      <span className="title">Generating AI Render...</span>
                      <span className="subtitle">Drag the slider after render completes</span>
                    </div>
                  </div>
                )}

                {!renderedSrc && !isProcessing && (
                  <div className="render-overlay">
                    <div className="rendering-card">
                      <span className="title">AI render will appear here</span>
                      <span className="subtitle">Generating automatically…</span>
                    </div>
                  </div>
                )}

                {renderError && !isProcessing && (
                  <div className="render-overlay">
                    <div className="rendering-card" style={{ maxWidth: 420, textAlign: "center" }}>
                      {renderError === "insufficient_funds" ? (
                        <>
                          <span className="title" style={{ color: "#ef4444" }}>⚠ AI Credits Exhausted</span>
                          <span className="subtitle" style={{ marginBottom: 12 }}>
                            Your Puter account has run out of free AI credits.
                            Sign in with your own account or upgrade your plan.
                          </span>
                          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                            <button
                              className="compare-tab active"
                              style={{ padding: "6px 16px", cursor: "pointer" }}
                              onClick={async () => {
                                try {
                                  await window.puter?.auth?.signIn();
                                  setRenderError(null);
                                  if (project) void runGeneration(project);
                                } catch (e) { console.error(e); }
                              }}
                            >
                              Sign in to Puter
                            </button>
                            <a
                              href="https://puter.com"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="compare-tab"
                              style={{ padding: "6px 16px", textDecoration: "none" }}
                            >
                              Upgrade Plan
                            </a>
                          </div>
                        </>
                      ) : renderError === "auth_required" ? (
                        <>
                          <span className="title" style={{ color: "#ef4444" }}>🔒 Login Required</span>
                          <span className="subtitle">Please log in to Puter to use AI rendering.</span>
                          <button
                            className="compare-tab active"
                            style={{ padding: "6px 16px", cursor: "pointer", marginTop: 8 }}
                            onClick={async () => {
                              try {
                                await window.puter?.auth?.signIn();
                                setRenderError(null);
                                if (project) void runGeneration(project);
                              } catch (e) { console.error(e); }
                            }}
                          >
                            Sign in to Puter
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="title" style={{ color: "#ef4444" }}>Render Failed</span>
                          <span className="subtitle">{renderError}</span>
                          <button
                            className="compare-tab active"
                            style={{ padding: "6px 16px", cursor: "pointer", marginTop: 8 }}
                            onClick={() => {
                              setRenderError(null);
                              if (project) void runGeneration(project);
                            }}
                          >
                            Retry
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="render-placeholder">
                {project?.sourceImage && (
                  <img src={project.sourceImage} alt="Original" className="render-fallback" />
                )}
              </div>
            )}
          </div>
        </div>

      </section>
    </div>
  );
};

export default VisualizerId;