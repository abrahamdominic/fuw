// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

/**
 * Integration coverage for the Marketplace mount itself (must.md Phase 10).
 *
 * Every other Marketplace spec asserts against source text. This one renders
 * the real route tree, which is the only way to catch the failures that source
 * assertions cannot see: a provider ordered wrongly, a route that was never
 * registered, an import that only resolves in one bundler's graph, or an auth
 * adapter that throws during mount.
 */

/**
 * A chainable Supabase double. `from()`/`rpc()`/`functions.invoke()` all return
 * thenable builders that resolve to "no rows, no error", and the auth surface
 * reports a signed-out session. Every method used by `AuthContext` during mount
 * exists here; unknown ones resolve rather than throw so an unrelated call
 * cannot fail this spec for the wrong reason.
 */
function fakeSupabase() {
  const emptyResult = Promise.resolve({ data: null, error: null, count: null });

  const builder: any = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') return (resolve: any) => resolve({ data: null, error: null, count: null });
        if (prop === 'single' || prop === 'maybeSingle' || prop === 'limit' || prop === 'eq') {
          return () => builder;
        }
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
    },
    from: () => builder,
    rpc: () => emptyResult,
    functions: { invoke: async () => ({ data: null, error: null }) },
    channel: () => ({ on: () => ({}), subscribe: () => ({}), unsubscribe: () => {} }),
    removeChannel: async () => {},
    storage: { from: () => builder },
  };
}

vi.mock('../../lib/supabase', () => {
  const client = fakeSupabase();
  return {
    supabase: client,
    requireSupabase: () => client,
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
  };
});

// Imported after the mock so the module graph picks the double up.
const { MarketplaceRoutes } = await import('../MarketplaceRoutes');
const { ThemeProvider } = await import('../../lib/ThemeContext');
const { AuthProvider } = await import('../../lib/AuthContext');

/** Records where the router actually ended up, so a `<Navigate>` is observable. */
const visited: string[] = [];
function LocationProbe() {
  visited.push(useLocation().pathname);
  return null;
}

/**
 * Mirrors how `src/main.tsx` mounts it: a `path="/marketplace/*"` route under
 * the platform's providers. The splat parent is not incidental — it is what lets
 * the Marketplace's own `<Routes>` resolve `/browse` to `/marketplace/browse`,
 * so a test that mounted `MarketplaceRoutes` bare would prove nothing.
 */
function renderAt(path: string) {
  visited.length = 0;
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <ThemeProvider>
        <AuthProvider>
          <Routes>
            <Route path="/marketplace/*" element={<MarketplaceRoutes />} />
            <Route path="/login" element={<div>PLATFORM LOGIN</div>} />
            <Route path="/register" element={<div>PLATFORM REGISTER</div>} />
          </Routes>
        </AuthProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('The Marketplace mounts inside the platform SPA', () => {
  it('renders the Marketplace shell at /marketplace', async () => {
    renderAt('/marketplace');
    await waitFor(() => {
      expect(document.querySelector('.mp-root')).not.toBeNull();
    });
    // The Marketplace owns its chrome; the platform layout is not wrapped
    // around it, and its styles are scoped so they cannot reach the platform.
    expect(document.body.textContent).toContain('Student Marketplace');
  });

  it('resolves a Marketplace deep link to that page, not the home page', async () => {
    renderAt('/marketplace/browse');
    await waitFor(() => {
      expect(document.querySelector('.mp-root')).not.toBeNull();
    });
    // A splat fallback that swallowed every route would still render `.mp-root`,
    // so assert on page-specific content.
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/browse|product|category/i);
    });
  });

  it('keeps an unknown Marketplace path inside the Marketplace', async () => {
    renderAt('/marketplace/not-a-real-page');
    await waitFor(() => {
      expect(visited.some((p) => p.startsWith('/marketplace'))).toBe(true);
    });
    expect(visited.every((p) => p.startsWith('/marketplace'))).toBe(true);
  });

  it('sends the Marketplace login route to the platform login', async () => {
    // The Marketplace keeps its own URL space but has only one sign-in surface:
    // a second login form would be a second authentication system.
    renderAt('/marketplace/login');
    await waitFor(() => {
      expect(screen.getByText('PLATFORM LOGIN')).toBeTruthy();
    });
    expect(visited.at(-1)).toBe('/login');
  });

  it('sends the Marketplace register route to the platform register', async () => {
    renderAt('/marketplace/register');
    await waitFor(() => {
      expect(visited).toContain('/register');
    });
  });

  it('renders the production Marketplace hero with trust badge, search and popular category chips', async () => {
    renderAt('/marketplace');
    await waitFor(() => {
      expect(document.querySelector('.mp-hero-card')).not.toBeNull();
    });
    expect(screen.getByText(/FUW Protected Student Commerce/i)).toBeTruthy();
    expect(screen.getByText(/Buy, Sell & Offer Services/i)).toBeTruthy();
    expect(screen.getByPlaceholderText(/Search food, textbooks, laundry, phones, barbing, repairs/i)).toBeTruthy();
    for (const chip of ['Food', 'Textbooks', 'Laundry', 'Phones', 'Barbing', 'Repairs']) {
      expect(screen.getByText(chip)).toBeTruthy();
    }
  });

  it('renders the mobile-friendly notification control with accessible label', async () => {
    renderAt('/marketplace');
    await waitFor(() => {
      expect(screen.getByLabelText(/Notifications/i)).toBeTruthy();
    });
  });
});
