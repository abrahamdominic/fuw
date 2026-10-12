import { describe, it, expect } from 'vitest';
import {
  chooseCanonical,
  flagNearDuplicates,
  groupIdenticalFiles,
  groupSamePath,
  isIdenticalFile,
  normalizeTitle,
  titleSimilarity,
  type LibraryMaterialRecord,
} from '../lib/libraryDedup';

function makeMaterial(partial: Partial<LibraryMaterialRecord> & Pick<LibraryMaterialRecord, 'id'>): LibraryMaterialRecord {
  return {
    title: 'Untitled',
    courseCode: null,
    courseTitle: null,
    filePath: null,
    fileSize: null,
    etag: null,
    downloads: 0,
    views: 0,
    isApproved: true,
    ...partial,
  };
}

describe('libraryDedup — title normalization & similarity', () => {
  it('normalizes titles by lowercasing, trimming punctuation and dropping filler words', () => {
    expect(normalizeTitle('  PHY 102 STUDY QUESTIONS 2024 new ')).toBe('phy 102 study questions new');
    expect(normalizeTitle('Phy102 magnetic field  ')).toBe('phy102 magnetic field');
  });

  it('identical titles have similarity 1 and disjoint titles have similarity 0', () => {
    expect(titleSimilarity('Phy102 magnetic field', 'Phy102 magnetic field')).toBe(1);
    expect(titleSimilarity('Electricity', 'Photosynthesis')).toBe(0);
  });

  it('titles that differ only by punctuation/order score at least 0.9 (the manual-review threshold)', () => {
    expect(titleSimilarity('phy102 · magnetic field!!', 'Phy102 Magnetic Field')).toBe(1);
    expect(titleSimilarity('Magnetic field Phy102', 'Phy102 magnetic field')).toBe(1);
  });
});

describe('libraryDedup — file identity & canonical choice', () => {
  it('files are identical only when etag and byte size both agree', () => {
    const a = makeMaterial({ id: 'a', etag: 'abc', fileSize: 100 });
    const b = makeMaterial({ id: 'b', etag: 'abc', fileSize: 100 });
    const c = makeMaterial({ id: 'c', etag: 'abc', fileSize: 200 });
    const d = makeMaterial({ id: 'd', etag: null, fileSize: 100 });
    expect(isIdenticalFile(a, b)).toBe(true);
    expect(isIdenticalFile(a, c)).toBe(false);
    expect(isIdenticalFile(a, d)).toBe(false);
  });

  it('the canonical material is the one with the most downloads + views', () => {
    const low = makeMaterial({ id: 'low', downloads: 1, views: 0 });
    const high = makeMaterial({ id: 'high', downloads: 5, views: 9 });
    expect(chooseCanonical([low, high]).id).toBe('high');
  });

  it('groups rows that share one storage path and picks one canonical', () => {
    const groups = groupSamePath([
      makeMaterial({ id: 'a', filePath: 'x.pdf', downloads: 3 }),
      makeMaterial({ id: 'b', filePath: 'x.pdf', downloads: 8 }),
      makeMaterial({ id: 'c', filePath: 'y.pdf', downloads: 1 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].canonical.id).toBe('b');
    expect(groups[0].removed.map((r) => r.id)).toEqual(['a']);
  });

  it('groups files with identical content (etag + size) even under different paths', () => {
    const groups = groupIdenticalFiles([
      makeMaterial({ id: 'a', etag: 'h1', fileSize: 10, filePath: 'p1.pdf' }),
      makeMaterial({ id: 'b', etag: 'h1', fileSize: 10, filePath: 'p2.pdf' }),
      makeMaterial({ id: 'c', etag: 'h2', fileSize: 10, filePath: 'p3.pdf' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].canonical.id).toBe('a');
    expect(groups[0].removed.map((r) => r.id)).toEqual(['b']);
  });

  it('flags near-duplicate titles within the same course for manual review', () => {
    const clusters = flagNearDuplicates([
      makeMaterial({ id: 'a', courseCode: 'PHY102C', title: 'Phy102 magnetic field' }),
      makeMaterial({ id: 'b', courseCode: 'PHY102C', title: 'phy102 · magnetic field!!' }),
      makeMaterial({ id: 'c', courseCode: 'PHY102C', title: 'PHY 102 STUDY QUESTIONS 2024' }),
    ], 0.8);
    // a and b normalize to the same token set and cluster together; c does not.
    expect(clusters).toHaveLength(1);
    expect(clusters[0].records.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('does not flag similar titles in different courses', () => {
    const clusters = flagNearDuplicates([
      makeMaterial({ id: 'a', courseCode: 'PHY102C', title: 'Phy102 magnetic field' }),
      makeMaterial({ id: 'b', courseCode: 'CHM102C', title: 'phy 102 . magnetic field' }),
    ], 0.9);
    expect(clusters).toHaveLength(0);
  });
});