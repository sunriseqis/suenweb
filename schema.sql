-- SuenWeb Cloudflare D1 / SQLite Database Schema

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS groups_table (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    icon         TEXT DEFAULT '',
    type         TEXT DEFAULT 'tab',
    display_mode TEXT DEFAULT 'compact',
    layout_mode  TEXT DEFAULT 'single',
    sort_order   INTEGER DEFAULT 0,
    is_imported  INTEGER DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS links (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id          INTEGER NOT NULL,
    title             TEXT NOT NULL,
    url               TEXT NOT NULL,
    description       TEXT DEFAULT '',
    icon              TEXT DEFAULT '',
    icon_type         TEXT DEFAULT 'auto',
    sort_order        INTEGER DEFAULT 0,
    is_imported       INTEGER DEFAULT 0,
    synced_to_browser INTEGER DEFAULT 1,
    created_at        TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (group_id) REFERENCES groups_table(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sync_state (
    id             INTEGER PRIMARY KEY DEFAULT 1,
    last_sync_at   TEXT,
    last_sync_from TEXT
);

CREATE TABLE IF NOT EXISTS auth_tokens (
    token_hash TEXT PRIMARY KEY,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS event_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL,
    payload    TEXT DEFAULT '{}',
    created_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS operation_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    action     TEXT NOT NULL,
    target     TEXT DEFAULT '',
    detail     TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS wallpapers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    url         TEXT NOT NULL,
    category    TEXT DEFAULT 'custom',
    enabled     INTEGER DEFAULT 1,
    sort_order  INTEGER DEFAULT 0,
    source_type TEXT DEFAULT 'url',
    created_at  TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS wallpaper_state (
    id                INTEGER PRIMARY KEY DEFAULT 1,
    current_url       TEXT DEFAULT '',
    current_index     INTEGER DEFAULT 0,
    current_image_idx INTEGER DEFAULT 0,
    last_refresh_at   TEXT
);

CREATE TABLE IF NOT EXISTS fonts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    family     TEXT NOT NULL,
    category   TEXT DEFAULT 'builtin',
    cdn_url    TEXT NOT NULL,
    language   TEXT DEFAULT 'zh',
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS icon_cache (
    domain       TEXT PRIMARY KEY,
    content      TEXT NOT NULL,
    content_type TEXT DEFAULT 'image/x-icon',
    source_url   TEXT DEFAULT '',
    updated_at   TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS steamgriddb_cache (
    game_id    TEXT NOT NULL,
    image_url  TEXT NOT NULL,
    style      TEXT DEFAULT '',
    fetched_at TEXT DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (game_id, image_url)
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_links_group_id ON links(group_id);
CREATE INDEX IF NOT EXISTS idx_links_synced ON links(synced_to_browser);
CREATE INDEX IF NOT EXISTS idx_links_imported ON links(is_imported);
CREATE INDEX IF NOT EXISTS idx_event_log_id ON event_log(id);

-- Initial Seed Data
INSERT OR IGNORE INTO sync_state (id) VALUES (1);
INSERT OR IGNORE INTO wallpaper_state (id) VALUES (1);

-- Default Settings
INSERT OR IGNORE INTO settings (key, value) VALUES ('theme', 'purple');
INSERT OR IGNORE INTO settings (key, value) VALUES ('pattern', 'grid');
INSERT OR IGNORE INTO settings (key, value) VALUES ('glass_intensity', '1');
INSERT OR IGNORE INTO settings (key, value) VALUES ('weather_city', 'Beijing');
INSERT OR IGNORE INTO settings (key, value) VALUES ('clock_format', '24h');
INSERT OR IGNORE INTO settings (key, value) VALUES ('weather_size', 'medium');
INSERT OR IGNORE INTO settings (key, value) VALUES ('widget_style', 'bar');
INSERT OR IGNORE INTO settings (key, value) VALUES ('clock_size', 'medium');
INSERT OR IGNORE INTO settings (key, value) VALUES ('auth_password_hash', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('background_type', 'gradient');
INSERT OR IGNORE INTO settings (key, value) VALUES ('wallpaper_interval', '900');
INSERT OR IGNORE INTO settings (key, value) VALUES ('font_body', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('font_title', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('font_code', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('font_size', '14');
INSERT OR IGNORE INTO settings (key, value) VALUES ('accent_color', '#7c6ff7');
INSERT OR IGNORE INTO settings (key, value) VALUES ('color_scheme', 'purple');
INSERT OR IGNORE INTO settings (key, value) VALUES ('style', 'glass');
INSERT OR IGNORE INTO settings (key, value) VALUES ('bg_solid_color', '#0d0e14');
INSERT OR IGNORE INTO settings (key, value) VALUES ('steamgriddb_api_key', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('ai_provider', 'free');
INSERT OR IGNORE INTO settings (key, value) VALUES ('ai_model', 'free-auto');

-- Built-in Wallpapers
INSERT OR IGNORE INTO wallpapers (name, url, category, enabled, sort_order, source_type) VALUES
('必应每日', 'https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8', 'builtin', 1, 0, 'url'),
('赛博朋克2077', '1091500', 'builtin', 1, 1, 'steamgriddb'),
('艾尔登法环', '1245620', 'builtin', 1, 2, 'steamgriddb'),
('荒野大镖客2', '1174180', 'builtin', 1, 3, 'steamgriddb'),
('巫师3', '292030', 'builtin', 1, 4, 'steamgriddb'),
('对马岛之魂', '2215430', 'builtin', 1, 5, 'steamgriddb'),
('死亡搁浅', '1850570', 'builtin', 1, 6, 'steamgriddb'),
('战神', '1593500', 'builtin', 1, 7, 'steamgriddb'),
('星空', '1716740', 'builtin', 1, 8, 'steamgriddb'),
('只狼', '814380', 'builtin', 1, 9, 'steamgriddb'),
('地平线：西之绝境', '2420110', 'builtin', 1, 10, 'steamgriddb'),
('地平线：零之曙光', '1151640', 'builtin', 1, 11, 'steamgriddb'),
('刺客信条：英灵殿', '2208920', 'builtin', 1, 12, 'steamgriddb'),
('刺客信条：奥德赛', '812140', 'builtin', 1, 13, 'steamgriddb'),
('怪物猎人：世界', '582010', 'builtin', 1, 14, 'steamgriddb'),
('黑暗之魂3', '374320', 'builtin', 1, 15, 'steamgriddb'),
('无人深空', '275850', 'builtin', 1, 16, 'steamgriddb');

-- Built-in Fonts
INSERT OR IGNORE INTO fonts (name, family, category, cdn_url, language, sort_order) VALUES
('匯文明朝體', 'Huiwen-mincho', 'builtin', 'https://fontsapi.zeoseven.com/256/main/result.css', 'zh', 0),
('京华老宋体', 'KingHwaOldSong', 'builtin', 'https://fontsapi.zeoseven.com/309/main/result.css', 'zh', 1),
('LXGW WenKai', 'LXGW WenKai', 'builtin', 'https://fontsapi.zeoseven.com/292/main/result.css', 'zh', 2),
('抖音美好体', 'DouyinSans', 'builtin', 'https://fontsapi.zeoseven.com/84/main/result.css', 'zh', 3);
