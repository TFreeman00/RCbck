/**
 * Computes the cosine similarity between two numeric vectors.
 *
 * Returns a value in [-1, 1] where 1 means identical direction.
 * Returns 0 if either vector has zero magnitude.
 *
 * @param vecA - First numeric array
 * @param vecB - Second numeric array (must be the same length as vecA)
 */
export function computeCosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error(
      `Vector length mismatch: ${vecA.length} vs ${vecB.length}`,
    );
  }

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    magA += vecA[i] * vecA[i];
    magB += vecB[i] * vecB[i];
  }

  magA = Math.sqrt(magA);
  magB = Math.sqrt(magB);

  if (magA === 0 || magB === 0) {
    return 0;
  }

  return dot / (magA * magB);
}
