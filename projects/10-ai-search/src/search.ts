/**
 * Semantic search implementation
 */

import { generateEmbedding } from "./embeddings";

interface Env {
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  DB: D1Database;
}

interface SearchOptions {
  limit?: number;
  filter?: {
    category?: string;
  };
}

interface SearchResult {
  id: string;
  title: string;
  content: string;
  category?: string;
  score: number;
}

export async function searchDocuments(
  env: Env,
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const { limit = 10, filter } = options;

  // Generate embedding for the query
  const queryEmbedding = await generateEmbedding(env.AI, query);

  // Build Vectorize filter
  const vectorFilter: VectorizeVectorMetadataFilter | undefined = filter?.category
    ? { category: filter.category }
    : undefined;

  // Query Vectorize
  const vectorResults = await env.VECTORIZE.query(queryEmbedding, {
    topK: limit,
    filter: vectorFilter,
    returnMetadata: true,
    returnValues: false,
  });

  if (!vectorResults.matches || vectorResults.matches.length === 0) {
    return [];
  }

  // Get full documents from D1
  const docIds = vectorResults.matches.map((m) => m.id);
  const placeholders = docIds.map(() => "?").join(",");

  const { results } = await env.DB.prepare(
    `SELECT id, title, content, category FROM documents WHERE id IN (${placeholders})`
  )
    .bind(...docIds)
    .all<{ id: string; title: string; content: string; category: string }>();

  // Combine with scores
  const docMap = new Map(results?.map((d) => [d.id, d]) || []);

  return vectorResults.matches
    .map((match) => {
      const doc = docMap.get(match.id);
      if (!doc) return null;

      return {
        id: doc.id,
        title: doc.title,
        content: doc.content,
        category: doc.category,
        score: match.score,
      };
    })
    .filter((r): r is SearchResult => r !== null);
}

/**
 * Hybrid search combining semantic and keyword search
 */
export async function hybridSearch(
  env: Env,
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const { limit = 10, filter } = options;

  // Semantic search
  const semanticResults = await searchDocuments(env, query, {
    limit: limit * 2,
    filter,
  });

  // Keyword search (simple LIKE matching)
  const keywords = query.toLowerCase().split(/\s+/).filter((k) => k.length > 2);

  if (keywords.length === 0) {
    return semanticResults.slice(0, limit);
  }

  const likeConditions = keywords
    .map(() => "(LOWER(title) LIKE ? OR LOWER(content) LIKE ?)")
    .join(" OR ");

  const likeParams = keywords.flatMap((k) => [`%${k}%`, `%${k}%`]);

  let query_sql = `SELECT id, title, content, category FROM documents WHERE ${likeConditions}`;
  if (filter?.category) {
    query_sql += " AND category = ?";
    likeParams.push(filter.category);
  }
  query_sql += ` LIMIT ${limit * 2}`;

  const { results: keywordResults } = await env.DB.prepare(query_sql)
    .bind(...likeParams)
    .all<{ id: string; title: string; content: string; category: string }>();

  // Combine and deduplicate
  const resultMap = new Map<string, SearchResult>();

  // Add semantic results with score boost
  for (const result of semanticResults) {
    resultMap.set(result.id, {
      ...result,
      score: result.score * 0.7, // Weight for semantic
    });
  }

  // Add/boost keyword results
  for (const doc of keywordResults || []) {
    const existing = resultMap.get(doc.id);
    if (existing) {
      // Boost score if found in both
      existing.score += 0.3;
    } else {
      resultMap.set(doc.id, {
        ...doc,
        score: 0.3, // Base score for keyword match
      });
    }
  }

  // Sort by combined score and limit
  return Array.from(resultMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
