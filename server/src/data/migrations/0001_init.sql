-- 0001_init: 核心六表（groups / links / settings / extensions / backups / sessions）
-- 时间统一 UTC ISO8601；groups.name_key 与 links(group_id,url_normalized) 是「自动合并 / 去重」的落地约束

CREATE TABLE IF NOT EXISTS groups (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  name_key     TEXT    NOT NULL UNIQUE,
  icon         TEXT,
  type         TEXT    NOT NULL DEFAULT 'fixed' CHECK (type IN ('fixed','tab')),
  display_mode TEXT    NOT NULL DEFAULT 'grid',
  layout_mode  TEXT    NOT NULL DEFAULT 'auto',
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_groups_order ON groups(sort_order, id);

CREATE TABLE IF NOT EXISTS links (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id       INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  title          TEXT    NOT NULL,
  url            TEXT    NOT NULL,
  url_normalized TEXT    NOT NULL,
  description    TEXT,
  icon           TEXT,
  icon_type      TEXT    NOT NULL DEFAULT 'auto' CHECK (icon_type IN ('auto','emoji','url','none')),
  sort_order     INTEGER NOT NULL DEFAULT 0,
  sync_state     TEXT    NOT NULL DEFAULT 'synced' CHECK (sync_state IN ('pending','synced','failed')),
  synced_at      TEXT,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_links_group_url ON links(group_id, url_normalized);
CREATE INDEX IF NOT EXISTS idx_links_order ON links(group_id, sort_order, id);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS extensions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ext_id     TEXT NOT NULL,
  name       TEXT NOT NULL,
  version    TEXT NOT NULL DEFAULT '',
  url        TEXT,
  browser    TEXT NOT NULL CHECK (browser IN ('firefox','chrome','edge','other')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (ext_id, browser)
);

CREATE TABLE IF NOT EXISTS backups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL CHECK (kind IN ('auto','manual','import')),
  location   TEXT NOT NULL,
  size       INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','failed')),
  error      TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT PRIMARY KEY,
  device       TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
