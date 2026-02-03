/**
 * Embedding generation using Workers AI
 */

const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
const MAX_TOKENS = 512; // Approximate token limit for the model

/**
 * Generate embedding for a single text
 */
export async function generateEmbedding(
  ai: Ai,
  text: string
): Promise<number[]> {
  // Truncate if too long (simple approach - in production use proper tokenization)
  const truncatedText = text.slice(0, MAX_TOKENS * 4); // ~4 chars per token

  const result = await ai.run(EMBEDDING_MODEL, {
    text: [truncatedText],
  });

  return result.data[0];
}

/**
 * Generate embeddings for multiple texts
 */
export async function generateEmbeddings(
  ai: Ai,
  texts: string[]
): Promise<number[][]> {
  // Process in batches of 100
  const batchSize = 100;
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize).map((t) =>
      t.slice(0, MAX_TOKENS * 4)
    );

    const result = await ai.run(EMBEDDING_MODEL, {
      text: batch,
    });

    allEmbeddings.push(...result.data);
  }

  return allEmbeddings;
}

/**
 * Chunk a long document into smaller pieces
 */
export function chunkText(
  text: string,
  chunkSize = 500,
  overlap = 50
): string[] {
  const chunks: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);

  let currentChunk = "";

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > chunkSize && currentChunk) {
      chunks.push(currentChunk.trim());

      // Keep overlap from previous chunk
      const words = currentChunk.split(" ");
      const overlapWords = words.slice(-Math.floor(overlap / 5));
      currentChunk = overlapWords.join(" ") + " " + sentence;
    } else {
      currentChunk += (currentChunk ? " " : "") + sentence;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Vectors must have the same length");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
