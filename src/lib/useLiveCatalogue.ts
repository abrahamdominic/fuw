// Hook that merges the live database course catalogue into the static
// structure. Lets admin/faculty/department/course views show administrator-
// published courses immediately.
import { useEffect, useState } from 'react';
import { catalogue, type Faculty } from '../data/catalogue';
import { getLiveCourseRows, mergeDbCourses, type LiveCourseRow } from './liveCatalogue';

export function useLiveCatalogue(refreshToken?: number): { catalogue: Faculty[]; ready: boolean } {
  const [rows, setRows] = useState<LiveCourseRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getLiveCourseRows()
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  return {
    catalogue: rows ? mergeDbCourses(catalogue, rows) : catalogue,
    ready: rows !== null
  };
}