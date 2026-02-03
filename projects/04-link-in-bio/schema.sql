-- Link in Bio Database Schema

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  bio TEXT,
  avatar_url TEXT,
  theme TEXT DEFAULT 'default',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Links table
CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  icon TEXT,
  position INTEGER DEFAULT 0,
  enabled INTEGER DEFAULT 1,
  clicks INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Analytics events table
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  link_id TEXT,
  event_type TEXT NOT NULL, -- 'page_view', 'link_click'
  ip_hash TEXT,
  country TEXT,
  user_agent TEXT,
  referer TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE SET NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_links_user ON links(user_id);
CREATE INDEX IF NOT EXISTS idx_links_position ON links(user_id, position);
CREATE INDEX IF NOT EXISTS idx_events_user_date ON events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_link ON events(link_id);

-- Sample data for testing
INSERT OR IGNORE INTO users (id, username, display_name, bio, avatar_url, theme)
VALUES (
  'user_demo',
  'demo',
  'Demo User',
  'This is a demo profile. Click the links below!',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=demo',
  'gradient'
);

INSERT OR IGNORE INTO links (id, user_id, title, url, icon, position, enabled)
VALUES
  ('link_1', 'user_demo', 'Personal Website', 'https://example.com', '🌐', 1, 1),
  ('link_2', 'user_demo', 'GitHub', 'https://github.com', '💻', 2, 1),
  ('link_3', 'user_demo', 'Twitter', 'https://twitter.com', '🐦', 3, 1),
  ('link_4', 'user_demo', 'LinkedIn', 'https://linkedin.com', '💼', 4, 1),
  ('link_5', 'user_demo', 'Email Me', 'mailto:demo@example.com', '📧', 5, 1);
