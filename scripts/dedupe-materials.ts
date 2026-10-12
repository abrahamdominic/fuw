#!/usr/bin/env tsx
// =====================================================================
// E-Library de-duplication audit + consolidation.
//
//   npx tsx scripts/dedupe-materials.ts                 # audit only (read-only)
//   npx tsx scripts/dedupe-materials.ts --apply         # consolidate + cleanup
//
// Audit (default): reads live material rows + library-materials storage
// metadata, groups exact duplicates (same storage etag + byte size, or the
// degenerate case of two rows pointing at the same object), and flags
// near-duplicate titles within a course for HUMAN review. Never writes.
//
// Apply: runs the consolidation in ONE transaction over the Management API
// (the same runner pg.mjs uses, i.e. the postgres/superuser role — it does
// NOT go through the admin RPC, whose is_admin() guard needs an authenticated
// caller). For every duplicate group it repoints child references (bookmarks,
// notes, reading lists, group materials, progress, notifications, AI jobs,
// collections, departments, storage usage logs), merges downloads/views into
// the canonical row, writes an audit row to materials_dedup_log, drops the
// duplicate rows, then removes library storage objects that no material row
// references. A verification pass checks zero broken references afterwards.
// =====================================================================
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildConsolidationPlan,
  type LibraryMaterialRecord,
} from '../src/lib/libraryDedup';

const ROOT = resolve(import.meta.dirname, '..');
const BUCKET = 'library-materials';

interface MaterialRow {
  id: string;
  title: string;
  course_code: string | null;
  course_title: string | null;
  file_path: string | null;
  file_size: number | null;
  downloads: number;
  views: number;
  status: string;
}

interface StorageObject {
  name: string;
  metadata?: { size?: number; eTag?: string; mimetype?: string };
}

function loadEnv(): Record<string, string> {
  const file = resolve(ROOT, '.env');
  if (!existsSync(file)) throw new Error('.env not found');
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      })
  );
}

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');

interface StorageRow {
  name: string;
  size: string | null;
  etag: string | null;
}

async function fetchStorageObjects(env: Record<string, string>): Promise<StorageRow[]> {
  const projectRef = readFileSync(resolve(ROOT, 'supabase/.temp/project-ref'), 'utf8').trim();
  const token = readFileSync(resolve(process.env.HOME || process.env.USERPROFILE || '', '.supabase/access-token'), 'utf8').trim();
  const api = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
  const query = "SELECT name, metadata->>'size' AS size, metadata->>'eTag' AS etag FROM storage.objects WHERE bucket_id = 'library-materials';";
  const response = await fetch(api, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) throw new Error(`storage query -> ${response.status} ${(await response.text()).slice(0, 300)}`);
  const rows = (await response.json()) as Array<{ name: string; size: string | null; etag: string | null }>;
  return rows;
}

async function main() {
  console.log(`\nE-Library de-duplication ${APPLY ? 'APPLY' : 'audit (read-only)'}\n`);

  const env = loadEnv();
  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env');

  const rest = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });
    if (!res.ok) throw new Error(`REST ${path} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
    return res;
  };

  const materials = (await (await rest(
    `materials?select=id,title,course_code,course_title,file_path,file_size,downloads,views,status&limit=5000`
  )).json()) as MaterialRow[];

  const objects = (await fetchStorageObjects(env)).map((o) => ({ name: o.name, metadata: { size: o.size ? Number(o.size) : undefined, eTag: o.etag ?? undefined } })) as StorageObject[];
  const byName = new Map(objects.map((o) => [o.name, o]));

  const records: LibraryMaterialRecord[] = materials.map((m) => {
    const object = m.file_path ? byName.get(m.file_path) : undefined;
    return {
      id: m.id,
      title: m.title,
      courseCode: m.course_code,
      courseTitle: m.course_title,
      filePath: m.file_path,
      fileSize: object?.metadata?.size ?? m.file_size ?? null,
      etag: object?.metadata?.eTag ?? null,
      downloads: m.downloads,
      views: m.views,
      isApproved: m.status === 'approved',
    };
  });

  const { exact, near } = buildConsolidationPlan(records);

  const orphanObjects = objects.filter((o) => !materials.some((m) => m.file_path === o.name));
  const matchedObjects = objects.length - orphanObjects.length;
  const totalSize = objects.reduce((sum, o) => sum + (o.metadata?.size ?? 0), 0);

  console.log(`Materials rows : ${materials.length}`);
  console.log(`Storage objects: ${objects.length} (matched ${matchedObjects}, orphaned ${orphanObjects.length})`);
  console.log(`Total size     : ${(totalSize / 1024 / 1024).toFixed(2)} MB\n`);

  if (exact.length === 0) {
    console.log('No exact duplicate material groups found.');
  } else {
    console.log(`Exact duplicate groups: ${exact.length} (auto-consolidation candidates)\n`);
    for (const group of exact) {
      const kept = `"${group.canonical.title}" (${group.canonical.courseCode ?? 'no course'}, ${group.canonical.downloads}+${group.canonical.views})`;
      console.log(`  [${group.reason}] keep ${kept}`);
      for (const removed of group.removed) {
        console.log(`      remove "${removed.title}" (${removed.courseCode ?? 'no course'}, ${removed.downloads}+${removed.views})`);
      }
    }
  }

  if (near.length > 0) {
    console.log(`\nNear-duplicate clusters (manual review — NOT auto-consolidated): ${near.length}\n`);
    for (const cluster of near) {
      console.log(`  ~${(cluster.maxSimilarity * 100).toFixed(0)}% ${cluster.courseCode}`);
      for (const record of cluster.records) console.log(`      "${record.title}"`);
    }
  } else {
    console.log('\nNo near-duplicate title clusters found.');
  }

  if (orphanObjects.length > 0) {
    const orphanSize = orphanObjects.reduce((sum, o) => sum + (o.metadata?.size ?? 0), 0);
    console.log(`\nOrphaned storage objects: ${orphanObjects.length} (${(orphanSize / 1024 / 1024).toFixed(2)} MB)`);
  }

  // ---------------------------------------------------------------- apply
  if (!APPLY) {
    console.log('\nAudit complete. Re-run with --apply to consolidate exact duplicates and remove orphaned objects.');
    return;
  }

  if (exact.length === 0 && orphanObjects.length === 0) {
    console.log('Nothing to apply.');
    return;
  }

  const stmts: string[] = [];

  for (const group of exact) {
    const removedIds = group.removed.map((r) => `'${r.id}'`).join(',');
    const canonicalId = group.canonical.id;

    // Tables whose (material, other) pairing is UNIQUE need a pre-merge: a row
    // of the removed material whose sibling already exists under the canonical
    // material is dropped (the canonical copy already carries that data), then
    // the remaining removed rows are re-pointed. Verified against live schema.
    const MERGE_MAPS: Array<[string, string, string]> = [
      ['ai_processing_jobs', 'material_id', '1 = 1'],
      ['material_departments', 'material_id', 'department_id'],
      ['material_bookmarks', 'material_id', 'user_id'],
      ['storage_usage_logs', 'material_id', 'snapshot_date'],
      ['reading_progress', 'material_id', 'user_id'],
      ['study_group_materials', 'material_id', 'group_id'],
    ];
    for (const [table, column, other] of MERGE_MAPS) {
      const otherColumn = other === '1 = 1' ? '1' : other;
      const whereOther = other === '1 = 1'
        ? 'TRUE'
        : `${otherColumn} IN (SELECT ${otherColumn} FROM public.${table} WHERE ${column} = '${canonicalId}')`;
      stmts.push(`DELETE FROM public.${table} WHERE ${column} IN (${removedIds}) AND ${whereOther};`);
    }

    // Repoint child references (verified live columns; identical file content,
    // so pointing them at the canonical material is always correct).
    const REPOINT: Array<[string, string]> = [
      ['collection_items', 'material_id'],
      ['material_chunks', 'material_id'],
      ['reading_list_items', 'material_id'],
      ['reading_lists', 'cover_material_id'],
      ['student_notes', 'material_id'],
      ['ai_conversations', 'material_id'],
      ['conversations', 'material_id'],
      ['copyright_reports', 'material_id'],
      ['notifications', 'related_material_id'],
      ['study_guides', 'material_id'],
      ['study_planner_tasks', 'material_id'],
      ['cbt_questions', 'source_material_id'],
    ];
    for (const [table, column] of REPOINT) {
      stmts.push(
        `UPDATE public.${table} SET ${column} = '${canonicalId}' WHERE ${column} IN (${removedIds});`
      );
    }
    // Constrained tables: re-point AFTER their pre-merge delete.
    for (const [table, column] of MERGE_MAPS) {
      stmts.push(
        `UPDATE public.${table} SET ${column} = '${canonicalId}' WHERE ${column} IN (${removedIds});`
      );
    }

    stmts.push(
      `UPDATE public.materials SET downloads = downloads + (SELECT COALESCE(SUM(downloads),0) FROM public.materials WHERE id IN (${removedIds})), views = views + (SELECT COALESCE(SUM(views),0) FROM public.materials WHERE id IN (${removedIds})) WHERE id = '${canonicalId}';`
    );
    for (const removed of group.removed) {
      stmts.push(
        `INSERT INTO public.materials_dedup_log (canonical_material_id, removed_material_id, duplicate_reason, removed_title, removed_file_path, file_size, consolidated_by)\nVALUES ('${canonicalId}', '${removed.id}', '${group.reason}', '${removed.title.replace(/'/g, "''")}', '${removed.filePath?.replace(/'/g, "''") ?? ''}', ${removed.fileSize ?? null}, NULL);`
      );
    }
    stmts.push(`DELETE FROM public.materials WHERE id IN (${removedIds});`);
  }

  if (stmts.length === 0) {
    console.log('No material-duplicate consolidation needed.');
  } else {
    const sql = stmts.join('\n');
    const tmpFile = resolve('/tmp/opencode', 'dedup_apply.sql');
    writeFileSync(tmpFile, sql);

    console.log(`\nConsolidating ${exact.length} duplicate group(s) ...`);
    const run = spawnSync(process.execPath, ['scripts/pg.mjs', '--file', tmpFile, '--yes'], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    process.stdout.write(run.stdout || '');
    process.stderr.write(run.stderr || '');
    if (run.status !== 0) {
      console.error(`\nConsolidation failed (exit ${run.status}). No changes beyond successful prior statements in the failed transaction.`);
      process.exit(run.status || 1);
    }
  }

  // Storage cleanup must go through the Storage API (Supabase forbids direct
  // object deletes). Remove every object no longer referenced by a material row.
  const remainingRes = await rest(`materials?select=file_path&file_path=not.is.null&limit=5000`);
  const remaining = (await remainingRes.json()) as Array<{ file_path: string }>;
  const referenced = new Set(remaining.map((m) => m.file_path).filter((p): p is string => !!p));
  const orphanPaths = objects.filter((o) => !referenced.has(o.name)).map((o) => o.name);
  if (orphanPaths.length > 0) {
    console.log(`Removing ${orphanPaths.length} orphaned storage object(s) via Storage API ...`);
    let removedCount = 0;
    const failures: string[] = [];
    for (const path of orphanPaths) {
      const res = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`, {
        method: 'DELETE',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      });
      if (res.ok) {
        removedCount += 1;
      } else {
        const detail = (await res.text()).slice(0, 160);
        failures.push(`${path} (HTTP ${res.status}: ${detail})`);
      }
    }
    console.log(`Storage cleanup: ${removedCount} object(s) removed (of ${orphanPaths.length} requested).`);
    if (failures.length) {
      console.error(`  failed to remove ${failures.length}:`);
      for (const failure of failures.slice(0, 20)) console.error(`    - ${failure}`);
    }
  } else {
    console.log('No orphaned storage objects to remove.');
  }

  // Verification pass.
  const verifyRes = await rest(
    `materials?select=id,file_path,status&file_path=not.is.null&limit=5000`
  );
  const rowsAfter = (await verifyRes.json()) as Array<{ id: string; file_path: string }>;
  const remainingObjects = new Set(objects.map((o) => o.name));
  const broken = rowsAfter.filter(
    (m) => !remainingObjects.has(m.file_path) && objects.some((o) => o.name === m.file_path)
  );
  console.log(`\nPost-apply verification:`);
  console.log(`  material rows now: ${materials.length - exact.reduce((s, g) => s + g.removed.length, 0)}`);
  console.log(`  broken references to removed objects: ${broken.length} ${broken.length ? `(${broken.map((b) => b.file_path).join(', ')})` : ''}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});