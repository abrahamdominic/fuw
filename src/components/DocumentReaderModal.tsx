import React, { useState, useEffect } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  Download,
  BookOpen,
  Bookmark,
  FileText,
  CheckCircle2,
  Share2
} from 'lucide-react';
import { MaterialItem, store } from '../lib/store';
import { useToast } from './Toast';

interface DocumentReaderModalProps {
  material: MaterialItem | null;
  onClose: () => void;
}

export function DocumentReaderModal({ material, onClose }: DocumentReaderModalProps) {
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { toast } = useToast();

  const totalPages = 18;

  // Render the REAL uploaded document whenever the browser can display it
  // inline (PDF files). Other formats fall back to the metadata sheet view.
  const source = material?.fileUrl || '';
  const looksLikePdf =
    /\.pdf(\?|#|$)/i.test(source) || /\.pdf(\?|#|$)/i.test(material?.fileName || '');
  const [canEmbedFile, setCanEmbedFile] = useState(true);
  useEffect(() => {
    setCanEmbedFile(Boolean(source) && looksLikePdf);
  }, [source, looksLikePdf]);

  useEffect(() => {
    if (material) {
      setPage(1);
      setZoom(100);
      store.recordView(material.id);
      if (looksLikePdf) {
        // Native PDF viewing is continuous - log the session as completed
        store.saveReadingProgress(material.id, 1, 1);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [material]);

  // Update reading progress when page changes
  useEffect(() => {
    if (material && !looksLikePdf) {
      store.saveReadingProgress(material.id, page, totalPages);
    }
  }, [page, material, looksLikePdf]);

  if (!material) return null;

  const isSaved = store.isBookmarked(material.id);

  const handleDownload = () => {
    store.recordDownload(material.id);
    toast(`Download initiated: ${material.fileName}`);
    // Trigger download of demo or actual document
    const link = document.createElement('a');
    link.href = material.fileUrl;
    link.download = material.fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleToggleBookmark = () => {
    const saved = store.toggleBookmark(material.id);
    toast(saved ? 'Saved to your bookmarked materials.' : 'Removed from bookmarks.', 'info');
  };

  const handleShare = () => {
    navigator.clipboard?.writeText(window.location.origin + '/materials/' + material.id);
    toast('Direct material link copied to clipboard!');
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.().catch(() => {});
      setIsFullscreen(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="reader-modal" onClick={(e) => e.stopPropagation()}>
        {/* Top Header */}
        <header className="reader-header">
          <div className="reader-meta">
            <span className={`file-badge ${material.tone}`}>
              <FileText size={16} />
            </span>
            <div>
              <h3>{material.title}</h3>
              <p>
                {material.course} · {material.faculty} · {material.level}
              </p>
            </div>
          </div>

          <div className="reader-controls">
            {!canEmbedFile && (
              <div className="zoom-group">
                <button
                  onClick={() => setZoom((z) => Math.max(75, z - 15))}
                  disabled={zoom <= 75}
                  title="Zoom out"
                  aria-label="Zoom out"
                >
                  <ZoomOut size={16} />
                </button>
                <span>{zoom}%</span>
                <button
                  onClick={() => setZoom((z) => Math.min(150, z + 15))}
                  disabled={zoom >= 150}
                  title="Zoom in"
                  aria-label="Zoom in"
                >
                  <ZoomIn size={16} />
                </button>
              </div>
            )}

            <button
              className={`control-btn ${isSaved ? 'active' : ''}`}
              onClick={handleToggleBookmark}
              title={isSaved ? 'Remove Bookmark' : 'Save Material'}
            >
              <Bookmark size={16} fill={isSaved ? 'currentColor' : 'none'} />
              <span>{isSaved ? 'Saved' : 'Save'}</span>
            </button>

            <button className="control-btn" onClick={handleShare} title="Share Link">
              <Share2 size={16} />
            </button>

            <button className="control-btn primary-btn" onClick={handleDownload} title="Download File">
              <Download size={16} />
              <span>Download</span>
            </button>

            <button className="control-btn" onClick={toggleFullscreen} title="Fullscreen Toggle">
              {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>

            <button className="close-btn" onClick={onClose} aria-label="Close reader">
              <X size={20} />
            </button>
          </div>
        </header>

        {/* Reader Document Viewport */}
        <div className="reader-viewport">
          {canEmbedFile ? (
            /* Real uploaded document rendered straight from storage */
            <iframe
              src={source}
              title={`${material.title} — full document`}
              className="document-embed-frame"
              referrerPolicy="no-referrer"
              sandbox="allow-same-origin"
              style={{
                width: '100%',
                height: '100%',
                minHeight: '60vh',
                border: 0,
                background: '#ffffff'
              }}
            />
          ) : (
          <div
            className="document-page-sheet"
            style={{
              transform: `scale(${zoom / 100})`,
              transformOrigin: 'top center'
            }}
          >
            <div className="sheet-header">
              <div className="sheet-institution">
                <span>FEDERAL UNIVERSITY WUKARI · E-LIBRARY REPOSITORY</span>
                <b>ACADEMIC SESSION 2025/2026</b>
              </div>
              <div className="sheet-course-badge">{material.course}</div>
            </div>

            <div className="sheet-title-section">
              <span className="sheet-kicker">{material.type.toUpperCase()}</span>
              <h1>{material.title}</h1>
              <div className="sheet-info-strip">
                <span><b>Faculty:</b> {material.faculty}</span>
                <span><b>Department:</b> {material.department}</span>
                <span><b>Level:</b> {material.level}</span>
                <span><b>Semester:</b> {material.semester}</span>
              </div>
            </div>

            <div className="sheet-content">
              {page === 1 && (
                <div className="sheet-chapter">
                  <h2>1. Course Overview & Introduction</h2>
                  <p>
                    {material.description}
                  </p>
                  <div className="callout-box">
                    <b>Institutional Note:</b>
                    <p>
                      This resource has been verified and deposited into the Federal University Wukari Digital Archive.
                      All registered students are authorized to read online and download copies for educational study.
                    </p>
                  </div>
                  <h3>Core Learning Objectives</h3>
                  <ul>
                    <li>Understand fundamental theoretical constructs and real-world applications.</li>
                    <li>Analyze problem formulations through rigorous academic methodology.</li>
                    <li>Master examination problem patterns and structured solution pathways.</li>
                    <li>Synthesize lecture concepts with verified textbook reference literature.</li>
                  </ul>
                </div>
              )}

              {page === 2 && (
                <div className="sheet-chapter">
                  <h2>2. Module 1: Foundational Frameworks</h2>
                  <p>
                    In accordance with the FUW syllabus, this section establishes the preliminary principles, analytical definitions, and operational paradigms required for advanced study in {material.department}.
                  </p>
                  <div className="academic-quote">
                    "Rigorous inquiry and continuous review form the bedrock of academic excellence."
                  </div>
                  <h3>Key Equations & Analytical Methods</h3>
                  <p>
                    Students are expected to master step-by-step derivational approaches and apply conceptual models to Taraba State and Nigerian regional case studies.
                  </p>
                </div>
              )}

              {page > 2 && (
                <div className="sheet-chapter">
                  <h2>3. Section {page}: Deep Dive & Case Analysis</h2>
                  <p>
                    Continuation of verified learning module notes for <b>{material.course}</b> ({material.title}).
                  </p>
                  <p>
                    Comprehensive lecture summaries, diagrammatic models, worked examples, and semester practice questions curated for {material.level} candidates.
                  </p>
                  <div className="callout-box">
                    <b>Reading Progress:</b>
                    <p>
                      You are currently reviewing page {page} of {totalPages} ({Math.round((page / totalPages) * 100)}% complete). Your progress is automatically logged in your student dashboard.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="sheet-footer">
              <span>Federal University Wukari (FUW) E-Library</span>
              <span>Page {page} of {totalPages}</span>
            </div>
          </div>
          )}
        </div>

        {/* Bottom Navigation & Progress Bar */}
        <footer className="reader-footer">
          {canEmbedFile ? (
            <>
              <div className="reader-nav-buttons">
                <span className="page-indicator">
                  Viewing full document: <b>{material.fileName}</b>
                </span>
                <button className="page-nav-btn" onClick={handleDownload}>
                  <Download size={16} /> Download copy
                </button>
              </div>
              <div className="reader-progress-track">
                <div className="reader-progress-fill" style={{ width: '100%' }} />
              </div>
            </>
          ) : (
          <>
          <div className="reader-nav-buttons">
            <button
              className="page-nav-btn"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft size={16} /> Previous
            </button>
            <span className="page-indicator">
              Page <b>{page}</b> of <b>{totalPages}</b>
            </span>
            <button
              className="page-nav-btn"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next <ChevronRight size={16} />
            </button>
          </div>

          <div className="reader-progress-track">
            <div
              className="reader-progress-fill"
              style={{ width: `${(page / totalPages) * 100}%` }}
            />
          </div>
          </>
          )}
        </footer>
      </div>
    </div>
  );
}
