import { describe, expect, it, vi } from 'vitest';

// Mock supabase client to avoid real network
vi.mock('../lib/supabase', () => {
  const rpc = vi.fn();
  const storage = {
    from: vi.fn(() => ({
      upload: vi.fn().mockResolvedValue({ error: null }),
      remove: vi.fn().mockResolvedValue({ error: null }),
      createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://example.com/doc' }, error: null }),
    })),
  };
  const functions = { invoke: vi.fn().mockResolvedValue({ data: {}, error: null }) };
  const auth = { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-1' } } }) };
  return {
    supabase: { rpc, storage, functions, auth },
    requireSupabase: () => ({ rpc, storage, functions, auth }),
  };
});

import { submitVerification, runDocumentVerification, getDocumentUrl } from '../lib/verification';

describe('verification flow (client)', () => {
  it('submitVerification calls RPC with 4 args and invokes function', async () => {
    const { supabase } = await import('../lib/supabase');
    ((supabase as any).rpc as any).mockResolvedValueOnce({ data: [{ id: 'r-1' }], error: null });
    const file = { name: 'id.jpg', type: 'image/jpeg', size: 1000 };
    const res = await submitVerification({
      documentType: 'student_id',
      file: { uri: 'file://x', name: 'id.jpg', mimeType: 'image/jpeg' } as any,
    });
    expect(res.id).toBe('r-1');
    expect(((supabase as any).rpc as any).mock.calls[0][0]).toBe('submit_verification');
    expect(((supabase as any).rpc as any).mock.calls[0][1]).toHaveProperty('p_document_type');
    expect(((supabase as any).rpc as any).mock.calls[0][1]).toHaveProperty('p_document_path');
    expect(((supabase as any).rpc as any).mock.calls[0][1]).toHaveProperty('p_document_name');
    expect(((supabase as any).rpc as any).mock.calls[0][1]).toHaveProperty('p_student_note');
  });

  it('runDocumentVerification invokes verify-document', async () => {
    const { supabase } = await import('../lib/supabase');
    ((supabase as any).functions.invoke as any).mockResolvedValueOnce({ data: { status: 'pending' }, error: null });
    const res = await runDocumentVerification('r-1');
    expect(((supabase as any).functions.invoke as any).mock.calls[0][0]).toBe('verify-document');
    expect(res.status).toBe('pending');
  });

  it('getDocumentUrl returns signed URL', async () => {
    const url = await getDocumentUrl('uid/x.pdf');
    expect(url).toBe('https://example.com/doc');
  });
});
