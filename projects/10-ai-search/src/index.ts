/**
 * 10 - AI Search
 *
 * An AI-powered semantic search engine with:
 * - Workers AI for embeddings
 * - Vectorize for vector storage
 * - RAG for question answering
 */

import { generateEmbedding, generateEmbeddings } from "./embeddings";
import { searchDocuments } from "./search";
import { askQuestion } from "./rag";

export interface Env {
  DB: D1Database;
  AI: Ai;
  VECTORIZE: VectorizeIndex;
}

interface Document {
  id: string;
  title: string;
  content: string;
  category?: string;
  tags?: string;
  url?: string;
  metadata?: string;
  indexed_at: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function generateId(): string {
  return `doc_${crypto.randomUUID().slice(0, 12)}`;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // ============================================
      // Document Management
      // ============================================

      // POST /documents - Index a document
      if (pathname === "/documents" && request.method === "POST") {
        const body = (await request.json()) as {
          id?: string;
          title: string;
          content: string;
          category?: string;
          tags?: string[];
          url?: string;
          metadata?: Record<string, unknown>;
        };

        if (!body.title || !body.content) {
          return Response.json(
            { error: "title and content are required" },
            { status: 400, headers: corsHeaders }
          );
        }

        const docId = body.id || generateId();

        // Generate embedding for the document
        const textToEmbed = `${body.title}\n\n${body.content}`;
        const embedding = await generateEmbedding(env.AI, textToEmbed);

        // Store in D1
        await env.DB.prepare(
          `INSERT OR REPLACE INTO documents (id, title, content, category, tags, url, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            docId,
            body.title,
            body.content,
            body.category || null,
            body.tags ? JSON.stringify(body.tags) : null,
            body.url || null,
            body.metadata ? JSON.stringify(body.metadata) : null
          )
          .run();

        // Store in Vectorize
        await env.VECTORIZE.upsert([
          {
            id: docId,
            values: embedding,
            metadata: {
              title: body.title,
              category: body.category || "",
              content: body.content.slice(0, 500), // Store preview
            },
          },
        ]);

        return Response.json(
          {
            id: docId,
            title: body.title,
            message: "Document indexed successfully",
          },
          { status: 201, headers: corsHeaders }
        );
      }

      // GET /documents - List documents
      if (pathname === "/documents" && request.method === "GET") {
        const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);
        const category = url.searchParams.get("category");

        let query = "SELECT id, title, category, tags, indexed_at FROM documents";
        const params: (string | number)[] = [];

        if (category) {
          query += " WHERE category = ?";
          params.push(category);
        }

        query += " ORDER BY indexed_at DESC LIMIT ?";
        params.push(limit);

        const { results } = await env.DB.prepare(query).bind(...params).all<Document>();

        const documents = (results || []).map((doc) => ({
          ...doc,
          tags: doc.tags ? JSON.parse(doc.tags) : [],
        }));

        return Response.json({ documents }, { headers: corsHeaders });
      }

      // GET /documents/:id - Get document
      if (pathname.match(/^\/documents\/[\w_-]+$/) && request.method === "GET") {
        const docId = pathname.split("/")[2];

        const doc = await env.DB.prepare("SELECT * FROM documents WHERE id = ?")
          .bind(docId)
          .first<Document>();

        if (!doc) {
          return Response.json(
            { error: "Document not found" },
            { status: 404, headers: corsHeaders }
          );
        }

        return Response.json(
          {
            ...doc,
            tags: doc.tags ? JSON.parse(doc.tags) : [],
            metadata: doc.metadata ? JSON.parse(doc.metadata) : null,
          },
          { headers: corsHeaders }
        );
      }

      // DELETE /documents/:id - Delete document
      if (pathname.match(/^\/documents\/[\w_-]+$/) && request.method === "DELETE") {
        const docId = pathname.split("/")[2];

        // Delete from D1
        await env.DB.prepare("DELETE FROM documents WHERE id = ?")
          .bind(docId)
          .run();

        // Delete from Vectorize
        await env.VECTORIZE.deleteByIds([docId]);

        return Response.json(
          { message: "Document deleted", id: docId },
          { headers: corsHeaders }
        );
      }

      // ============================================
      // Search
      // ============================================

      // POST /search - Semantic search
      if (pathname === "/search" && request.method === "POST") {
        const body = (await request.json()) as {
          query: string;
          limit?: number;
          filter?: { category?: string };
        };

        if (!body.query) {
          return Response.json(
            { error: "query is required" },
            { status: 400, headers: corsHeaders }
          );
        }

        const startTime = Date.now();
        const results = await searchDocuments(env, body.query, {
          limit: body.limit || 10,
          filter: body.filter,
        });
        const latencyMs = Date.now() - startTime;

        // Log search (fire-and-forget)
        ctx.waitUntil(
          env.DB.prepare(
            `INSERT INTO search_history (id, query, results_count, top_result_id, top_result_score, latency_ms)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
            .bind(
              `srch_${crypto.randomUUID().slice(0, 8)}`,
              body.query,
              results.length,
              results[0]?.id || null,
              results[0]?.score || null,
              latencyMs
            )
            .run()
        );

        return Response.json(
          {
            query: body.query,
            results,
            count: results.length,
            latencyMs,
          },
          { headers: corsHeaders }
        );
      }

      // ============================================
      // RAG (Question Answering)
      // ============================================

      // POST /ask - Ask a question
      if (pathname === "/ask" && request.method === "POST") {
        const body = (await request.json()) as {
          question: string;
          maxSources?: number;
        };

        if (!body.question) {
          return Response.json(
            { error: "question is required" },
            { status: 400, headers: corsHeaders }
          );
        }

        const startTime = Date.now();
        const result = await askQuestion(env, body.question, {
          maxSources: body.maxSources || 5,
        });
        const latencyMs = Date.now() - startTime;

        return Response.json(
          {
            question: body.question,
            answer: result.answer,
            sources: result.sources,
            latencyMs,
          },
          { headers: corsHeaders }
        );
      }

      // ============================================
      // Bulk Operations
      // ============================================

      // POST /documents/bulk - Bulk index documents
      if (pathname === "/documents/bulk" && request.method === "POST") {
        const body = (await request.json()) as Array<{
          id?: string;
          title: string;
          content: string;
          category?: string;
          tags?: string[];
        }>;

        if (!Array.isArray(body) || body.length === 0) {
          return Response.json(
            { error: "Request body must be a non-empty array" },
            { status: 400, headers: corsHeaders }
          );
        }

        // Limit batch size
        const documents = body.slice(0, 100);

        // Generate embeddings in batch
        const textsToEmbed = documents.map((d) => `${d.title}\n\n${d.content}`);
        const embeddings = await generateEmbeddings(env.AI, textsToEmbed);

        // Prepare data
        const vectorRecords: VectorizeVector[] = [];
        const dbInserts: Promise<D1Result>[] = [];

        for (let i = 0; i < documents.length; i++) {
          const doc = documents[i];
          const docId = doc.id || generateId();

          vectorRecords.push({
            id: docId,
            values: embeddings[i],
            metadata: {
              title: doc.title,
              category: doc.category || "",
              content: doc.content.slice(0, 500),
            },
          });

          dbInserts.push(
            env.DB.prepare(
              `INSERT OR REPLACE INTO documents (id, title, content, category, tags)
               VALUES (?, ?, ?, ?, ?)`
            )
              .bind(
                docId,
                doc.title,
                doc.content,
                doc.category || null,
                doc.tags ? JSON.stringify(doc.tags) : null
              )
              .run()
          );
        }

        // Execute in parallel
        await Promise.all([
          env.VECTORIZE.upsert(vectorRecords),
          Promise.all(dbInserts),
        ]);

        return Response.json(
          {
            message: "Documents indexed",
            count: documents.length,
          },
          { status: 201, headers: corsHeaders }
        );
      }

      // ============================================
      // Home / Documentation
      // ============================================

      if (pathname === "/" && request.method === "GET") {
        return Response.json(
          {
            name: "AI Search",
            version: "1.0.0",
            endpoints: {
              "POST /documents": "Index a document",
              "GET /documents": "List documents",
              "GET /documents/:id": "Get document",
              "DELETE /documents/:id": "Delete document",
              "POST /documents/bulk": "Bulk index documents",
              "POST /search": "Semantic search",
              "POST /ask": "Ask a question (RAG)",
            },
            models: {
              embedding: "@cf/baai/bge-base-en-v1.5",
              generation: "@cf/meta/llama-2-7b-chat-int8",
            },
          },
          { headers: corsHeaders }
        );
      }

      return Response.json(
        { error: "Not Found" },
        { status: 404, headers: corsHeaders }
      );
    } catch (error) {
      console.error("Error:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      return Response.json(
        { error: "Internal Server Error", message },
        { status: 500, headers: corsHeaders }
      );
    }
  },
};
