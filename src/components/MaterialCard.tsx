import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Bookmark, Download, ArrowRight, Eye, Sparkles, Quote } from 'lucide-react';
import { MaterialItem, store } from '../lib/store';
import { incrementDownload, getSecureFileUrl } from '../lib/materials';
import { analyticsTracker } from '../lib/analyticsTracker';
import { useToast } from './Toast';
import { CitationModal } from './CitationModal';

interface MaterialCardProps {
  material: MaterialItem;
  onReadOnline?: (material: MaterialItem) => void;
  /** When provided (authenticated student surfaces), shows an "Ask AI" action. */
  onAskAi?: (material: MaterialItem) => void;
}

export function MaterialCard({ material, onReadOnline, onAskAi }: MaterialCardProps) {
  const { toast } = useToast();
  const [showCitation, setShowCitation] = useState(false);
  const isSaved = store.isBookmarked(material.id);

  const handleSave = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const saved = store.toggleBookmark(material.id);
    analyticsTracker.trackBookmarkToggle(material.id, saved);
    toast(saved ? `"${material.title}" saved to bookmarks` : `"${material.title}" removed from bookmarks`, 'info');
  };

  const handleDownload = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const url = await getSecureFileUrl(material);
    if (!url) {
      toast('This file has not been uploaded yet.', 'error');
      return;
    }
    store.recordDownload(material.id);
    analyticsTracker.trackMaterialDownload(material.id, material.title);
    // Persist the counter server-side so stats survive across devices.
    void incrementDownload(material.id);
    toast(`Downloading ${material.fileName} (${material.fileSize})`, 'success');

    const link = document.createElement('a');
    link.href = url;
    link.download = material.fileName;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleRead = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onReadOnline) {
      onReadOnline(material);
    }
  };

  return (
    <article className="material-card">
      <div className="card-top-row">
        <div className={`file-icon-box ${material.tone}`}>
          <FileText size={24} />
        </div>
        <button
          className={`save-btn ${isSaved ? 'saved' : ''}`}
          onClick={handleSave}
          title={isSaved ? 'Remove from saved' : 'Save material'}
          aria-label={isSaved ? 'Remove from saved' : 'Save material'}
        >
          <Bookmark size={18} fill={isSaved ? 'currentColor' : 'none'} />
        </button>
      </div>

      <div className="card-type-tag">{material.type}</div>

      <h3 className="card-title">
        <Link to={`/materials/${material.id}`}>{material.title}</Link>
      </h3>

      <p className="card-course">
        <b>{material.course}</b> ·{' '}
        {material.assignedDepartments && material.assignedDepartments.length > 1 ? (
          <span>
            {material.assignedDepartments[0].name}{' '}
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: '#0B6B3A',
                backgroundColor: '#eaf3ec',
                padding: '1px 6px',
                borderRadius: '10px',
                marginLeft: '4px',
                display: 'inline-block'
              }}
              title={material.assignedDepartments.map((d) => d.name).join(', ')}
            >
              +{material.assignedDepartments.length - 1} more
            </span>
          </span>
        ) : (
          material.department
        )}
      </p>

      <p className="card-meta">
        <span>{material.level}</span>
        <i className="dot" />
        <span>{material.session}</span>
      </p>

      <p className="card-desc-snippet">{material.description}</p>

      <div className="card-foot">
        <span className="foot-stat">
          <Download size={14} />
          {material.downloads.toLocaleString()}
        </span>
        <span className="foot-stat">
          <Eye size={14} />
          {material.views.toLocaleString()}
        </span>
        <span className="foot-date">{material.date}</span>
      </div>

      <div className="card-actions-bar">
        <button className="card-action-btn read-btn" onClick={handleRead} title="Read online in browser">
          <Eye size={14} />
          <span>Read</span>
        </button>
        <button className="card-action-btn dl-btn" onClick={handleDownload} title="Download file">
          <Download size={14} />
          <span>Download</span>
        </button>
        {onAskAi && (
          <button
            className="card-action-btn ask-btn"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onAskAi(material);
            }}
            title="Ask the AI assistant about this material"
          >
            <Sparkles size={14} />
            <span>Ask AI</span>
          </button>
        )}
        <Link className="card-view-link" to={`/materials/${material.id}`} title="View full material details">
          <span>Details</span>
          <ArrowRight size={14} />
        </Link>
      </div>

      <button
        className="card-cite-link"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setShowCitation(true);
        }}
        title="Generate a citation for this material"
      >
        <Quote size={12} /> Cite
      </button>

      {showCitation && <CitationModal material={material} onClose={() => setShowCitation(false)} />}
    </article>
  );
}
