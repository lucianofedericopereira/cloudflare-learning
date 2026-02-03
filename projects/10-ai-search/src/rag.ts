/**
 * RAG (Retrieval Augmented Generation) implementation
 */

import { generateEmbedding } from "./embeddings";

interface Env {
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  DB: D1Database;
}

interface RAGOptions {
  maxSources?: number;
  maxContextLength?: number;
}

interface RAGResult {
  answer: string;
  sources: Array<{
    id: string;
    title: string;
    relevance: number;
  }>;
}

const GENERATION_MODEL = "@cf/meta/llama-2-7b-chat-int8";

export async function askQuestion(
  env: Env,
  question: string,
  options: RAGOptions = {}
): Promise<RAGResult> {
  const { maxSources = 5, maxContextLength = 2000 } = options;

  // 1. Generate embedding for the question
  const questionEmbedding = await generateEmbedding(env.AI, question);

  // 2. Find relevant documents
  const vectorResults = await env.VECTORIZE.query(questionEmbedding, {
    topK: maxSources,
    returnMetadata: true,
    returnValues: false,
  });

  if (!vectorResults.matches || vectorResults.matches.length === 0) {
    // No relevant documents found
    const response = await env.AI.run(GENERATION_MODEL, {
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant. If you don't have enough information to answer, say so.",
        },
        { role: "user", content: question },
      ],
    });

    return {
      answer:
        (response as { response: string }).response ||
        "I don't have enough information to answer that question.",
      sources: [],
    };
  }

  // 3. Get full document content from D1
  const docIds = vectorResults.matches.map((m) => m.id);
  const placeholders = docIds.map(() => "?").join(",");

  const { results } = await env.DB.prepare(
    `SELECT id, title, content FROM documents WHERE id IN (${placeholders})`
  )
    .bind(...docIds)
    .all<{ id: string; title: string; content: string }>();

  const docMap = new Map(results?.map((d) => [d.id, d]) || []);

  // 4. Build context from retrieved documents
  let context = "";
  const sources: RAGResult["sources"] = [];

  for (const match of vectorResults.matches) {
    const doc = docMap.get(match.id);
    if (!doc) continue;

    // Check if we have room for more context
    const docContext = `### ${doc.title}\n${doc.content}\n\n`;
    if ((context + docContext).length > maxContextLength) {
      // Truncate if needed
      const remaining = maxContextLength - context.length;
      if (remaining > 100) {
        context += docContext.slice(0, remaining) + "...";
      }
      break;
    }

    context += docContext;
    sources.push({
      id: doc.id,
      title: doc.title,
      relevance: match.score,
    });
  }

  // 5. Generate answer with context
  const systemPrompt = `You are a helpful assistant that answers questions based on the provided context.
Use only the information from the context to answer. If the context doesn't contain enough information, say so.
Be concise and accurate.

Context:
${context}`;

  const response = await env.AI.run(GENERATION_MODEL, {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: question },
    ],
    max_tokens: 500,
  });

  return {
    answer:
      (response as { response: string }).response ||
      "I couldn't generate an answer.",
    sources,
  };
}

/**
 * Stream RAG response (for real-time UI updates)
 */
export async function* askQuestionStream(
  env: Env,
  question: string,
  options: RAGOptions = {}
): AsyncGenerator<string> {
  const { maxSources = 5, maxContextLength = 2000 } = options;

  // 1-4. Same as above...
  const questionEmbedding = await generateEmbedding(env.AI, question);

  const vectorResults = await env.VECTORIZE.query(questionEmbedding, {
    topK: maxSources,
    returnMetadata: true,
    returnValues: false,
  });

  if (!vectorResults.matches || vectorResults.matches.length === 0) {
    yield "I don't have enough information to answer that question.";
    return;
  }

  const docIds = vectorResults.matches.map((m) => m.id);
  const placeholders = docIds.map(() => "?").join(",");

  const { results } = await env.DB.prepare(
    `SELECT id, title, content FROM documents WHERE id IN (${placeholders})`
  )
    .bind(...docIds)
    .all<{ id: string; title: string; content: string }>();

  const docMap = new Map(results?.map((d) => [d.id, d]) || []);

  let context = "";
  for (const match of vectorResults.matches) {
    const doc = docMap.get(match.id);
    if (!doc) continue;

    const docContext = `### ${doc.title}\n${doc.content}\n\n`;
    if ((context + docContext).length > maxContextLength) break;
    context += docContext;
  }

  // 5. Stream the response
  const systemPrompt = `You are a helpful assistant that answers questions based on the provided context.
Use only the information from the context to answer. If the context doesn't contain enough information, say so.

Context:
${context}`;

  const stream = await env.AI.run(GENERATION_MODEL, {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: question },
    ],
    stream: true,
  });

  // Type assertion for streaming response
  const reader = (stream as ReadableStream).getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    yield decoder.decode(value);
  }
}
