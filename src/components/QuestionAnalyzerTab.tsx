import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Sparkles,
  HelpCircle,
  AlertTriangle,
  CheckCircle,
  BookOpen,
  ArrowRight,
  Loader2,
  Lock,
  ChevronDown,
  ChevronUp,
  Copy,
  Printer,
  Compass,
  FileQuestion
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { analyzeQuestion, QuestionAnalysisResult } from '../lib/questionAnalyzer';
import { fx } from '../lib/motion';

export function QuestionAnalyzerTab() {
  const { hasPremium } = useAuth();
  const [questionText, setQuestionText] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QuestionAnalysisResult | null>(null);
  const [expandedSolutions, setExpandedSolutions] = useState<Record<number, boolean>>({});

  const sampleQuestions = [
    {
      course: 'CSC 201',
      text: 'Explain the difference between a stack and a queue with real-life campus analogies, and write pseudocode for push and enqueue operations.'
    },
    {
      course: 'MTH 101',
      text: 'Evaluate the limit of (sin 3x) / (2x) as x approaches 0 using L’Hôpital’s rule and standard trigonometric limits.'
    },
    {
      course: 'GST 111',
      text: 'Distinguish between skimming and scanning reading techniques with three practical examples from university academic texts.'
    }
  ];

  const handleAnalyze = async (qText?: string, cCode?: string) => {
    const textToAnalyze = qText || questionText;
    const course = cCode || courseCode;

    if (!textToAnalyze.trim()) return;

    if (!hasPremium) {
      setError('Advanced AI Question Analysis is a Premium feature. Please upgrade your plan to unlock full exam breakdowns and examiner traps.');
      return;
    }

    setAnalyzing(true);
    setError(null);

    try {
      const res = await analyzeQuestion(textToAnalyze, { courseCode: course });
      setResult(res);
      setExpandedSolutions({});
    } catch (err: any) {
      setError(err?.message || 'Could not analyze question. Please try again.');
    } finally {
      setAnalyzing(false);
    }
  };

  const toggleSolution = (idx: number) => {
    setExpandedSolutions((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  return (
    <div className={`question-analyzer-view ${fx.fadeIn}`} style={{ maxWidth: 900, margin: '0 auto', paddingBottom: 60 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 999, background: 'rgba(168, 85, 247, 0.12)', color: '#9333ea', fontSize: 11, fontWeight: 700, marginBottom: 8 }}>
          <Sparkles size={13} />
          <span>AI QUESTION ANALYZER &middot; EXAM BREAKDOWN</span>
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 900, margin: '0 0 6px', letterSpacing: '-0.02em' }}>
          Exam Question Analyzer
        </h1>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)' }}>
          Paste any assignment or past question. Receive syllabus topic mapping, difficulty rating, step-by-step reasoning, examiner traps, and similar practice questions.
        </p>
      </div>

      {/* Input Box Card */}
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: '24px',
          boxShadow: 'var(--shadow-sm)',
          marginBottom: 28
        }}
      >
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
            Paste Question or Problem Statement:
          </label>
          <textarea
            rows={4}
            value={questionText}
            onChange={(e) => setQuestionText(e.target.value)}
            placeholder="e.g. Find the derivative of f(x) = (3x^2 + 2x)/(x - 1) and determine any points where f'(x) = 0."
            disabled={analyzing}
            style={{
              width: '100%',
              padding: '12px 14px',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'var(--surface-alt)',
              fontSize: 13,
              fontFamily: 'inherit',
              lineHeight: 1.5,
              resize: 'vertical'
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
              Course Code (optional):
            </label>
            <input
              type="text"
              value={courseCode}
              onChange={(e) => setCourseCode(e.target.value.toUpperCase())}
              placeholder="e.g. MTH 101"
              maxLength={10}
              disabled={analyzing}
              style={{
                width: 110,
                padding: '6px 10px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--surface-alt)',
                fontSize: 12,
                fontWeight: 700
              }}
            />
          </div>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => handleAnalyze()}
            disabled={analyzing || !questionText.trim()}
            style={{ padding: '10px 22px', fontSize: 13, fontWeight: 700, borderRadius: 10, gap: 8 }}
          >
            {analyzing ? <Loader2 size={16} className="spin-icon" /> : <Sparkles size={16} />}
            <span>Analyze Question</span>
          </button>
        </div>

        {/* Quick Samples */}
        <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginRight: 10 }}>
            Try an example:
          </span>
          <div style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            {sampleQuestions.map((s) => (
              <button
                key={s.course}
                type="button"
                onClick={() => {
                  setQuestionText(s.text);
                  setCourseCode(s.course);
                  void handleAnalyze(s.text, s.course);
                }}
                disabled={analyzing}
                style={{
                  background: 'var(--surface-alt)',
                  border: '1px solid var(--border)',
                  padding: '4px 10px',
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  color: 'var(--text-primary)'
                }}
              >
                {s.course}: {s.text.slice(0, 30)}...
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Error or Premium Prompt */}
      {error && (
        <div
          style={{
            padding: '16px 20px',
            borderRadius: 12,
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            marginBottom: 24,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12
          }}
        >
          <AlertTriangle size={18} color="#dc2626" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#dc2626', marginBottom: 4 }}>
              {error}
            </div>
            {!hasPremium && (
              <Link to="/student/subscription" className="btn btn-primary" style={{ fontSize: 12, padding: '6px 14px', marginTop: 8 }}>
                View Premium Plans &amp; Upgrade
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Analysis Result Display */}
      {result && (
        <div className={fx.fadeUp} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Metadata Card */}
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 16,
              padding: '20px 24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12
            }}
          >
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--green-800)', marginBottom: 2 }}>
                Identified Syllabus Topic
              </div>
              <h2 style={{ fontSize: 18, fontWeight: 900, margin: 0 }}>
                {result.topic}
              </h2>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span
                style={{
                  padding: '5px 12px',
                  borderRadius: 20,
                  fontSize: 12,
                  fontWeight: 800,
                  background:
                    result.difficulty === 'Beginner'
                      ? 'rgba(34, 197, 94, 0.12)'
                      : result.difficulty === 'Intermediate'
                      ? 'rgba(59, 130, 246, 0.12)'
                      : 'rgba(234, 88, 12, 0.12)',
                  color:
                    result.difficulty === 'Beginner'
                      ? '#16a34a'
                      : result.difficulty === 'Intermediate'
                      ? '#2563eb'
                      : '#c2410c'
                }}
              >
                Difficulty: {result.difficulty}
              </span>
              <button
                type="button"
                onClick={() => window.print()}
                className="btn btn-secondary"
                style={{ padding: '6px 12px', fontSize: 12 }}
                title="Print analysis summary"
              >
                <Printer size={13} />
                <span>Print</span>
              </button>
            </div>
          </div>

          {/* Explanation Section */}
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 16,
              padding: '24px'
            }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <BookOpen size={16} color="var(--green-700)" />
              <span>Core Understanding &amp; Solution Overview</span>
            </h3>
            <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-primary)', margin: 0, whiteSpace: 'pre-wrap' }}>
              {result.explanation}
            </p>
          </div>

          {/* Step-by-Step Breakdown */}
          {result.stepByStep.length > 0 && (
            <div
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 16,
                padding: '24px'
              }}
            >
              <h3 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <CheckCircle size={16} color="var(--green-700)" />
                <span>Step-by-Step Solution Breakdown</span>
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {result.stepByStep.map((step, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      gap: 14,
                      padding: '14px 16px',
                      borderRadius: 12,
                      background: 'var(--surface-alt)',
                      border: '1px solid var(--border)'
                    }}
                  >
                    <div
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 999,
                        background: 'var(--green-800)',
                        color: '#ffffff',
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: 12,
                        fontWeight: 800,
                        flexShrink: 0
                      }}
                    >
                      {idx + 1}
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-primary)' }}>
                      {step}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Key Concepts and Examiner Traps (Two Columns) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))', gap: 20 }}>
            {/* Key Concepts */}
            <div
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 16,
                padding: '20px'
              }}
            >
              <h4 style={{ fontSize: 14, fontWeight: 800, margin: '0 0 12px', color: 'var(--green-800)' }}>
                Key Concepts &amp; Formulas
              </h4>
              <ul style={{ paddingLeft: 18, margin: 0, fontSize: 13, lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {result.keyConcepts.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>

            {/* Common Mistakes */}
            <div
              style={{
                background: 'var(--surface)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                borderRadius: 16,
                padding: '20px'
              }}
            >
              <h4 style={{ fontSize: 14, fontWeight: 800, margin: '0 0 12px', color: '#dc2626', display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={15} />
                <span>Examiner Traps &amp; Common Pitfalls</span>
              </h4>
              <ul style={{ paddingLeft: 18, margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--text-primary)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {result.commonMistakes.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          </div>

          {/* Similar Practice Exam Questions */}
          {result.similarQuestions.length > 0 && (
            <div
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 16,
                padding: '24px'
              }}
            >
              <h3 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileQuestion size={16} color="var(--green-700)" />
                <span>Similar Practice Questions</span>
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {result.similarQuestions.map((sq, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '16px',
                      borderRadius: 12,
                      background: 'var(--surface-alt)',
                      border: '1px solid var(--border)'
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, lineHeight: 1.4 }}>
                      Q{idx + 1}: {sq.question}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10, fontStyle: 'italic' }}>
                      Hint: {sq.hint}
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleSolution(idx)}
                      className="btn btn-secondary"
                      style={{ fontSize: 11, padding: '5px 10px', gap: 6 }}
                    >
                      {expandedSolutions[idx] ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      <span>{expandedSolutions[idx] ? 'Hide Solution' : 'Reveal Solution'}</span>
                    </button>

                    {expandedSolutions[idx] && (
                      <div
                        style={{
                          marginTop: 10,
                          padding: '10px 14px',
                          borderRadius: 8,
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          fontSize: 12,
                          lineHeight: 1.5,
                          color: 'var(--text-primary)'
                        }}
                      >
                        <strong>Solution:</strong> {sq.solution}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Citations & Suggested Revision Topics */}
          {result.citations && result.citations.length > 0 && (
            <div
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 16,
                padding: '20px 24px'
              }}
            >
              <h4 style={{ fontSize: 14, fontWeight: 800, margin: '0 0 10px', color: 'var(--green-800)' }}>
                Recommended FUW Library Reading
              </h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {result.citations.map((c, i) => (
                  <Link
                    key={i}
                    to={`/materials/${c.materialId}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 12px',
                      borderRadius: 8,
                      background: 'var(--surface-alt)',
                      border: '1px solid var(--border)',
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                      textDecoration: 'none'
                    }}
                  >
                    <BookOpen size={13} color="var(--green-700)" />
                    <span>{c.title}{c.page ? ` (p. ${c.page})` : ''}</span>
                    <ArrowRight size={11} />
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
