import { useCallback, useEffect, useRef, useState } from "react";
import { useOutletContext, useNavigate } from "react-router";
import { CheckCircle2, ImageIcon, Plus, LogIn, X } from "lucide-react";
import { REDIRECT_DELAY_MS } from "../lib/constants";

const PROGRESS_INCREMENT   = 15;
const PROGRESS_INTERVAL_MS = 100;

const Upload = ({ onComplete }) => {
  const [file, setFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const intervalRef = useRef(null);
  const timeoutRef = useRef(null);

  const { isSignedIn } = useOutletContext();
  const navigate = useNavigate();

  useEffect(() => {
    return () => {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    };
  }, []);

  const processFile = useCallback(async (fileToRead) => {
    if (!isSignedIn) { setShowLoginPrompt(true); return; }
    setFile(fileToRead);
    setProgress(0);
    const formData = new FormData();
    formData.append("image", fileToRead);
    intervalRef.current = setInterval(() => {
      setProgress(prev => { const next = prev + PROGRESS_INCREMENT; return next >= 90 ? 90 : next; });
    }, PROGRESS_INTERVAL_MS);
    try {
      const response = await fetch("/api/upload", { method: "POST", body: formData, credentials: "include" });
      if (!response.ok) throw new Error("Upload failed");
      const data = await response.json();
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      setProgress(100);
      timeoutRef.current = setTimeout(() => { onComplete?.(data.url); timeoutRef.current = null; }, REDIRECT_DELAY_MS);
    } catch (err) {
      console.error("Upload failed:", err);
      setFile(null); setProgress(0);
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    }
  }, [isSignedIn, onComplete]);

  const handleDropzoneClick = (e) => {
    if (!isSignedIn) { e.preventDefault(); e.stopPropagation(); setShowLoginPrompt(true); }
  };
  const handleDragOver = (e) => {
    e.preventDefault();
    if (!isSignedIn) { setShowLoginPrompt(true); return; }
    setIsDragging(true);
  };
  const handleDragLeave = () => { setIsDragging(false); };
  const handleDrop = (e) => {
    e.preventDefault(); setIsDragging(false);
    if (!isSignedIn) { setShowLoginPrompt(true); return; }
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && ["image/jpeg","image/png"].includes(droppedFile.type)) processFile(droppedFile);
  };
  const handleChange = (e) => {
    if (!isSignedIn) { setShowLoginPrompt(true); return; }
    const selectedFile = e.target.files?.[0];
    if (selectedFile) processFile(selectedFile);
  };

  return (
    <div className="upload" style={{ position: 'relative' }}>

      {/* Login prompt overlay — clean, design-system-consistent */}
      {showLoginPrompt && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 20,
          background: '#ffffff',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          borderRadius: 12, padding: '32px 28px',
          boxShadow: 'inset 0 0 0 1px #e4e4e7',
        }}>
          {/* Dismiss button */}
          <button
            onClick={() => setShowLoginPrompt(false)}
            style={{
              position: 'absolute', top: 12, right: 12,
              background: 'transparent', border: '1px solid #e4e4e7',
              borderRadius: 6, cursor: 'pointer', color: '#71717a',
              width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <X size={14} />
          </button>

          {/* Heading */}
          <p style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: '#dc2626', textAlign: 'center' }}>
            Log in to upload
          </p>

          {/* Body */}
          <p style={{ margin: '0 0 8px', fontSize: 13, color: '#71717a', lineHeight: 1.6, textAlign: 'center', maxWidth: 240 }}>
            Upload floor plans and generate AI renders after logging in.
          </p>

          {/* Actions */}
          
        </div>
      )}

      {!file ? (
        <div
          className={`dropzone ${isDragging ? "is-dragging" : ""}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={handleDropzoneClick}
        >
          <input
            type="file" className="drop-input" accept=".jpg,.jpeg,.png,.webp"
            disabled={!isSignedIn}
            onChange={handleChange}
            style={{ pointerEvents: isSignedIn ? 'auto' : 'none' }}
          />
          <div className="drop-content">
            <div className="drop-icon-plus">
              <Plus size={40} strokeWidth={1} color="black" opacity={0.2} />
            </div>
            <p className="drop-main-text">
              {isSignedIn ? "Click to upload or just drag and drop" : "Click to upload"}
            </p>
            <p className="drop-sub">Supports PNG, JPG, JPEG</p>
          </div>
        </div>
      ) : (
        <div className="upload-status">
          <div className="status-content">
            <div className="status-icon">
              {progress === 100 ? <CheckCircle2 className="check" /> : <ImageIcon className="image" />}
            </div>
            <h3>{file.name}</h3>
            <div className="progress">
              <div className="bar" style={{ width: `${progress}%` }} />
              <p className="status-text">
                {progress < 100 ? "Analyzing Floor Plan..." : "Redirecting..."}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Upload;