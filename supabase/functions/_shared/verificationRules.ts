// verificationRules.ts — the deterministic rules engine for automated
// student-document verification.
//
// PURE TypeScript: no Deno APIs, no network, no database access. The
// verify-document edge function feeds it OCR/extraction output plus the
// student's registration snapshot; it returns an explicit, auditable decision.
// The same file is unit-tested from the web Vitest suite
// (src/test/verification_rules.test.ts).
//
// HONEST LIMITATION: these rules can detect inconsistency, mismatch and
// forgery indicators. They CANNOT prove a document was issued by the
// university — no authoritative registry integration exists. Auto-approval is
// therefore restricted to documents that pass every configured check, and any
// uncertainty is routed to the library queue instead of being approved.

export const ENGINE_VERSION = '1.0.0';

export type DocumentType = 'student_id' | 'admission_letter';
export type Decision =
  | 'verified'
  | 'rejected'
  | 'action_required'
  | 'verification_unavailable'
  | 'pending';

export type CheckOutcome = 'pass' | 'fail' | 'soft_fail' | 'info';

export interface CheckResult {
  id: string;
  outcome: CheckOutcome;
  detail?: string;
}

export interface ExtractedFields {
  /** The document is legible enough to read identity information. */
  readable: boolean;
  /** What the document actually looks like, independent of what was claimed. */
  document_type: 'student_id' | 'admission_letter' | 'unknown';
  institution: string | null;
  student_name: string | null;
  matric_number: string | null;
  /** Admission/reference number on an admission letter (may differ from matric). */
  admission_number: string | null;
  department: string | null;
  programme: string | null;
  has_expected_structure: boolean;
  manipulation_indicators: string[];
  manipulation_confidence: 'low' | 'medium' | 'high';
  legibility_notes: string | null;
  /** Model-reported extraction confidence, 0..1. */
  extraction_confidence: number;
}

export interface StudentIdentity {
  full_name: string | null;
  matric_number: string | null;
  faculty: string | null;
  department: string | null;
}

export interface EvaluationContext {
  documentType: DocumentType;
  student: StudentIdentity;
  /** True when this exact file (SHA-256) is already on another student's live request. */
  duplicateOfAnotherAccount: boolean;
  /** True when the student's matriculation number is already verified elsewhere. */
  matricAssignedElsewhere: boolean;
  /** Magic-byte sniffed type of the uploaded bytes. */
  actualFileType: 'jpeg' | 'png' | 'webp' | 'pdf' | 'unknown';
  /** Set when the file itself could not be accepted (type/size/integrity). */
  fileError?: 'unsupported_type' | 'magic_mismatch' | 'too_large' | 'download_failed' | null;
}

export interface Evaluation {
  decision: Decision;
  decisionCode: string;
  /** Student-facing reason. Never contains OCR text or third-party names. */
  reason: string;
  checks: CheckResult[];
  confidence: number;
}

// ─── Institution knowledge (authoritative FUW identifiers) ──────────────────

const INSTITUTION_ALIASES = [
  'federal university wukari',
  'federal univ. wukari',
  'federal univ wukari',
  'university of wukari',
  'fuw'
];

const MATRIC_ASSIGNED_ELSEWHERE_REASON =
  'Your matriculation number is already linked to a verified account, so the library must review this submission.';

// ─── Normalisation helpers ───────────────────────────────────────────────────

const NAME_TITLES = new Set([
  'mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'professor', 'engr', 'engineer',
  'alhaji', 'alhaja', 'chief', 'hon', 'sir', 'madam', ' Mallam', 'mallam'
]);

export function normalizeName(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/\b(mr|mrs|ms|miss|dr|prof|professor|engr|engineer|alhaji|alhaja|chief|hon|sir|mallam)\b\.?/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function nameTokens(value: string | null | undefined): string[] {
  return normalizeName(value)
    .split(' ')
    .filter((t) => t.length > 1);
}

/**
 * Score how well an extracted name matches the registered name.
 * 1 = identical after normalisation; 0 = nothing in common.
 * Middle names, surnames-into-given variations and initials are common on
 * Nigerian student documents, so a document passes when it contains at least
 * two thirds of the registered name's significant tokens (or embeds it whole).
 */
export function nameMatchScore(extracted: string | null | undefined, expected: string | null | undefined): number {
  const a = normalizeName(extracted);
  const b = normalizeName(expected);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 1;

  const expectedTokens = nameTokens(expected);
  const extractedTokens = new Set(nameTokens(extracted));
  if (expectedTokens.length === 0 || extractedTokens.size === 0) return 0;

  const matched = expectedTokens.filter((t) => extractedTokens.has(t)).length;
  const containment = matched / expectedTokens.length;

  // "T. Ibrahim" style initials: an extracted single-letter token counts when
  // a registered token starts with the same letter.
  const initialBonus = expectedTokens.some((t) =>
    [...extractedTokens].some((e) => e.length === 1 && t.startsWith(e))
  );
  if (initialBonus && containment >= 0.34) return 0.67;

  return containment;
}

export function normalizeIdentifier(value: string | null | undefined): string {
  return (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Compare matric/admission identifiers tolerating separators and prefixes. */
export function identifierMatchScore(
  extracted: string | null | undefined,
  expected: string | null | undefined
): number {
  const a = normalizeIdentifier(extracted);
  const b = normalizeIdentifier(expected);
  if (!a || !b) return 0;
  if (a === b) return 1;
  // Real documents differ on slashes and spaces (CIS/CSC/20/001 vs CISCSC20001).
  if (a.length >= 5 && b.length >= 5 && (a.includes(b) || b.includes(a))) return 1;
  return 0;
}

export function containsInstitution(text: string | null | undefined): 'match' | 'other' | 'unknown' {
  const hay = (text ?? '').toLowerCase();
  if (!hay.trim()) return 'unknown';
  // Longest aliases first so "federal university wukari" wins over "fuw".
  const sorted = [...INSTITUTION_ALIASES].sort((a, b) => b.length - a.length);
  for (const alias of sorted) {
    if (alias === 'fuw') {
      // Word-bounded FUW only: never match inside another word.
      if (/(^|[^a-z])fuw([^a-z]|$)/.test(hay)) return 'match';
    } else if (hay.includes(alias)) {
      return 'match';
    }
  }
  return 'other';
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

// ─── The decision procedure ──────────────────────────────────────────────────

const FILE_ERROR_META: Record<
  NonNullable<EvaluationContext['fileError']>,
  { code: string; reason: string }
> = {
  unsupported_type: {
    code: 'unsupported_file_type',
    reason: 'That file type is not supported. Upload a JPG, PNG, WebP or PDF.'
  },
  magic_mismatch: {
    code: 'file_mismatch',
    reason: 'The file contents do not match a supported document format. Please upload a clear photo or PDF of your document.'
  },
  too_large: {
    code: 'file_too_large',
    reason: 'That file is larger than 5 MB. Upload a smaller photo or scan.'
  },
  download_failed: {
    code: 'file_unreadable',
    reason: 'We could not read the uploaded file. Please upload it again.'
  }
};

const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  student_id: 'student ID card',
  admission_letter: 'admission letter'
};

export function evaluateDocument(
  extraction: ExtractedFields,
  ctx: EvaluationContext
): Evaluation {
  const checks: CheckResult[] = [];
  const confidence = clamp01(extraction.extraction_confidence ?? 0);

  // 1. File-level integrity (rejected before any OCR ran).
  if (ctx.fileError) {
    const meta = FILE_ERROR_META[ctx.fileError];
    checks.push({ id: 'file_integrity', outcome: 'fail', detail: meta.code });
    return {
      decision: 'action_required',
      decisionCode: meta.code,
      reason: meta.reason,
      checks,
      confidence: 0
    };
  }

  // 2. Readability.
  const textPresent = Boolean(
    extraction.institution || extraction.student_name || extraction.matric_number ||
    extraction.admission_number || extraction.department || extraction.programme
  );
  if (!extraction.readable || !textPresent) {
    checks.push({ id: 'readable', outcome: 'fail', detail: 'no_legible_identity_text' });
    return {
      decision: 'action_required',
      decisionCode: 'unreadable',
      reason: `We could not read a ${DOCUMENT_TYPE_LABEL[ctx.documentType]} in that upload. Please upload a sharper, well-lit photo or scan of the full document.`,
      checks,
      confidence
    };
  }
  checks.push({ id: 'readable', outcome: 'pass' });

  // 3. Document type consistency.
  if (extraction.document_type !== 'unknown' && extraction.document_type !== ctx.documentType) {
    checks.push({
      id: 'document_type',
      outcome: 'fail',
      detail: `submitted_${ctx.documentType}_got_${extraction.document_type}`
    });
    return {
      decision: 'action_required',
      decisionCode: 'wrong_document_type',
      reason: `That upload looks like ${
        extraction.document_type === 'student_id' ? 'a student ID card' : 'an admission letter'
      }, not ${ctx.documentType === 'student_id' ? 'a student ID card' : 'an admission letter'}. Please upload the correct document.`,
      checks,
      confidence
    };
  }
  checks.push({ id: 'document_type', outcome: 'pass' });

  // 4. Manipulation / forgery indicators.
  const indicators = extraction.manipulation_indicators ?? [];
  const manipConf = extraction.manipulation_confidence ?? 'low';
  let manipulationOutcome: CheckOutcome = 'pass';
  if (manipConf === 'high' || (manipConf === 'medium' && indicators.length >= 2)) {
    manipulationOutcome = 'fail';
  } else if (manipConf === 'medium') {
    manipulationOutcome = 'soft_fail';
  } else if (manipConf === 'low' && indicators.length > 0) {
    manipulationOutcome = 'soft_fail';
  }
  checks.push({
    id: 'manipulation',
    outcome: manipulationOutcome,
    detail: manipulationOutcome === 'pass' ? undefined : `${manipConf}:${indicators.length}_indicators`
  });
  if (manipulationOutcome === 'fail') {
    return {
      decision: 'rejected',
      decisionCode: 'manipulation_suspected',
      reason: 'The uploaded document shows strong signs of alteration or fabrication, so it cannot be accepted. Contact the library if you believe this is a mistake.',
      checks,
      confidence
    };
  }

  // 5. Institution identity.
  const inst = containsInstitution(extraction.institution);
  if (inst === 'match') {
    checks.push({ id: 'institution', outcome: 'pass' });
  } else if (inst === 'other') {
    checks.push({ id: 'institution', outcome: 'fail', detail: 'different_institution' });
    return {
      decision: 'rejected',
      decisionCode: 'institution_mismatch',
      reason: 'The institution named on the document is not Federal University Wukari. Only FUW student documents are accepted.',
      checks,
      confidence
    };
  } else {
    checks.push({ id: 'institution', outcome: 'soft_fail', detail: 'institution_not_found' });
  }

  // 6. Registered name on the document.
  const nameScore = nameMatchScore(extraction.student_name, ctx.student.full_name);
  if (!extraction.student_name) {
    checks.push({ id: 'name_match', outcome: 'soft_fail', detail: 'name_not_found' });
  } else if (nameScore >= 0.67) {
    checks.push({ id: 'name_match', outcome: 'pass' });
  } else {
    checks.push({ id: 'name_match', outcome: 'fail', detail: 'name_mismatch' });
    return {
      decision: 'rejected',
      decisionCode: 'name_mismatch',
      reason: 'The name on the document does not match the name registered on your account. Check your profile details and submit the correct document.',
      checks,
      confidence
    };
  }

  // 7. Matriculation / admission number.
  const matricOnDoc = ctx.documentType === 'student_id'
    ? extraction.matric_number
    : (extraction.matric_number || extraction.admission_number);
  const matricScore = identifierMatchScore(matricOnDoc, ctx.student.matric_number);
  if (!matricOnDoc) {
    checks.push({ id: 'matric_match', outcome: 'soft_fail', detail: 'matric_not_found' });
  } else if (matricScore >= 1) {
    checks.push({ id: 'matric_match', outcome: 'pass' });
  } else {
    checks.push({ id: 'matric_match', outcome: 'fail', detail: 'matric_mismatch' });
    return {
      decision: 'rejected',
      decisionCode: 'matric_mismatch',
      reason: 'The matriculation number on the document does not match the one registered on your account. Update your profile or submit the correct document.',
      checks,
      confidence
    };
  }

  // 8. Department (informational — layouts vary and older documents omit it).
  const deptScore = nameMatchScore(extraction.department, ctx.student.department);
  checks.push({
    id: 'department',
    outcome: extraction.department && deptScore >= 0.67 ? 'pass' : 'info',
    detail: extraction.department ? (deptScore >= 0.67 ? undefined : 'department_not_confirmed') : 'department_not_on_document'
  });

  // 9. Duplicate document (privacy-safe reuse detection by hash only).
  if (ctx.duplicateOfAnotherAccount) {
    checks.push({ id: 'duplicate_document', outcome: 'fail', detail: 'hash_seen_on_other_account' });
    return {
      decision: 'pending',
      decisionCode: 'duplicate_document',
      reason: 'This document is already associated with another account, so the library must review it.',
      checks,
      confidence
    };
  }
  checks.push({ id: 'duplicate_document', outcome: 'pass' });

  // 10. Matriculation number already verified on a different account.
  if (ctx.matricAssignedElsewhere) {
    checks.push({ id: 'matric_conflict', outcome: 'fail', detail: 'matric_verified_elsewhere' });
    return {
      decision: 'pending',
      decisionCode: 'matric_conflict',
      reason: MATRIC_ASSIGNED_ELSEWHERE_REASON,
      checks,
      confidence
    };
  }
  checks.push({ id: 'matric_conflict', outcome: 'pass' });

  // 11. Manipulation uncertainty routes to a human, never to auto-approval.
  if (manipulationOutcome === 'soft_fail') {
    return {
      decision: 'pending',
      decisionCode: 'manipulation_uncertain',
      reason: 'Some details of the document could not be confirmed automatically, so the library will review it.',
      checks,
      confidence
    };
  }

  // 12. Auto-verify: every required check passed with sufficient confidence.
  const structureOk = extraction.has_expected_structure === true || confidence >= 0.75;
  const requiredPass =
    structureOk &&
    inst === 'match' &&
    nameScore >= 0.67 &&
    matricScore >= 1;

  if (requiredPass && confidence >= 0.6) {
    checks.push({ id: 'decision', outcome: 'pass', detail: 'all_required_checks_passed' });
    return {
      decision: 'verified',
      decisionCode: 'checks_passed',
      reason: 'Automated checks passed: the document matches your registration details and shows no signs of alteration.',
      checks,
      confidence
    };
  }

  // 13. Anything else is uncertain by definition — the fallback is the library
  // queue, NOT approval.
  checks.push({ id: 'decision', outcome: 'soft_fail', detail: 'insufficient_evidence' });
  return {
    decision: 'pending',
    decisionCode: 'insufficient_evidence',
    reason: 'Your document was readable, but some details could not be confirmed automatically. The library will review it shortly.',
    checks,
    confidence
  };
}
