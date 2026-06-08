"""
SuenWeb - 轻量个人导航页 (Server Edition)
Flask + SQLite backend. No seed data. Auth-protected.
Browser extension syncs bookmarks to this server.
"""

import os, json, sqlite3, hashlib, secrets, time, re, io, warnings
from pathlib import Path
from urllib.parse import urlparse
from functools import wraps

from flask import Flask, render_template, request, jsonify, send_file, Response, g
import requests

# Suppress SSL warnings for link checker
warnings.filterwarnings('ignore', message='Unverified HTTPS request')
from urllib3.exceptions import InsecureRequestWarning
warnings.filterwarnings('ignore', category=InsecureRequestWarning)

from bookmark_parser import parse_bookmarks

# Thread-local HTTP session — each Flask thread gets its own connection pool
import threading
_thread_local = threading.local()

def _get_http_session() -> requests.Session:
    """Get or create a thread-local requests.Session with connection pooling."""
    if not hasattr(_thread_local, 'session'):
        _thread_local.session = requests.Session()
        adapter = requests.adapters.HTTPAdapter(pool_connections=10, pool_maxsize=20, max_retries=1)
        _thread_local.session.mount('https://', adapter)
        _thread_local.session.mount('http://', adapter)
    return _thread_local.session

# ── App Setup ──────────────────────────────────────────────
app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', secrets.token_hex(32))

# Fix Chinese garbled text in JSON responses
app.json.ensure_ascii = False

@app.after_request
def add_charset(response):
    if 'application/json' in response.content_type:
        response.content_type = 'application/json; charset=utf-8'
    return response

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / 'data'
DB_PATH = DATA_DIR / 'suenweb.db'

DATA_DIR.mkdir(exist_ok=True)



# ── Change notifications (for extension realtime sync) ─────
# Each connection holds a queue; _notify_change() pushes events to all.
# Extension on /api/events/stream (SSE) drains the queue.
import queue as _queue
import threading as _threading
_SSE_LISTENERS: list[_queue.Queue] = []
_SSE_LOCK = _threading.Lock()

def _notify_change(kind: str, payload: dict | None = None) -> None:
    """Push a change event to all SSE listeners (extension realtime sync)."""
    msg = {'kind': kind, 'payload': payload or {}, 'ts': int(time.time() * 1000)}
    with _SSE_LOCK:
        # Drop dead listeners; broadcast to live ones
        live: list[_queue.Queue] = []
        for q in _SSE_LISTENERS:
            try:
                q.put_nowait(msg)
                live.append(q)
            except _queue.Full:
                # Slow consumer; drop this connection
                pass
            except Exception:
                pass
        _SSE_LISTENERS[:] = live


# ── Database ───────────────────────────────────────────────
def get_db() -> sqlite3.Connection:
    if 'db' not in g:
        g.db = sqlite3.connect(str(DB_PATH))
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
        _ensure_tables(g.db)
    return g.db


def _ensure_tables(conn: sqlite3.Connection):
    """Create tables if they don't exist (handles DB file deletion while server runs)."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT
        );
        CREATE TABLE IF NOT EXISTS groups_table (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL,
            icon       TEXT DEFAULT '📁',
            type       TEXT DEFAULT 'tab',
            display_mode TEXT DEFAULT 'compact',
            sort_order INTEGER DEFAULT 0,
            is_imported INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now','localtime'))
        );
        CREATE TABLE IF NOT EXISTS links (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id    INTEGER NOT NULL,
            title       TEXT NOT NULL,
            url         TEXT NOT NULL,
            description TEXT DEFAULT '',
            icon        TEXT DEFAULT '',
            icon_type   TEXT DEFAULT 'auto',
            sort_order  INTEGER DEFAULT 0,
            is_imported INTEGER DEFAULT 0,
            synced_to_browser INTEGER DEFAULT 1,
            created_at  TEXT DEFAULT (datetime('now','localtime')),
            FOREIGN KEY (group_id) REFERENCES groups_table(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS sync_state (
            id              INTEGER PRIMARY KEY DEFAULT 1,
            last_sync_at    TEXT,
            last_sync_from  TEXT
        );
        CREATE TABLE IF NOT EXISTS wallpapers (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            url         TEXT NOT NULL,
            category    TEXT DEFAULT 'custom',
            enabled     INTEGER DEFAULT 1,
            sort_order  INTEGER DEFAULT 0,
            created_at  TEXT DEFAULT (datetime('now','localtime'))
        );
        CREATE TABLE IF NOT EXISTS wallpaper_state (
            id              INTEGER PRIMARY KEY DEFAULT 1,
            current_url     TEXT DEFAULT '',
            current_index   INTEGER DEFAULT 0,
            last_refresh_at TEXT
        );
        CREATE TABLE IF NOT EXISTS fonts (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            family      TEXT NOT NULL,
            category    TEXT DEFAULT 'builtin',
            cdn_url     TEXT NOT NULL,
            language    TEXT DEFAULT 'zh',
            sort_order  INTEGER DEFAULT 0,
            created_at  TEXT DEFAULT (datetime('now','localtime'))
        );
        CREATE TABLE IF NOT EXISTS icon_cache (
            domain       TEXT PRIMARY KEY,
            content      BLOB NOT NULL,
            content_type TEXT DEFAULT 'image/x-icon',
            source_url   TEXT DEFAULT '',
            updated_at   TEXT DEFAULT (datetime('now','localtime'))
        );
        INSERT OR IGNORE INTO sync_state (id) VALUES (1);
        INSERT OR IGNORE INTO wallpaper_state (id) VALUES (1);
        INSERT OR IGNORE INTO settings (key, value) VALUES ('theme', 'purple');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('pattern', 'grid');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('glass_intensity', '1');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('weather_city', 'Beijing');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('auth_password_hash', '');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('background_type', 'gradient');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('wallpaper_interval', '300');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('font_body', '');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('font_title', '');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('font_code', '');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('font_size', '14');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('accent_color', '#7c6ff7');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('color_scheme', 'purple');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('pattern', 'grid');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('style', 'glass');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('bg_solid_color', '#0d0e14');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('steamgriddb_api_key', '');
    """)
    # Migration: add columns that may be missing
    existing = {r[1] for r in conn.execute("PRAGMA table_info(links)")}
    if 'synced_to_browser' not in existing:
        conn.execute("ALTER TABLE links ADD COLUMN synced_to_browser INTEGER DEFAULT 1")
    gcols = {r[1] for r in conn.execute("PRAGMA table_info(groups_table)")}
    if 'display_mode' not in gcols:
        conn.execute("ALTER TABLE groups_table ADD COLUMN display_mode TEXT DEFAULT 'compact'")
    wcols = {r[1] for r in conn.execute("PRAGMA table_info(wallpapers)")}
    if 'source_type' not in wcols:
        conn.execute("ALTER TABLE wallpapers ADD COLUMN source_type TEXT DEFAULT 'url'")
    # SteamGridDB image cache
    conn.execute("""
        CREATE TABLE IF NOT EXISTS steamgriddb_cache (
            game_id     TEXT NOT NULL,
            image_url   TEXT NOT NULL,
            style       TEXT DEFAULT '',
            fetched_at  TEXT DEFAULT (datetime('now','localtime')),
            PRIMARY KEY (game_id, image_url)
        )
    """)

    # Seed built-in wallpaper sources if none exist
    wcount = conn.execute("SELECT COUNT(*) FROM wallpapers").fetchone()[0]
    if wcount == 0:
        _seed_wallpapers(conn)
    else:
        # Migration: remove dead APIs and seed SteamGridDB games
        _migrate_wallpapers(conn)

    # Seed built-in fonts if none exist
    fcount = conn.execute("SELECT COUNT(*) FROM fonts WHERE category='builtin'").fetchone()[0]
    if fcount == 0:
        _seed_fonts(conn)

    conn.commit()


def _seed_wallpapers(conn: sqlite3.Connection):
    """Seed built-in wallpaper sources: Bing + SteamGridDB games."""
    builtin = [
        # Bing (always available, no API key needed)
        ('必应每日', 'https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8', 'builtin', 0, 'url'),
        # SteamGridDB — 3A / open-world / cyberpunk (Steam App IDs)
        ('赛博朋克2077', '1091500', 'builtin', 1, 'steamgriddb'),
        ('艾尔登法环', '1245620', 'builtin', 2, 'steamgriddb'),
        ('荒野大镖客2', '1174180', 'builtin', 3, 'steamgriddb'),
        ('巫师3', '292030', 'builtin', 4, 'steamgriddb'),
        ('对马岛之魂', '2215430', 'builtin', 5, 'steamgriddb'),
        ('死亡搁浅', '1850570', 'builtin', 6, 'steamgriddb'),
        ('战神', '1593500', 'builtin', 7, 'steamgriddb'),
        ('星空', '1716740', 'builtin', 8, 'steamgriddb'),
        ('只狼', '814380', 'builtin', 9, 'steamgriddb'),
        ('地平线：西之绝境', '2420110', 'builtin', 10, 'steamgriddb'),
        ('地平线：零之曙光', '1151640', 'builtin', 11, 'steamgriddb'),
        ('刺客信条：英灵殿', '2208920', 'builtin', 12, 'steamgriddb'),
        ('刺客信条：奥德赛', '812140', 'builtin', 13, 'steamgriddb'),
        ('怪物猎人：世界', '582010', 'builtin', 14, 'steamgriddb'),
        ('黑暗之魂3', '374320', 'builtin', 15, 'steamgriddb'),
        ('无人深空', '275850', 'builtin', 16, 'steamgriddb'),
    ]
    for name, url, cat, order, stype in builtin:
        conn.execute(
            "INSERT INTO wallpapers (name, url, category, enabled, sort_order, source_type) VALUES (?,?,?,1,?,?)",
            (name, url, cat, order, stype)
        )


def _migrate_wallpapers(conn: sqlite3.Connection):
    """One-time migration: remove dead APIs, add SteamGridDB games if missing."""
    # Remove dead domains
    dead_domains = ('ixiaowai.cn', 'mtyqx.cn')
    for d in dead_domains:
        conn.execute("DELETE FROM wallpapers WHERE url LIKE ?", (f'%{d}%',))
    # Remove dmoe.cc (replaced by SteamGridDB)
    conn.execute("DELETE FROM wallpapers WHERE url LIKE '%dmoe.cc%'")
    # Add SteamGridDB games if not already present
    sgdb_ids = {r[0] for r in conn.execute(
        "SELECT url FROM wallpapers WHERE source_type='steamgriddb'"
    ).fetchall()}
    steam_games = [
        ('赛博朋克2077', '1091500', 'builtin', 1),
        ('艾尔登法环', '1245620', 'builtin', 2),
        ('荒野大镖客2', '1174180', 'builtin', 3),
        ('巫师3', '292030', 'builtin', 4),
        ('对马岛之魂', '2215430', 'builtin', 5),
        ('死亡搁浅', '1850570', 'builtin', 6),
        ('战神', '1593500', 'builtin', 7),
        ('星空', '1716740', 'builtin', 8),
        ('只狼', '814380', 'builtin', 9),
        ('地平线：西之绝境', '2420110', 'builtin', 10),
        ('地平线：零之曙光', '1151640', 'builtin', 11),
        ('刺客信条：英灵殿', '2208920', 'builtin', 12),
        ('刺客信条：奥德赛', '812140', 'builtin', 13),
        ('怪物猎人：世界', '582010', 'builtin', 14),
        ('黑暗之魂3', '374320', 'builtin', 15),
        ('无人深空', '275850', 'builtin', 16),
    ]
    for name, appid, cat, order in steam_games:
        if appid not in sgdb_ids:
            conn.execute(
                "INSERT INTO wallpapers (name, url, category, enabled, sort_order, source_type) "
                "VALUES (?,?,?,1,?,?)",
                (name, appid, cat, order, 'steamgriddb')
            )


def _seed_fonts(conn: sqlite3.Connection):
    """Seed built-in fonts from ZeoSeven Fonts API."""
    builtin = [
        ('匯文明朝體', 'Huiwen-mincho', 'https://fontsapi.zeoseven.com/256/main/result.css', 'zh', 0),
        ('京华老宋体', 'KingHwaOldSong', 'https://fontsapi.zeoseven.com/309/main/result.css', 'zh', 1),
        ('LXGW WenKai', 'LXGW WenKai', 'https://fontsapi.zeoseven.com/292/main/result.css', 'zh', 2),
        ('抖音美好体', 'DouyinSans', 'https://fontsapi.zeoseven.com/84/main/result.css', 'zh', 3),
    ]
    for name, family, cdn, lang, order in builtin:
        conn.execute(
            "INSERT INTO fonts (name, family, category, cdn_url, language, sort_order) VALUES (?,?,?,?,?,?)",
            (name, family, 'builtin', cdn, lang, order)
        )


@app.teardown_appcontext
def close_db(exception=None):
    db = g.pop('db', None)
    if db:
        db.close()


def init_db():
    """Called once at module import to ensure DB exists."""
    conn = sqlite3.connect(str(DB_PATH))
    _ensure_tables(conn)
    conn.close()


# ── Auth ───────────────────────────────────────────────────
def _get_setting(key: str, default: str = '') -> str:
    db = get_db()
    row = db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return row['value'] if row else default


def _set_setting(key: str, value: str):
    db = get_db()
    db.execute("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)", (key, value))
    db.commit()


def _hash_pw(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()


def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get('Authorization', '')
        pw = auth_header.replace('Bearer ', '').strip()
        pw_hash = _get_setting('auth_password_hash', '')
        if not pw_hash:
            return jsonify({'error': 'No password set', 'code': 'NO_PASSWORD'}), 401
        if not pw or _hash_pw(pw) != pw_hash:
            return jsonify({'error': 'Unauthorized', 'code': 'AUTH_REQUIRED'}), 401
        return f(*args, **kwargs)
    return decorated


# ── Helpers ────────────────────────────────────────────────
def _normalize_url(url: str) -> str:
    url = url.strip().lower()
    url = re.sub(r'^https?://(www\.)?', '', url)
    return url.rstrip('/')


def _get_all_data():
    """Return all groups with their links as a dict."""
    db = get_db()
    groups = db.execute("SELECT * FROM groups_table ORDER BY sort_order, id").fetchall()
    result = []
    for g in groups:
        links = db.execute(
            "SELECT * FROM links WHERE group_id=? ORDER BY sort_order, id", (g['id'],)
        ).fetchall()
        result.append({
            'id': g['id'], 'name': g['name'], 'icon': g['icon'],
            'type': g['type'], 'display_mode': g['display_mode'] or 'compact',
            'sort_order': g['sort_order'],
            'is_imported': bool(g['is_imported']),
            'links': [dict(l) for l in links],
        })
    return result


# ═══════════════════════════════════════════════════════════
#  ROUTES — Pages
# ═══════════════════════════════════════════════════════════
@app.route('/')
def index():
    db = get_db()
    pw_hash = _get_setting('auth_password_hash', '')
    has_password = bool(pw_hash)
    settings_rows = db.execute("SELECT * FROM settings").fetchall()
    return render_template('index.html',
        has_password=has_password,
        settings={r['key']: r['value'] for r in settings_rows})


# ═══════════════════════════════════════════════════════════
#  ROUTES — Auth API
# ═══════════════════════════════════════════════════════════
@app.route('/api/auth/status', methods=['GET'])
def api_auth_status():
    pw_hash = _get_setting('auth_password_hash', '')
    return jsonify({'has_password': bool(pw_hash)})


@app.route('/api/auth/setup', methods=['POST'])
def api_auth_setup():
    """Set initial password (only if not already set)."""
    pw_hash = _get_setting('auth_password_hash', '')
    if pw_hash:
        return jsonify({'error': '密码已设置'}), 400
    data = request.get_json() or {}
    password = data.get('password', '').strip()
    if len(password) < 4:
        return jsonify({'error': '密码至少4位'}), 400
    _set_setting('auth_password_hash', _hash_pw(password))
    return jsonify({'ok': True})


@app.route('/api/auth/login', methods=['POST'])
def api_auth_login():
    pw_hash = _get_setting('auth_password_hash', '')
    if not pw_hash:
        return jsonify({'error': '请先设置密码', 'code': 'NO_PASSWORD'}), 400
    data = request.get_json() or {}
    password = data.get('password', '').strip()
    if _hash_pw(password) != pw_hash:
        return jsonify({'error': '密码错误'}), 401
    return jsonify({'ok': True})


@app.route('/api/auth/logout', methods=['POST'])
@require_auth
def api_auth_logout():
    return jsonify({'ok': True})


@app.route('/api/auth/change-password', methods=['POST'])
@require_auth
def api_change_password():
    data = request.get_json() or {}
    old_pw = data.get('old_password', '')
    new_pw = data.get('new_password', '').strip()
    if len(new_pw) < 4:
        return jsonify({'error': '新密码至少4位'}), 400
    current_hash = _get_setting('auth_password_hash', '')
    if _hash_pw(old_pw) != current_hash:
        return jsonify({'error': '旧密码错误'}), 401
    _set_setting('auth_password_hash', _hash_pw(new_pw))
    return jsonify({'ok': True})


# ═══════════════════════════════════════════════════════════
#  ROUTES — Bookmark Sync (from extension / upload)
# ═══════════════════════════════════════════════════════════
@app.route('/api/sync', methods=['POST'])
@require_auth
def api_sync_bookmarks():
    """
    Receive bookmarks from browser extension or manual upload.
    Extension sends JSON: { "folders": [{ "name": "...", "bookmarks": [{ "title": "...", "url": "..." }] }] }
    Upload sends bookmark HTML file as multipart form.
    """
    db = get_db()

    # Check if it's a JSON payload from extension
    if request.is_json:
        data = request.get_json() or {}
        folders = data.get('folders', [])
        if not folders:
            return jsonify({'error': 'No bookmark data'}), 400
        imported_count = _merge_bookmark_folders(db, folders)
    else:
        # File upload
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'Empty file'}), 400

        content = file.read()
        try:
            text = content.decode('utf-8')
        except UnicodeDecodeError:
            text = content.decode('gbk', errors='replace')

        try:
            parsed = parse_bookmarks(text)
        except Exception as e:
            return jsonify({'error': f'解析失败: {str(e)}'}), 400

        folders = []
        for folder in parsed:
            bookmarks = []
            for link in folder.get('links', []):
                bookmarks.append({
                    'title': link.get('title', ''),
                    'url': link.get('url', ''),
                })
            if bookmarks:
                folders.append({
                    'name': folder.get('name', '未命名'),
                    'bookmarks': bookmarks,
                })
        imported_count = _merge_bookmark_folders(db, folders)

    # Update sync state
    db.execute(
        "UPDATE sync_state SET last_sync_at=datetime('now','localtime'), last_sync_from=? WHERE id=1",
        ('extension' if request.is_json else 'upload',)
    )
    db.commit()
    if imported_count > 0:
        _notify_change('sync_imported', {'imported': imported_count})

    return jsonify({'ok': True, 'imported': imported_count})


def _merge_bookmark_folders(db: sqlite3.Connection, folders: list[dict]) -> int:
    """
    Merge bookmark folders into database.
    - Existing group (by name): append new links (skip duplicate URLs)
    - New group: create as 'tab' type
    Returns number of newly added links.
    """
    total_new = 0

    for folder in folders:
        name = folder.get('name', '未命名').strip()
        if not name:
            continue

        # Find or create group
        row = db.execute("SELECT id FROM groups_table WHERE name=?", (name,)).fetchone()
        if row:
            group_id = row['id']
        else:
            max_order = db.execute("SELECT COALESCE(MAX(sort_order), -1) FROM groups_table").fetchone()[0]
            cur = db.execute(
                "INSERT INTO groups_table (name, icon, type, sort_order, is_imported) VALUES (?,?,?,?,1)",
                (name, '📁', 'tab', max_order + 1)
            )
            group_id = cur.lastrowid

        # Get existing URLs in this group
        existing = db.execute("SELECT url FROM links WHERE group_id=?", (group_id,)).fetchall()
        existing_norm = {_normalize_url(r['url']) for r in existing}

        # Insert new links
        max_link_order = db.execute(
            "SELECT COALESCE(MAX(sort_order), -1) FROM links WHERE group_id=?", (group_id,)
        ).fetchone()[0]

        for bm in folder.get('bookmarks', []):
            url = bm.get('url', '').strip()
            title = bm.get('title', '').strip()
            if not url or not title:
                continue
            norm_url = _normalize_url(url)
            if norm_url in existing_norm:
                continue  # Skip duplicates
            max_link_order += 1
            db.execute(
                "INSERT INTO links (group_id, title, url, icon_type, sort_order, is_imported, synced_to_browser) VALUES (?,?,?,'auto',?,1,1)",
                (group_id, title, url, max_link_order)
            )
            existing_norm.add(norm_url)
            total_new += 1

    return total_new



@app.route('/api/sync/bookmark', methods=['DELETE'])
@require_auth
def api_sync_delete_bookmark():
    """Delete a single link by URL (called by extension when browser bookmark is removed)."""
    url = request.args.get('url', '').strip()
    if not url:
        return jsonify({'error': 'Missing url'}), 400
    db = get_db()
    norm = _normalize_url(url)
    deleted = 0
    deleted_group_name = None
    for row in db.execute(
        "SELECT l.id, l.url, g.name as group_name FROM links l JOIN groups_table g ON l.group_id = g.id WHERE l.is_imported=1"
    ).fetchall():
        if _normalize_url(row['url']) == norm:
            deleted_group_name = row['group_name']
            db.execute("DELETE FROM links WHERE id=?", (row['id'],))
            deleted += 1
            break  # Delete first match only
    db.commit()
    if deleted:
        _notify_change('link_deleted', {'url': url, 'group_name': deleted_group_name})
    return jsonify({'deleted': deleted})


@app.route('/api/sync/status', methods=['GET'])
def api_sync_status():
    db = get_db()
    row = db.execute("SELECT * FROM sync_state WHERE id=1").fetchone()
    total_links = db.execute("SELECT COUNT(*) as cnt FROM links").fetchone()['cnt']
    total_groups = db.execute("SELECT COUNT(*) as cnt FROM groups_table").fetchone()['cnt']
    pending = db.execute("SELECT COUNT(*) as cnt FROM links WHERE synced_to_browser=0").fetchone()['cnt']
    # Update last contact time when polled (heartbeat from extension or web UI)
    db.execute(
        "UPDATE sync_state SET last_sync_at=datetime('now','localtime'), last_sync_from='poll' WHERE id=1"
    )
    db.commit()
    row = db.execute("SELECT * FROM sync_state WHERE id=1").fetchone()
    return jsonify({
        'last_sync_at': row['last_sync_at'] if row else None,
        'last_sync_from': row['last_sync_from'] if row else None,
        'total_links': total_links,
        'total_groups': total_groups,
        'pending_sync': pending,
        'listeners': len(_SSE_LISTENERS),
    })




@app.route('/api/events/stream', methods=['GET'])
@require_auth
def api_events_stream():
    """SSE endpoint for realtime change notifications (extension sync).

    Streams 'change' events whenever links/groups are created, updated, or deleted
    on the web side. Extension listens and pulls `/api/sync/pending` immediately.
    """
    import json as _json

    def gen():
        q: _queue.Queue = _queue.Queue(maxsize=64)
        with _SSE_LOCK:
            _SSE_LISTENERS.append(q)
        try:
            # Initial hello so the client knows it's connected
            yield f"event: hello\ndata: {_json.dumps({'ts': int(time.time()*1000)})}\n\n"
            # Heartbeat every 25s to keep connection alive through proxies
            last_hb = time.time()
            while True:
                try:
                    msg = q.get(timeout=5)
                    yield f"event: change\ndata: {_json.dumps(msg, ensure_ascii=False)}\n\n"
                except _queue.Empty:
                    if time.time() - last_hb > 25:
                        yield ": heartbeat\n\n"
                        last_hb = time.time()
        except GeneratorExit:
            pass
        finally:
            with _SSE_LOCK:
                try:
                    _SSE_LISTENERS.remove(q)
                except ValueError:
                    pass

    resp = Response(gen(), mimetype='text/event-stream')
    resp.headers['Cache-Control'] = 'no-cache'
    resp.headers['X-Accel-Buffering'] = 'no'  # disable nginx buffering
    resp.headers['Connection'] = 'keep-alive'
    return resp


# ═══════════════════════════════════════════════════════════
#  ROUTES — Data API (Groups + Links, auth required)
# ═══════════════════════════════════════════════════════════
@app.route('/api/data', methods=['GET'])
def api_get_data():
    return jsonify({'groups': _get_all_data()})


@app.route('/api/groups', methods=['POST'])
@require_auth
def api_create_group():
    data = request.get_json() or {}
    name = data.get('name', '').strip()
    if not name:
        return jsonify({'error': '名称不能为空'}), 400
    icon = data.get('icon', '📁')
    gtype = data.get('type', 'tab')
    db = get_db()
    max_order = db.execute("SELECT COALESCE(MAX(sort_order), -1) FROM groups_table").fetchone()[0]
    cur = db.execute(
        "INSERT INTO groups_table (name, icon, type, sort_order) VALUES (?,?,?,?)",
        (name, icon, gtype, max_order + 1)
    )
    db.commit()
    _notify_change('group_created', {'id': cur.lastrowid, 'name': name})
    return jsonify({'id': cur.lastrowid, 'name': name, 'icon': icon, 'type': gtype, 'links': []}), 201


@app.route('/api/groups/<int:gid>', methods=['PUT'])
@require_auth
def api_update_group(gid):
    data = request.get_json() or {}
    db = get_db()
    for field in ['name', 'icon', 'type', 'display_mode', 'sort_order']:
        if field in data:
            db.execute(f"UPDATE groups_table SET {field}=? WHERE id=?", (data[field], gid))
    db.commit()
    row = db.execute("SELECT * FROM groups_table WHERE id=?", (gid,)).fetchone()
    if not row:
        return jsonify({'error': 'Not found'}), 404
    _notify_change('group_updated', {'id': gid})
    return jsonify(dict(row))


@app.route('/api/groups/<int:gid>', methods=['DELETE'])
@require_auth
def api_delete_group(gid):
    db = get_db()
    row = db.execute("SELECT name FROM groups_table WHERE id=?", (gid,)).fetchone()
    group_name = row['name'] if row else None
    db.execute("DELETE FROM groups_table WHERE id=?", (gid,))
    db.commit()
    _notify_change('group_deleted', {'id': gid, 'name': group_name})
    return jsonify({'ok': True})


@app.route('/api/links', methods=['POST'])
@require_auth
def api_create_link():
    data = request.get_json() or {}
    group_id = data.get('group_id')
    group_name = data.get('group_name', '').strip()
    group_type = data.get('group_type', 'tab')
    title = data.get('title', '').strip()
    url = data.get('url', '').strip()

    # Auto-create group by name if group_id not provided
    if not group_id and group_name:
        db = get_db()
        existing = db.execute("SELECT id FROM groups_table WHERE name=?", (group_name,)).fetchone()
        if existing:
            group_id = existing['id']
        else:
            max_order = db.execute("SELECT COALESCE(MAX(sort_order), -1) FROM groups_table").fetchone()[0]
            cur = db.execute(
                "INSERT INTO groups_table (name, icon, type, sort_order) VALUES (?,?,?,?)",
                (group_name, '📌', group_type, max_order + 1)
            )
            db.commit()
            group_id = cur.lastrowid
            _notify_change('group_created', {'id': group_id, 'name': group_name})

    if not title or not url or not group_id:
        return jsonify({'error': '缺少必填字段'}), 400
    desc = data.get('description', '')
    icon = data.get('icon', '')
    icon_type = data.get('icon_type', 'auto')
    db = get_db()
    max_order = db.execute(
        "SELECT COALESCE(MAX(sort_order), -1) FROM links WHERE group_id=?", (group_id,)
    ).fetchone()[0]
    cur = db.execute(
        "INSERT INTO links (group_id, title, url, description, icon, icon_type, sort_order, synced_to_browser) VALUES (?,?,?,?,?,?,?,0)",
        (group_id, title, url, desc, icon, icon_type, max_order + 1)
    )
    db.commit()
    _notify_change('link_created', {'id': cur.lastrowid, 'group_id': group_id, 'title': title})
    return jsonify({'id': cur.lastrowid}), 201


@app.route('/api/links/<int:lid>', methods=['PUT'])
@require_auth
def api_update_link(lid):
    data = request.get_json() or {}
    db = get_db()
    for field in ['title', 'url', 'description', 'icon', 'icon_type', 'group_id', 'sort_order']:
        if field in data:
            db.execute(f"UPDATE links SET {field}=? WHERE id=?", (data[field], lid))
    db.commit()
    row = db.execute("SELECT * FROM links WHERE id=?", (lid,)).fetchone()
    if not row:
        return jsonify({'error': 'Not found'}), 404
    _notify_change('link_updated', {'id': lid})
    return jsonify(dict(row))


@app.route('/api/links/<int:lid>', methods=['DELETE'])
@require_auth
def api_delete_link(lid):
    db = get_db()
    row = db.execute(
        "SELECT l.url, g.name as group_name FROM links l JOIN groups_table g ON l.group_id = g.id WHERE l.id=?",
        (lid,)
    ).fetchone()
    url = row['url'] if row else None
    group_name = row['group_name'] if row else None
    db.execute("DELETE FROM links WHERE id=?", (lid,))
    # If this was the last link in the group, also delete the empty group
    if group_name:
        remaining = db.execute(
            "SELECT COUNT(*) as cnt FROM links l JOIN groups_table g ON l.group_id = g.id WHERE g.name=?",
            (group_name,)
        ).fetchone()
        if remaining and remaining['cnt'] == 0:
            db.execute("DELETE FROM groups_table WHERE name=?", (group_name,))
            _notify_change('group_deleted', {'name': group_name})
    db.commit()
    _notify_change('link_deleted', {'id': lid, 'url': url, 'group_name': group_name})
    return jsonify({'ok': True})




# ═══════════════════════════════════════════════════════════
#  ROUTES — Export
# ═══════════════════════════════════════════════════════════
@app.route('/api/export', methods=['GET'])
@require_auth
def api_export_bookmarks():
    """Export all links as Netscape Bookmark HTML (for importing back into browser)."""
    db = get_db()
    groups = db.execute("SELECT * FROM groups_table ORDER BY sort_order, id").fetchall()

    lines = [
        '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
        '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
        '<TITLE>SuenWeb Export</TITLE>',
        '<H1>SuenWeb Bookmarks</H1>',
        '<DL><p>',
    ]

    for g in groups:
        lines.append(f'    <DT><H3>{_escape_html(g["name"])}</H3>')
        lines.append('    <DL><p>')
        links = db.execute(
            "SELECT * FROM links WHERE group_id=? ORDER BY sort_order, id", (g['id'],)
        ).fetchall()
        for l in links:
            lines.append(
                f'        <DT><A HREF="{_escape_attr(l["url"])}" ICON="">{_escape_html(l["title"])}</A>'
            )
        lines.append('    </DL><p>')

    lines.append('</DL><p>')

    html = '\n'.join(lines)
    return Response(html, mimetype='text/html; charset=utf-8',
                    headers={'Content-Disposition': 'attachment; filename=suenweb_bookmarks.html'})


def _escape_html(s: str) -> str:
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def _escape_attr(s: str) -> str:
    return s.replace('&', '&amp;').replace('"', '&quot;')


# ═══════════════════════════════════════════════════════════
#  ROUTES — Settings
# ═══════════════════════════════════════════════════════════
@app.route('/api/settings', methods=['GET'])
def api_get_settings():
    db = get_db()
    rows = db.execute("SELECT key, value FROM settings WHERE key NOT LIKE 'auth_%'").fetchall()
    return jsonify({r['key']: r['value'] for r in rows})


@app.route('/api/settings', methods=['PUT'])
@require_auth
def api_update_settings():
    data = request.get_json() or {}
    allowed = ['pattern', 'glass_intensity', 'weather_city',
               'clock_format', 'weather_size', 'search_engines', 'search_default',
               'llm_url', 'llm_key', 'llm_model',
               'background_type', 'wallpaper_interval',
               'font_body', 'font_title', 'font_body_en', 'font_code', 'font_size',
               'accent_color', 'style', 'bg_solid_color', 'color_scheme',
               'steamgriddb_api_key']
    for key in allowed:
        if key in data:
            _set_setting(key, str(data[key]))
    # Backwards-compat: 'theme' field is accepted but ignored
    return jsonify({'ok': True})


# ═══════════════════════════════════════════════════════════
#  ROUTES — Wallpaper System
# ═══════════════════════════════════════════════════════════
@app.route('/api/wallpaper', methods=['GET'])
def api_wallpaper():
    """Return current wallpaper URL. For Bing API, resolve the JSON to an image URL."""
    db = get_db()
    state = db.execute("SELECT * FROM wallpaper_state WHERE id=1").fetchone()
    url = state['current_url'] if state else ''

    # If no current URL or interval expired, try to get a fresh one
    if not url:
        url = _fetch_wallpaper_url(db)
        if url:
            db.execute("UPDATE wallpaper_state SET current_url=?, last_refresh_at=datetime('now','localtime') WHERE id=1", (url,))
            db.commit()

    return jsonify({'url': url, 'background_type': _get_setting('background_type', 'pattern')})


@app.route('/api/wallpaper/sources', methods=['GET'])
def api_wallpaper_sources():
    """Get all wallpaper sources with enabled status, plus SteamGridDB config."""
    db = get_db()
    rows = db.execute("SELECT * FROM wallpapers ORDER BY sort_order, id").fetchall()
    sources = [dict(r) for r in rows]
    interval = _get_setting('wallpaper_interval', '300')
    bg_type = _get_setting('background_type', 'pattern')
    state = db.execute("SELECT * FROM wallpaper_state WHERE id=1").fetchone()
    sgdb_key = _get_setting('steamgriddb_api_key', '')
    return jsonify({
        'sources': sources,
        'interval': int(interval),
        'background_type': bg_type,
        'current_index': state['current_index'] if state else 0,
        'steamgriddb_api_key': sgdb_key[:4] + '****' + sgdb_key[-4:] if len(sgdb_key) > 8 else sgdb_key,
        'steamgriddb_configured': bool(sgdb_key.strip()),
    })


@app.route('/api/wallpaper/source', methods=['POST'])
@require_auth
def api_add_wallpaper_source():
    """Add a custom wallpaper API source or SteamGridDB game."""
    data = request.get_json() or {}
    name = data.get('name', '').strip()
    url = data.get('url', '').strip()
    source_type = data.get('source_type', 'url')
    if not name or not url:
        return jsonify({'error': '名称和URL/游戏ID不能为空'}), 400
    db = get_db()
    max_order = db.execute("SELECT COALESCE(MAX(sort_order), -1) FROM wallpapers").fetchone()[0]
    cur = db.execute(
        "INSERT INTO wallpapers (name, url, category, enabled, sort_order, source_type) VALUES (?,?,?,1,?,?)",
        (name, url, 'custom', max_order + 1, source_type)
    )
    db.commit()
    return jsonify({'id': cur.lastrowid, 'name': name, 'url': url, 'category': 'custom', 'enabled': 1, 'source_type': source_type}), 201


@app.route('/api/wallpaper/source/<int:sid>', methods=['DELETE'])
@require_auth
def api_delete_wallpaper_source(sid):
    """Delete a wallpaper source (custom only)."""
    db = get_db()
    row = db.execute("SELECT * FROM wallpapers WHERE id=?", (sid,)).fetchone()
    if not row:
        return jsonify({'error': 'Not found'}), 404
    if row['category'] == 'builtin':
        return jsonify({'error': '内置源不可删除'}), 400
    db.execute("DELETE FROM wallpapers WHERE id=?", (sid,))
    db.commit()
    return jsonify({'ok': True})


@app.route('/api/wallpaper/source/<int:sid>', methods=['PUT'])
@require_auth
def api_update_wallpaper_source(sid):
    """Toggle enable/disable a wallpaper source."""
    data = request.get_json() or {}
    db = get_db()
    if 'enabled' in data:
        db.execute("UPDATE wallpapers SET enabled=? WHERE id=?", (int(data['enabled']), sid))
        db.commit()
    return jsonify({'ok': True})


@app.route('/api/wallpaper/refresh', methods=['POST'])
@require_auth
def api_refresh_wallpaper():
    """Force refresh current wallpaper (next/prev/random)."""
    data = request.get_json() or {}
    direction = data.get('direction', 'next')  # 'next', 'prev', or 'random'
    db = get_db()

    url = _fetch_wallpaper_url(db, direction)
    if url:
        db.execute("UPDATE wallpaper_state SET current_url=?, last_refresh_at=datetime('now','localtime') WHERE id=1", (url,))
        db.commit()

    return jsonify({'url': url})


@app.route('/api/wallpaper/sgdb-test', methods=['POST'])
@require_auth
def api_sgdb_test():
    """Test SteamGridDB API key by fetching a known game."""
    data = request.get_json() or {}
    api_key = (data.get('api_key') or '').strip()
    if not api_key:
        return jsonify({'ok': False, 'error': '请填写 API Key'})
    try:
        # Test with a lightweight endpoint — search for "cyberpunk"
        resp = _get_http_session().get(
            f'{SGDB_BASE}/search/autocomplete/Cyberpunk',
            headers={'Authorization': f'Bearer {api_key}'},
            timeout=10
        )
        if resp.status_code == 401:
            return jsonify({'ok': False, 'error': 'API Key 无效 (401)'})
        if resp.status_code == 403:
            return jsonify({'ok': False, 'error': 'API Key 无权限 (403)'})
        if not resp.ok:
            return jsonify({'ok': False, 'error': f'HTTP {resp.status_code}'})
        data = resp.json()
        count = len(data.get('data', []))
        return jsonify({'ok': True, 'message': f'连接成功，找到 {count} 个匹配游戏'})
    except requests.exceptions.Timeout:
        return jsonify({'ok': False, 'error': '连接超时'})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)})


def _fetch_wallpaper_url(db, direction='next'):
    """Fetch a wallpaper URL from enabled sources. Returns resolved image URL."""
    sources = db.execute(
        "SELECT * FROM wallpapers WHERE enabled=1 ORDER BY sort_order, id"
    ).fetchall()
    if not sources:
        return ''

    state = db.execute("SELECT * FROM wallpaper_state WHERE id=1").fetchone()
    current_index = state['current_index'] if state else 0
    total = len(sources)

    if direction == 'next':
        current_index = (current_index + 1) % total
    elif direction == 'prev':
        current_index = (current_index - 1) % total
    elif direction == 'random':
        import random
        current_index = random.randint(0, total - 1)

    db.execute("UPDATE wallpaper_state SET current_index=? WHERE id=1", (current_index,))

    source = sources[current_index]
    stype = source['source_type'] if 'source_type' in source.keys() else 'url'
    if stype == 'steamgriddb':
        return _resolve_steamgriddb(db, source['url'], source['name'])
    else:
        return _resolve_wallpaper(source['url'])


# SteamGridDB API constants
SGDB_BASE = 'https://www.steamgriddb.com/api/v2'
SGDB_HEROES_URL = f'{SGDB_BASE}/heroes/steam/{{appid}}'


def _resolve_steamgriddb(db, steam_app_id, game_name=''):
    """Fetch a random hero image from SteamGridDB for a given Steam App ID.
    Caches results in steamgriddb_cache table. Filters for material/blurred/alternate styles."""
    api_key = _get_setting('steamgriddb_api_key', '')
    if not api_key:
        return ''

    # Check cache first (fresh within 24h)
    cached = db.execute(
        "SELECT image_url FROM steamgriddb_cache WHERE game_id=? "
        "AND datetime(fetched_at) > datetime('now','-1 day')",
        (steam_app_id,)
    ).fetchall()
    if cached:
        import random
        return random.choice([r['image_url'] for r in cached])

    # Fetch from SteamGridDB API
    try:
        resp = _get_http_session().get(
            SGDB_HEROES_URL.format(appid=steam_app_id),
            headers={'Authorization': f'Bearer {api_key}'},
            timeout=12
        )
        if not resp.ok:
            return ''
        data = resp.json()
        heroes = data.get('data', []) if data.get('success') else []
        if not heroes:
            return ''

        # Prefer: material > blurred > alternate > default, exclude solid/logos
        preferred_styles = ['material', 'blurred', 'alternate']
        scored = []
        for h in heroes:
            style = h.get('style', '')
            score = preferred_styles.index(style) if style in preferred_styles else 99
            scored.append((score, h['url'], style))
        scored.sort(key=lambda x: x[0])

        # Take top half (up to 8), preferring the good styles
        top = scored[:max(3, len(scored) // 2)][:8]

        # Cache them
        for _, url, style in top:
            try:
                db.execute(
                    "INSERT OR IGNORE INTO steamgriddb_cache (game_id, image_url, style, fetched_at) "
                    "VALUES (?,?,?,datetime('now','localtime'))",
                    (steam_app_id, url, style)
                )
            except Exception:
                pass
        db.commit()

        import random
        return random.choice([url for _, url, _ in top])
    except Exception:
        return ''


def _resolve_wallpaper(api_url):
    """Resolve wallpaper API URL to actual image URL. Handles Bing JSON API and direct image URLs."""
    try:
        # Bing daily wallpaper API
        if 'bing.com' in api_url:
            resp = _get_http_session().get(api_url, timeout=10, headers={'User-Agent': 'Mozilla/5.0'})
            if resp.ok:
                data = resp.json()
                images = data.get('images', [])
                if images:
                    return 'https://cn.bing.com' + images[0]['url']
            return api_url

        # Direct image URLs (most APIs return the image directly)
        # Try HEAD request to check if it's a redirect to an image
        resp = _get_http_session().head(api_url, timeout=10, allow_redirects=True,
                            headers={'User-Agent': 'Mozilla/5.0'})
        content_type = resp.headers.get('Content-Type', '')
        if 'image' in content_type or resp.status_code == 200:
            return api_url

        # If can't determine, return as-is (it's probably fine)
        return api_url
    except Exception:
        return api_url


# ═══════════════════════════════════════════════════════════
#  ROUTES — Font System
# ═══════════════════════════════════════════════════════════
@app.route('/api/fonts', methods=['GET'])
def api_fonts():
    """Get all font configurations."""
    db = get_db()
    rows = db.execute("SELECT * FROM fonts ORDER BY sort_order, id").fetchall()
    fonts = [dict(r) for r in rows]
    return jsonify({
        'fonts': fonts,
        'font_body': _get_setting('font_body', ''),
        'font_title': _get_setting('font_title', ''),
        'font_body_en': _get_setting('font_body_en', ''),
        'font_code': _get_setting('font_code', ''),
        'font_size': _get_setting('font_size', '14'),
    })


@app.route('/api/fonts', methods=['POST'])
@require_auth
def api_add_font():
    """Add a custom font source."""
    data = request.get_json() or {}
    name = data.get('name', '').strip()
    family = data.get('family', '').strip()
    cdn_url = data.get('cdn_url', '').strip()
    language = data.get('language', 'zh')
    if not name or not family or not cdn_url:
        return jsonify({'error': '名称、font-family 和 CDN URL 不能为空'}), 400
    db = get_db()
    max_order = db.execute("SELECT COALESCE(MAX(sort_order), -1) FROM fonts").fetchone()[0]
    cur = db.execute(
        "INSERT INTO fonts (name, family, category, cdn_url, language, sort_order) VALUES (?,?,?,?,?,?)",
        (name, family, 'custom', cdn_url, language, max_order + 1)
    )
    db.commit()
    return jsonify({'id': cur.lastrowid, 'name': name, 'family': family, 'cdn_url': cdn_url}), 201


@app.route('/api/fonts/<int:fid>', methods=['DELETE'])
@require_auth
def api_delete_font(fid):
    """Delete a custom font (builtin fonts cannot be deleted)."""
    db = get_db()
    row = db.execute("SELECT * FROM fonts WHERE id=?", (fid,)).fetchone()
    if not row:
        return jsonify({'error': 'Not found'}), 404
    if row['category'] == 'builtin':
        return jsonify({'error': '内置字体不可删除'}), 400
    db.execute("DELETE FROM fonts WHERE id=?", (fid,))
    db.commit()
    return jsonify({'ok': True})


def _normalize_font_css(raw_css: str, family_id: str) -> str:
    """Normalize ZeoSeven font CSS: rewrite relative WOFF2 URLs to our proxy, drop local() and format() hints."""
    base_local = f"/api/font-woff?family={family_id}&file="
    css = raw_css
    # Rewrite relative URLs: url("./xxx.woff2") or url(xxx.woff2) → url(/api/font-woff?family=ID&file=xxx.woff2)
    # Strip leading "./" so the file param is clean
    css = re.sub(r'url\(\s*(["\']?)(?!https?:|data:|/api/)([^"\')\s]+)\1\s*\)',
                  lambda m: f'url({base_local}{m.group(2).lstrip("./")})', css)
    # Strip local("...") fallbacks
    css = re.sub(r'\s*local\([^)]+\),?\s*', '', css)
    # Strip format("...") hints (browser auto-detect is safer)
    css = re.sub(r'\s+format\([^)]+\)', '', css)
    return css


@app.route('/api/font-css/<int:fid>.css')
def api_font_css(fid):
    """Proxy and normalize a font's CSS, rewriting WOFF2 URLs to our own proxy."""
    db = get_db()
    row = db.execute("SELECT * FROM fonts WHERE id=?", (fid,)).fetchone()
    if not row:
        return "/* not found */", 404, {'Content-Type': 'text/css; charset=utf-8'}
    cdn_url = row['cdn_url']
    if not cdn_url:
        return "/* no cdn */", 404, {'Content-Type': 'text/css; charset=utf-8'}
    try:
        import urllib.request
        req = urllib.request.Request(cdn_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read().decode('utf-8', errors='replace')
    except Exception as e:
        return f"/* fetch error: {e} */", 502, {'Content-Type': 'text/css; charset=utf-8'}
    css = _normalize_font_css(raw, str(fid))
    return css, 200, {
        'Content-Type': 'text/css; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
    }


@app.route('/api/font-woff')
def api_font_woff():
    """Proxy a WOFF2 file from a font's CDN."""
    import urllib.request
    family = request.args.get('family', '')
    fname = request.args.get('file', '')
    if not family or not fname:
        return "", 404
    # Sanitize filename to prevent path traversal
    if '/' in fname or '\\' in fname or '..' in fname:
        return "", 404
    try:
        fid_int = int(family)
    except ValueError:
        return "", 404
    db = get_db()
    row = db.execute("SELECT cdn_url FROM fonts WHERE id=?", (fid_int,)).fetchone()
    if not row:
        return "", 404
    cdn = row['cdn_url']
    base = cdn.rsplit('/', 1)[0] + '/'
    target = base + fname
    try:
        req = urllib.request.Request(target, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read()
        return data, 200, {
            'Content-Type': 'font/woff2',
            'Cache-Control': 'public, max-age=86400',
        }
    except Exception as e:
        return f"woff2 fetch error: {e}", 502, {'Content-Type': 'text/plain'}


# ═══════════════════════════════════════════════════════════
#  ROUTES — Icon Proxy
# ═══════════════════════════════════════════════════════════
def _extract_icons_from_html(domain):
    """Fetch homepage and extract <link rel=icon> hrefs. Returns list of absolute URLs."""
    icons = []
    try:
        resp = _get_http_session().get(f'https://{domain}/', timeout=4,
                            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'})
        if resp.status_code != 200:
            return icons
        html = resp.text[:200000]  # Only scan first 200KB

        # Patterns: rel="icon", rel="shortcut icon", rel="apple-touch-icon"
        # Attribute order varies, so we search in both directions
        patterns = [
            r'<link[^>]*rel=["\'](?:shortcut\s+)?icon["\'][^>]*href=["\']([^"\'\s>]+)',
            r'<link[^>]*href=["\']([^"\'\s>]+)[^>]*rel=["\'](?:shortcut\s+)?icon["\']',
            r'<link[^>]*rel=["\']apple-touch-icon["\'][^>]*href=["\']([^"\'\s>]+)',
            r'<link[^>]*href=["\']([^"\'\s>]+)[^>]*rel=["\']apple-touch-icon["\']',
        ]
        seen = set()
        for pat in patterns:
            for m in re.findall(pat, html, re.IGNORECASE):
                # Resolve relative URLs
                if m.startswith('//'):
                    m = f'https:{m}'
                elif m.startswith('/'):
                    m = f'https://{domain}{m}'
                elif not m.startswith('http'):
                    m = f'https://{domain}/{m}'
                if m not in seen:
                    seen.add(m)
                    icons.append(m)
    except Exception:
        pass
    return icons


@app.route('/api/icon/proxy')
def api_icon_proxy():
    """Proxy fetch favicon to avoid CORS and provide fallback, with SQLite cache.
    
    Performance-critical: Flask dev server is single-threaded; this handler MUST return
    fast (<3s) or all other API requests (incl. pin/unpin) queue behind it.
    Strategy: Google favicons first (~200ms), fast 3rd-party services next, skip slow
    homepage scraping in the primary path. Failed domains get negative-cached."""
    url = request.args.get('url', '')
    domain = request.args.get('domain', '')
    if not url and not domain:
        return '', 400

    if domain and not url:
        parsed = urlparse(domain if '://' in domain else f'https://{domain}')
        domain = parsed.netloc or parsed.path
    elif url and not domain:
        try:
            domain = urlparse(url).netloc or urlparse(url).hostname or ''
        except Exception:
            domain = ''

    # --- Check SQLite cache first (7-day TTL) ---
    if domain:
        try:
            db = get_db()
            # Negative cache: skip domains that failed recently (1h)
            neg = db.execute(
                "SELECT 1 FROM icon_cache WHERE domain=? AND content_type='x-negative' "
                "AND updated_at > datetime('now','localtime','-1 hours')",
                (domain,)
            ).fetchone()
            if neg:
                return _default_icon_svg()

            row = db.execute(
                "SELECT content, content_type FROM icon_cache "
                "WHERE domain=? AND content_type!='x-negative' "
                "AND updated_at > datetime('now','localtime','-7 days')",
                (domain,)
            ).fetchone()
            if row:
                return Response(row['content'], mimetype=row['content_type'],
                                headers={'Cache-Control': 'public, max-age=86400',
                                         'X-Icon-Cache': 'hit'})
        except Exception:
            pass

    # --- Cache miss: fast sources first ---
    # Ordered by speed: Google (200ms) > DuckDuckGo > icon.horse > direct favicon.ico > other APIs
    sources = []
    if domain:
        sources.append(f'https://www.google.com/s2/favicons?domain={domain}&sz=32')
        sources.append(f'https://icons.duckduckgo.com/ip3/{domain}.ico')
        sources.append(f'https://icon.horse/icon/{domain}')
        sources.append(f'https://{domain}/favicon.ico')
        sources.append(f'https://api.faviconkit.com/{domain}/32')

    if url:
        sources.insert(0, url)

    # Try each source with short timeout; connection reuse via shared session
    for src in sources:
        try:
            resp = _get_http_session().get(src, timeout=3, headers={'User-Agent': 'Mozilla/5.0'})
            if resp.status_code == 200 and len(resp.content) > 60:
                content_type = resp.headers.get('Content-Type', 'image/x-icon')
                if 'text/html' in content_type or 'text/plain' in content_type:
                    continue
                # Save to cache
                if domain:
                    try:
                        db2 = get_db()
                        db2.execute(
                            "INSERT OR REPLACE INTO icon_cache (domain, content, content_type, source_url, updated_at) "
                            "VALUES (?,?,?,?,datetime('now','localtime'))",
                            (domain, resp.content, content_type, src)
                        )
                        db2.commit()
                    except Exception:
                        pass
                return Response(resp.content, mimetype=content_type,
                                headers={'Cache-Control': 'public, max-age=86400',
                                         'X-Icon-Cache': 'miss'})
        except Exception:
            continue

    # All fast sources failed — try HTML scraping as last resort (one attempt only)
    if domain:
        try:
            html_icons = _extract_icons_from_html(domain)
            for hi_src in html_icons[:2]:  # only try first 2
                try:
                    resp = _get_http_session().get(hi_src, timeout=3, headers={'User-Agent': 'Mozilla/5.0'})
                    if resp.status_code == 200 and len(resp.content) > 60:
                        content_type = resp.headers.get('Content-Type', 'image/x-icon')
                        if 'text/html' in content_type:
                            continue
                        db3 = get_db()
                        db3.execute(
                            "INSERT OR REPLACE INTO icon_cache (domain, content, content_type, source_url, updated_at) "
                            "VALUES (?,?,?,?,datetime('now','localtime'))",
                            (domain, resp.content, content_type, hi_src)
                        )
                        db3.commit()
                        return Response(resp.content, mimetype=content_type,
                                        headers={'Cache-Control': 'public, max-age=86400',
                                                 'X-Icon-Cache': 'miss'})
                except Exception:
                    continue
        except Exception:
            pass

    # --- Write negative cache ---
    if domain:
        try:
            db4 = get_db()
            db4.execute(
                "INSERT OR REPLACE INTO icon_cache (domain, content, content_type, source_url, updated_at) "
                "VALUES (?,?,?,?,datetime('now','localtime'))",
                (domain, b'', 'x-negative', '')
            )
            db4.commit()
        except Exception:
            pass

    return _default_icon_svg()


def _default_icon_svg():
    svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
        <rect width="32" height="32" rx="6" fill="#333"/>
        <text x="16" y="22" text-anchor="middle" fill="#888" font-size="18">🔗</text>
    </svg>'''
    return Response(svg, mimetype='image/svg+xml')


# ═══════════════════════════════════════════════════════════
#  ROUTES — Built-in Icon Library
# ═══════════════════════════════════════════════════════════
@app.route('/api/builtin-icons')
def api_builtin_icons():
    """List all built-in SVG icons in static/icons/."""
    icons_dir = BASE_DIR / 'static' / 'icons'
    icons = []
    if icons_dir.exists():
        for f in sorted(icons_dir.iterdir()):
            if f.suffix.lower() == '.svg':
                icons.append({
                    'name': f.stem,
                    'path': f'/static/icons/{f.name}'
                })
    return jsonify({'icons': icons})


@app.route('/extension/download/chrome')
def download_extension_chrome():
    """Package extension for Chrome/Edge (MV3 manifest)."""
    return _make_extension_zip('chrome')

@app.route('/extension/download/firefox')
def download_extension_firefox():
    """Serve the signed Firefox extension XPI."""
    xpi = BASE_DIR / 'extension' / 'suenweb-firefox.xpi'
    if xpi.exists():
        return send_file(xpi, mimetype='application/x-xpinstall', as_attachment=True, download_name='suenweb-firefox.xpi')
    # Fallback: build unsigned zip for development
    return _make_extension_zip('firefox')


def _make_extension_zip(browser: str):
    import zipfile
    ext_dir = BASE_DIR / 'extension'
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        for f in ext_dir.rglob('*'):
            if not f.is_file():
                continue
            arcname = str(f.relative_to(ext_dir))
            # Skip the "wrong" manifest — use the right one
            if arcname == 'manifest_firefox.json' and browser == 'chrome':
                continue
            if arcname == 'manifest.json' and browser == 'firefox':
                continue
            # For Firefox: rename manifest_firefox.json → manifest.json
            if arcname == 'manifest_firefox.json' and browser == 'firefox':
                arcname = 'manifest.json'
            zf.write(f, arcname)
    buf.seek(0)
    name = f'suenweb-extension-{browser}.zip'
    return send_file(buf, mimetype='application/zip', as_attachment=True, download_name=name)


# ═══════════════════════════════════════════════════════════
#  ROUTES — AI Features (auth required)
# ═══════════════════════════════════════════════════════════
@app.route('/api/ai/describe', methods=['POST'])
@require_auth
def api_ai_describe():
    """Use LLM to generate descriptions. Supports bulk (no link_id) or single (with link_id)."""
    data = request.get_json() or {}
    llm_url = data.get('llm_url', '').strip()
    llm_key = data.get('llm_key', '').strip()
    llm_model = data.get('llm_model', '').strip()
    link_id = data.get('link_id')  # single link mode
    group_ids = data.get('group_ids')  # bulk: optional filter

    if not llm_url:
        return jsonify({'error': '请填写 LLM API 地址'}), 400
    if not llm_key:
        return jsonify({'error': '请填写 API Key'}), 400
    if not llm_model:
        return jsonify({'error': '请填写模型名称'}), 400

    db = get_db()

    # Single link mode
    if link_id:
        link = db.execute("SELECT id, title, url FROM links WHERE id=?", (link_id,)).fetchone()
        if not link:
            return jsonify({'error': '链接不存在'}), 404

        prompt = f"""为这个网站写一句简短中文描述（不超过15字）。只返回纯文本描述，不要任何其他内容。

网站：{link["title"]}
网址：{link["url"]}"""

        try:
            resp = requests.post(
                llm_url.rstrip('/') + '/chat/completions',
                headers={'Authorization': f'Bearer {llm_key}', 'Content-Type': 'application/json'},
                json={'model': llm_model, 'messages': [{'role': 'user', 'content': prompt}], 'temperature': 0.3},
                timeout=120,
            )
            if not resp.ok:
                return jsonify({'error': f'LLM API 返回: {resp.status_code}'}), 502

            # Use resp.content (bytes) and decode as UTF-8 to avoid requests'
            # auto-decoding which falls back to ISO-8859-1 when charset is missing
            result = _safe_json(resp.content.decode('utf-8'))
            if not result:
                return jsonify({'error': 'LLM 返回格式异常'}), 502

            msg = result['choices'][0]['message']
            desc = msg.get('content', '') or msg.get('reasoning_content', '')
            desc = desc.strip()[:50]
            if not desc:
                return jsonify({'error': 'LLM 返回内容为空，请增加 max_tokens 或换模型'}), 502
            db.execute("UPDATE links SET description=? WHERE id=?", (desc, link_id))
            db.commit()
            return Response(json.dumps({'description': desc, 'count': 1}, ensure_ascii=False),
                            mimetype='application/json; charset=utf-8')
        except requests.exceptions.Timeout:
            return jsonify({'error': 'LLM 请求超时 (120s)，模型推理时间较长，请重试'}), 504
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    # Bulk mode
    query = "SELECT l.id, l.title, l.url FROM links l WHERE (l.description IS NULL OR l.description = '')"
    params = []
    if group_ids:
        placeholders = ','.join('?' * len(group_ids))
        query += f" AND l.group_id IN ({placeholders})"
        params = group_ids
    links = db.execute(query, params).fetchall()

    if not links:
        return jsonify({'message': '所有链接已有描述', 'count': 0})

    # Progress tracking
    total = len(links)
    print(f'[AI Describe] 开始批量补全 {total} 个链接描述...')

    links_json = json.dumps([{'id': i, 'title': l['title'], 'url': l['url']} for i, l in enumerate(links)], ensure_ascii=False)
    prompt = f"""为以下网站列表生成中文描述（每项不超过15字）。严格按照 JSON 数组格式返回，不要任何其他内容。

格式：[{{"id": 索引, "desc": "描述"}}, ...]

网站列表：
{links_json}"""

    try:
        resp = requests.post(
            llm_url.rstrip('/') + '/chat/completions',
            headers={'Authorization': f'Bearer {llm_key}', 'Content-Type': 'application/json'},
            json={'model': llm_model, 'messages': [{'role': 'user', 'content': prompt}], 'temperature': 0.3},
            timeout=180,
        )
        if not resp.ok:
            return jsonify({'error': f'LLM API 返回: {resp.status_code}'}), 502

        result = _safe_json(resp.content.decode('utf-8'))
        if not result:
            return jsonify({'error': 'LLM 返回格式异常'}), 502

        content = result['choices'][0]['message'].get('content', '') or ''
        descs = _safe_json(content)
        if isinstance(descs, list):
            updated = 0
            for item in descs:
                idx = item.get('id', -1)
                desc = str(item.get('desc', ''))[:50]
                if 0 <= idx < len(links) and desc:
                    db.execute("UPDATE links SET description=? WHERE id=?", (desc, links[idx]['id']))
                    updated += 1
                    print(f'[AI Describe] {updated}/{total} {links[idx]["title"]}: {desc}')
        else:
            updated = _parse_descriptions_fallback(content, links, db)

        db.commit()
        print(f'[AI Describe] 完成！已为 {updated} 个链接生成描述')
        return jsonify({'message': f'已为 {updated} 个链接生成描述', 'count': updated})

    except requests.exceptions.Timeout:
        print('[AI Describe] 超时！')
        return jsonify({'error': 'LLM 请求超时 (180s)'}), 504
    except Exception as e:
        print(f'[AI Describe] 错误: {e}')
        return jsonify({'error': str(e)}), 500


def _safe_json(text: str):
    """Safely parse JSON from LLM response, handling various non-standard formats."""
    text = text.strip()
    # Remove streaming artifacts: "data: [DONE]" at end
    text = re.sub(r'data:\s*\[DONE\]\s*$', '', text)
    # Remove markdown code fences
    if text.startswith('```'):
        text = re.sub(r'^```\w*\n?', '', text)
        text = re.sub(r'\n?```$', '', text)
    # Try direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Try extracting from { to last }
    start = text.find('{')
    end = text.rfind('}')
    if start >= 0 and end > start:
        try:
            return json.loads(text[start:end+1])
        except json.JSONDecodeError:
            pass
    # Try [ to last ]
    start = text.find('[')
    end = text.rfind(']')
    if start >= 0 and end > start:
        try:
            return json.loads(text[start:end+1])
        except json.JSONDecodeError:
            pass
    return None


def _parse_descriptions_fallback(content: str, links, db) -> int:
    """Fallback: line-based parsing when JSON array parsing fails."""
    updated = 0
    for line in content.strip().split('\n'):
        line = line.strip()
        if not line: continue
        for pattern in [r'^(\d+)[:：]\s*(.+)', r'^(\d+)[\.、\s]+\s*(.+)']:
            m = re.match(pattern, line)
            if m:
                idx = int(m.group(1)); desc = m.group(2).strip()[:50]
                if 0 <= idx < len(links) and desc:
                    db.execute("UPDATE links SET description=? WHERE id=?", (desc, links[idx]['id']))
                    updated += 1
                break
    return updated


@app.route('/api/ai/check', methods=['POST'])
@require_auth
def api_ai_check():
    """Check selected links for broken URLs."""
    data = request.get_json() or {}
    group_ids = data.get('group_ids')

    db = get_db()
    query = "SELECT l.id, l.title, l.url, g.name as group_name FROM links l JOIN groups_table g ON l.group_id = g.id"
    params = []

    if group_ids is not None and len(group_ids) > 0:
        placeholders = ','.join('?' * len(group_ids))
        query += f" AND l.group_id IN ({placeholders})"
        params = group_ids

    links = db.execute(query, params).fetchall()
    if not links:
        return jsonify({'error': '没有找到链接'}), 400

    total = len(links)
    print(f'[Link Check] 开始检测 {total} 个链接...')

    results = []
    working = 0
    broken = 0

    for i, link in enumerate(links):
        status = _check_url(link['url'])
        item = {
            'id': link['id'], 'title': link['title'], 'url': link['url'],
            'group': link['group_name'], 'status': status['code'],
            'ok': status['ok'], 'error': status.get('error', ''),
        }
        results.append(item)
        if status['ok']: working += 1
        else: broken += 1
        if (i+1) % 5 == 0 or i+1 == total:
            print(f'[Link Check] {i+1}/{total} (正常:{working} 失效:{broken})')

    print(f'[Link Check] 完成！{working} 正常 / {broken} 失效 / {total} 总共')
    return jsonify({'total': total, 'working': working, 'broken': broken, 'results': results})


def _check_url(url: str, timeout: int = 8) -> dict:
    """Check if a URL is reachable. Returns {ok, code, error}."""
    try:
        resp = requests.head(url, timeout=timeout, allow_redirects=True,
                            headers={'User-Agent': 'Mozilla/5.0 SuenWeb/1.0'})
        return {'ok': 200 <= resp.status_code < 500, 'code': resp.status_code}
    except requests.exceptions.SSLError:
        # Try without SSL verification
        try:
            resp = requests.head(url, timeout=timeout, allow_redirects=True, verify=False,
                                headers={'User-Agent': 'Mozilla/5.0'})
            return {'ok': 200 <= resp.status_code < 500, 'code': resp.status_code}
        except Exception as e:
            return {'ok': False, 'code': 0, 'error': str(e)[:100]}
    except requests.exceptions.Timeout:
        return {'ok': False, 'code': 0, 'error': '超时'}
    except requests.exceptions.ConnectionError:
        return {'ok': False, 'code': 0, 'error': '无法连接'}
    except Exception as e:
        return {'ok': False, 'code': 0, 'error': str(e)[:100]}


# ═══════════════════════════════════════════════════════════
#  Init & Main
# ═══════════════════════════════════════════════════════════
# Ensure DB is initialized on import (for both dev server and gunicorn)
init_db()

if __name__ == '__main__':
    # debug=False to avoid Werkzeug reloader fork (was causing 'stuck' foreground in some shells)
    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)
