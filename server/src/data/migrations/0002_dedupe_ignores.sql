-- 0002: 跨组重复的「忽略提示」记忆 + 跨组查重索引
-- 规则（v1.6）：同组重复静默去重；跨组重复需要用户确认，用户选择「忽略」后同一 URL 到同一分组不再提示

CREATE INDEX IF NOT EXISTS idx_links_normalized ON links(url_normalized);

CREATE TABLE IF NOT EXISTS dedupe_ignores (
  url_normalized TEXT    NOT NULL,
  group_id       INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (url_normalized, group_id)
);
