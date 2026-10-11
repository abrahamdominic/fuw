import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The registration screen must not create an account with a malformed or
 * duplicate matric number, and it must pinpoint the offending field instead of
 * showing one generic banner. `validateStudentRegistration` wraps the
 * server-side `validate_student_registration` RPC and normalises its payload;
 * these cases pin that contract, including the fail-open behaviour when the RPC
 * is temporarily unreachable (the database still enforces the rules at insert).
 */

const rpcCalls: { name: string; args: any }[] = [];
type RpcResult = { data: any; error: any };
let rpcImpl: (name: string, args: any) => RpcResult = () => ({ data: null, error: null });

const client = {
  rpc: (name: string, args: any) => {
    rpcCalls.push({ name, args });
    return Promise.resolve(rpcImpl(name, args));
  }
};

vi.mock('../lib/supabase', () => ({
  supabase: client,
  requireSupabase: () => client
}));

const { validateStudentRegistration } = await import('../lib/AuthContext');

const VALID = {
  matricNumber: 'FUW/2022/CS/1042',
  faculty: 'Faculty of Science',
  department: 'Computer Science',
  level: '300 Level'
};

beforeEach(() => {
  rpcCalls.length = 0;
  rpcImpl = () => ({ data: null, error: null });
});

describe('validateStudentRegistration', () => {
  it('passes the four fields to the RPC with the expected parameter names', async () => {
    rpcImpl = () => ({ data: { ok: true, errors: [] }, error: null });
    const res = await validateStudentRegistration(VALID);
    expect(rpcCalls[0].name).toBe('validate_student_registration');
    expect(rpcCalls[0].args).toEqual({
      p_matric_number: 'FUW/2022/CS/1042',
      p_faculty: 'Faculty of Science',
      p_department: 'Computer Science',
      p_level: '300 Level'
    });
    expect(res).toEqual({ ok: true, errors: {} });
  });

  it('maps a per-field error array into a field map', async () => {
    rpcImpl = () => ({
      data: {
        ok: false,
        errors: [
          { field: 'matricNumber', message: 'Enter a valid matriculation number.' },
          { field: 'level', message: 'Select your current level.' }
        ]
      },
      error: null
    });
    const res = await validateStudentRegistration(VALID);
    expect(res.ok).toBe(false);
    expect(res.errors.matricNumber).toBe('Enter a valid matriculation number.');
    expect(res.errors.level).toBe('Select your current level.');
  });

  it('treats a duplicate matric number as a field error', async () => {
    rpcImpl = () => ({
      data: {
        ok: false,
        errors: [
          {
            field: 'matricNumber',
            message: 'This matriculation number is already registered to another account.'
          }
        ],
        matric_in_use: true
      },
      error: null
    });
    const res = await validateStudentRegistration(VALID);
    expect(res.ok).toBe(false);
    expect(res.errors.matricNumber).toMatch(/already registered/);
  });

  it('fails open (ok, no errors) when the RPC returns a transport error', async () => {
    rpcImpl = () => ({ data: null, error: { message: 'network' } });
    const res = await validateStudentRegistration(VALID);
    expect(res).toEqual({ ok: true, errors: {} });
  });

  it('fails open when the RPC returns no data', async () => {
    rpcImpl = () => ({ data: null, error: null });
    const res = await validateStudentRegistration(VALID);
    expect(res).toEqual({ ok: true, errors: {} });
  });
});
