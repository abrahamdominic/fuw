// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';

/**
 * Whole-app route smoke test.
 *
 * Every other spec in this repository asserts against a module, a source string
 * or an isolated subtree. None of them can catch the single most expensive class
 * of regression in an SPA of this size: a route that is registered, type-checks
 * and bundles, but throws the moment React renders it — an undefined context, a
 * bad `useSearchParams` read, a component that dereferences a field the
 * data loader never returns.
 *
 * This spec mounts the real entry point (`src/main.tsx`), which is what the dev
 * server and production both execute, and renders every route in the table. The
 * Supabase client is doubled so pages see an empty, error-free dataset, and the
 * browser APIs jsdom lacks are stubbed.
 *
 * A route passes when React mounts it without throwing and without the error
 * boundary catching. Routes behind a guard are expected to redirect to the
 * sign-in surface rather than render their content, so the assertion is
 * "something sensible rendered and nothing crashed", not "the private data is
 * visible".
 */

/**
 * Chainable Supabase double. Every builder resolves to "no rows, no error", and
 * the auth surface reports a signed-out session, so guarded routes redirect and
 * public routes render their empty states. Unknown methods resolve rather than
 * throw so an unrelated call cannot fail this spec for the wrong reason.
 */
function fakeSupabase() {
  const empty = Promise.resolve({ data: null, error: null, count: null });

  const builder: any = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') return (resolve: any) => resolve({ data: null, error: null, count: null });
        if (prop === Symbol.toPrimitive || typeof prop === 'symbol') return undefined;
        // Filters, ordering and pagination are all chainable no-ops.
        return () => builder;
      },
    }
  );

  return {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
      setSession: async () => ({ error: null }),
      signInWithPassword: async () => ({ error: null }),
      signUp: async () => ({ data: { user: null }, error: null }),
      resetPasswordForEmail: async () => ({ error: null }),
      updateUser: async () => ({ error: null }),
      mfa: {
        listFactors: async () => ({ data: [], error: null }),
        enroll: async () => ({ data: null, error: null }),
        challenge: async () => ({ data: null, error: null }),
        verify: async () => ({ data: null, error: null }),
        getAuthenticatorAssuranceLevel: async () => ({ data: null, error: null }),
      },
    },
    from: () => builder,
    rpc: () => empty,
    functions: { invoke: async () => ({ data: null, error: null }) },
    channel: () => ({ on: () => ({}), subscribe: () => ({}), unsubscribe: () => {} }),
    removeChannel: async () => {},
    storage: { from: () => builder },
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

// The maintenance gate is a real Supabase read. Fail open, deterministically.
vi.mock('../lib/maintenance', () => ({
  fetchMaintenanceStatus: async () => null,
  setMaintenanceStatus: async () => ({ error: null }),
}));

// Imported after the `vi.mock` calls so the module graph picks the doubles up.
const { App } = await import('../main');
const { BrowserRouter } = await import('react-router-dom');
const { HelmetProvider } = await import('react-helmet-async');

/** Routes that must render without any session. */
const PUBLIC_ROUTES = [
  '/',
  '/home',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/admin/login',
  '/super/login',
  '/library',
  '/courses',
  '/faculties',
  '/faculties/faculty-of-science',
  '/departments/department-of-physics',
  '/about',
  '/repository',
  '/collections',
  '/contact',
  '/help',
  '/hub',
  '/accommodation',
  '/accommodation/roommates',
];

/** Parameterised routes get a concrete value so the leaf component renders. */
const PARAM_ROUTES = [
  ['/courses/PHY-101', 'PHY-101'],
  ['/materials/1', '1'],
  ['/faculties/faculty-of-science', 'faculty-of-science'],
  ['/departments/department-of-physics', 'department-of-physics'],
  ['/collections/exam-past-questions', 'exam-past-questions'],
  ['/repository/1', '1'],
  ['/accommodation/hostel-1', 'hostel-1'],
];

/** Marketplace routes, which live under the `/marketplace/*` splat route. */
const MARKETPLACE_ROUTES = [
  '/marketplace',
  '/marketplace/browse',
  '/marketplace/cart',
  '/marketplace/checkout',
  '/marketplace/favourites',
  '/marketplace/messages',
  '/marketplace/orders',
  '/marketplace/order/1',
  '/marketplace/product/1',
  '/marketplace/wallet',
  '/marketplace/profile',
  '/marketplace/vendor/dashboard',
  '/marketplace/vendor/register',
  '/marketplace/vendor/some-vendor',
  '/marketplace/admin',
  '/marketplace/admin/support',
];

/** Routes behind a guard. Rendering one must not crash and must not leak data. */
const GUARDED_ROUTES = [
  '/dashboard',
  '/profile',
  '/settings',
  '/student',
  '/admin',
  // AdminPortal switches the panel on the current path, so the accommodation
  // console is only reached when its own path is requested.
  '/admin/accommodation',
  '/admin/services',
  '/super',
];

/** Any path the app is expected to answer with the not-found screen. */
const UNKNOWN_ROUTE = '/this-route-does-not-exist';

beforeAll(() => {
  // jsdom implements none of these, and several pages observe them on mount.
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
  class NoopObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (globalThis as any).IntersectionObserver ??= NoopObserver;
  (globalThis as any).ResizeObserver ??= NoopObserver;
  (globalThis as any).MutationObserver ??= NoopObserver;
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  const nodeFetch = globalThis.fetch;
  (globalThis as any).fetch = vi.fn(async (input: any, init?: any) => {
    const urlStr = typeof input === 'string' ? input : (input?.url || input?.href || '');
    if (urlStr.startsWith('/@') || urlStr.startsWith('/src') || urlStr.includes('vite') || urlStr.includes('node_modules')) {
      return nodeFetch(input, init);
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  });
  window.fetch = (globalThis as any).fetch;
});

beforeEach(() => {
  window.localStorage.clear();
  // Any rejection escaping a route is a failure of that route, not noise.
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const first = String(args[0] ?? '');
    // Two React dev warnings are expected when a real entry point is mounted
    // outside `act()`: generic prop warnings, and the act() advisory itself.
    if (/Warning: /.test(first) || /not wrapped in act/.test(first)) return;
    throw new Error(`console.error during render: ${args.map(String).join(' ').slice(0, 300)}`);
  });
});

afterEach(() => {
  // Unmounting between routes matters: a leaked tree keeps its timers and
  // effects alive and re-renders into a container the next test replaced.
  cleanup();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

/**
 * Mounts the real application at `path`.
 *
 * `<App/>` is rendered inside the same `BrowserRouter`/`HelmetProvider` pair
 * `main.tsx` uses, and the module graph is deliberately NOT reset between tests:
 * resetting it would hand a lazily imported route chunk a different copy of
 * `AuthContext` than the provider tree was built from, and every context
 * consumer would throw `useAuth must be used within an AuthProvider`.
 */
async function mountAt(path: string, ready?: () => boolean) {
  window.history.pushState({}, '', path);

  const view = render(
    <HelmetProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </HelmetProvider>
  );

  // Wait for the splash boundary, the maintenance gate and the lazily imported
  // route chunk. A fixed sleep is not enough — a cold route chunk is a real
  // dynamic import — so poll until the route has painted what it should.
  await waitFor(
    () => {
      expect(view.container.querySelector('.route-fallback')).toBeNull();
      expect(view.container.querySelector('.boot-fallback')).toBeNull();
      expect(view.container.textContent?.trim().length ?? 0).toBeGreaterThan(0);
      if (ready) expect(ready()).toBe(true);
    },
    { timeout: 15_000 }
  );

  return view;
}

/** Fails when the error boundary swallowed a render crash. */
function assertNoCrashBoundary(text: string, path: string) {
  expect(text, `${path} rendered the error boundary`).not.toMatch(
    /something went wrong|something went wrong on our end|unexpected error/i
  );
}

describe('Every route in the application mounts without crashing', () => {
  // Each route pays for a cold dynamic import plus the splash and maintenance
  // gates, so the default 5s budget is too tight for a full-app mount.
  const ROUTE_TIMEOUT = 20_000;

  it.each(PUBLIC_ROUTES)('renders %s', { timeout: ROUTE_TIMEOUT }, async (path) => {
    const text = (await mountAt(path)).container.textContent || '';
    assertNoCrashBoundary(text, path);
    // A real page always renders some chrome or content; an empty document
    // means the route matched nothing.
    expect(text.trim().length, `${path} rendered nothing`).toBeGreaterThan(0);
  });

  it.each(PARAM_ROUTES)('renders %s', { timeout: ROUTE_TIMEOUT }, async (path) => {
    const text = (await mountAt(path)).container.textContent || '';
    assertNoCrashBoundary(text, path);
    expect(text.trim().length, `${path} rendered nothing`).toBeGreaterThan(0);
  });

  it.each(MARKETPLACE_ROUTES)('renders %s', { timeout: ROUTE_TIMEOUT }, async (path) => {
    const view = await mountAt(path, () => Boolean(document.querySelector('.mp-root')));
    const text = view.container.textContent || '';
    assertNoCrashBoundary(text, path);
    // Marketplace routes live inside the scoped `.mp-root` shell.
    expect(
      view.container.querySelector('.mp-root'),
      `${path} did not render the Marketplace shell`
    ).not.toBeNull();
  });

  it.each(GUARDED_ROUTES)('guards %s without crashing', { timeout: ROUTE_TIMEOUT }, async (path) => {
    const text = (await mountAt(path)).container.textContent || '';
    assertNoCrashBoundary(text, path);
    expect(text.trim().length, `${path} rendered nothing`).toBeGreaterThan(0);
  });

  it('answers an unknown path with the not-found screen', { timeout: ROUTE_TIMEOUT }, async () => {
    const NOT_FOUND = /not found|404|page.*doesn.*exist|couldn.*find/i;
    const view = await mountAt(UNKNOWN_ROUTE, () =>
      NOT_FOUND.test(document.body.textContent || '')
    );
    const text = view.container.textContent || '';
    assertNoCrashBoundary(text, UNKNOWN_ROUTE);
    // The platform shell (header/footer) paints first, so waiting only for
    // non-empty text would sample before the lazily imported 404 page lands.
    expect(text).toMatch(NOT_FOUND);
  });
});
