// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/Toast';
import {
  SuperAdminWalletWithdrawalsTab,
  safeApprovalUrl
} from '../pages/SuperAdminWalletWithdrawalsTab';
import { naira } from '../lib/verification';

/**
 * The super-admin wallet withdrawal console.
 *
 * This spec pins the two contracts the surface must never break:
 *   1. the console reads/writes only through the privileged server entry points
 *      (the RPCs and the wallet-paystack-withdraw Edge Function), and
 *   2. an approval URL is only rendered when it is a genuine absolute https URL,
 *      never synthesised from a status or a reference.
 */

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  invoke: vi.fn()
}));

vi.mock('../lib/supabase', () => ({
  requireSupabase: () => ({
    rpc: mocks.rpc,
    functions: { invoke: mocks.invoke }
  })
}));

const baseRow = {
  id: 'w-1',
  user_id: 'u-1',
  amount_kobo: 250000,
  fee_kobo: 5000,
  net_amount_kobo: 245000,
  currency: 'NGN',
  bank_code: '058',
  bank_name: 'GTBank',
  account_number: '0123456789',
  account_name: 'ADA LOVELACE',
  status: 'processing',
  reference: 'WTH-ABC123',
  provider: 'paystack',
  provider_transfer_code: 'TRF_test_1',
  provider_approval_url: null as string | null,
  provider_authorization_code: null,
  provider_status: 'otp',
  failure_reason: null,
  created_at: '2026-01-02T10:00:00.000Z',
  updated_at: '2026-01-02T10:05:00.000Z',
  processed_at: null,
  full_name: 'Ada Lovelace',
  email: 'ada@example.com',
  matric_number: 'FUW/CS/001'
};

const summary = {
  total_count: 1,
  total_amount_kobo: 250000,
  total_fee_kobo: 5000,
  total_net_kobo: 245000,
  awaiting_otp_count: 1,
  last_requested_at: '2026-01-02T10:00:00.000Z',
  by_status: { processing: { count: 1 } }
};

function renderTab() {
  return render(
    <ToastProvider>
      <MemoryRouter>
        <SuperAdminWalletWithdrawalsTab />
      </MemoryRouter>
    </ToastProvider>
  );
}

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.invoke.mockReset();
  mocks.rpc.mockImplementation(async (fn: string) => {
    if (fn === 'fuw_admin_list_withdrawals') {
      return { data: { total: 1, withdrawals: [baseRow] }, error: null };
    }
    if (fn === 'fuw_admin_withdrawal_summary') {
      return { data: summary, error: null };
    }
    return { data: null, error: null };
  });
  mocks.invoke.mockResolvedValue({ data: { success: true, status: 'otp' }, error: null });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('safeApprovalUrl', () => {
  it('accepts only absolute https URLs', () => {
    expect(safeApprovalUrl('https://checkout.paystack.com/abc')).toBe(
      'https://checkout.paystack.com/abc'
    );
    expect(safeApprovalUrl('  https://paystack.com/x  ')).toBe('https://paystack.com/x');
  });

  it('rejects everything else, including schemes that could execute', () => {
    expect(safeApprovalUrl(null)).toBeNull();
    expect(safeApprovalUrl(undefined)).toBeNull();
    expect(safeApprovalUrl('')).toBeNull();
    expect(safeApprovalUrl('   ')).toBeNull();
    expect(safeApprovalUrl('http://paystack.com/x')).toBeNull();
    expect(safeApprovalUrl('javascript:alert(1)')).toBeNull();
    expect(safeApprovalUrl('data:text/html,x')).toBeNull();
    expect(safeApprovalUrl('/relative/path')).toBeNull();
    expect(safeApprovalUrl('https://user:pass@paystack.com/x')).toBeNull();
    expect(safeApprovalUrl('not a url')).toBeNull();
  });
});

describe('SuperAdminWalletWithdrawalsTab', () => {
  it('loads withdrawals through the admin RPC and renders the full row', async () => {
    renderTab();

    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
    expect(mocks.rpc).toHaveBeenCalledWith('fuw_admin_list_withdrawals', {
      p_status: null,
      p_limit: 25,
      p_offset: 0
    });
    expect(mocks.rpc).toHaveBeenCalledWith('fuw_admin_withdrawal_summary', {});

    // kobo -> naira formatting.
    expect(screen.getAllByText(naira(250000)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(naira(5000)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(naira(245000)).length).toBeGreaterThan(0);

    expect(screen.getByText('GTBank')).toBeTruthy();
    expect(screen.getByText('0123456789')).toBeTruthy();
    expect(screen.getByText('WTH-ABC123')).toBeTruthy();
    expect(screen.getByText('TRF_test_1')).toBeTruthy();
    expect(screen.getByText(/FUW\/CS\/001/)).toBeTruthy();
    // Provider status from metadata surfaces so an operator can see the OTP wait.
    expect(screen.getByText(/Paystack: otp/)).toBeTruthy();
  });

  it('renders a valid approval URL as a link and never invents one', async () => {
    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn === 'fuw_admin_list_withdrawals') {
        return {
          data: {
            total: 1,
            withdrawals: [{ ...baseRow, provider_approval_url: 'https://checkout.paystack.com/xyz' }]
          },
          error: null
        };
      }
      return { data: summary, error: null };
    });

    renderTab();
    const link = await screen.findByRole('link', { name: /paystack approval url/i });
    expect(link.getAttribute('href')).toBe('https://checkout.paystack.com/xyz');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('does not render a link for a non-https approval value', async () => {
    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn === 'fuw_admin_list_withdrawals') {
        return {
          data: {
            total: 1,
            withdrawals: [{ ...baseRow, provider_approval_url: 'javascript:alert(1)' }]
          },
          error: null
        };
      }
      return { data: summary, error: null };
    });

    renderTab();
    await screen.findByText('Ada Lovelace');
    expect(screen.queryByRole('link', { name: /paystack approval url/i })).toBeNull();
    expect(screen.getByText('No approval URL on record')).toBeTruthy();
  });

  it('lets a super admin finalise an OTP transfer through the edge function', async () => {
    renderTab();
    await screen.findByText('Ada Lovelace');

    fireEvent.click(screen.getByRole('button', { name: /enter otp/i }));
    const otpInput = screen.getByLabelText(/one-time password/i) as HTMLInputElement;
    fireEvent.change(otpInput, { target: { value: '123456' } });

    fireEvent.click(screen.getByRole('button', { name: /send otp to paystack/i }));

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    expect(mocks.invoke).toHaveBeenCalledWith('wallet-paystack-withdraw', {
      body: { action: 'finalize_transfer', transferCode: 'TRF_test_1', otp: '123456' }
    });

    // The OTP must not survive the attempt: the form closes and the input
    // is torn down, so nothing remains in the DOM to leak it.
    await waitFor(() => {
      expect(screen.queryByLabelText(/one-time password/i)).toBeNull();
    });
  });

  it('passes the chosen status filter to the RPC and resets to the first page', async () => {
    renderTab();
    await screen.findByText('Ada Lovelace');

    fireEvent.change(screen.getByLabelText(/filter withdrawals by status/i), {
      target: { value: 'failed' }
    });

    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith('fuw_admin_list_withdrawals', {
        p_status: 'failed',
        p_limit: 25,
        p_offset: 0
      });
    });
  });

  it('shows an empty state rather than a blank panel', async () => {
    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn === 'fuw_admin_list_withdrawals') return { data: { total: 0, withdrawals: [] }, error: null };
      if (fn === 'fuw_admin_withdrawal_summary') return { data: summary, error: null };
      return { data: null, error: null };
    });

    renderTab();
    expect(await screen.findByText('No wallet withdrawals yet.')).toBeTruthy();
  });

  it('surfaces RPC errors with a retry affordance', async () => {
    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn === 'fuw_admin_list_withdrawals') {
        return { data: null, error: { message: 'Administrator privileges required.' } };
      }
      return { data: summary, error: null };
    });

    renderTab();
    expect(await screen.findByText('Administrator privileges required.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });
});