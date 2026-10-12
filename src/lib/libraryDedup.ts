/**
 * Pure, testable helpers for E-Library de-duplication. The runtime script
 * (scripts/dedupe-materials.ts) feeds live material + storage rows through
 * these functions; the browser admin tab uses the same logic for reports.
 */

export interface LibraryMaterialRecord {
  id: string;
  title: string;
  courseCode: string | null;
  courseTitle: string | null;
  filePath: string | null;
  fileSize: number | null;
  etag: string | null;
  downloads: number;
  views: number;
  isApproved: boolean;
}

export interface DuplicateGroup {
  /** 'identical_file' = same content (etag+size), 'same_path' = borderline rows sharing a file_path. */
  reason: 'identical_file' | 'same_path';
  canonical: LibraryMaterialRecord;
  removed: LibraryMaterialRecord[];
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'of', 'and', 'for', 'on', 'in', 'to', 'with', 'part', 'i', 'ii', 'iii', 'iv', 'v', 'vi',
  'vol', 'volume', 'edition', 'pdf', 'pdfs', 'college', 'university', 'course', 'material', 'note',
  'notes', 'lecture', 'handout', 'handouts', 'textbook', 'book', 'compiled', 'by', 'updated', '2024',
  '2025', '2026', '1', '2', '3', '4', '5',
]);

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[·•–—_,/\\()!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
    .join(' ');
}

/** Token-level Jaccard similarity between two titles (0..1). */
export function titleSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeTitle(a).split(' ').filter(Boolean));
  const tb = new Set(normalizeTitle(b).split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const token of ta) if (tb.has(token)) intersection += 1;
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Content hashes are equal when the storage etag and byte size agree. */
export function isIdenticalFile(a: LibraryMaterialRecord, b: LibraryMaterialRecord): boolean {
  if (!a.etag || !b.etag) return false;
  if (a.fileSize == null || b.fileSize == null) return false;
  return a.etag === b.etag && a.fileSize === b.fileSize;
}

/** The material that should survive: most downloads + views first. */
export function chooseCanonical(records: LibraryMaterialRecord[]): LibraryMaterialRecord {
  return [...records].sort((a, b) => {
    const scoreA = a.downloads + a.views;
    const scoreB = b.downloads + b.views;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return a.id.localeCompare(b.id);
  })[0];
}

/** Groups rows that reference the exact same storage object. */
export function groupSamePath(records: LibraryMaterialRecord[]): DuplicateGroup[] {
  const groups = new Map<string, LibraryMaterialRecord[]>();
  for (const record of records) {
    if (!record.filePath) continue;
    const list = groups.get(record.filePath) || [];
    list.push(record);
    groups.set(record.filePath, list);
  }
  const result: DuplicateGroup[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const canonical = chooseCanonical(group);
    result.push({
      reason: 'same_path',
      canonical,
      removed: group.filter((r) => r.id !== canonical.id),
    });
  }
  return result;
}

/** Groups rows whose storage object has identical content (etag + size). */
export function groupIdenticalFiles(records: LibraryMaterialRecord[]): DuplicateGroup[] {
  const groups = new Map<string, LibraryMaterialRecord[]>();
  for (const record of records) {
    if (!record.etag || record.fileSize == null) continue;
    const key = `${record.etag}|${record.fileSize}`;
    const list = groups.get(key) || [];
    list.push(record);
    groups.set(key, list);
  }
  const result: DuplicateGroup[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const canonical = chooseCanonical(group);
    result.push({
      reason: 'identical_file',
      canonical,
      removed: group.filter((r) => r.id !== canonical.id),
    });
  }
  return result;
}

export interface NearDuplicateGroup {
  courseCode: string | null;
  records: LibraryMaterialRecord[];
  maxSimilarity: number;
}

/**
 * Flag rows in the same course whose normalized titles are near-identical but
 * whose files we could not confirm as full duplicates. These are surfaced for
 * manual review (never auto-consolidated, because title similarity alone is
 * not proof of duplicated content).
 */
export function flagNearDuplicates(
  records: LibraryMaterialRecord[],
  threshold = 0.9
): NearDuplicateGroup[] {
  const byCourse = new Map<string, LibraryMaterialRecord[]>();
  for (const record of records) {
    if (!record.courseCode) continue;
    const list = byCourse.get(record.courseCode) || [];
    list.push(record);
    byCourse.set(record.courseCode, list);
  }

  const result: NearDuplicateGroup[] = [];
  for (const [courseCode, list] of byCourse) {
    const used = new Set<number>();
    for (let i = 0; i < list.length; i += 1) {
      if (used.has(i)) continue;
      const cluster = [list[i]];
      let maxSimilarity = 0;
      for (let j = i + 1; j < list.length; j += 1) {
        if (used.has(j)) continue;
        const score = titleSimilarity(list[i].title, list[j].title);
        if (score >= threshold) {
          cluster.push(list[j]);
          maxSimilarity = Math.max(maxSimilarity, score);
          used.add(j);
        }
      }
      if (cluster.length >= 2) {
        cluster.forEach((_, idx) => used.add(idx));
        result.push({ courseCode, records: cluster, maxSimilarity });
      }
    }
  }
  return result;
}

/**
 * Full auto-consolidation plan: exact duplicates (safe to merge automatically)
 * and near-duplicate clusters (require a human decision).
 */
export function buildConsolidationPlan(records: LibraryMaterialRecord[]): {
  exact: DuplicateGroup[];
  near: NearDuplicateGroup[];
} {
  const samePath = new Map<string, DuplicateGroup>();
  for (const group of groupSamePath(records)) samePath.set(group.canonical.filePath!, group);

  const exact: DuplicateGroup[] = [];
  const seenCanonical = new Set<string>();
  for (const group of [...groupIdenticalFiles(records), ...samePath.values()]) {
    if (seenCanonical.has(group.canonical.id)) continue;
    seenCanonical.add(group.canonical.id);
    exact.push(group);
  }

  const near = flagNearDuplicates(records);
  return { exact, near };
}