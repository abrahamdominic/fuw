import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        // Object-form manualChunks keeps the React family coherent. Function-
        // form splitting let shared React runtime deps (scheduler,
        // use-sync-external-store, @remix-run/router, …) fall into the generic
        // `vendor` chunk, so vendor <-> vendor-react imported each other and
        // Rollup emitted a "Circular chunk" warning. With the object form,
        // Rollup pulls each package's exclusive deps into the same chunk and
        // auto-creates shared chunks for anything used across groups, so the
        // chunk graph stays acyclic.
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-router': ['react-router', 'react-router-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-queries': ['@tanstack/react-query'],
          'vendor-icons': ['lucide-react'],
        },
      }
    }
  }
});