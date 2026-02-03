# 10 - AI Search

An AI-powered semantic search engine using Workers AI, Vectorize, and D1.

## Learning Objectives

- Workers AI for generating embeddings
- Vectorize for vector storage and similarity search
- RAG (Retrieval Augmented Generation) patterns
- Semantic search implementation

## Concepts

### Workers AI

Workers AI provides access to ML models at the edge:

```typescript
// Generate embeddings
const embeddings = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
  text: ["Hello world", "How are you?"],
});
// Returns: { data: [[0.123, 0.456, ...], [0.789, ...]] }

// Text generation
const response = await env.AI.run("@cf/meta/llama-2-7b-chat-int8", {
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "What is Cloudflare?" },
  ],
});

// Image classification
const result = await env.AI.run("@cf/microsoft/resnet-50", {
  image: imageArrayBuffer,
});
```

### Vectorize

Vectorize is a vector database for similarity search:

```typescript
// Insert vectors
await env.VECTORIZE.upsert([
  {
    id: "doc_1",
    values: [0.123, 0.456, ...], // 768-dim for bge-base
    metadata: { title: "Document 1", category: "tech" },
  },
]);

// Query similar vectors
const results = await env.VECTORIZE.query(queryVector, {
  topK: 10,
  filter: { category: "tech" }, // Optional metadata filter
  returnMetadata: true,
  returnValues: false,
});
// Returns: { matches: [{ id, score, metadata }] }

// Delete vectors
await env.VECTORIZE.deleteByIds(["doc_1", "doc_2"]);
```

### RAG Pattern

```typescript
async function ragQuery(query: string, env: Env): Promise<string> {
  // 1. Generate embedding for query
  const { data } = await env.AI.run("@cf/baai/bge-base-en-v1.5", {
    text: [query],
  });
  const queryEmbedding = data[0];

  // 2. Find similar documents
  const results = await env.VECTORIZE.query(queryEmbedding, {
    topK: 5,
    returnMetadata: true,
  });

  // 3. Build context from retrieved documents
  const context = results.matches
    .map((m) => m.metadata?.content)
    .join("\n\n");

  // 4. Generate answer with context
  const response = await env.AI.run("@cf/meta/llama-2-7b-chat-int8", {
    messages: [
      {
        role: "system",
        content: `Answer based on this context:\n${context}`,
      },
      { role: "user", content: query },
    ],
  });

  return response.response;
}
```

### Embedding Models

| Model | Dimensions | Use Case |
|-------|------------|----------|
| `@cf/baai/bge-base-en-v1.5` | 768 | General English text |
| `@cf/baai/bge-small-en-v1.5` | 384 | Faster, smaller |
| `@cf/baai/bge-large-en-v1.5` | 1024 | Higher quality |

## API Design

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/documents` | Index a document |
| DELETE | `/documents/:id` | Remove document |
| GET | `/documents` | List documents |
| POST | `/search` | Semantic search |
| POST | `/ask` | RAG query |

### Request Examples

**Index Document:**
```json
POST /documents
{
  "id": "doc_1",
  "title": "Introduction to Cloudflare",
  "content": "Cloudflare is a global network...",
  "category": "tech",
  "tags": ["cloudflare", "cdn", "security"]
}
```

**Search:**
```json
POST /search
{
  "query": "How does CDN caching work?",
  "limit": 10,
  "filter": { "category": "tech" }
}
```

**RAG Query:**
```json
POST /ask
{
  "question": "What are the benefits of edge computing?",
  "maxSources": 5
}
```

## Project Tasks

### Task 1: Document Indexing
- Accept document submissions
- Generate embeddings with Workers AI
- Store in Vectorize

### Task 2: Semantic Search
- Convert query to embedding
- Query Vectorize for similar docs
- Return ranked results

### Task 3: RAG Implementation
- Retrieve relevant documents
- Build context for LLM
- Generate answers

### Task 4: Hybrid Search
- Combine semantic + keyword search
- Re-ranking with cross-encoder
- Metadata filtering

## Commands

```bash
# Create Vectorize index
npx wrangler vectorize create ai-search --dimensions=768 --metric=cosine

# Create D1 database
npx wrangler d1 create ai-search
npx wrangler d1 execute ai-search --file=schema.sql

# Run locally
npm run dev

# Deploy
npm run deploy
```

## File Structure

```
10-ai-search/
├── src/
│   ├── index.ts          # Main router
│   ├── embeddings.ts     # Embedding generation
│   ├── search.ts         # Search logic
│   └── rag.ts            # RAG implementation
├── schema.sql
├── wrangler.toml
├── package.json
├── tsconfig.json
└── README.md
```

## Testing

```bash
# Index a document
curl -X POST http://localhost:8787/documents \
  -H "Content-Type: application/json" \
  -d '{
    "title": "What is Workers AI?",
    "content": "Workers AI allows you to run machine learning models..."
  }'

# Search
curl -X POST http://localhost:8787/search \
  -H "Content-Type: application/json" \
  -d '{"query": "machine learning at the edge"}'

# RAG query
curl -X POST http://localhost:8787/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "How do I use Workers AI for text generation?"}'
```

## Available AI Models

### Text Embedding
- `@cf/baai/bge-base-en-v1.5` - Balanced quality/speed
- `@cf/baai/bge-small-en-v1.5` - Faster, smaller
- `@cf/baai/bge-large-en-v1.5` - Highest quality

### Text Generation
- `@cf/meta/llama-2-7b-chat-int8` - General chat
- `@cf/mistral/mistral-7b-instruct-v0.1` - Instruction following
- `@cf/meta/llama-3-8b-instruct` - Latest Llama

### Other Models
- `@cf/openai/whisper` - Speech to text
- `@cf/huggingface/distilbert-sst-2-int8` - Sentiment analysis
- `@cf/microsoft/resnet-50` - Image classification

## Key Takeaways

1. Workers AI runs models directly at the edge - no external API calls
2. Vectorize handles high-dimensional vector similarity search
3. RAG combines retrieval + generation for accurate answers
4. Chunk long documents for better embedding quality
5. Use metadata filters to narrow search scope
