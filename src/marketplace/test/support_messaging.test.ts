import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * PHASE 16 contract checks.
 *
 * A support thread is the one place where a vendor, a buyer and a staff member
 * can all reach the same transcript, so the client is held to a narrow set of
 * promises:
 *
 *  - the server decides who may read, write and close a thread;
 *  - the client never tells the server what role the sender has;
 *  - a vendor cannot borrow a support thread to message a buyer, or the reverse;
 *  - the UI cannot show a closed thread as writable.
 *
 * The transactional proof that the database enforces all of this lives in
 * /tmp/opencode/fuw/support_smoke.py and chat_regress.py. These checks stop the
 * client drifting away from that contract in the meantime.
 */

const apiSrc = readFileSync(resolve(__dirname, '../lib/api.ts'), 'utf8');
const supportSrc = readFileSync(resolve(__dirname, '../pages/SupportPage.tsx'), 'utf8');
const vendorSrc = readFileSync(resolve(__dirname, '../pages/VendorDashboardPage.tsx'), 'utf8');
const adminSrc = readFileSync(resolve(__dirname, '../pages/AdminPortalPage.tsx'), 'utf8');
const navbarSrc = readFileSync(resolve(__dirname, '../components/Navbar.tsx'), 'utf8');
const appSrc = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8');
const migrationsDir = resolve(__dirname, '../../../supabase/migrations');

/** The executable body of one exported function. */
function rpcBody(fnName: string): string {
  const start = apiSrc.indexOf(`export async function ${fnName}(`);
  expect(start, `${fnName} is missing from api.ts`).toBeGreaterThan(-1);
  const end = apiSrc.indexOf('\n}\n', start);
  expect(end, `could not find the end of ${fnName}`).toBeGreaterThan(-1);
  return apiSrc.slice(start, end);
}

function readMigration(name: string): string {
  return readFileSync(resolve(migrationsDir, name), 'utf8');
}

describe('Support threads are opened by the server, not the client', () => {
  it('starts a thread through the dedicated RPC', () => {
    const body = rpcBody('startSupportThread');
    expect(body).toContain("supabase.rpc('mp_start_support_thread'");
  });

  it('never sends a vendor id, a buyer id or a role from the browser', () => {
    const body = rpcBody('startSupportThread');
    // If the client could name the other party, a vendor could open a thread
    // against somebody else's storefront.
    expect(body).not.toMatch(/p_vendor_id|p_buyer_id|sender_role|p_role/);
  });

  it('reads the thread the server returned rather than building an id', () => {
    const body = rpcBody('startSupportThread');
    expect(body).toContain('conversation_id');
    expect(body).toMatch(/return \(data as \{ conversation_id/);
  });
});

describe('Sending a support message cannot impersonate anyone', () => {
  it('goes through the support RPC, not the general chat RPC', () => {
    const body = rpcBody('sendSupportMessage');
    expect(body).toContain("supabase.rpc('mp_send_support_message'");
    expect(body).not.toContain("supabase.rpc('mp_send_message'");
  });

  it('passes no sender role of any kind', () => {
    const body = rpcBody('sendSupportMessage');
    expect(body).not.toMatch(/p_sender_role|p_sender_id|p_role/);
  });

  it('sends attachments as JSONB rather than a stringified array', () => {
    const body = rpcBody('sendSupportMessage');
    // A string here would arrive as a JSON scalar and be rejected server side.
    expect(body).toContain('attachments ?? null');
    expect(body).not.toContain('JSON.stringify');
  });
});

describe('A closed thread is presented as closed', () => {
  it('offers no composer once the status is closed', () => {
    expect(supportSrc).toContain("active.status === 'closed'");
    // The composer form and the closed notice are mutually exclusive branches.
    expect(supportSrc).toMatch(/status === 'closed' \? \([\s\S]{0,400}?support-composer--closed[\s\S]{0,1200}?chat-composer/);
  });

  it('explains how to continue instead of leaving a dead end', () => {
    expect(supportSrc).toMatch(/closed[\s\S]{0,300}?same subject/);
  });
});

describe('Only staff see the admin side of support', () => {
  it('refuses the admin inbox to a signed-in non-staff user', () => {
    expect(supportSrc).toMatch(/viewer === 'admin' && !isAdmin[\s\S]{0,200}?Staff only/);
  });

  it('does not render admin controls for a vendor', () => {
    // The claim, close and reopen controls are gated on the viewer, not on a
    // flag the server sent, so a vendor's bundle cannot show them.
    expect(supportSrc).toMatch(/viewer === 'admin' && \(\s*<div style=\{\{ marginLeft/);
  });

  it('links the queue from the admin portal, not from the vendor dashboard', () => {
    expect(adminSrc).toContain('<SupportInbox viewer="admin" embedded />');
    expect(vendorSrc).toContain('<SupportInbox viewer="vendor" embedded />');
    expect(vendorSrc).not.toContain('viewer="admin"');
  });

  it('offers a staff member the queue from the navbar', () => {
    // Routes are built through `mpPath` since the Marketplace is mounted under
    // /marketplace/* in the platform SPA (must.md Phase 10).
    expect(navbarSrc).toContain('mpPath("/admin/support")');
    // The link sits behind the same staff check as the admin portal.
    expect(navbarSrc).toMatch(/\(isAdmin \|\| isStaff\) && \([\s\S]{0,400}?mpPath\("\/admin\/support"/);
  });
});

describe('Support has its own routes', () => {
  it('serves the vendor inbox at /vendor/support', () => {
    expect(appSrc).toContain('<Route path="/vendor/support" element={<SupportInbox viewer="vendor" />} />');
  });

  it('serves the admin queue at /admin/support', () => {
    expect(appSrc).toContain('<Route path="/admin/support" element={<SupportInbox viewer="admin" />} />');
  });

  it('leaves ordinary buyer and seller chats on their own route', () => {
    expect(appSrc).toContain('<Route path="/messages" element={<MessagesPage />} />');
  });
});

describe('The vendor is told what a support message must not carry', () => {
  it('warns against sending credentials or card numbers', () => {
    expect(supportSrc).toMatch(/Never include a[\s\S]{0,120}?password[\s\S]{0,120}?card number/);
  });

  it('keeps the attachment rules server side', () => {
    // The client sends no attachment picker at all, so the only place the size
    // and path rules exist is the migration.
    expect(supportSrc).not.toContain('accept="image');
    const migration = readMigration('20261006102000_marketplace_support_messaging.sql');
    expect(migration).toContain('Attachment rejected');
  });
});

describe('The database is the only place membership is decided', () => {
  const migration = readMigration('20261006102000_marketplace_support_messaging.sql');

  it('routes every membership decision through one function', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.mp_conversation_role');
    // Both read policies defer to it, so a new kind cannot slip past a check
    // that only covers direct and order conversations.
    expect(migration).toMatch(/CREATE POLICY mp_conv_select_member[\s\S]{0,200}?mp_conversation_role\(id\)/);
    expect(migration).toMatch(/CREATE POLICY mp_msg_select_member[\s\S]{0,200}?mp_conversation_role\(conversation_id\)/);
  });

  it('keeps support threads free of any buyer', () => {
    expect(migration).toMatch(/kind = 'support' AND vendor_id IS NOT NULL AND buyer_id IS NULL/);
  });

  it('requires a closing note before a thread can be closed', () => {
    expect(migration).toMatch(/char_length\(trim\(COALESCE\(p_note, ''\)\)\) < 3/);
  });

  it('never grants these RPCs to anon', () => {
    expect(migration).toMatch(/REVOKE EXECUTE ON FUNCTION public\.mp_send_support_message\(UUID, TEXT, JSONB\) FROM PUBLIC, anon/);
    expect(migration).toMatch(/REVOKE EXECUTE ON FUNCTION public\.mp_admin_support_threads\(TEXT\) FROM PUBLIC, anon/);
  });

  it('adds the enum value in a migration of its own', () => {
    // PostgreSQL cannot sort a new enum value into place until it commits, so
    // the value and its first use must not share a transaction.
    const kindMigration = readMigration('20261006101000_marketplace_support_conversation_kind.sql');
    expect(kindMigration).toContain("ADD VALUE IF NOT EXISTS 'support'");
    expect(kindMigration).not.toContain('BEGIN;');
    expect(migration).not.toContain('ADD VALUE');
  });

  it('freezes a sent message once it is stored', () => {
    expect(migration).toContain('CREATE TRIGGER mp_msg_immutable');
    expect(migration).toMatch(/NEW\.body IS DISTINCT FROM OLD\.body[\s\S]{0,200}?cannot be edited/);
    expect(migration).toMatch(/OLD\.read_at IS NOT NULL AND NEW\.read_at IS DISTINCT FROM OLD\.read_at/);
  });

  it('never moves money while a support message is sent', () => {
    // No ledger function may appear inside the send path.
    const send = migration.slice(
      migration.indexOf('FUNCTION public.mp_send_support_message'),
      migration.indexOf('FUNCTION public.mp_claim_support_thread'),
    );
    expect(send).not.toMatch(/mp_ledger|ledger_entries|mp_wallet_/);
  });
});
