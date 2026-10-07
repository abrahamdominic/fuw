#!/usr/bin/env node
// =============================================================================
// `npm run dev` launcher
// =============================================================================
//
// WHY THIS EXISTS
// ---------------
// `vite dev` is the only part of the toolchain that execs the native esbuild
// binary: Vite's dependency pre-bundler hands it absolute paths. On some hosts
// that binary cannot open files under this repository, and reports the path with
// an extra path segment wedged in:
//
//     /home/abraham/FUW/fuw/package.json
//       ->  Cannot read file: /home/abraham/FUW/fuw/fuw/package.json
//
// which takes the dev server down with ~1,500 of those errors before it can
// serve a single request.
//
// The paths travel to esbuild inside its `--service=...` stdin protocol, so there
// is no environment variable, shim binary or Vite option that can rewrite them:
// the only thing that reliably works is giving the process a repository path the
// binary *can* open.
//
// WHAT THIS DOES
// -------------
// 1. Probes the real esbuild binary against this repository's `package.json`.
// 2. If the probe passes, runs `vite` directly. This is the normal path and it is
//    what runs on CI, on Netlify, and on any healthy machine.
// 3. If the probe fails, re-executes itself inside an unprivileged mount namespace
//    where the repository is bind-mounted at a path outside the unreadable
//    prefix, then runs `vite` from there.
//
// Nothing outside the repository is modified, the mount disappears with the
// namespace when the server exits, and the repository is not modified at all.
//
// The network namespace is deliberately NOT unshared, so the dev server keeps
// listening on the normal host ports and remains reachable at localhost.
//
// OVERRIDES
// ---------
//   FUW_DEV_NO_REMAP=1   skip the probe and always run `vite` directly
//   FUW_DEV_MOUNT_ROOT=  where to bind-mount inside the namespace
//                        (default: a fresh directory under the OS temp dir)
//
// NOTE: `vite build`, `tsc` and `vitest` use esbuild's in-process transform
// rather than the binary, so they are unaffected and are intentionally left
// running normally.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VITE_ARGS = process.argv.slice(2);

/** Absolute path of the platform esbuild binary that Vite's pre-bundler uses. */
function realEsbuildBinary() {
  for (const dir of [
    join(ROOT, 'node_modules', 'vite', 'node_modules', '@esbuild'),
    join(ROOT, 'node_modules', '@esbuild')
  ]) {
    if (!existsSync(dir)) continue;
    const bin = join(dir, `${process.platform}-${process.arch}`, 'bin', 'esbuild');
    if (existsSync(bin)) return bin;
  }
  return '';
}

/** True when esbuild can read a file that definitely exists in this repository. */
function esbuildCanReadRepo() {
  if (process.env.FUW_DEV_NO_REMAP === '1') return true;

  const binary = realEsbuildBinary();
  if (!binary) return true;

  const probe = join(ROOT, 'package.json');
  if (!existsSync(probe)) return true;

  const out = mkdtempSync(join(tmpdir(), 'fuw-dev-probe-'));
  try {
    execFileSync(binary, [probe, '--format=esm', `--outfile=${join(out, 'probe.mjs')}`], {
      stdio: 'pipe'
    });
    return true;
  } catch {
    return false;
  } finally {
    // Best effort: a leftover temp dir is harmless and never touches the repo.
    try {
      execFileSync('rm', ['-rf', out], { stdio: 'ignore' });
    } catch {
      /* ignore */
    }
  }
}

/** Re-run this script inside a mount namespace with the repo bind-mounted. */
function relaunchInNamespace() {
  const mountRoot =
    process.env.FUW_DEV_MOUNT_ROOT || join(tmpdir(), `fuw-dev-${process.pid}`);
  const self = fileURLToPath(import.meta.url);

  // A tiny POSIX shell script keeps the quoting correct for paths with spaces and
  // avoids depending on how each platform's `unshare` parses argv.
  const script = `
set -e
mkdir -p ${JSON.stringify(mountRoot)}
mount --bind ${JSON.stringify(ROOT)} ${JSON.stringify(mountRoot)}
cd ${JSON.stringify(mountRoot)}
exec node ${JSON.stringify(self)} --from-namespace "$@"
`;

  const result = spawnSync(
    'unshare',
    [
      '--map-root-user',
      '--mount',
      // Keep the mount private, otherwise it would propagate back to the host.
      '--propagation',
      'private',
      'sh',
      '-c',
      script,
      'sh',
      ...VITE_ARGS
    ],
    { stdio: 'inherit', env: { ...process.env, FUW_DEV_ROOT: mountRoot } }
  );

  if (result.error || result.status !== 0) {
    console.error(
      '\n[dev] could not start a remapped dev server.\n' +
        `      ${result.error ? result.error.message : `unshare exited with ${result.status}`}\n` +
        '      The dev server needs an unprivileged mount namespace (util-linux\n' +
        '      `unshare`) on this machine because the native esbuild binary cannot\n' +
        '      read files under this repository.\n' +
        '      `vite build`, `npm run build`, `npm test` and `tsc` are unaffected.'
    );
    process.exit(result.status ?? 1);
  }
  process.exit(0);
}

if (process.argv.includes('--from-namespace')) {
  // Inside the namespace the repository is readable, so run the real thing. The
  // working directory is the bind mount, not the script's own location, which is
  // still the original path (both work, but only the mount one is readable).
  const forwarded = process.argv.slice(2).filter((a) => a !== '--from-namespace');
  const cwd = process.env.FUW_DEV_ROOT || process.cwd();
  const result = spawnSync('npx', ['vite', ...forwarded], { stdio: 'inherit', cwd });
  process.exit(result.status ?? 0);
}

if (esbuildCanReadRepo()) {
  const result = spawnSync('npx', ['vite', ...VITE_ARGS], { stdio: 'inherit', cwd: ROOT });
  process.exit(result.status ?? 0);
}

console.warn(
  '[dev] the native esbuild binary on this host cannot read files under this\n' +
    '      repository, which breaks Vite\'s dependency pre-bundler. Starting the\n' +
    '      dev server from a bind-mounted copy of the path instead. Set\n' +
    '      FUW_DEV_NO_REMAP=1 to disable this.'
);

relaunchInNamespace();
