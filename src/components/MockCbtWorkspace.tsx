import React, { useState, useEffect } from 'react';
import {
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Award,
  RotateCcw,
  BookOpen,
  ArrowRight,
  ArrowLeft,
  Flag,
  Sparkles,
  HelpCircle,
  ChevronRight,
  Filter,
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { Link } from 'react-router-dom';

interface CbtQuestion {
  id: string;
  courseCode: string;
  courseTitle: string;
  question: string;
  options: { [key: string]: string };
  correctOption: string;
  topic: string;
  explanation: string;
}

const SAMPLE_QUESTION_BANK: CbtQuestion[] = [
  {
    id: 'gst101-1',
    courseCode: 'GST101',
    courseTitle: 'Use of English I',
    question: 'In English morphology, which of the following prefixes indicates negation or reversal?',
    options: {
      A: 'Pre-',
      B: 'Dis-',
      C: 'Sub-',
      D: 'Trans-',
    },
    correctOption: 'B',
    topic: 'Morphology & Affixation',
    explanation: 'The prefix "dis-" denotes negation or the reverse of an action (e.g., connect -> disconnect, approve -> disapprove).',
  },
  {
    id: 'gst101-2',
    courseCode: 'GST101',
    courseTitle: 'Use of English I',
    question: 'Identify the sentence with correct subject-verb concord:',
    options: {
      A: 'Neither the lecturer nor the students was present in the auditorium.',
      B: 'Neither the lecturer nor the students were present in the auditorium.',
      C: 'Neither the students nor the lecturer were present in the auditorium.',
      D: 'The students and the lecturer was late.',
    },
    correctOption: 'B',
    topic: 'Grammatical Concord',
    explanation: 'When subjects are connected by "neither... nor", the verb agrees in number with the nearer subject ("the students" is plural, hence "were").',
  },
  {
    id: 'gst102-1',
    courseCode: 'GST102',
    courseTitle: 'Philosophy, Logic & Human Existence',
    question: 'In traditional formal logic, an argument whose conclusion follows necessarily from its premises is termed:',
    options: {
      A: 'Inductive',
      B: 'Valid',
      C: 'Plausible',
      D: 'Fallacious',
    },
    correctOption: 'B',
    topic: 'Deductive Logic',
    explanation: 'A deductive argument is valid if and only if it takes a form that makes it impossible for the premises to be true and the conclusion nevertheless false.',
  },
  {
    id: 'bio102-1',
    courseCode: 'BIO102',
    courseTitle: 'General Biology II',
    question: 'During cellular respiration, which stage generates the highest yield of ATP via oxidative phosphorylation?',
    options: {
      A: 'Glycolysis',
      B: 'Krebs Cycle',
      C: 'Electron Transport Chain',
      D: 'Fermentation',
    },
    correctOption: 'C',
    topic: 'Cellular Energetics',
    explanation: 'The Electron Transport Chain (ETC) paired with chemiosmosis generates approximately 28 to 32 ATP molecules, the largest fraction of ATP in aerobic respiration.',
  },
  {
    id: 'chm102-1',
    courseCode: 'CHM102',
    courseTitle: 'General Chemistry II',
    question: 'According to Le Chatelier’s Principle, what effect will increasing the pressure have on an equilibrium system containing gaseous reactants and products?',
    options: {
      A: 'Shift the equilibrium towards the side with fewer moles of gas',
      B: 'Shift the equilibrium towards the side with more moles of gas',
      C: 'Double the rate constant of the forward reaction',
      D: 'Decrease the total activation energy of the catalyst',
    },
    correctOption: 'A',
    topic: 'Chemical Equilibrium',
    explanation: 'An increase in pressure forces the system to reduce the number of gas molecules, shifting equilibrium toward the side with fewer moles of gas.',
  },
  {
    id: 'mth102-1',
    courseCode: 'MTH102',
    courseTitle: 'Elementary Mathematics II',
    question: 'What is the derivative of f(x) = ln(3x² + 5) with respect to x?',
    options: {
      A: '1 / (3x² + 5)',
      B: '6x / (3x² + 5)',
      C: '3x / (3x² + 5)',
      D: '6x ln(3x² + 5)',
    },
    correctOption: 'B',
    topic: 'Calculus & Chain Rule',
    explanation: 'Applying the chain rule d/dx[ln(u)] = u\'/u, where u = 3x² + 5 and u\' = 6x, gives f\'(x) = 6x / (3x² + 5).',
  },
];

export const MockCbtWorkspace: React.FC = () => {
  const { hasPremium, profile } = useAuth();

  const [selectedCourse, setSelectedCourse] = useState('ALL');
  const [examStarted, setExamStarted] = useState(false);
  const [examFinished, setExamFinished] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState<{ [id: string]: string }>({});
  const [flaggedQuestions, setFlaggedQuestions] = useState<{ [id: string]: boolean }>({});
  const [timeLeftSeconds, setTimeLeftSeconds] = useState(600); // 10 minutes default
  const [questions, setQuestions] = useState<CbtQuestion[]>(SAMPLE_QUESTION_BANK);

  // Filter questions by course
  useEffect(() => {
    if (selectedCourse === 'ALL') {
      setQuestions(SAMPLE_QUESTION_BANK);
    } else {
      setQuestions(SAMPLE_QUESTION_BANK.filter((q) => q.courseCode === selectedCourse));
    }
  }, [selectedCourse]);

  // Timer countdown
  useEffect(() => {
    if (!examStarted || examFinished) return;
    if (timeLeftSeconds <= 0) {
      handleFinishExam();
      return;
    }
    const timer = setInterval(() => {
      setTimeLeftSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [examStarted, examFinished, timeLeftSeconds]);

  const handleStartExam = () => {
    setUserAnswers({});
    setFlaggedQuestions({});
    setCurrentIndex(0);
    setTimeLeftSeconds(Math.max(questions.length * 60, 300));
    setExamStarted(true);
    setExamFinished(false);
  };

  const handleSelectOption = (optKey: string) => {
    const q = questions[currentIndex];
    if (!q) return;
    setUserAnswers((prev) => ({ ...prev, [q.id]: optKey }));
  };

  const handleToggleFlag = () => {
    const q = questions[currentIndex];
    if (!q) return;
    setFlaggedQuestions((prev) => ({ ...prev, [q.id]: !prev[q.id] }));
  };

  const handleFinishExam = () => {
    setExamFinished(true);
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // Score computation
  const correctCount = questions.reduce((acc, q) => {
    return userAnswers[q.id] === q.correctOption ? acc + 1 : acc;
  }, 0);
  const totalCount = questions.length;
  const scorePercent = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0;

  // Weak topics calculation
  const topicStats: { [topic: string]: { correct: number; total: number } } = {};
  questions.forEach((q) => {
    if (!topicStats[q.topic]) topicStats[q.topic] = { correct: 0, total: 0 };
    topicStats[q.topic].total += 1;
    if (userAnswers[q.id] === q.correctOption) {
      topicStats[q.topic].correct += 1;
    }
  });

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '16px 8px' }}>
      {/* Header Banner */}
      <div
        style={{
          background: 'linear-gradient(135deg, #0d4a2f 0%, #12603d 100%)',
          color: '#ffffff',
          borderRadius: 16,
          padding: '24px 20px',
          marginBottom: 24,
          boxShadow: '0 4px 16px rgba(18, 96, 61, 0.15)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.15)', padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
              <Sparkles size={14} color="#fde047" />
              <span>Campus Hub Mock CBT Simulator</span>
            </div>
            <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>Timed Exam &amp; Past-Question Drill</h2>
            <p style={{ margin: '6px 0 0', fontSize: 14, opacity: 0.9 }}>
              Practice real departmental past questions and GST tests under timed computer conditions with instant diagnostic review.
            </p>
          </div>

          {!hasPremium && (
            <div style={{ background: '#fef3c7', color: '#92400e', padding: '8px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700 }}>
              Free Preview Mode (Sample Drill) · <Link to="/student/subscription" style={{ color: '#b45309', textDecoration: 'underline' }}>Unlock Unlimited CBT</Link>
            </div>
          )}
        </div>
      </div>

      {!examStarted && !examFinished && (
        <div style={{ background: '#ffffff', borderRadius: 16, border: '1px solid #dcebe0', padding: 24 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 800 }}>Configure Your Practice Test</h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 24 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                Select Course / Subject
              </label>
              <select
                value={selectedCourse}
                onChange={(e) => setSelectedCourse(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #dcebe0', fontSize: 14 }}
              >
                <option value="ALL">All General Courses (Mix Drill)</option>
                <option value="GST101">GST 101 - Use of English I</option>
                <option value="GST102">GST 102 - Philosophy &amp; Logic</option>
                <option value="BIO102">BIO 102 - General Biology II</option>
                <option value="CHM102">CHM 102 - General Chemistry II</option>
                <option value="MTH102">MTH 102 - Elementary Mathematics II</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                Questions in Drill
              </label>
              <div style={{ padding: '10px 12px', borderRadius: 8, background: '#f8faf9', border: '1px solid #dcebe0', fontSize: 14, fontWeight: 700 }}>
                {questions.length} Questions ({Math.round(questions.length * 1.5)} minutes estimated)
              </div>
            </div>
          </div>

          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: 16, marginBottom: 24 }}>
            <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: '#166534' }}>
              Exam Instructions &amp; Format:
            </h4>
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#14532d', lineHeight: 1.6 }}>
              <li>Each question has exactly one correct answer.</li>
              <li>You can flag difficult questions to review before submitting.</li>
              <li>When the timer hits 0:00, your exam will auto-submit automatically.</li>
              <li>Full explanations and weak-topic breakdown will be presented immediately upon completion.</li>
            </ul>
          </div>

          <button
            type="button"
            onClick={handleStartExam}
            className="btn btn-primary"
            style={{ width: '100%', padding: '14px', fontSize: 16, fontWeight: 700, borderRadius: 10 }}
          >
            Start Timed CBT Test Now
          </button>
        </div>
      )}

      {/* Live Exam Mode */}
      {examStarted && !examFinished && questions[currentIndex] && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24 }}>
          {/* Main Question Panel */}
          <div style={{ background: '#ffffff', borderRadius: 16, border: '1px solid #dcebe0', padding: 24 }}>
            {/* Top Toolbar */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #e5e7eb', paddingBottom: 14, marginBottom: 18 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#065f46' }}>
                Question {currentIndex + 1} of {questions.length}
                <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 8 }}>({questions[currentIndex].courseCode})</span>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 8,
                  fontWeight: 800,
                  fontSize: 14,
                  background: timeLeftSeconds < 120 ? '#fee2e2' : '#f0fdf4',
                  color: timeLeftSeconds < 120 ? '#dc2626' : '#166534',
                  border: `1px solid ${timeLeftSeconds < 120 ? '#fca5a5' : '#bbf7d0'}`,
                }}
              >
                <Clock size={16} />
                <span>{formatTime(timeLeftSeconds)}</span>
              </div>
            </div>

            {/* Question Text */}
            <div style={{ fontSize: 16, fontWeight: 600, color: '#111827', lineHeight: 1.5, marginBottom: 20 }}>
              {questions[currentIndex].question}
            </div>

            {/* Options List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
              {Object.entries(questions[currentIndex].options).map(([optKey, optVal]) => {
                const isSelected = userAnswers[questions[currentIndex].id] === optKey;
                return (
                  <button
                    key={optKey}
                    type="button"
                    onClick={() => handleSelectOption(optKey)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '12px 16px',
                      borderRadius: 10,
                      border: isSelected ? '2px solid #10b981' : '1px solid #d1d5db',
                      background: isSelected ? '#ecfdf5' : '#ffffff',
                      textAlign: 'left',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      width: '100%',
                    }}
                  >
                    <span
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 999,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 13,
                        fontWeight: 700,
                        background: isSelected ? '#10b981' : '#f3f4f6',
                        color: isSelected ? '#ffffff' : '#374151',
                        flexShrink: 0,
                      }}
                    >
                      {optKey}
                    </span>
                    <span style={{ fontSize: 14, color: '#1f2937', fontWeight: isSelected ? 600 : 400 }}>
                      {optVal}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Navigation Actions */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #e5e7eb', paddingTop: 16, flexWrap: 'wrap', gap: 10 }}>
              <button
                type="button"
                onClick={handleToggleFlag}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 14px',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  border: '1px solid #d1d5db',
                  background: flaggedQuestions[questions[currentIndex].id] ? '#fef3c7' : '#f9fafb',
                  color: flaggedQuestions[questions[currentIndex].id] ? '#b45309' : '#4b5563',
                  cursor: 'pointer',
                }}
              >
                <Flag size={14} />
                <span>{flaggedQuestions[questions[currentIndex].id] ? 'Flagged for Review' : 'Flag Question'}</span>
              </button>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  disabled={currentIndex === 0}
                  onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
                  className="btn btn-secondary btn-sm"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <ArrowLeft size={14} /> Prev
                </button>

                {currentIndex < questions.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => setCurrentIndex((prev) => Math.min(questions.length - 1, prev + 1))}
                    className="btn btn-primary btn-sm"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  >
                    Next <ArrowRight size={14} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleFinishExam}
                    className="btn btn-primary btn-sm"
                    style={{ background: '#059669', borderColor: '#059669' }}
                  >
                    Submit Test
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Question Grid Navigator */}
          <div style={{ background: '#ffffff', borderRadius: 16, border: '1px solid #dcebe0', padding: 20 }}>
            <h4 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700 }}>Question Navigator</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 20 }}>
              {questions.map((q, idx) => {
                const isAnswered = !!userAnswers[q.id];
                const isCurrent = idx === currentIndex;
                const isFlagged = !!flaggedQuestions[q.id];

                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setCurrentIndex(idx)}
                    style={{
                      height: 38,
                      borderRadius: 8,
                      border: isCurrent ? '2px solid #10b981' : '1px solid #d1d5db',
                      background: isFlagged ? '#fde68a' : isAnswered ? '#d1fae5' : '#f9fafb',
                      color: isFlagged ? '#92400e' : isAnswered ? '#065f46' : '#374151',
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>

            <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: '#4b5563' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: '#d1fae5', border: '1px solid #10b981' }}></span>
                <span>Answered ({Object.keys(userAnswers).length})</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: '#fde68a', border: '1px solid #f59e0b' }}></span>
                <span>Flagged for Review ({Object.values(flaggedQuestions).filter(Boolean).length})</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: '#f9fafb', border: '1px solid #d1d5db' }}></span>
                <span>Unanswered ({questions.length - Object.keys(userAnswers).length})</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleFinishExam}
              className="btn btn-primary"
              style={{ width: '100%', marginTop: 20, padding: '10px', fontSize: 14, fontWeight: 700 }}
            >
              Finish &amp; View Results
            </button>
          </div>
        </div>
      )}

      {/* Results & Diagnostic Review Mode */}
      {examFinished && (
        <div style={{ background: '#ffffff', borderRadius: 16, border: '1px solid #dcebe0', padding: 24 }}>
          {/* Score Card */}
          <div
            style={{
              textAlign: 'center',
              padding: '24px 16px',
              borderRadius: 14,
              background: scorePercent >= 70 ? '#f0fdf4' : scorePercent >= 50 ? '#fefce8' : '#fef2f2',
              border: `1px solid ${scorePercent >= 70 ? '#bbf7d0' : scorePercent >= 50 ? '#fef08a' : '#fecaca'}`,
              marginBottom: 28,
            }}
          >
            <Award
              size={44}
              color={scorePercent >= 70 ? '#166534' : scorePercent >= 50 ? '#ca8a04' : '#dc2626'}
              style={{ margin: '0 auto 8px' }}
            />
            <h3 style={{ margin: 0, fontSize: 28, fontWeight: 900, color: '#111827' }}>
              {scorePercent}%
            </h3>
            <p style={{ margin: '4px 0 12px', fontSize: 15, fontWeight: 600, color: '#374151' }}>
              You scored {correctCount} out of {totalCount} questions correct.
            </p>
            <div style={{ display: 'inline-flex', gap: 10 }}>
              <button
                type="button"
                onClick={handleStartExam}
                className="btn btn-secondary btn-sm"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <RotateCcw size={14} /> Retake Test
              </button>
            </div>
          </div>

          {/* Topic Performance Breakdown */}
          <h4 style={{ margin: '0 0 14px', fontSize: 16, fontWeight: 800 }}>Topic Mastery Diagnostic</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 32 }}>
            {Object.entries(topicStats).map(([topic, stat]) => {
              const pct = Math.round((stat.correct / stat.total) * 100);
              return (
                <div key={topic} style={{ background: '#f8faf9', border: '1px solid #e5e7eb', borderRadius: 10, padding: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1f2937', marginBottom: 6 }}>{topic}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#4b5563', marginBottom: 4 }}>
                    <span>{stat.correct}/{stat.total} Correct</span>
                    <span style={{ fontWeight: 700, color: pct >= 70 ? '#059669' : '#dc2626' }}>{pct}%</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: '#e5e7eb', overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: pct >= 70 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444' }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Question-by-Question Review */}
          <h4 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 800 }}>Question Review &amp; Explanations</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {questions.map((q, idx) => {
              const userOpt = userAnswers[q.id];
              const isCorrect = userOpt === q.correctOption;

              return (
                <div
                  key={q.id}
                  style={{
                    padding: 18,
                    borderRadius: 12,
                    border: `1px solid ${isCorrect ? '#bbf7d0' : '#fecaca'}`,
                    background: isCorrect ? '#fafffc' : '#fffbfa',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: '#374151' }}>
                      Question {idx + 1} · {q.courseCode} ({q.topic})
                    </span>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: 12,
                        fontWeight: 700,
                        color: isCorrect ? '#166534' : '#b91c1c',
                      }}
                    >
                      {isCorrect ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                      {isCorrect ? 'Correct' : userOpt ? 'Incorrect' : 'Skipped'}
                    </span>
                  </div>

                  <p style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 600, color: '#111827' }}>
                    {q.question}
                  </p>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, marginBottom: 12 }}>
                    {Object.entries(q.options).map(([k, val]) => {
                      const isCorrectChoice = k === q.correctOption;
                      const isUserChoice = k === userOpt;

                      let border = '#e5e7eb';
                      let bg = '#ffffff';
                      let color = '#374151';

                      if (isCorrectChoice) {
                        border = '#10b981';
                        bg = '#ecfdf5';
                        color = '#065f46';
                      } else if (isUserChoice && !isCorrect) {
                        border = '#ef4444';
                        bg = '#fef2f2';
                        color = '#991b1b';
                      }

                      return (
                        <div
                          key={k}
                          style={{
                            padding: '8px 12px',
                            borderRadius: 8,
                            border: `1px solid ${border}`,
                            background: bg,
                            fontSize: 13,
                            color,
                            fontWeight: isCorrectChoice || isUserChoice ? 600 : 400,
                          }}
                        >
                          <strong>{k}.</strong> {val}
                        </div>
                      );
                    })}
                  </div>

                  {/* Academic Explanation */}
                  <div style={{ background: '#f8faf9', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, fontSize: 13, color: '#374151' }}>
                    <strong style={{ color: '#065f46', display: 'block', marginBottom: 2 }}>
                      Academic Rationale:
                    </strong>
                    {q.explanation}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default MockCbtWorkspace;
