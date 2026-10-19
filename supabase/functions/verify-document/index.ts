// FUW E-Library — automated student-document verification pipeline.
//
// POST { request_id }
//
// The student has already stored ONE document (student ID OR admission letter)
// in the private `verification-evidence` bucket and the submit_verification()
// RPC parked the request in `processing`. This function is the trusted
// server-side step:
//
//   1. Re-authorises the caller and confirms they own the request.
//   2. Downloads the document with the service role and validates its real
//      type from magic bytes — never the filename or declared MIME type.
//   3. Hashes it and checks for reuse on another account (hash only).
//   4. Extracts text: vision OCR for images, the text layer for PDFs.
//   5. Runs the deterministic rules engine (verify-document rules) against the
//      student's registration snapshot.
//   6. Records the decision through apply_verification_decision(), which is
//      service-role only. Nothing here returns before the RPC records state.
//
// Security: the service-role key and the AI key never leave the server; the
// request/response bodies and logs never contain OCR text or document bytes.
// Idempotent: re-invoking for a request that is already decided is a no-op.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { aiConfig, chatComplete, corsFor, json, visionComplete } from '../_shared/ai.ts';
import {
  ENGINE_VERSION,
  evaluateDocument,
  type DocumentType,
  type ExtractedFields
} from '../_shared/verificationRules.ts';

const EVIDENCE_BUCKET = 'verification-evidence';
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const MAX_PDF_PAGES = 3;

type SniffedType = 'jpeg' | 'png' | 'webp' | 'pdf' | 'unknown';

function sniffType(bytes: Uint8Array): SniffedType {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return 'png';
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return 'webp';
  }
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) {
    return 'pdf';
  }
  return 'unknown';
}

function extGroup(path: string): 'image' | 'pdf' | 'other' {
  const ext = path.toLowerCase().split('.').pop() ?? '';
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  return 'other';
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

const EXTRACTION_SCHEMA_PROMPT = `You are a strict document-data extractor for Federal University Wukari (FUW) student verification.
Transcribe ONLY what is visibly printed on the document. Never guess, never fill in gaps from context, and never use prior knowledge about the student.
Return a single JSON object with exactly these keys:
{
  "readable": boolean,                     // is the document legible enough to read identity fields?
  "document_type": "student_id" | "admission_letter" | "unknown",
  "institution": string | null,            // institution name as printed, verbatim
  "student_name": string | null,           // full name as printed
  "matric_number": string | null,          // matriculation/registration number as printed
  "admission_number": string | null,       // admission/reference number (admission letters)
  "department": string | null,
  "programme": string | null,              // course/programme of study
  "has_expected_structure": boolean,       // does the layout contain the elements expected for this document type?
  "manipulation_indicators": string[],     // short labels, e.g. "mismatched font", "visible edit", "paste artefact", "inconsistent lighting"
  "manipulation_confidence": "low" | "medium" | "high",
  "legibility_notes": string | null,
  "extraction_confidence": number          // 0.0 to 1.0 confidence in the fields you transcribed
}
Do not include any text outside the JSON object.`;

function parseExtraction(raw: string): ExtractedFields | null {
  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, 300) : null;
  const conf = Number(parsed.extraction_confidence);
  return {
    readable: parsed.readable === true,
    document_type:
      parsed.document_type === 'student_id' || parsed.document_type === 'admission_letter'
        ? parsed.document_type
        : 'unknown',
    institution: str(parsed.institution),
    student_name: str(parsed.student_name),
    matric_number: str(parsed.matric_number),
    admission_number: str(parsed.admission_number),
    department: str(parsed.department),
    programme: str(parsed.programme),
    has_expected_structure: parsed.has_expected_structure === true,
    manipulation_indicators: Array.isArray(parsed.manipulation_indicators)
      ? parsed.manipulation_indicators.filter((x) => typeof x === 'string').slice(0, 10).map((x) => String(x).slice(0, 80))
      : [],
    manipulation_confidence:
      parsed.manipulation_confidence === 'high' || parsed.manipulation_confidence === 'medium'
        ? parsed.manipulation_confidence
        : 'low',
    legibility_notes: str(parsed.legibility_notes),
    extraction_confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0
  };
}

async function extractWithVision(
  cfg: ReturnType<typeof aiConfig>,
  dataUrl: string
): Promise<ExtractedFields | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await visionComplete(cfg, EXTRACTION_SCHEMA_PROMPT, dataUrl, {
        jsonMode: true,
        maxTokens: 900
      });
      const parsed = parseExtraction(raw);
      if (parsed) return parsed;
    } catch (_err) {
      // Fall through and retry once; a hard double failure surfaces upstream.
    }
  }
  return null;
}

async function extractFromPdfText(
  cfg: ReturnType<typeof aiConfig>,
  text: string
): Promise<ExtractedFields | null> {
  const prompt = `${EXTRACTION_SCHEMA_PROMPT}\n\nThe following is the extracted text layer of a PDF document:\n"""\n${text.slice(0, 20000)}\n"""`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await chatComplete(cfg, [{ role: 'user', content: prompt }], 900);
      const parsed = parseExtraction(raw);
      if (parsed) return parsed;
    } catch (_err) {
      // Retry once.
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsFor(req) });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, req);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey =
    Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json({ error: 'Server misconfigured' }, 500, req);
  }

  // 1. Authenticate the caller.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false }
  });
  const {
    data: { user },
    error: userError
  } = await userClient.auth.getUser();
  if (userError || !user) return json({ error: 'Authentication required' }, 401, req);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, req);
  }
  const requestId = String(body.request_id ?? '').trim();
  if (!requestId) return json({ error: 'request_id is required.' }, 400, req);

  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false }
  });

  // 2. Load and authorise the request.
  const { data: request, error: reqErr } = await serviceClient
    .from('verification_requests')
    .select(
      'id, user_id, status, document_type, student_id_path, admission_letter_path, matric_number, faculty, department, level, profiles!verification_requests_user_id_fkey_profiles!inner(full_name, matric_number, faculty, department)'
    )
    .eq('id', requestId)
    .maybeSingle();
  if (reqErr) return json({ error: 'Could not load the request.' }, 500, req);
  if (!request) return json({ error: 'Verification request not found.' }, 404, req);
  if (request.user_id !== user.id) return json({ error: 'Not your request.' }, 403, req);

  const profiles = (request as Record<string, unknown>).profiles as Record<string, unknown> | null;
  const student = {
    full_name: (profiles?.full_name as string) ?? null,
    matric_number: (profiles?.matric_number as string) ?? (request.matric_number as string) ?? null,
    faculty: (profiles?.faculty as string) ?? null,
    department: (profiles?.department as string) ?? null
  };
  const documentType = request.document_type as DocumentType | null;

  const finish = async (payload: Record<string, unknown>, status = 200) =>
    json(payload, status, req);

  // Idempotency: never re-run or flip an already-decided request.
  if (['approved', 'rejected', 'withdrawn'].includes(request.status)) {
    return finish({ ok: true, status: request.status, skipped: 'already_decided' });
  }
  if (request.status === 'pending') {
    return finish({ ok: true, status: 'pending', skipped: 'in_review' });
  }
  if (documentType !== 'student_id' && documentType !== 'admission_letter') {
    return finish({ error: 'This request is missing its document type.' }, 409);
  }

  const documentPath = documentType === 'student_id'
    ? (request.student_id_path as string | null)
    : (request.admission_letter_path as string | null);

  // Shared recorder: always persists the decision and returns a safe summary.
  const record = async (input: {
    decision: 'verified' | 'rejected' | 'action_required' | 'verification_unavailable' | 'pending';
    decisionCode: string;
    reason: string;
    checks: unknown[];
    sha?: string | null;
    confidence?: number;
  }) => {
    const { data: updated, error: applyErr } = await serviceClient.rpc(
      'apply_verification_decision',
      {
        p_request_id: requestId,
        p_decision: input.decision,
        p_decision_code: input.decisionCode,
        p_reason: input.reason,
        p_checks: input.checks,
        p_document_sha256: input.sha ?? null,
        p_engine_version: ENGINE_VERSION
      }
    );
    if (applyErr) {
      console.error('verify-document: decision RPC failed', applyErr.message);
      return finish({ error: 'Could not record the verification decision.' }, 500);
    }
    const row = Array.isArray(updated) ? updated[0] : updated;
    console.log(
      JSON.stringify({
        evt: 'verification_decision',
        request_id: requestId,
        decision: input.decision,
        decision_code: input.decisionCode,
        engine: ENGINE_VERSION
      })
    );
    return finish({
      ok: true,
      request_id: requestId,
      status: (row as Record<string, unknown>)?.status ?? input.decision,
      decision: input.decision,
      decision_code: input.decisionCode
    });
  };

  const applyActionRequired = (code: string, reason: string, checks: unknown[] = []) =>
    record({ decision: 'action_required', decisionCode: code, reason, checks });

  if (!documentPath) {
    return applyActionRequired(
      'document_missing',
      'We could not find your uploaded document. Please upload it again.'
    );
  }

  // 3. Download the document with the service role.
  const { data: blob, error: dlErr } = await serviceClient.storage
    .from(EVIDENCE_BUCKET)
    .download(documentPath);
  if (dlErr || !blob) {
    return applyActionRequired(
      'file_unreadable',
      'We could not read the uploaded file. Please upload it again.'
    );
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
    return record({
      decision: 'action_required',
      decisionCode: 'file_too_large',
      reason: 'That file is larger than 5 MB. Upload a smaller photo or scan.',
      checks: [{ id: 'file_integrity', outcome: 'fail', detail: 'file_too_large' }]
    });
  }

  const sniffed = sniffType(bytes);
  const group = extGroup(documentPath);
  if (sniffed === 'unknown') {
    return record({
      decision: 'action_required',
      decisionCode: 'unsupported_file_type',
      reason: 'That file type is not supported. Upload a JPG, PNG, WebP or PDF.',
      checks: [{ id: 'file_integrity', outcome: 'fail', detail: 'unsupported_file_type' }]
    });
  }
  const sniffedGroup = sniffed === 'pdf' ? 'pdf' : 'image';
  if ((group === 'pdf' && sniffedGroup !== 'pdf') || (group === 'image' && sniffedGroup !== 'image')) {
    return record({
      decision: 'action_required',
      decisionCode: 'file_mismatch',
      reason: 'The file contents do not match a supported document format. Upload a clear photo or PDF of your document.',
      checks: [{ id: 'file_integrity', outcome: 'fail', detail: 'file_mismatch' }]
    });
  }

  // 4. Reuse + conflict signals (hash and matric only — no document content).
  const sha = await sha256Hex(bytes);
  const [dupe, matricConflict] = await Promise.all([
    serviceClient
      .from('verification_requests')
      .select('id')
      .eq('document_sha256', sha)
      .neq('user_id', user.id)
      .in('status', ['processing', 'pending', 'approved', 'action_required', 'verification_unavailable'])
      .limit(1),
    student.matric_number
      ? serviceClient
          .from('profiles')
          .select('id')
          .neq('id', user.id)
          .eq('verified', true)
          .ilike('matric_number', student.matric_number)
          .limit(1)
      : Promise.resolve({ data: [] as unknown[] })
  ]);

  const cfg = aiConfig();
  if (!cfg.configured) {
    return record({
      decision: 'verification_unavailable',
      decisionCode: 'ocr_unavailable',
      reason: 'Automated verification is temporarily unavailable. Please retry shortly.',
      checks: [{ id: 'extraction', outcome: 'info', detail: 'ai_not_configured' }],
      sha
    });
  }

  // 5. Extract text/fields.
  let extraction: ExtractedFields | null = null;
  if (sniffed === 'pdf') {
    let pdfText = '';
    try {
      const { extractText, getDocumentProxy } = await import('https://esm.sh/unpdf@0.12.1');
      const pdf = await getDocumentProxy(bytes);
      const { text } = await extractText(pdf, { mergePages: true });
      pdfText = Array.isArray(text) ? text.slice(0, MAX_PDF_PAGES).join('\n') : String(text ?? '');
    } catch {
      pdfText = '';
    }
    if (pdfText.replace(/\s+/g, '').length < 80) {
      // Image-only scans cannot be OCR'd without a rasteriser; ask for a photo.
      return applyActionRequired(
        'unreadable',
        'We could not read any text from that PDF. Please upload a clear photo of the document or a text-based PDF.',
        [{ id: 'readable', outcome: 'fail', detail: 'pdf_no_text_layer' }]
      );
    }
    extraction = await extractFromPdfText(cfg, pdfText);
  } else {
    const mime = sniffed === 'jpeg' ? 'image/jpeg' : `image/${sniffed}`;
    const dataUrl = `data:${mime};base64,${toBase64(bytes)}`;
    extraction = await extractWithVision(cfg, dataUrl);
  }

  if (!extraction) {
    return record({
      decision: 'verification_unavailable',
      decisionCode: 'extraction_failed',
      reason: 'We could not complete the automated checks right now. Your document was saved — please retry shortly.',
      checks: [{ id: 'extraction', outcome: 'info', detail: 'provider_unavailable' }],
      sha
    });
  }

  // 6. Deterministic decision.
  const evaluation = evaluateDocument(extraction, {
    documentType,
    student,
    duplicateOfAnotherAccount: (dupe.data?.length ?? 0) > 0,
    matricAssignedElsewhere: (matricConflict.data?.length ?? 0) > 0,
    actualFileType: sniffed,
    fileError: null
  });

  return record({
    decision: evaluation.decision,
    decisionCode: evaluation.decisionCode,
    reason: evaluation.reason,
    checks: evaluation.checks,
    sha,
    confidence: evaluation.confidence
  });
});
