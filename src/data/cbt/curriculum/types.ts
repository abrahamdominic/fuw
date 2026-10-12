export interface CuratedQuestion {
  /** Unique within the course; 1..120. Used to build the dedupe_key. */
  n: number;
  /** The question stem. Always a complete sentence ending in '?' */
  q: string;
  /** Exactly 4 options. */
  o: [string, string, string, string];
  /** Index (0-3) of the correct option inside `o`. */
  c: 0 | 1 | 2 | 3;
  /** Topic / learning objective label, e.g. 'Cell Division'. */
  t: string;
  /** Short verified academic explanation (1-3 sentences). */
  e: string;
  /** Difficulty band. */
  d: 'easy' | 'medium' | 'hard';
}