// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * Accommodation platform regression spec.
 *
 * Each case below pins a defect that shipped in this feature, in the order the
 * defects were found:
 *
 *  - `under_maintenance` and `booked` collapsed onto one "Booked" badge, telling
 *    a student a lodge was fully taken when it was out of service.
 *  - The detail page never rendered the availability status at all, so the most
 *    decision-relevant fact about a lodge was missing from the page a student
 *    reads before contacting a caretaker.
 *  - "Any budget" was sent as a real price ceiling, silently hiding every lodge
 *    priced above the top of the slider.
 *  - Every keystroke in the search box issued a full-table query.
 *  - The inquiry and report forms were reachable by anonymous visitors, whose
 *    submissions could only ever be rejected by row-level security.
 *  - The inquiry phone field was prefilled from `profile.phone`, which does not
 *    exist on `Profile`, so it was always blank.
 *  - `view_count` was a column nothing ever incremented.
 *
 * `getAvailabilityBadge` and `recordAccommodationView` are pure enough to test
 * directly; the two page cases render the real components against a Supabase
 * double that records the arguments it was called with.
 */

const rpcCalls: { name: string; args: any }[] = [];
const propertyQueries: any[] = [];

/**
 * When set, the properties double resolves to this row instead of an empty
 * list, so a spec can render the populated detail page.
 */
let propertyRow: any = null;

const SAMPLE_PROPERTY = {
  id: 'prop-1',
  slug: 'some-lodge',
  title: 'Some Lodge',
  description: 'A lodge.',
  property_type: 'bedspace',
  location_area: 'Wukari Town',
  address_landmark: 'Near the gate',
  distance_to_campus: '5 min walk',
  price_annual: 250000,
  price_semester: null,
  caution_deposit: 0,
  service_charge: 0,
  total_units: 10,
  available_units: 3,
  availability_status: 'under_maintenance',
  images: [],
  amenities: [],
  rules_notes: null,
  contact_phone: '08000000000',
  contact_whatsapp: null,
  is_verified: true,
  is_featured: false,
  is_published: true,
  view_count: 4,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

function fakeSupabase() {
  const empty = Promise.resolve({ data: null, error: null, count: null });

  // A builder that records the filter chain for the properties table so a spec
  // can assert on what the page actually asked for. Range operators record as
  // well as `eq`: a budget ceiling arrives via `lte`, and a double that only
  // captured equality would silently pass while the ceiling was in place.
  const makeBuilder = (table: string) => {
    const filters: Record<string, unknown> = {};
    const builder: any = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return builder;
      },
      neq: (col: string, val: unknown) => {
        filters[col] = { neq: val };
        return builder;
      },
      gt: (col: string, val: unknown) => {
        filters[col] = { gt: val };
        return builder;
      },
      gte: (col: string, val: unknown) => {
        filters[col] = { gte: val };
        return builder;
      },
      lte: (col: string, val: unknown) => {
        filters[col] = { lte: val };
        return builder;
      },
      lt: (col: string, val: unknown) => {
        filters[col] = { lt: val };
        return builder;
      },
      like: (col: string, val: unknown) => {
        filters[col] = { like: val };
        return builder;
      },
      ilike: (col: string, val: unknown) => {
        filters[col] = { ilike: val };
        return builder;
      },
      or: () => builder,
      in: () => builder,
      is: () => builder,
      order: () => builder,
      limit: () => builder,
      range: () => builder,
      single: async () => ({ data: propertyRow, error: null }),
      maybeSingle: async () => ({ data: propertyRow, error: null }),
      insert: async () => empty,
      update: async () => empty,
      upsert: async () => empty,
      delete: async () => empty,
      then: (resolve: any) => {
        if (table === 'accommodation_properties') {
          propertyQueries.push({ ...filters });
          // A slug lookup is the detail page's fetch; serve it the sample row.
          if (filters.slug !== undefined && propertyRow) {
            return resolve({ data: [propertyRow], error: null, count: 1 });
          }
        }
        return resolve({ data: [], error: null, count: null });
      },
    };
    return builder;
  };

  return {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
    },
    from: (table: string) => makeBuilder(table),
    rpc: (name: string, args?: any) => {
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: 7, error: null });
    },
    functions: { invoke: async () => ({ data: null, error: null }) },
    channel: () => ({ on: () => ({}), subscribe: () => ({}), unsubscribe: () => {} }),
    removeChannel: async () => {},
    storage: { from: () => makeBuilder('storage') },
  };
}

vi.mock('../lib/supabase', () => {
  const client = fakeSupabase();
  return {
    supabase: client,
    requireSupabase: () => client,
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
  };
});

vi.mock('../lib/maintenance', () => ({
  fetchMaintenanceStatus: async () => null,
  setMaintenanceStatus: async () => ({ error: null }),
}));

// Signed out by default. Cases that need a session flip this.
let authState: { isAuthenticated: boolean; user: any; profile: any } = {
  isAuthenticated: false,
  user: null,
  profile: null,
};

vi.mock('../lib/AuthContext', () => ({
  useAuth: () => authState,
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const toastSpy = vi.fn();
vi.mock('../components/Toast', () => ({
  useToast: () => ({ toast: toastSpy }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const { getAvailabilityBadge, recordAccommodationView } = await import('../lib/accommodation');
const { AccommodationPage } = await import('../pages/AccommodationPage');
const { AccommodationDetailPage } = await import('../pages/AccommodationDetailPage');
const { MemoryRouter, Routes, Route } = await import('react-router-dom');
const { HelmetProvider } = await import('react-helmet-async');

beforeAll(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
});

beforeEach(() => {
  rpcCalls.length = 0;
  propertyQueries.length = 0;
  toastSpy.mockClear();
  propertyRow = null;
  authState = { isAuthenticated: false, user: null, profile: null };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderDetail() {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={['/accommodation/some-lodge']}>
        <Routes>
          <Route path="/accommodation/:slug" element={<AccommodationDetailPage />} />
        </Routes>
      </MemoryRouter>
    </HelmetProvider>
  );
}

function renderList() {
  return render(
    <HelmetProvider>
      <MemoryRouter>
        <AccommodationPage />
      </MemoryRouter>
    </HelmetProvider>
  );
}

describe('accommodation availability status', () => {
  it('distinguishes all four stored states', () => {
    // The defect: `booked` and `under_maintenance` both rendered as "Booked".
    expect(getAvailabilityBadge('available').label).toBe('Available');
    expect(getAvailabilityBadge('fast_filling').label).toBe('Fast Filling');
    expect(getAvailabilityBadge('under_maintenance').label).toBe('Under Maintenance');
    expect(getAvailabilityBadge('booked').label).toBe('Fully Booked');

    // Every state must also be visually separable, or a colour-blind reader
    // loses the distinction the labels carry.
    const tones = ['available', 'fast_filling', 'under_maintenance', 'booked'].map(
      (s) => `${getAvailabilityBadge(s).background}|${getAvailabilityBadge(s).color}`
    );
    expect(new Set(tones).size).toBe(4);
  });

  it('falls back to Unavailable for an unrecognised status', () => {
    expect(getAvailabilityBadge('something_new').label).toBe('Unavailable');
  });

  it('badges the status on the detail page, which previously omitted it', async () => {
    propertyRow = SAMPLE_PROPERTY;
    renderDetail();

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Some Lodge' })).toBeTruthy());

    // The sample row is under maintenance. Before the fix the detail page
    // rendered no status at all, so this text was simply absent.
    expect(screen.getByText('Under Maintenance')).toBeTruthy();
    // And it must not be mistaken for a full booking.
    expect(screen.queryByText('Fully Booked')).toBeNull();
  });
});

describe('accommodation anonymous access', () => {
  it('offers sign-in instead of an inquiry form a visitor cannot submit', async () => {
    propertyRow = SAMPLE_PROPERTY;
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Some Lodge' })).toBeTruthy());

    // Row-level security attaches the reporter to the session, so an anonymous
    // inquiry could only ever be rejected. Sign-in is the only honest offer.
    expect(screen.queryByText(/Send Move-in Inquiry/)).toBeNull();
    expect(screen.getByText(/Sign in to send an inquiry/)).toBeTruthy();
    expect(screen.getByText(/Sign in to report this listing/)).toBeTruthy();
  });

  it('shows the real forms to a signed-in student', async () => {
    propertyRow = SAMPLE_PROPERTY;
    authState = {
      isAuthenticated: true,
      user: { id: 'user-1' },
      profile: { displayName: 'Ada', fullName: 'Ada Lovelace', phoneNumber: '08012345678' },
    };
    renderDetail();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Some Lodge' })).toBeTruthy());

    expect(screen.getByText(/Send Move-in Inquiry/)).toBeTruthy();
    expect(screen.getByText(/Report Suspicious Listing/)).toBeTruthy();
    expect(screen.queryByText(/Sign in to send an inquiry/)).toBeNull();

    // Open the inquiry the way a student would, then check the phone field.
    // It is prefilled from `Profile.phoneNumber`. It used to be read from
    // `profile.phone`, which is not a Profile field, so it always came back
    // undefined and left the form blank.
    fireEvent.click(screen.getByText(/Send Move-in Inquiry/));
    await waitFor(() => {
      const phone = document.querySelector('input[type="tel"]') as HTMLInputElement;
      expect(phone).toBeTruthy();
      expect(phone.value).toBe('08012345678');
    });
  });

  it('counts a view through the rpc when the detail page loads', async () => {
    propertyRow = SAMPLE_PROPERTY;
    renderDetail();
    await waitFor(() => {
      expect(rpcCalls.map((c) => c.name)).toContain('increment_accommodation_view_count');
    });
    expect(rpcCalls.find((c) => c.name === 'increment_accommodation_view_count')?.args).toEqual({
      p_property_id: 'prop-1',
    });
  });
});

describe('accommodation listing filters', () => {
  it('does not treat the top of the budget slider as a price ceiling', async () => {
    renderList();
    await waitFor(() => expect(propertyQueries.length).toBeGreaterThan(0));

    const last = propertyQueries[propertyQueries.length - 1];
    // "Any budget" is MAX_BUDGET. Sending it as a ceiling hid every lodge above
    // it while the UI claimed no budget filter was applied.
    expect(last.price_annual).toBeUndefined();
    // Published-only is the intended scope of the public list.
    expect(last.is_published).toBe(true);
  });

  it('still applies a real ceiling once the slider is moved', async () => {
    renderList();
    await waitFor(() => expect(propertyQueries.length).toBeGreaterThan(0));

    const slider = screen.getByRole('slider') as HTMLInputElement;
    // A slider's value is a string; the page must turn it back into a number.
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(slider, { target: { value: '120000' } });

    await waitFor(() => {
      const last = propertyQueries[propertyQueries.length - 1];
      expect(last.price_annual).toEqual({ lte: 120000 });
    });
  });

  it('debounces search so a burst of typing issues one query, not one per key', async () => {
    renderList();
    await waitFor(() => expect(propertyQueries.length).toBeGreaterThan(0));
    const baseline = propertyQueries.length;

    const box = screen.getByPlaceholderText(/lodge name/i) as HTMLInputElement;
    const { fireEvent } = await import('@testing-library/react');

    // "wukari" typed one character at a time, as a person would. Six keystrokes
    // against an undebounced input meant six full-table queries.
    for (const value of ['w', 'wu', 'wuk', 'wuka', 'wukar', 'wukari']) {
      fireEvent.change(box, { target: { value } });
    }

    // Still inside the debounce window, so nothing has been sent.
    expect(propertyQueries.length).toBe(baseline);

    // Once the window closes, exactly one query goes out.
    await waitFor(
      () => expect(propertyQueries.length).toBe(baseline + 1),
      { timeout: 2000 }
    );
    // And it settles there rather than trickling further queries.
    await new Promise((r) => setTimeout(r, 400));
    expect(propertyQueries.length).toBe(baseline + 1);
  });
});

describe('accommodation view counter', () => {
  it('increments through the SECURITY DEFINER rpc, not a client write', async () => {
    const total = await recordAccommodationView('prop-1');
    expect(total).toBe(7);
    expect(rpcCalls).toEqual([
      { name: 'increment_accommodation_view_count', args: { p_property_id: 'prop-1' } },
    ]);
  });

  it('swallows an rpc failure rather than breaking the page', async () => {
    const { supabase } = await import('../lib/supabase');
    const client = supabase as any;
    const spy = vi.spyOn(client, 'rpc').mockResolvedValueOnce({
      data: null,
      error: { message: 'boom' },
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(recordAccommodationView('prop-1')).resolves.toBeNull();
    spy.mockRestore();
    errSpy.mockRestore();
  });
});
