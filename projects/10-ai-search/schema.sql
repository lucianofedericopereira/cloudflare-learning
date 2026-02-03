-- AI Search Database Schema

-- Documents table (stores original content)
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT,
  tags TEXT,  -- JSON array
  url TEXT,
  metadata TEXT,  -- JSON
  indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Chunks table (for long documents split into chunks)
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  content TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  token_count INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

-- Search history (for analytics)
CREATE TABLE IF NOT EXISTS search_history (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  results_count INTEGER,
  top_result_id TEXT,
  top_result_score REAL,
  latency_ms INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category);
CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_search_created ON search_history(created_at);

-- Sample documents
INSERT OR IGNORE INTO documents (id, title, content, category, tags)
VALUES
  (
    'doc_workers',
    'Introduction to Cloudflare Workers',
    'Cloudflare Workers is a serverless execution environment that allows you to create new applications or augment existing ones without configuring or maintaining infrastructure. Workers run on Cloudflare''s global network in over 300 cities worldwide, providing low latency and high performance.',
    'tech',
    '["cloudflare", "workers", "serverless"]'
  ),
  (
    'doc_ai',
    'Workers AI Overview',
    'Workers AI allows you to run machine learning models directly on Cloudflare''s global network. You can use pre-trained models for tasks like text generation, image classification, and embeddings generation. The models run close to your users for fast inference.',
    'tech',
    '["cloudflare", "ai", "machine-learning"]'
  ),
  (
    'doc_vectorize',
    'Vectorize: Vector Database',
    'Vectorize is Cloudflare''s vector database for storing and querying high-dimensional vectors. It''s perfect for building semantic search, recommendation systems, and RAG applications. Vectorize integrates seamlessly with Workers AI for generating embeddings.',
    'tech',
    '["cloudflare", "vectorize", "vector-database"]'
  );
