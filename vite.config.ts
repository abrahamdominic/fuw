/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Manual chunking strategy.
//
// The previous object-form mapping produced an empty `vendor-react` chunk
// because React's runtime deps (`scheduler`, `react-dom/client`) were being
// pulled into the entry chunk instead of the named group. A function form lets
// us route every React-family package — including its transitive runtime deps —
// into one chunk while keeping the rest of the vendor graph acyclic.
function manualChunks(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined;

  // React runtime + its exclusive transitive deps.
  if (
    /node_modules\/(react|react-dom|scheduler|use-sync-external-store)\//.test(id)
  ) {
    return 'vendor-react';
  }

  if (id.includes('node_modules/react-router') || id.includes('node_modules/@remix-run')) {
    return 'vendor-router';
  }

  if (id.includes('node_modules/@supabase')) {
    return 'vendor-supabase';
  }

  if (id.includes('node_modules/@tanstack')) {
    return 'vendor-queries';
  }

  if (id.includes('node_modules/lucide-react')) {
    return 'vendor-icons';
  }

  // Async helpers used by several chunks — keep in one place to avoid
  // cross-chunk cycles.
  if (id.includes('node_modules/@babel/runtime') || id.includes('node_modules/regenerator-runtime')) {
    return 'vendor-runtime';
  }

  return 'vendor';
}

export default defineConfig({
  plugins: [react()],
  esbuild: {
    target: 'es2022',
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'es2022',
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    fileParallelism: false,
    testTimeout: 20000,
    // The FUW Student Marketplace brought its Vitest suite with it when it was
    // folded into this SPA (must.md Phase 10). These specs guard money,
    // authorization and RLS contracts, so they run as part of `npm test`.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
