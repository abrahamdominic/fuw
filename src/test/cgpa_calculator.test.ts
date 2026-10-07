import { describe, it, expect } from 'vitest';
import {
  calculateCgpa,
  evaluateCalculatorRow,
  parseCreditUnits,
  GradingScale,
} from '../lib/academics';

const NIGERIAN_FIVE_POINT_SCALE: GradingScale = {
  id: 'scale-fuw',
  name: 'FUW Standard 5.0 Scale',
  description: 'Official 5-point undergraduate grading scale',
  isDefault: true,
  isActive: true,
  bands: [
    { id: 'b1', letter: 'A', minScore: 70, maxScore: 100, gradePoint: 5.0, isPassing: true, sortOrder: 1 },
    { id: 'b2', letter: 'B', minScore: 60, maxScore: 69, gradePoint: 4.0, isPassing: true, sortOrder: 2 },
    { id: 'b3', letter: 'C', minScore: 50, maxScore: 59, gradePoint: 3.0, isPassing: true, sortOrder: 3 },
    { id: 'b4', letter: 'D', minScore: 45, maxScore: 49, gradePoint: 2.0, isPassing: true, sortOrder: 4 },
    { id: 'b5', letter: 'E', minScore: 40, maxScore: 44, gradePoint: 1.0, isPassing: true, sortOrder: 5 },
    { id: 'b6', letter: 'F', minScore: 0, maxScore: 39, gradePoint: 0.0, isPassing: false, sortOrder: 6 },
  ],
};

describe('CGPA Calculator Validation & Logic', () => {
  it('parses valid credit units correctly', () => {
    expect(parseCreditUnits('3')).toBe(3);
    expect(parseCreditUnits(' 4 ')).toBe(4);
    expect(parseCreditUnits('1.5')).toBe(1.5);
    expect(parseCreditUnits('.5')).toBe(0.5);
  });

  it('rejects invalid or unsafe credit units', () => {
    expect(parseCreditUnits('')).toBeNull();
    expect(parseCreditUnits('abc')).toBeNull();
    expect(parseCreditUnits('-2')).toBeNull();
    expect(parseCreditUnits('0')).toBeNull();
    expect(parseCreditUnits('101')).toBeNull(); // exceeds MAX_CREDIT_UNITS
  });

  it('evaluates valid calculator rows into quality points', () => {
    const row = { course: 'MTH 101', units: '3', grade: 'A' };
    const state = evaluateCalculatorRow(row, NIGERIAN_FIVE_POINT_SCALE);

    expect(state.status).toBe('ready');
    if (state.status === 'ready') {
      expect(state.units).toBe(3);
      expect(state.gradePoint).toBe(5.0);
      expect(state.qualityPoints).toBe(15.0);
    }
  });

  it('flags missing units or invalid grades', () => {
    const missingUnits = evaluateCalculatorRow({ course: 'PHY 101', units: '', grade: 'A' }, NIGERIAN_FIVE_POINT_SCALE);
    expect(missingUnits.status).toBe('invalid');
    if (missingUnits.status === 'invalid') {
      expect(missingUnits.field).toBe('units');
    }

    const missingGrade = evaluateCalculatorRow({ course: 'CHM 101', units: '3', grade: '' }, NIGERIAN_FIVE_POINT_SCALE);
    expect(missingGrade.status).toBe('invalid');
    if (missingGrade.status === 'invalid') {
      expect(missingGrade.field).toBe('grade');
    }

    const invalidGrade = evaluateCalculatorRow({ course: 'CHM 101', units: '3', grade: 'Z' }, NIGERIAN_FIVE_POINT_SCALE);
    expect(invalidGrade.status).toBe('invalid');
    if (invalidGrade.status === 'invalid') {
      expect(invalidGrade.field).toBe('grade');
    }
  });

  it('correctly calculates weighted CGPA mathematically', () => {
    // 3 units of A (5.0) = 15 QP
    // 3 units of B (4.0) = 12 QP
    // 2 units of C (3.0) = 6 QP
    // Total Units = 8, Total QP = 33
    // CGPA = 33 / 8 = 4.125
    const rows = [
      { units: 3, gradePoint: 5.0 },
      { units: 3, gradePoint: 4.0 },
      { units: 2, gradePoint: 3.0 },
    ];

    const result = calculateCgpa(rows);
    expect(result).not.toBeNull();
    expect(result).toBeCloseTo(4.125, 3);
  });

  it('returns null when no rows have units or when rows are empty', () => {
    expect(calculateCgpa([])).toBeNull();
    expect(calculateCgpa([{ units: 0, gradePoint: 5.0 }])).toBeNull();
    expect(calculateCgpa([{ units: null, gradePoint: 5.0 }])).toBeNull();
  });
});
