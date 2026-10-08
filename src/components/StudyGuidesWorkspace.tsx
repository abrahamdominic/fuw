import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  FileText,
  Sparkles,
  Plus,
  Trash2,
  ChevronLeft,
  BookOpen,
  Printer,
  CheckCircle,
  HelpCircle,
  ArrowRight,
  Loader2,
  Lock,
  X
} from 'lucide-react';
import {
  fetchStudyGuides,
  deleteStudyGuide,
  generateAndSaveStudyGuide,
  StudyGuideItem
} from '../lib/studyGuides';
import { useAuth } from '../lib/AuthContext';
import { fx } from '../lib/motion';

export function StudyGuidesWorkspace() {
  const { hasPremium } = useAuth();
  const [guides, setGuides] = useState<StudyGuideItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGuide, setSelectedGuide] = useState<StudyGuideItem | null>(null);

  // Generate modal
  const [showModal, setShowModal] = useState(false);
  const [courseCode, setCourseCode] = useState('');
  const [topic, setTopic] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadGuides = async () => {
    try {
      setLoading(true);
      const data = await fetchStudyGuides();
      setGuides(data);
    } catch (err) {
      console.warn('Could not load study guides:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadGuides();
  }, []);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Delete this study guide permanently?')) return;
    try {
      await deleteStudyGuide(id);
      setGuides((prev) => prev.filter((g) => g.id !== id));
      if (selectedGuide?.id === id) {
        setSelectedGuide(null);
      }
    } catch (err: any) {
      alert(err?.message || 'Could not delete study guide.');
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!courseCode.trim() || !topic.trim()) return;

    if (!hasPremium) {
      setError('AI Study Guide generation is a Premium feature. Please upgrade your plan.');
      return;
    }

    setGenerating(true);
    setError(null);

    try {
      const created = await generateAndSaveStudyGuide({
        courseCode,
        topic
      });
      setGuides((prev) => [created, ...prev]);
      setShowModal(false);
      setCourseCode('');
      setTopic('');
      setSelectedGuide(created);
    } catch (err: any) {
      setError(err?.message || 'Failed to generate study guide.');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className={`study-guides-workspace ${fx.fadeIn}`} style={{ maxWidth: 960, margin: '0 auto', paddingBottom: 60 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 28 }}>
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 999, background: 'rgba(16, 185, 129, 0.12)', color: '#059669', fontSize: 11, fontWeight: 700, marginBottom: 8 }}>
            <FileText size={13} />
            <span>AI EXAM BLUEPRINTS &middot; HIGH-YIELD REVISION</span>
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 900, margin: '0 0 6px', letterSpacing: '-0.02em' }}>
            Comprehensive Study Guides
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)' }}>
            Turn complex lecture packs into concise executive summaries, key formula sheets, and model exam questions.
          </p>
        </div>

        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setShowModal(true)}
          style={{ fontSize: 13, padding: '9px 16px', gap: 6 }}
        >
          <Sparkles size={15} />
          <span>Generate Study Guide</span>
        </button>
      </div>

      {/* Main Workspace Layout */}
      {!selectedGuide ? (
        /* Guides List */
        <div>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>
              Loading study guides...
            </div>
          ) : guides.length === 0 ? (
            <div
              style={{
                background: 'var(--surface)',
                border: '1px dashed var(--border)',
                borderRadius: 16,
                padding: '48px 24px',
                textAlign: 'center'
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 16,
                  background: 'rgba(16, 185, 129, 0.12)',
                  color: '#059669',
                  display: 'grid',
                  placeItems: 'center',
                  margin: '0 auto 16px'
                }}
              >
                <FileText size={28} />
              </div>
              <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 800 }}>
                No study guides generated yet
              </h3>
              <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-secondary)', maxWidth: 420, marginLeft: 'auto', marginRight: 'auto' }}>
                Generate your first comprehensive study guide with high-yield concepts, formulas, and model practice questions.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setShowModal(true)}
                style={{ fontSize: 13 }}
              >
                Generate First Guide
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 20 }}>
              {guides.map((guide) => (
                <div
                  key={guide.id}
                  onClick={() => setSelectedGuide(guide)}
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 16,
                    padding: '20px',
                    cursor: 'pointer',
                    boxShadow: 'var(--shadow-sm)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between'
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      {guide.course_code && (
                        <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 8px', borderRadius: 6, background: 'rgba(16, 185, 129, 0.12)', color: '#059669' }}>
                          {guide.course_code}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => handleDelete(guide.id, e)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4 }}
                        title="Delete guide"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>

                    <h3 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 6px', lineHeight: 1.3 }}>
                      {guide.title}
                    </h3>
                    <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
                      {guide.content?.summary || 'Comprehensive revision blueprint.'}
                    </p>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 14, borderTop: '1px solid var(--border)', marginTop: 12 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      {new Date(guide.created_at).toLocaleDateString()}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--green-800)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span>Open Guide</span>
                      <ArrowRight size={12} />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Selected Guide Detail View */
        <div className={fx.fadeUp}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setSelectedGuide(null)}
              style={{ fontSize: 12, padding: '6px 12px', gap: 6 }}
            >
              <ChevronLeft size={14} />
              <span>All Guides</span>
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className="btn btn-secondary"
              style={{ fontSize: 12, padding: '6px 14px', gap: 6 }}
            >
              <Printer size={13} />
              <span>Print / Save PDF</span>
            </button>
          </div>

          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 18,
              padding: '32px',
              boxShadow: 'var(--shadow-sm)'
            }}
          >
            <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 20, marginBottom: 24 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
                {selectedGuide.course_code && (
                  <span style={{ fontSize: 12, fontWeight: 800, padding: '3px 10px', borderRadius: 6, background: 'rgba(16, 185, 129, 0.12)', color: '#059669' }}>
                    {selectedGuide.course_code}
                  </span>
                )}
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  Created {new Date(selectedGuide.created_at).toLocaleDateString()}
                </span>
              </div>
              <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0 }}>
                {selectedGuide.title}
              </h1>
            </div>

            {/* Summary */}
            <div style={{ marginBottom: 28 }}>
              <h3 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 10px', color: 'var(--green-800)' }}>
                Executive Overview
              </h3>
              <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', margin: 0 }}>
                {selectedGuide.content?.summary}
              </p>
            </div>

            {/* Key Concepts & Definitions */}
            {selectedGuide.content?.keyConcepts && selectedGuide.content.keyConcepts.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <h3 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 12px', color: 'var(--green-800)' }}>
                  Key Concepts &amp; Definitions
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                  {selectedGuide.content.keyConcepts.map((kc, i) => (
                    <div
                      key={i}
                      style={{
                        padding: '14px',
                        borderRadius: 10,
                        background: 'var(--surface-alt)',
                        border: '1px solid var(--border)'
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4, color: 'var(--text-primary)' }}>
                        {kc.term}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                        {kc.definition}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Formulas and Principles */}
            {selectedGuide.content?.formulasAndLaws && selectedGuide.content.formulasAndLaws.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <h3 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 12px', color: 'var(--green-800)' }}>
                  Formulas, Laws &amp; Core Principles
                </h3>
                <div style={{ padding: '16px 20px', borderRadius: 12, background: 'var(--surface-alt)', border: '1px solid var(--border)' }}>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {selectedGuide.content.formulasAndLaws.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Model Exam Questions */}
            {selectedGuide.content?.examQuestions && selectedGuide.content.examQuestions.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <h3 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 14px', color: 'var(--green-800)' }}>
                  High-Yield Exam Practice Questions
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {selectedGuide.content.examQuestions.map((eq, i) => (
                    <div
                      key={i}
                      style={{
                        padding: '16px',
                        borderRadius: 12,
                        background: 'var(--surface-alt)',
                        border: '1px solid var(--border)'
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>
                        Q{i + 1}: {eq.question}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5, padding: '10px 14px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                        <strong>Model Answer:</strong> {eq.modelAnswer}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Revision Checklist */}
            {selectedGuide.content?.revisionChecklist && selectedGuide.content.revisionChecklist.length > 0 && (
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 12px', color: 'var(--green-800)' }}>
                  Self-Assessment Revision Checklist
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {selectedGuide.content.revisionChecklist.map((item, i) => (
                    <label
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        fontSize: 13,
                        cursor: 'pointer',
                        padding: '8px 12px',
                        borderRadius: 8,
                        background: 'var(--surface-alt)'
                      }}
                    >
                      <input type="checkbox" style={{ accentColor: 'var(--green-700)' }} />
                      <span>{item}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Generate Guide */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'grid', placeItems: 'center', zIndex: 9999, padding: 20 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 16, maxWidth: 460, width: '100%', padding: 24, boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Sparkles size={18} color="#059669" />
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Generate AI Study Guide</h3>
              </div>
              <button type="button" onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            {error && (
              <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(239, 68, 68, 0.1)', color: '#dc2626', fontSize: 12, marginBottom: 14 }}>
                {error}
              </div>
            )}

            <form onSubmit={handleGenerate} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Course Code:</label>
                <input
                  type="text"
                  required
                  value={courseCode}
                  onChange={(e) => setCourseCode(e.target.value.toUpperCase())}
                  placeholder="e.g. CSC 301, MTH 101, GST 111"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-alt)' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Topic or Unit:</label>
                <input
                  type="text"
                  required
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="e.g. Relational Database Normalization, Organic Reaction Mechanisms"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-alt)' }}
                />
              </div>

              {!hasPremium && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: 'rgba(234, 179, 8, 0.1)', color: '#b45309', fontSize: 12 }}>
                  <Lock size={14} />
                  <span>Premium feature &middot; <Link to="/student/subscription" style={{ fontWeight: 700, textDecoration: 'underline' }}>Upgrade</Link></span>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)} style={{ fontSize: 13 }}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={generating} style={{ fontSize: 13 }}>
                  {generating ? <><Loader2 size={14} className="spin-icon" /> Generating Guide...</> : 'Generate Guide'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
