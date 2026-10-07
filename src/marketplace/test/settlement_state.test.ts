import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `marketplace_orders.settlement_status` is a mirror of the vendor's receivable.
 * It has to be impossible for that mirror to claim money is owed on an order
 * that was cancelled or refunded.
 *
 * The defect this guards against was measured, not hypothetical: two expired,
 * unpaid orders were sitting at `status = 'cancelled',
 * settlement_status = 'pending'` — a false statement about money owed. The cause
 * was that `mp_transition_order` only rewrites the mirror when
 * `marks_refunded` or `holds_settlement` is set, and a
 * `pending_payment -> cancelled` transition sets neither.
 *
 * These assertions read the migration rather than re-implementing the rule. The
 * behavioural half — that the trigger fires, that `paid_out`/`failed` survive,
 * that the two stranded rows were repaired — was verified against the live
 * project inside a rolled-back transaction.
 */

const ROOT = join(__dirname, '..', '..', '..');
const MIGRATIONS = join(ROOT, 'supabase/migrations');

/** Newest migration that owns terminal settlement state. */
const FIX = '20261006110000_marketplace_settlement_terminal_state.sql';

const fix = readFileSync(join(MIGRATIONS, FIX), 'utf8');

describe('A cancelled or refunded order never keeps a live settlement state', () => {
  it('ships the fix as a migration, not as a manual database edit', () => {
    expect(readdirSync(MIGRATIONS)).toContain(FIX);
  });

  it('sorts after every migration that creates the tables it touches', () => {
    // The requirement is a dependency ordering, not a filename position: the fix
    // attaches a trigger to `marketplace_orders` and backfills
    // `marketplace_settlements`, so it must be applied after the migrations
    // that create them. Asserting `files.at(-1)` instead broke the moment an
    // unrelated, later migration was added, which is not a defect in either
    // migration.
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
    const fixIndex = files.indexOf(FIX);
    expect(fixIndex).toBeGreaterThan(-1);

    const creates = (needle: string) =>
      files.filter(
        (f) => f < FIX && new RegExp(`CREATE TABLE[^;]*${needle}`, 'i').test(readFileSync(join(MIGRATIONS, f), 'utf8'))
      );

    for (const table of ['marketplace_orders', 'marketplace_settlements']) {
      const parents = creates(table);
      expect(parents.length, `no migration creates public.${table} before the fix`).toBeGreaterThan(0);
      for (const parent of parents) {
        expect(
          files.indexOf(parent),
          `${FIX} must sort after ${parent}, which creates public.${table}`
        ).toBeLessThan(fixIndex);
      }
    }
  });

  it('normalises the order mirror on every writer, not just the transition RPC', () => {
    // A trigger is the point: `marketplace_orders.status` is also written by the
    // escrow and partial-refund paths, and a fix inside `mp_transition_order`
    // would silently miss those.
    expect(fix).toMatch(
      /CREATE TRIGGER mp_normalize_settlement_on_terminal_order\s+BEFORE UPDATE ON public\.marketplace_orders/
    );
    // `mp_transition_order` is deliberately NOT restated here. Re-declaring a
    // 400-line function to add three lines is how the copies drift apart.
    expect(fix).not.toContain('FUNCTION public.mp_transition_order');
  });

  it('only fires on an actual status change', () => {
    // Without the WHEN clause, every unrelated UPDATE on the order (a note, a
    // read receipt) would run the normalisation.
    expect(fix).toMatch(/WHEN \(OLD\.status IS DISTINCT FROM NEW\.status\)/);
  });

  it('treats cancelled and refunded as the only terminal statuses', () => {
    expect(fix).toMatch(/IF NEW\.status NOT IN \('cancelled', 'refunded'\) THEN/);
  });

  it('never rewrites money that has already moved or already failed', () => {
    // `paid_out` -> `cancelled` would erase the evidence that money left the
    // platform. The refund path is handled by the existing
    // `order.refund_required` audit, not by relabelling the settlement.
    expect(fix).toMatch(
      /IF NEW\.settlement_status IN \('paid_out', 'cancelled', 'failed'\) THEN/
    );
    expect(fix).toMatch(
      /UPDATE public\.marketplace_settlements[\s\S]*?status NOT IN \('paid_out', 'cancelled', 'failed'\)/
    );
  });

  it('closes the settlement row as well as the mirror', () => {
    // A receivable left 'pending' after its order was cancelled is the same bug
    // one table over.
    expect(fix).toMatch(/UPDATE public\.marketplace_settlements\s+SET status = 'cancelled'/);
    expect(fix).toMatch(/hold_reason = NULL/);
  });

  it('repairs the rows the old code already stranded', () => {
    // The trigger only fires on UPDATE, so an existing bad row would stay bad
    // forever unless it is backfilled explicitly.
    expect(fix).toMatch(/UPDATE public\.marketplace_orders\s+SET settlement_status = 'cancelled'/);
    expect(fix).toMatch(
      /WHERE status IN \('cancelled', 'refunded'\)\s+AND settlement_status NOT IN \('paid_out', 'cancelled', 'failed'\)/
    );
  });

  it('records what the backfill changed', () => {
    expect(fix).toContain("mp_audit(");
    expect(fix).toContain("'order.settlement_normalized'");
  });

  it('grants nothing to any client role', () => {
    // A trigger is not independently executable, so there is no function to
    // grant. Asserting the absence of a GRANT keeps a future edit from adding
    // one: `marketplace_settlements` is vendor money.
    expect(fix).not.toMatch(/GRANT EXECUTE/);
    expect(fix).not.toMatch(/GRANT .* TO (anon|authenticated|public)/i);
  });

  it('runs with a pinned search_path', () => {
    // Every SECURITY DEFINER function in this schema pins it; an unpinned one is
    // a schema-hijacking primitive.
    expect(fix).toMatch(/SECURITY DEFINER\s+SET search_path = public, pg_temp/);
  });
});
