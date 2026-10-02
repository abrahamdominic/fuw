import React, { useState } from 'react';
import { X, Copy, Check, Download, FileText, Quote } from 'lucide-react';
import {
  CITATION_FORMATS,
  CitationStyle,
  buildCitationExport,
  downloadCitationFile
} from '../lib/citations';
import type { MaterialItem } from '../lib/store';
import type { ResearchItem } from '../lib/repository';
import { useToast } from './Toast';
import { AnimatedModal } from './animations/AnimatedModal';

interface CitationModalProps {
  material?: MaterialItem | null;
  researchItem?: ResearchItem | null;
  onClose: () => void;
}

export function CitationModal({ material, researchItem, onClose }: CitationModalProps) {
  const [activeFormat, setActiveFormat] = useState<CitationStyle>('apa');
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const bundle = buildCitationExport(material || null, researchItem || null);
  if (!bundle) return null;

  const { source, citations, bibtex, ris } = bundle;
  const activeCitation = citations[activeFormat];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeCitation);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('Could not copy to clipboard.', 'error');
    }
  };

  const handleDownload = (ext: string, content: string) => {
    const safeTitle = source.title.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '_').slice(0, 60);
    const year = source.year || '20xx';
    downloadCitationFile(content, `${safeTitle}_${year}.${ext}`);
    toast(`Citation downloaded as ${ext.toUpperCase()}.`, 'success');
  };

  const styleSwitcher = (
    <div className="citation-format-tabs" role="tablist" aria-label="Citation format">
      {CITATION_FORMATS.map((f) => (
        <button
          key={f.id}
          role="tab"
          aria-selected={activeFormat === f.id}
          className={activeFormat === f.id ? 'citation-format-active' : ''}
          onClick={() => setActiveFormat(f.id)}
        >
          {f.label}
        </button>
      ))}
    </div>
  );

  return (
    <AnimatedModal
      open
      onClose={onClose}
      dialogClassName="modal-card citation-modal"
      labelledBy="citation-modal-title"
    >
      <div className="modal-header">
          <h3 id="citation-modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Quote size={18} /> Cite this {material ? 'Material' : 'Publication'}
          </h3>
          <button className="link-btn" onClick={onClose} aria-label="Close citation dialog">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="citation-source-meta">
            <div className="citation-source-title">{source.title}</div>
            {source.subtitle && <div className="citation-source-sub">{source.subtitle}</div>}
            <div className="citation-meta-row">
              <span><FileText size={13} /> {source.resourceType}</span>
              {source.authors.length > 0 && <span>by {source.authors.join(', ')}</span>}
              {source.year && <span>{source.year}</span>}
              {source.department && <span>{source.department}</span>}
            </div>
          </div>

          {styleSwitcher}

          <div className="citation-text-block">
            <p className="citation-text">{activeCitation}</p>
            <div className="citation-actions">
              <button className="primary btn-sm" onClick={handleCopy}>
                {copied ? <><Check size={14} /> Copied!</> : <><Copy size={14} /> Copy</>}
              </button>
            </div>
          </div>

          <div className="citation-export-section">
            <div className="citation-export-label">Export</div>
            <div className="citation-export-buttons">
              <button className="secondary-btn btn-sm" onClick={() => handleDownload('bib', bibtex)}>
                <Download size={14} /> BibTeX
              </button>
              <button className="secondary-btn btn-sm" onClick={() => handleDownload('ris', ris)}>
                <Download size={14} /> RIS
              </button>
            </div>
          </div>

          {source.doi && (
            <div className="citation-doi">
              DOI: <a href={`https://doi.org/${source.doi}`} target="_blank" rel="noopener noreferrer">{source.doi}</a>
            </div>
          )}
      </div>
    </AnimatedModal>
  );
}