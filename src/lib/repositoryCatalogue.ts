// Repository catalogue helpers: flatten faculties/departments from the
// canonical FUW course catalogue for the research repository forms.
import { catalogue } from '../data/catalogue';

export interface RepoFaculty {
  name: string;
  departments: { name: string; id: string }[];
}

/** All faculties with their departments (id + name) for the repository dropdowns. */
export function repositoryFaculties(): RepoFaculty[] {
  return catalogue.map((f) => ({
    name: f.name,
    departments: f.departments.map((d) => ({ name: d.name, id: d.name }))
  }));
}

/** Flat list of {id, name} departments for repository filters. */
export function getAllDepartmentsForRepository(): { id: string; name: string }[] {
  const seen = new Set<string>();
  const out: { id: string; name: string }[] = [];
  for (const f of catalogue) {
    for (const d of f.departments) {
      if (!seen.has(d.name)) {
        seen.add(d.name);
        out.push({ id: d.name, name: d.name });
      }
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}