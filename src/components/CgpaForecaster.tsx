import React, { useState } from 'react';
import {
  Award,
  Calculator,
  TrendingUp,
  Target,
  Plus,
  Trash2,
  Sparkles,
  Info,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { Link } from 'react-router-dom';

interface CourseEntry {
  id: string;
  code: string;
  units: number;
  expectedGrade: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
}

const GRADE_POINTS: { [grade: string]: number } = {
  A: 5.0,
  B: 4.0,
  C: 3.0,
  D: 2.0,
  E: 1.0,
  F: 0.0,
};

export const CgpaForecaster: React.FC = () => {
  const { hasPremium, profile } = useAuth();

  // Initial user state
  const [currentCgpa, setCurrentCgpa] = useState<number>(3.25);
  const [completedUnits, setCompletedUnits] = useState<number>(36);
  const [targetClassification, setTargetClassification] = useState<'first_class' | 'second_upper' | 'second_lower'>('second_upper');

  // Semester Courses for projection
  const [courses, setCourses] = useState<CourseEntry[]>([
    { id: '1', code: 'BIO 102', units: 3, expectedGrade: 'A' },
    { id: '2', code: 'CHM 102', units: 3, expectedGrade: 'B' },
    { id: '3', code: 'PHY 102', units: 3, expectedGrade: 'B' },
    { id: '4', code: 'MTH 102', units: 3, expectedGrade: 'A' },
    { id: '5', code: 'GST 102', units: 2, expectedGrade: 'A' },
    { id: '6', code: 'GST 104', units: 2, expectedGrade: 'B' },
  ]);

  // Target GPA cutoff
  const targetCgpaGoal =
    targetClassification === 'first_class'
      ? 4.5
      : targetClassification === 'second_upper'
        ? 3.5
        : 2.4;

  // Semester calculations
  const semesterUnits = courses.reduce((sum, c) => sum + c.units, 0);
  const semesterQualityPoints = courses.reduce((sum, c) => sum + c.units * GRADE_POINTS[c.expectedGrade], 0);
  const semesterGpa = semesterUnits > 0 ? semesterQualityPoints / semesterUnits : 0;

  // Projected New Cumulative CGPA
  const priorTotalPoints = currentCgpa * completedUnits;
  const newTotalUnits = completedUnits + semesterUnits;
  const projectedCgpa =
    newTotalUnits > 0 ? (priorTotalPoints + semesterQualityPoints) / newTotalUnits : 0;

  // Minimum semester GPA required to hit goal
  // (priorTotalPoints + reqPoints) / newTotalUnits = targetCgpaGoal
  // reqPoints = (targetCgpaGoal * newTotalUnits) - priorTotalPoints
  const requiredPoints = targetCgpaGoal * newTotalUnits - priorTotalPoints;
  const requiredSemesterGpa = semesterUnits > 0 ? requiredPoints / semesterUnits : 0;

  const handleAddCourse = () => {
    const newId = String(Date.now());
    setCourses((prev) => [
      ...prev,
      { id: newId, code: `CRS ${prev.length + 1}01`, units: 3, expectedGrade: 'A' },
    ]);
  };

  const handleRemoveCourse = (id: string) => {
    setCourses((prev) => prev.filter((c) => c.id !== id));
  };

  const handleUpdateCourse = (id: string, field: 'code' | 'units' | 'expectedGrade', val: any) => {
    setCourses((prev) =>
      prev.map((c) => (c.id === id ? { ...c, [field]: val } : c))
    );
  };

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
              <Target size={14} color="#fde047" />
              <span>Target Degree Classification Simulator</span>
            </div>
            <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>Target CGPA Forecaster</h2>
            <p style={{ margin: '6px 0 0', fontSize: 14, opacity: 0.9 }}>
              Calculate the exact grade letters (A, B, C) required per registered course to achieve your target degree classification on the NUC 5.0 scale.
            </p>
          </div>

          {!hasPremium && (
            <div style={{ background: '#fef3c7', color: '#92400e', padding: '8px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700 }}>
              Included in Campus Hub Plus · <Link to="/student/subscription" style={{ color: '#b45309', textDecoration: 'underline' }}>View Plans</Link>
            </div>
          )}
        </div>
      </div>

      {/* Inputs: Current State & Target Goal */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20, marginBottom: 24 }}>
        <div style={{ background: '#ffffff', border: '1px solid #dcebe0', borderRadius: 14, padding: 20 }}>
          <h4 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 800 }}>1. Current Academic Standing</h4>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 4 }}>
                Current Cumulative CGPA (out of 5.00)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="5.00"
                value={currentCgpa}
                onChange={(e) => setCurrentCgpa(parseFloat(e.target.value) || 0)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #dcebe0', fontSize: 16, fontWeight: 700 }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 4 }}>
                Total Credit Units Completed So Far
              </label>
              <input
                type="number"
                min="0"
                value={completedUnits}
                onChange={(e) => setCompletedUnits(parseInt(e.target.value) || 0)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #dcebe0', fontSize: 16, fontWeight: 700 }}
              />
            </div>
          </div>
        </div>

        <div style={{ background: '#ffffff', border: '1px solid #dcebe0', borderRadius: 14, padding: 20 }}>
          <h4 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 800 }}>2. Target Degree Classification</h4>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { key: 'first_class', label: 'First Class Honours (4.50 – 5.00)', cutoff: 4.5 },
              { key: 'second_upper', label: 'Second Class Upper (3.50 – 4.49)', cutoff: 3.5 },
              { key: 'second_lower', label: 'Second Class Lower (2.40 – 3.49)', cutoff: 2.4 },
            ].map((cls) => (
              <label
                key={cls.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '12px 14px',
                  borderRadius: 8,
                  border: targetClassification === cls.key ? '2px solid #10b981' : '1px solid #e5e7eb',
                  background: targetClassification === cls.key ? '#ecfdf5' : '#ffffff',
                  cursor: 'pointer',
                  fontWeight: targetClassification === cls.key ? 700 : 500,
                  fontSize: 13,
                }}
              >
                <input
                  type="radio"
                  name="classification"
                  checked={targetClassification === cls.key}
                  onChange={() => setTargetClassification(cls.key as any)}
                />
                <span>{cls.label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Live Projection Metrics Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 28 }}>
        <div style={{ background: '#f8faf9', border: '1px solid #dcebe0', borderRadius: 12, padding: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#55675b', marginBottom: 4 }}>Registered Units This Term</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#17231d' }}>{semesterUnits} Units</div>
        </div>

        <div style={{ background: '#f8faf9', border: '1px solid #dcebe0', borderRadius: 12, padding: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#55675b', marginBottom: 4 }}>Projected Term GPA</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#047857' }}>{semesterGpa.toFixed(2)}</div>
        </div>

        <div style={{ background: '#f8faf9', border: '1px solid #dcebe0', borderRadius: 12, padding: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#55675b', marginBottom: 4 }}>New Projected CGPA</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: projectedCgpa >= targetCgpaGoal ? '#047857' : '#b45309' }}>
            {projectedCgpa.toFixed(2)}
          </div>
        </div>

        <div style={{ background: '#f8faf9', border: '1px solid #dcebe0', borderRadius: 12, padding: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#55675b', marginBottom: 4 }}>Term GPA Needed for Goal</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: requiredSemesterGpa <= 5.0 ? '#047857' : '#dc2626' }}>
            {requiredSemesterGpa <= 5.0 ? requiredSemesterGpa.toFixed(2) : 'Exceeds 5.0 (Need 2+ sems)'}
          </div>
        </div>
      </div>

      {/* Target Roadmap Recommendation */}
      <div
        style={{
          background: projectedCgpa >= targetCgpaGoal ? '#f0fdf4' : '#fffbeb',
          border: `1px solid ${projectedCgpa >= targetCgpaGoal ? '#bbf7d0' : '#fde68a'}`,
          borderRadius: 14,
          padding: 18,
          marginBottom: 28,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
        }}
      >
        {projectedCgpa >= targetCgpaGoal ? (
          <CheckCircle2 size={24} color="#166534" style={{ flexShrink: 0, marginTop: 2 }} />
        ) : (
          <AlertCircle size={24} color="#b45309" style={{ flexShrink: 0, marginTop: 2 }} />
        )}
        <div>
          <h4 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700, color: projectedCgpa >= targetCgpaGoal ? '#166534' : '#92400e' }}>
            {projectedCgpa >= targetCgpaGoal
              ? `You are on track to achieve ${targetClassification.replace('_', ' ').toUpperCase()} (${projectedCgpa.toFixed(2)})!`
              : `To reach your goal of ${targetCgpaGoal.toFixed(2)}, increase higher grade letters in your 3-unit courses.`}
          </h4>
          <p style={{ margin: 0, fontSize: 13, color: '#4b5563', lineHeight: 1.5 }}>
            Focus on maximizing 3-credit courses: earning an &lsquo;A&rsquo; in a 3-unit course yields 15 quality points, which moves your CGPA faster than 2-unit electives.
          </p>
        </div>
      </div>

      {/* Course Grade Sandbox */}
      <div style={{ background: '#ffffff', border: '1px solid #dcebe0', borderRadius: 14, padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h4 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Course Grade Sandbox</h4>
          <button
            type="button"
            onClick={handleAddCourse}
            className="btn btn-secondary btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Plus size={14} /> Add Course
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {courses.map((c) => (
            <div
              key={c.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '2fr 1fr 1fr auto',
                gap: 12,
                alignItems: 'center',
                padding: '10px 14px',
                background: '#f8faf9',
                borderRadius: 8,
                border: '1px solid #e5e7eb',
              }}
            >
              <input
                type="text"
                value={c.code}
                onChange={(e) => handleUpdateCourse(c.id, 'code', e.target.value)}
                placeholder="Course Code"
                style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13, fontWeight: 600 }}
              />

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: '#6b7280' }}>Units:</span>
                <select
                  value={c.units}
                  onChange={(e) => handleUpdateCourse(c.id, 'units', parseInt(e.target.value) || 1)}
                  style={{ padding: '8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }}
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                  <option value={4}>4</option>
                  <option value={5}>5</option>
                  <option value={6}>6</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: '#6b7280' }}>Grade:</span>
                <select
                  value={c.expectedGrade}
                  onChange={(e) => handleUpdateCourse(c.id, 'expectedGrade', e.target.value as any)}
                  style={{
                    padding: '8px',
                    borderRadius: 6,
                    border: '1px solid #d1d5db',
                    fontSize: 13,
                    fontWeight: 700,
                    color: c.expectedGrade === 'A' ? '#059669' : c.expectedGrade === 'B' ? '#2563eb' : '#4b5563',
                  }}
                >
                  <option value="A">A (5.0)</option>
                  <option value="B">B (4.0)</option>
                  <option value="C">C (3.0)</option>
                  <option value="D">D (2.0)</option>
                  <option value="E">E (1.0)</option>
                  <option value="F">F (0.0)</option>
                </select>
              </div>

              <button
                type="button"
                onClick={() => handleRemoveCourse(c.id)}
                style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: 4 }}
                title="Remove course"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CgpaForecaster;
