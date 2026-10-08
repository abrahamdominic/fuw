import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp,
  Sparkles,
  Calendar,
  CheckCircle,
  HelpCircle,
  AlertTriangle,
  ArrowRight,
  Loader2,
  Lock,
  BookOpen,
  Award,
  Clock,
  RotateCcw
} from 'lucide-react';
import {
  calculateExamReadiness,
  generateExamPrepPlan,
  ExamReadinessResult,
  ExamPrepPlan
} from '../lib/examPrep';
import { useAuth } from '../lib/AuthContext';
import { fx } from '../lib/motion';

export function ExamPrepWorkspace() {
  const { profile, hasPremium } = useAuth();
  const [selectedCourse, setSelectedCourse] = useState('CSC 201');
  const [examDate, setExamDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 21);
    return d.toISOString().split('T')[0];
  });
  const [weakTopics, setWeakTopics] = useState('');
  const [readiness, setReadiness] = useState<ExamReadinessResult | null>(null);
  const [plan, setPlan] = useState<ExamPrepPlan | null>(null);
  const [loadingReadiness, setLoadingReadiness] = useState(false);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Practice Quiz State
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({});
  const [showQuizResults, setShowQuizResults] = useState(false);

  const availableCourses = ['CSC 201', 'MTH 101', 'GST 111', 'CHM 101', 'PHY 101', 'BIO 101'];

  useEffect(() => {
    loadReadiness(selectedCourse);
  }, [selectedCourse]);

  const loadReadiness = async (course: string) => {
    setLoadingReadiness(true);
    try {
      const res = await calculateExamReadiness(course, examDate);
      setReadiness(res);
    } catch (err) {
      console.warn('Could not calculate readiness:', err);
    } finally {
      setLoadingReadiness(false);
    }
  };

  const handleGeneratePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasPremium) {
      setError('AI Exam Preparation Planning is a Premium feature. Upgrade to unlock custom study roadmaps and quizzes.');
      return;
    }

    setGeneratingPlan(true);
    setError(null);
    try {
      const p = await generateExamPrepPlan({
        courseCode: selectedCourse,
        examDate,
        weakTopics: weakTopics || undefined
      });
      setPlan(p);
      setQuizAnswers({});
      setShowQuizResults(false);
    } catch (err: any) {
      setError(err?.message || 'Failed to generate exam preparation plan.');
    } finally {
      setGeneratingPlan(false);
    }
  };

  const handleSelectQuizOption = (qIdx: number, optIdx: number) => {
    if (showQuizResults) return;
    setQuizAnswers((prev) => ({ ...prev, [qIdx]: optIdx }));
  };

  return (
    <div className={`exam-prep-workspace ${fx.fadeIn}`} style={{ maxWidth: 960, margin: '0 auto', paddingBottom: 60 }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 999, background: 'rgba(234, 88, 12, 0.12)', color: '#ea580c', fontSize: 11, fontWeight: 700, marginBottom: 8 }}>
          <TrendingUp size={13} />
          <span>EXAM READINESS SCORE &middot; AI STUDY BLUEPRINTS</span>
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 900, margin: '0 0 6px', letterSpacing: '-0.02em' }}>
          Exam Preparation &amp; Readiness
        </h1>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)' }}>
          Evaluate your exam readiness score, identify weak topics, generate structured daily milestones, and test your retention with past exam practice quizzes.
        </p>
      </div>

      {/* Course Selector Strip */}
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 24
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ fontSize: 13, fontWeight: 700 }}>Select Target Course:</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {availableCourses.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setSelectedCourse(c)}
                style={{
                  padding: '5px 12px',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 700,
                  border: '1px solid var(--border)',
                  background: selectedCourse === c ? 'var(--green-800)' : 'var(--surface-alt)',
                  color: selectedCourse === c ? '#ffffff' : 'var(--text-primary)',
                  cursor: 'pointer'
                }}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>Exam Date:</label>
          <input
            type="date"
            value={examDate}
            onChange={(e) => setExamDate(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, background: 'var(--surface-alt)' }}
          />
        </div>
      </div>

      {/* Exam Readiness Score Card */}
      {readiness && (
        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 18,
            padding: '24px',
            marginBottom: 28,
            boxShadow: 'var(--shadow-sm)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', color: 'var(--green-800)', marginBottom: 2 }}>
                Current Preparation Level
              </div>
              <h2 style={{ fontSize: 20, fontWeight: 900, margin: 0 }}>
                {readiness.courseCode} Readiness: {readiness.tier}
              </h2>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 999,
                  background:
                    readiness.score >= 80
                      ? 'rgba(34, 197, 94, 0.15)'
                      : readiness.score >= 60
                      ? 'rgba(59, 130, 246, 0.15)'
                      : 'rgba(239, 68, 68, 0.15)',
                  color:
                    readiness.score >= 80
                      ? '#16a34a'
                      : readiness.score >= 60
                      ? '#2563eb'
                      : '#dc2626',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 18,
                  fontWeight: 900
                }}
              >
                {readiness.score}%
              </div>
            </div>
          </div>

          {/* Sub-metrics Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 20 }}>
            <div style={{ padding: '14px', borderRadius: 12, background: 'var(--surface-alt)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 700, marginBottom: 4 }}>
                Course Materials Read
              </div>
              <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--text-primary)' }}>
                {readiness.readingProgressPct}%
              </div>
              <div style={{ height: 4, borderRadius: 999, background: 'var(--border)', marginTop: 8, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${readiness.readingProgressPct}%`, background: 'var(--green-600)' }} />
              </div>
            </div>

            <div style={{ padding: '14px', borderRadius: 12, background: 'var(--surface-alt)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 700, marginBottom: 4 }}>
                Flashcard Active Recall
              </div>
              <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--text-primary)' }}>
                {readiness.flashcardMasteryPct}%
              </div>
              <div style={{ height: 4, borderRadius: 999, background: 'var(--border)', marginTop: 8, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${readiness.flashcardMasteryPct}%`, background: '#2563eb' }} />
              </div>
            </div>

            <div style={{ padding: '14px', borderRadius: 12, background: 'var(--surface-alt)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 700, marginBottom: 4 }}>
                Preparation Tasks Completed
              </div>
              <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--text-primary)' }}>
                {readiness.tasksCompletedCount}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 8 }}>
                Logged reading &amp; download records
              </div>
            </div>
          </div>

          {/* Actionable Insights */}
          <div style={{ padding: '16px 20px', borderRadius: 12, background: 'rgba(22, 163, 74, 0.08)', border: '1px solid rgba(22, 163, 74, 0.2)' }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--green-800)', marginBottom: 6 }}>
              Actionable Recommendations to Reach 100% Readiness:
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6, color: 'var(--text-primary)' }}>
              {readiness.actionableInsights.map((insight, i) => (
                <li key={i}>{insight}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* AI Exam Plan Generator Form */}
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 18,
          padding: '24px',
          marginBottom: 28
        }}
      >
        <h3 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={16} color="#ea580c" />
          <span>Generate AI Exam Revision Roadmap &amp; Practice Quiz</span>
        </h3>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-secondary)' }}>
          Create a targeted day-by-day revision schedule customized to the time remaining and your self-reported weak areas.
        </p>

        <form onSubmit={handleGeneratePlan} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
              Weak Areas or Difficult Topics (Optional):
            </label>
            <input
              type="text"
              value={weakTopics}
              onChange={(e) => setWeakTopics(e.target.value)}
              placeholder="e.g. Memory addressing modes, calculus optimization, legal tort principles"
              style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-alt)', fontSize: 13 }}
            />
          </div>

          {error && (
            <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(239, 68, 68, 0.1)', color: '#dc2626', fontSize: 12 }}>
              {error}
            </div>
          )}

          {!hasPremium && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: 'rgba(234, 179, 8, 0.1)', color: '#b45309', fontSize: 12 }}>
              <Lock size={14} />
              <span>Full Exam Roadmap &amp; Quizzes require FUW Premium &middot; <Link to="/student/subscription" style={{ fontWeight: 700, textDecoration: 'underline' }}>Upgrade</Link></span>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={generatingPlan}
              style={{ fontSize: 13, padding: '10px 20px', gap: 8 }}
            >
              {generatingPlan ? <><Loader2 size={15} className="spin-icon" /> Generating Roadmap...</> : <><Sparkles size={15} /> Build Revision Roadmap</>}
            </button>
          </div>
        </form>
      </div>

      {/* Generated Plan Display */}
      {plan && (
        <div className={fx.fadeUp} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Plan Summary Card */}
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 18,
              padding: '24px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ fontSize: 18, fontWeight: 900, margin: 0 }}>
                {plan.courseCode} Revision Strategy ({plan.daysRemaining} Days Left)
              </h2>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Target: {plan.examDate}
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
              {plan.summary}
            </p>
          </div>

          {/* Weekly Schedule */}
          {plan.weeklyPlan.length > 0 && (
            <div
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 18,
                padding: '24px'
              }}
            >
              <h3 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Calendar size={16} color="var(--green-800)" />
                <span>Weekly Revision Milestones</span>
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {plan.weeklyPlan.map((wk, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '16px 20px',
                      borderRadius: 12,
                      background: 'var(--surface-alt)',
                      border: '1px solid var(--border)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--green-800)' }}>
                        {wk.week}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
                        {wk.focus}
                      </span>
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {wk.dailyTasks.map((t, ti) => (
                        <li key={ti}>{t}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Interactive Practice Quiz */}
          {plan.quizQuestions.length > 0 && (
            <div
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 18,
                padding: '24px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <HelpCircle size={16} color="#ea580c" />
                  <span>Exam Simulation Quiz ({plan.quizQuestions.length} Questions)</span>
                </h3>

                {showQuizResults && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuizAnswers({});
                      setShowQuizResults(false);
                    }}
                    className="btn btn-secondary"
                    style={{ fontSize: 11, padding: '4px 10px', gap: 4 }}
                  >
                    <RotateCcw size={12} />
                    <span>Retake Quiz</span>
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {plan.quizQuestions.map((q, qIdx) => {
                  const selected = quizAnswers[qIdx];
                  const isAnswered = selected !== undefined;
                  const isCorrect = isAnswered && selected === q.correctIndex;

                  return (
                    <div
                      key={qIdx}
                      style={{
                        padding: '16px 20px',
                        borderRadius: 12,
                        background: 'var(--surface-alt)',
                        border: '1px solid var(--border)'
                      }}
                    >
                      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, lineHeight: 1.4 }}>
                        {qIdx + 1}. {q.question}
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {q.options.map((opt, oIdx) => {
                          const isOptionSelected = selected === oIdx;
                          const isRightOption = q.correctIndex === oIdx;

                          let bg = 'var(--surface)';
                          let border = '1px solid var(--border)';
                          let color = 'inherit';

                          if (showQuizResults) {
                            if (isRightOption) {
                              bg = 'rgba(34, 197, 94, 0.15)';
                              border = '1px solid #16a34a';
                              color = '#15803d';
                            } else if (isOptionSelected && !isRightOption) {
                              bg = 'rgba(239, 68, 68, 0.15)';
                              border = '1px solid #dc2626';
                              color = '#dc2626';
                            }
                          } else if (isOptionSelected) {
                            bg = 'var(--green-800)';
                            color = '#ffffff';
                            border = '1px solid var(--green-800)';
                          }

                          return (
                            <button
                              key={oIdx}
                              type="button"
                              onClick={() => handleSelectQuizOption(qIdx, oIdx)}
                              disabled={showQuizResults}
                              style={{
                                padding: '10px 14px',
                                borderRadius: 8,
                                border,
                                background: bg,
                                color,
                                textAlign: 'left',
                                fontSize: 13,
                                cursor: showQuizResults ? 'default' : 'pointer',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              <strong>{['A', 'B', 'C', 'D'][oIdx]})</strong> {opt}
                            </button>
                          );
                        })}
                      </div>

                      {showQuizResults && (
                        <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border)', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                          <strong>Explanation:</strong> {q.explanation}
                        </div>
                      )}
                    </div>
                  );
                })}

                {!showQuizResults && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => setShowQuizResults(true)}
                      disabled={Object.keys(quizAnswers).length === 0}
                      style={{ fontSize: 13, padding: '10px 24px', gap: 6 }}
                    >
                      <CheckCircle size={15} />
                      <span>Submit Quiz &amp; View Explanations</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
