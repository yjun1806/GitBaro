export interface FuzzyResult {
  matched: boolean;
  indices: number[];
  score: number;
}

/**
 * Subsequence-based fuzzy match.
 * Returns matched indices and a score (lower = better match).
 */
export function fuzzyMatch(query: string, text: string): FuzzyResult {
  if (query.length === 0) return { matched: true, indices: [], score: 0 };

  const lowerQuery = query.toLowerCase();
  const lowerText = text.toLowerCase();
  const indices: number[] = [];
  let qi = 0;

  for (let ti = 0; ti < lowerText.length && qi < lowerQuery.length; ti++) {
    if (lowerText[ti] === lowerQuery[qi]) {
      indices.push(ti);
      qi++;
    }
  }

  if (qi < lowerQuery.length) {
    return { matched: false, indices: [], score: Infinity };
  }

  // Score: prefer consecutive matches, early matches, and exact prefix
  let score = 0;
  for (let i = 0; i < indices.length; i++) {
    score += indices[i]; // earlier = better
    if (i > 0 && indices[i] !== indices[i - 1] + 1) {
      score += 5; // penalty for gaps
    }
  }

  // Bonus for prefix match
  if (indices[0] === 0) {
    score -= 10;
  }

  return { matched: true, indices, score };
}

/**
 * Filter and sort items by fuzzy match quality.
 */
export function fuzzyFilter<T>(
  items: T[],
  query: string,
  getText: (item: T) => string,
): T[] {
  if (query.length === 0) return items;

  const results: { item: T; score: number }[] = [];
  for (const item of items) {
    const result = fuzzyMatch(query, getText(item));
    if (result.matched) {
      results.push({ item, score: result.score });
    }
  }

  results.sort((a, b) => a.score - b.score);
  return results.map((r) => r.item);
}
