import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression pin for the two accommodation monetization features added together:
 *
 *  - the four required photo slots (main room / toilet / kitchen / front view)
 *    that every published listing must carry, and the ordering that puts the
 *    `main_room` shot first so it becomes the discovery card cover;
 *  - the per-listing connection fee that unlocks a caretaker's contact details,
 *    paid exactly once by a student and revealed only by the server.
 *
 * The helpers are pure, so they are asserted directly; the RPC wrappers are
 * asserted against a Supabase double that records the function name and args.
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
  requireSupabase: () => client,
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => client
}));

const {
  REQUIRED_PHOTO_SLOTS,
  photoSlotLabel,
  galleryImagesFor,
  missingPhotoSlots,
  fetchListingConnectionFee,
  fetchContactBlock,
  payConnectionFee
} = await import('../lib/accommodation');

beforeEach(() => {
  rpcCalls.length = 0;
  rpcImpl = () => ({ data: null, error: null });
});

describe('required photo slots', () => {
  it('defines the four mandated categories in a stable display order', () => {
    expect(REQUIRED_PHOTO_SLOTS.map((s) => s.key)).toEqual([
      'main_room',
      'toilet',
      'kitchen',
      'front_view'
    ]);
  });

  it('labels every slot', () => {
    expect(photoSlotLabel('main_room')).toBe('Main Room');
    expect(photoSlotLabel('toilet')).toBe('Toilet / Bathroom');
    expect(photoSlotLabel('kitchen')).toBe('Kitchen');
    expect(photoSlotLabel('front_view')).toBe('Front View');
  });

  it('falls back to a generic label for an unknown key', () => {
    expect(photoSlotLabel('plumbing')).toBe('Photo');
  });
});

describe('galleryImagesFor', () => {
  it('orders categorized slots by category, main_room first', () => {
    const images = galleryImagesFor({
      images: ['https://img.test/legacy.jpg'],
      photo_slots: [
        { key: 'front_view', url: 'https://img.test/front.jpg' },
        { key: 'main_room', url: 'https://img.test/main.jpg' },
        { key: 'kitchen', url: 'https://img.test/kitchen.jpg' }
      ]
    } as any);
    // Slots are emitted in REQUIRED_PHOTO_SLOTS order regardless of input order.
    expect(images.slice(0, 3)).toEqual([
      'https://img.test/main.jpg',
      'https://img.test/kitchen.jpg',
      'https://img.test/front.jpg'
    ]);
    // A legacy image not covered by a slot is appended.
    expect(images).toContain('https://img.test/legacy.jpg');
  });

  it('de-duplicates a URL that appears both as a slot and a legacy image', () => {
    const images = galleryImagesFor({
      images: ['https://img.test/main.jpg'],
      photo_slots: [{ key: 'main_room', url: 'https://img.test/main.jpg' }]
    } as any);
    expect(images).toEqual(['https://img.test/main.jpg']);
  });

  it('ignores blank or non-renderable slot URLs', () => {
    const images = galleryImagesFor({
      images: ['https://img.test/ok.jpg'],
      photo_slots: [{ key: 'main_room', url: '   ' }, { key: 'toilet', url: null as any }]
    } as any);
    expect(images).toEqual(['https://img.test/ok.jpg']);
  });

  it('returns an empty list for a missing property', () => {
    expect(galleryImagesFor(null)).toEqual([]);
    expect(galleryImagesFor({ images: [] } as any)).toEqual([]);
  });
});

describe('missingPhotoSlots', () => {
  it('reports all four categories when none are present', () => {
    expect(missingPhotoSlots(null).map((s) => s.key)).toEqual([
      'main_room',
      'toilet',
      'kitchen',
      'front_view'
    ]);
  });

  it('reports only the categories still missing', () => {
    const missing = missingPhotoSlots([
      { key: 'main_room', url: 'https://img.test/main.jpg' },
      { key: 'kitchen', url: 'https://img.test/kitchen.jpg' }
    ]);
    expect(missing.map((s) => s.key)).toEqual(['toilet', 'front_view']);
  });
});

describe('connection fee RPC wrappers', () => {
  it('reads the listing fee (anon-callable) and returns the payload', async () => {
    rpcImpl = () => ({
      data: { required: true, amount_kobo: 20000, currency: 'NGN', paid: false },
      error: null
    });
    const fee = await fetchListingConnectionFee('prop-1');
    expect(rpcCalls[0]).toEqual({
      name: 'acc_listing_connection_fee',
      args: { p_property_id: 'prop-1' }
    });
    expect(fee).toMatchObject({ required: true, amount_kobo: 20000, paid: false });
  });

  it('returns null when the listing-fee RPC errors', async () => {
    rpcImpl = () => ({ data: null, error: { message: 'boom' } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fee = await fetchListingConnectionFee('prop-1');
    expect(fee).toBeNull();
    spy.mockRestore();
  });

  it('fetches the masked contact block for the signed-in student', async () => {
    rpcImpl = () => ({
      data: {
        required: true,
        allowed: false,
        fee_kobo: 20000,
        currency: 'NGN',
        contact_phone: null,
        contact_whatsapp: null
      },
      error: null
    });
    const block = await fetchContactBlock('prop-1');
    expect(rpcCalls[0].name).toBe('acc_get_contact_block');
    expect(block?.allowed).toBe(false);
    expect(block?.contact_phone).toBeNull();
  });

  it('pays the connection fee through the guarded RPC', async () => {
    rpcImpl = () => ({
      data: { ok: true, required: true, amount_kobo: 20000, currency: 'NGN', paid: true, already: false },
      error: null
    });
    const res = await payConnectionFee('prop-1');
    expect(rpcCalls[0]).toEqual({
      name: 'acc_pay_connection_fee',
      args: { p_property_id: 'prop-1' }
    });
    expect(res.paid).toBe(true);
    expect(res.already).toBe(false);
  });

  it('reports already=true for a repeat payment instead of throwing', async () => {
    rpcImpl = () => ({
      data: { ok: true, required: true, amount_kobo: 20000, currency: 'NGN', paid: true, already: true },
      error: null
    });
    const res = await payConnectionFee('prop-1');
    expect(res.already).toBe(true);
    expect(res.paid).toBe(true);
  });

  it('surfaces a wallet shortfall from the RPC as a thrown error', async () => {
    rpcImpl = () => ({
      data: null,
      error: { message: 'INSUFFICIENT_FUNDS|needed=20000|available=5000|shortfall=15000' }
    });
    await expect(payConnectionFee('prop-1')).rejects.toThrow(/INSUFFICIENT_FUNDS/);
  });
});
