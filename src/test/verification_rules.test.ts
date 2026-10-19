import { describe, expect, it } from 'vitest';
import {
  ENGINE_VERSION,
  normalizeName,
  nameMatchScore,
  normalizeIdentifier,
  identifierMatchScore,
  containsInstitution,
  evaluateDocument,
  type DocumentType,
} from '../../supabase/functions/_shared/verificationRules';

const FUW_INST = 'Federal University Wukari';
const BSC_CSC = 'CIS/CSC/20/001';
const BSC_MCB = 'BSC/MCB/25/048';

describe('verification rules', () => {
  it('ENGINE_VERSION is 1.0.0', () => {
    expect(ENGINE_VERSION).toBe('1.0.0');
  });

  it('normalizeName collapses spaces, lowercase and strips noise', () => {
    expect(normalizeName('  ABRAHAM  DOMINIC  ')).toBe('abraham dominic');
    expect(normalizeName('Mr. John-Paul O. Obi')).toBe('john paul o obi');
  });

  it('nameMatchScore favors exact and high overlap', () => {
    const full = 'abraham dominic';
    expect(nameMatchScore(full, 'abraham dominic')).toBeGreaterThan(0.85);
    expect(nameMatchScore(full, 'abraham')).toBeGreaterThan(0);
    expect(nameMatchScore('x', 'y')).toBeLessThan(0.3);
  });

  it('normalizeIdentifier uppercases and collapses', () => {
    expect(normalizeIdentifier('cis/csc/20/001')).toBe('CISCSC20001');
    expect(normalizeIdentifier('  bsc mcb 25 048  ')).toBe('BSCMCB25048');
  });

  it('identifierMatchScore matches common formats', () => {
    expect(identifierMatchScore(BSC_CSC, 'cis/csc/20/001')).toBeGreaterThan(0.9);
    expect(identifierMatchScore(BSC_MCB, 'bsc/mcb/25/048')).toBeGreaterThan(0.9);
  });

  it('containsInstitution flags FUW variants', () => {
    expect(containsInstitution('FEDERAL UNIVERSITY WUKARI STUDENT ID')).toBe('match');
    expect(containsInstitution('Federal Univ. Wukari')).toBe('match');
    expect(containsInstitution('University of Wukari')).toBe('match');
    expect(containsInstitution('FUW Registry')).toBe('match');
    expect(containsInstitution('Some College')).toBe('other');
  });

  it('evaluateDocument passes for reasonable student id', () => {
    const res = evaluateDocument(
      {
        readable: true,
        document_type: 'student_id',
        institution: FUW_INST,
        student_name: 'ABRAHAM DOMINIC',
        matric_number: BSC_CSC,
        admission_number: null,
        department: null,
        programme: null,
        has_expected_structure: true,
        manipulation_indicators: [],
        manipulation_confidence: 'low',
        legibility_notes: null,
        extraction_confidence: 0.9,
      } as any,
      {
        documentType: 'student_id' as DocumentType,
        student: { full_name: 'Abraham Dominic', matric_number: BSC_CSC } as any,
        duplicateOfAnotherAccount: false,
        matricAssignedElsewhere: false,
        actualFileType: 'jpeg',
      } as any
    );
    expect(res.decision).toBe('verified');
    expect(res.decisionCode).toBe('checks_passed');
  });

  it('rejects when matric/institution mismatch confidently', () => {
    const res = evaluateDocument(
      {
        readable: true,
        document_type: 'student_id',
        institution: 'Another University',
        student_name: 'JOHN DOE',
        matric_number: 'CIS/CSC/19/999',
        admission_number: null,
        department: null,
        programme: null,
        has_expected_structure: false,
        manipulation_indicators: ['altered_text'],
        manipulation_confidence: 'high',
        legibility_notes: null,
        extraction_confidence: 0.9,
      } as any,
      {
        documentType: 'student_id' as DocumentType,
        student: { full_name: 'John Doe', matric_number: BSC_CSC } as any,
        duplicateOfAnotherAccount: false,
        matricAssignedElsewhere: false,
        actualFileType: 'jpeg',
      } as any
    );
    expect(res.decision).toBe('rejected');
    expect(res.decisionCode).toBe('manipulation_suspected');
  });

  it('requests action when unreadable', () => {
    const res = evaluateDocument(
      {
        readable: false,
        document_type: 'unknown',
        institution: '',
        student_name: '',
        matric_number: '',
        admission_number: null,
        department: null,
        programme: null,
        has_expected_structure: false,
        manipulation_indicators: [],
        manipulation_confidence: 'low',
        legibility_notes: null,
        extraction_confidence: 0,
      } as any,
      {
        documentType: 'student_id' as DocumentType,
        student: { full_name: 'A', matric_number: BSC_CSC } as any,
        duplicateOfAnotherAccount: false,
        matricAssignedElsewhere: false,
        actualFileType: 'pdf',
      } as any
    );
    expect(res.decision).toBe('action_required');
    expect(res.decisionCode).toBe('unreadable');
  });
});
