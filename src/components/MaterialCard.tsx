import React from 'react';
import { Link } from 'react-router-dom';
import { FileText, Bookmark, Download, ArrowRight, Eye, Sparkles } from 'lucide-react';
import { MaterialItem, store } from '../lib/store';
import { useToast } from './Toast';

interface MaterialCardProps {
  material: MaterialItem;
  onReadOnline?: (material: MaterialItem) => void;
}

export function MaterialCard({ material, onReadOnline }: MaterialCardProps) {
  const { toast } = useToast();
  const isSaved = store.isBookmarked(material.id);

  const handleSave = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const saved = store.toggleBookmark(material.id);
    toast(saved ? `"${material.title}" saved to bookmarks` : `"${material.title}" removed from bookmarks`, 'info');
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    store.recordDownload(material.id);
    toast(`Downloading ${material.fileName} (${material.fileSize})`, 'success');

    const link = document.createElement('a');
    link.href = material.fileUrl;
    link.download = material.fileName;
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
        <b>{material.course}</b> · {material.department}
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
        <Link className="card-view-link" to={`/materials/${material.id}`} title="View full material details">
          <span>Details</span>
          <ArrowRight size={14} />
        </Link>
      </div>
    </article>
  );
}
