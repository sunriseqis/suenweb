"""
SuenWeb — 轻量个人导航页 (FastAPI + SQLite)
Async I/O for concurrent icon proxy; uvicorn for production.
Browser extension syncs bookmarks to this server.
"""

import os, json, sqlite3, hashlib, secrets, time, re, io, asyncio, warnings, ipaddress, socket, shutil, datetime, random
from pathlib import Path
from urllib.parse import urlparse
from contextlib import asynccontextmanager
from contextvars import ContextVar

import httpx
from fastapi import FastAPI, Request, HTTPException, Depends, Query, UploadFile, File
from fastapi.responses import (
    JSONResponse, HTMLResponse, Response, StreamingResponse, FileResponse,
)
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.cors import CORSMiddleware

from bookmark_parser import parse_bookmarks

# ── Suppress SSL warnings (link checker) ───────────────────
warnings.filterwarnings('ignore', message='Unverified HTTPS request')
from urllib3.exceptions import InsecureRequestWarning
warnings.filterwarnings('ignore', category=InsecureRequestWarning)

# ── Paths ──────────────────────────────────────────────────
BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / 'data'
DATA_DIR.mkdir(exist_ok=True)
LEGACY_DB_PATH = DATA_DIR / 'suenweb_new.db'
DB_PATH = DATA_DIR / 'suenweb.db'

# ═══════════════════════════════════════════════════════════
#  SSE Change Notifications (SQLite-backed, multi-worker safe)
# ═══════════════════════════════════════════════════════════
_SSE_LOCK = asyncio.Lock()
_SSE_CONNECTIONS = 0

async def _notify_change(kind: str, payload: dict | None = None):
    db = get_db()
    db.execute(
        "INSERT INTO event_log (kind, payload, created_ms) VALUES (?,?,?)",
        (kind, json.dumps(payload or {}, ensure_ascii=False), int(time.time() * 1000))
    )
    db.commit()

# ═══════════════════════════════════════════════════════════
#  Database (sync sqlite3, per-request via ContextVar)
# ═══════════════════════════════════════════════════════════
_db_ctx: ContextVar[sqlite3.Connection | None] = ContextVar('db', default=None)

def get_db() -> sqlite3.Connection:
    db = _db_ctx.get()
    if db is None:
        db = sqlite3.connect(str(DB_PATH), timeout=30, check_same_thread=False)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON")
        _db_ctx.set(db)
    return db


def _ensure_tables(conn: sqlite3.Connection):
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
            created_at  TEXT DEFAULT (datetime('now','localtime'))
        );
        CREATE TABLE IF NOT EXISTS wallpaper_state (
            id              INTEGER PRIMARY KEY DEFAULT 1,
            current_url     TEXT DEFAULT '',
            current_index   INTEGER DEFAULT 0,
            current_image_idx INTEGER DEFAULT 0,
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
        CREATE TABLE IF NOT EXISTS steamgriddb_cache (
            game_id     TEXT NOT NULL,
            image_url   TEXT NOT NULL,
            style       TEXT DEFAULT '',
            fetched_at  TEXT DEFAULT (datetime('now','localtime')),
            PRIMARY KEY (game_id, image_url)
        );
        INSERT OR IGNORE INTO sync_state (id) VALUES (1);
        INSERT OR IGNORE INTO wallpaper_state (id) VALUES (1);
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
    """)
    # Performance indexes
    conn.execute("CREATE INDEX IF NOT EXISTS idx_links_group_id ON links(group_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_links_synced ON links(synced_to_browser)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_links_imported ON links(is_imported)")
    # Migrations
    existing = {r[1] for r in conn.execute("PRAGMA table_info(links)")}
    if 'synced_to_browser' not in existing:
        conn.execute("ALTER TABLE links ADD COLUMN synced_to_browser INTEGER DEFAULT 1")
    gcols = {r[1] for r in conn.execute("PRAGMA table_info(groups_table)")}
    if 'display_mode' not in gcols:
        conn.execute("ALTER TABLE groups_table ADD COLUMN display_mode TEXT DEFAULT 'compact'")
    wcols = {r[1] for r in conn.execute("PRAGMA table_info(wallpapers)")}
    if 'source_type' not in wcols:
        conn.execute("ALTER TABLE wallpapers ADD COLUMN source_type TEXT DEFAULT 'url'")
    wscols = {r[1] for r in conn.execute("PRAGMA table_info(wallpaper_state)")}
    if 'current_image_idx' not in wscols:
        conn.execute("ALTER TABLE wallpaper_state ADD COLUMN current_image_idx INTEGER DEFAULT 0")

    wcount = conn.execute("SELECT COUNT(*) FROM wallpapers").fetchone()[0]
    if wcount == 0:
        _seed_wallpapers(conn)
    else:
        _migrate_wallpapers(conn)

    fcount = conn.execute("SELECT COUNT(*) FROM fonts WHERE category='builtin'").fetchone()[0]
    if fcount == 0:
        _seed_fonts(conn)
    conn.commit()


def _seed_wallpapers(conn):
    builtin = [
        ('必应每日', 'https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8', 'builtin', 0, 'url'),
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


def _migrate_wallpapers(conn):
    dead_domains = ('ixiaowai.cn', 'mtyqx.cn')
    for d in dead_domains:
        conn.execute("DELETE FROM wallpapers WHERE url LIKE ?", (f'%{d}%',))
    conn.execute("DELETE FROM wallpapers WHERE url LIKE '%dmoe.cc%'")
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


def _seed_fonts(conn):
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


def init_db():
    def link_count(path: Path) -> int:
        if not path.exists():
            return -1
        try:
            c = sqlite3.connect(str(path))
            try:
                row = c.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='links'").fetchone()
                if not row or row[0] == 0:
                    return 0
                return c.execute("SELECT COUNT(*) FROM links").fetchone()[0]
            finally:
                c.close()
        except Exception:
            return 0
    if LEGACY_DB_PATH.exists() and (not DB_PATH.exists() or (link_count(DB_PATH) == 0 and link_count(LEGACY_DB_PATH) > 0)):
        shutil.copy2(LEGACY_DB_PATH, DB_PATH)
    conn = sqlite3.connect(str(DB_PATH), timeout=30, check_same_thread=False)
    try:
        try:
            conn.execute("PRAGMA journal_mode=WAL")
        except Exception:
            pass
        _ensure_tables(conn)
    finally:
        conn.close()

# ── Auth helpers ───────────────────────────────────────────
def _get_setting(key: str, default: str = '') -> str:
    db = get_db()
    row = db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return row['value'] if row else default

def _set_setting(key: str, value: str):
    db = get_db()
    db.execute("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)", (key, value))
    db.commit()

def _hash_pw(pw: str) -> str:
    salt = secrets.token_hex(16)
    rounds = 260000
    digest = hashlib.pbkdf2_hmac('sha256', pw.encode(), salt.encode(), rounds).hex()
    return f'pbkdf2_sha256${rounds}${salt}${digest}'

def _verify_pw(pw: str, stored: str) -> bool:
    if not pw or not stored:
        return False
    # Legacy SHA256 hash compatibility; next password change/setup writes PBKDF2.
    if re.fullmatch(r'[0-9a-f]{64}', stored or ''):
        return secrets.compare_digest(hashlib.sha256(pw.encode()).hexdigest(), stored)
    try:
        algo, rounds, salt, digest = stored.split('$', 3)
        if algo != 'pbkdf2_sha256':
            return False
        calc = hashlib.pbkdf2_hmac('sha256', pw.encode(), salt.encode(), int(rounds)).hex()
        return secrets.compare_digest(calc, digest)
    except Exception:
        return False

def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()

def _issue_token() -> str:
    token = secrets.token_urlsafe(32)
    expires_at = int(time.time()) + 90 * 24 * 3600
    db = get_db()
    db.execute("DELETE FROM auth_tokens WHERE expires_at < ?", (int(time.time()),))
    db.execute("INSERT INTO auth_tokens (token_hash, expires_at) VALUES (?,?)", (_hash_token(token), expires_at))
    db.commit()
    return token

def _is_bearer_authorized(token: str) -> bool:
    if not token:
        return False
    db = get_db()
    row = db.execute("SELECT expires_at FROM auth_tokens WHERE token_hash=?", (_hash_token(token),)).fetchone()
    if row and row['expires_at'] >= int(time.time()):
        return True
    return False

async def require_auth(request: Request):
    auth = request.headers.get('Authorization', '')
    token = auth.replace('Bearer ', '').strip()
    pw_hash = _get_setting('auth_password_hash', '')
    if not pw_hash:
        raise HTTPException(401, detail='No password set')
    if not _is_bearer_authorized(token):
        raise HTTPException(401, detail='Unauthorized')
    return True

# ── Helpers ────────────────────────────────────────────────
def _normalize_url(url: str) -> str:
    url = url.strip().lower()
    url = re.sub(r'^https?://(www\.)?', '', url)
    return url.rstrip('/')

def _get_all_data():
    db = get_db()
    groups = db.execute("SELECT * FROM groups_table ORDER BY sort_order, id").fetchall()
    all_links = db.execute("SELECT * FROM links ORDER BY group_id, sort_order, id").fetchall()
    links_by_group = {}
    for l in all_links:
        links_by_group.setdefault(l['group_id'], []).append(dict(l))
    result = []
    for g in groups:
        result.append({
            'id': g['id'], 'name': g['name'], 'icon': g['icon'],
            'type': g['type'], 'display_mode': g['display_mode'] or 'compact',
            'sort_order': g['sort_order'],
            'is_imported': bool(g['is_imported']),
            'links': links_by_group.get(g['id'], []),
        })
    return result

def _get_all_data_threadsafe():
    token = _db_ctx.set(None)
    try:
        return _get_all_data()
    finally:
        db = _db_ctx.get()
        if db:
            db.close()
        _db_ctx.reset(token)

def _log_action(action: str, target: str = '', detail: dict | None = None):
    try:
        db = get_db()
        db.execute(
            "INSERT INTO operation_log (action, target, detail) VALUES (?,?,?)",
            (action, target, json.dumps(detail or {}, ensure_ascii=False))
        )
    except Exception:
        pass

def _parse_uploaded_bookmarks(text: str) -> list[dict]:
    parsed = parse_bookmarks(text)
    folders = []
    for folder in parsed:
        bookmarks = []
        for link in folder.get('links', []):
            title = (link.get('title') or '').strip()
            url = (link.get('url') or '').strip()
            if title and url:
                bookmarks.append({'title': title, 'url': url})
        if bookmarks:
            folders.append({'name': (folder.get('name') or '未命名').strip() or '未命名', 'bookmarks': bookmarks})
    return folders

def _preview_bookmark_folders(db, folders: list[dict]) -> dict:
    existing_global = {_normalize_url(r['url']) for r in db.execute("SELECT url FROM links").fetchall()}
    groups = []
    total = duplicate = new_count = 0
    for folder in folders:
        links = folder.get('bookmarks', [])
        total += len(links)
        folder_dup = 0
        samples = []
        for bm in links:
            is_dup = _normalize_url(bm.get('url', '')) in existing_global
            folder_dup += 1 if is_dup else 0
            if len(samples) < 5:
                samples.append({'title': bm.get('title', ''), 'url': bm.get('url', ''), 'duplicate': is_dup})
        duplicate += folder_dup
        new_count += len(links) - folder_dup
        groups.append({'name': folder.get('name', '未命名'), 'total': len(links), 'new': len(links) - folder_dup, 'duplicate': folder_dup, 'samples': samples})
    return {'groups': groups, 'total': total, 'new': new_count, 'duplicate': duplicate}

def _escape_html(s: str) -> str:
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

def _escape_attr(s: str) -> str:
    return s.replace('&', '&amp;').replace('"', '&quot;')

def _is_safe_remote_url(raw_url: str, *, allow_private: bool = False) -> bool:
    try:
        parsed = urlparse(raw_url)
        if parsed.scheme not in ('http', 'https') or not parsed.hostname:
            return False
        host = parsed.hostname
        if host.lower() in ('localhost',):
            return allow_private
        try:
            ip = ipaddress.ip_address(host)
            return allow_private or not (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast)
        except ValueError:
            if allow_private:
                return True
            try:
                infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
                for info in infos[:5]:
                    ip = ipaddress.ip_address(info[4][0])
                    if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast:
                        return False
            except Exception:
                return False
            return True
    except Exception:
        return False

# ── DB middleware: clean up connection per request ─────────
class DBMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        try:
            return await call_next(request)
        finally:
            db = _db_ctx.get()
            if db:
                db.close()
                _db_ctx.set(None)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title='SuenWeb', lifespan=lifespan)
app.add_middleware(DBMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)
app.mount('/static', StaticFiles(directory=str(BASE_DIR / 'static')), name='static')

# ═══════════════════════════════════════════════════════════
#  ROUTES — Pages
# ═══════════════════════════════════════════════════════════
@app.get('/')
async def index(request: Request):
    return FileResponse(str(BASE_DIR / 'templates' / 'index.html'), media_type='text/html')


@app.get('/health')
async def health():
    return {'status': 'ok', 'ts': int(time.time() * 1000)}


# ═══════════════════════════════════════════════════════════
#  ROUTES — Auth API
# ═══════════════════════════════════════════════════════════
@app.get('/api/auth/status')
async def api_auth_status():
    pw_hash = _get_setting('auth_password_hash', '')
    return {'has_password': bool(pw_hash)}

@app.post('/api/auth/setup')
async def api_auth_setup(request: Request):
    pw_hash = _get_setting('auth_password_hash', '')
    if pw_hash:
        raise HTTPException(400, detail='密码已设置')
    data = await request.json() or {}
    password = data.get('password', '').strip()
    if len(password) < 4:
        raise HTTPException(400, detail='密码至少4位')
    _set_setting('auth_password_hash', _hash_pw(password))
    return {'ok': True, 'token': _issue_token()}

@app.post('/api/auth/login')
async def api_auth_login(request: Request):
    pw_hash = _get_setting('auth_password_hash', '')
    if not pw_hash:
        raise HTTPException(400, detail='请先设置密码')
    data = await request.json() or {}
    password = data.get('password', '').strip()
    if not _verify_pw(password, pw_hash):
        raise HTTPException(401, detail='密码错误')
    return {'ok': True, 'token': _issue_token()}

@app.post('/api/auth/logout')
async def api_auth_logout(request: Request, _=Depends(require_auth)):
    token = request.headers.get('Authorization', '').replace('Bearer ', '').strip()
    if token:
        db = get_db()
        db.execute("DELETE FROM auth_tokens WHERE token_hash=?", (_hash_token(token),))
        db.commit()
    return {'ok': True}

@app.post('/api/auth/change-password')
async def api_change_password(request: Request, _=Depends(require_auth)):
    data = await request.json() or {}
    old_pw = data.get('old_password', '')
    new_pw = data.get('new_password', '').strip()
    if len(new_pw) < 4:
        raise HTTPException(400, detail='新密码至少4位')
    current_hash = _get_setting('auth_password_hash', '')
    if not _verify_pw(old_pw, current_hash):
        raise HTTPException(401, detail='旧密码错误')
    _set_setting('auth_password_hash', _hash_pw(new_pw))
    db = get_db()
    db.execute("DELETE FROM auth_tokens")
    db.commit()
    return {'ok': True, 'token': _issue_token()}


# ═══════════════════════════════════════════════════════════
#  ROUTES — Bookmark Sync
# ═══════════════════════════════════════════════════════════
@app.post('/api/sync')
async def api_sync_bookmarks(request: Request, _=Depends(require_auth)):
    db = get_db()
    content_type = request.headers.get('content-type', '')

    if 'application/json' in content_type:
        data = await request.json() or {}
        folders = data.get('folders', [])
        if not folders:
            raise HTTPException(400, detail='No bookmark data')
        imported_count = _merge_bookmark_folders(db, folders)
    else:
        form = await request.form()
        file = form.get('file')
        if not file:
            raise HTTPException(400, detail='No file provided')
        content = await file.read()
        try:
            text = content.decode('utf-8')
        except UnicodeDecodeError:
            text = content.decode('gbk', errors='replace')
        try:
            folders = _parse_uploaded_bookmarks(text)
        except Exception as e:
            raise HTTPException(400, detail=f'解析失败: {e}')
        imported_count = _merge_bookmark_folders(db, folders)

    db.execute(
        "UPDATE sync_state SET last_sync_at=datetime('now','localtime'), last_sync_from=? WHERE id=1",
        ('extension',)
    )
    db.commit()
    if imported_count > 0:
        _log_action('import_bookmarks', 'bookmarks', {'imported': imported_count})
        await _notify_change('sync_imported', {'imported': imported_count})
    return {'ok': True, 'imported': imported_count}

@app.post('/api/import/preview')
async def api_import_preview(request: Request, _=Depends(require_auth)):
    form = await request.form()
    file = form.get('file')
    if not file:
        raise HTTPException(400, detail='No file provided')
    content = await file.read()
    try:
        text = content.decode('utf-8')
    except UnicodeDecodeError:
        text = content.decode('gb18030', errors='replace')
    try:
        folders = _parse_uploaded_bookmarks(text)
    except Exception as e:
        raise HTTPException(400, detail=f'解析失败: {e}')
    return _preview_bookmark_folders(get_db(), folders)


def _merge_bookmark_folders(db, folders):
    total_new = 0
    for folder in folders:
        name = folder.get('name', '未命名').strip()
        if not name:
            continue
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
        existing = db.execute("SELECT url FROM links WHERE group_id=?", (group_id,)).fetchall()
        existing_norm = {_normalize_url(r['url']) for r in existing}
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
                continue
            max_link_order += 1
            db.execute(
                "INSERT INTO links (group_id, title, url, icon_type, sort_order, is_imported, synced_to_browser) VALUES (?,?,?,'auto',?,1,1)",
                (group_id, title, url, max_link_order)
            )
            existing_norm.add(norm_url)
            total_new += 1
    return total_new


@app.delete('/api/sync/bookmark')
async def api_sync_delete_bookmark(url: str = Query(''), _=Depends(require_auth)):
    url = url.strip()
    if not url:
        raise HTTPException(400, detail='Missing url')
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
            break
    db.commit()
    if deleted:
        await _notify_change('link_deleted', {'url': url, 'group_name': deleted_group_name})
    return {'deleted': deleted}


@app.get('/api/sync/status')
async def api_sync_status(_=Depends(require_auth)):
    db = get_db()
    row = db.execute("SELECT * FROM sync_state WHERE id=1").fetchone()
    total_links = db.execute("SELECT COUNT(*) as cnt FROM links").fetchone()['cnt']
    total_groups = db.execute("SELECT COUNT(*) as cnt FROM groups_table").fetchone()['cnt']
    pending = db.execute("SELECT COUNT(*) as cnt FROM links WHERE synced_to_browser=0").fetchone()['cnt']
    return {
        'last_sync_at': row['last_sync_at'] if row else None,
        'last_sync_from': row['last_sync_from'] if row else None,
        'total_links': total_links,
        'total_groups': total_groups,
        'pending_sync': pending,
        'listeners': _SSE_CONNECTIONS,
    }

@app.post('/api/sync/heartbeat')
async def api_sync_heartbeat(_=Depends(require_auth)):
    db = get_db()
    db.execute(
        "UPDATE sync_state SET last_sync_at=datetime('now','localtime'), last_sync_from='plugin' WHERE id=1"
    )
    db.commit()
    return {'ok': True}


@app.get('/api/sync/pending')
async def api_sync_pending(_=Depends(require_auth)):
    db = get_db()
    rows = db.execute(
        "SELECT l.id, l.group_id, l.title, l.url, l.icon_type, l.description, "
        "g.name as group_name, g.type as group_type "
        "FROM links l JOIN groups_table g ON l.group_id = g.id "
        "WHERE l.synced_to_browser=0 ORDER BY l.id"
    ).fetchall()
    links = [{
        'id': r['id'], 'group_id': r['group_id'], 'title': r['title'],
        'url': r['url'], 'icon_type': r['icon_type'], 'description': r['description'],
        'group_name': r['group_name'], 'group_type': r['group_type'],
    } for r in rows]
    return {'links': links, 'count': len(links)}


@app.post('/api/sync/ack')
async def api_sync_ack(request: Request, _=Depends(require_auth)):
    data = await request.json() or {}
    ids = data.get('ids', [])
    if not ids:
        raise HTTPException(400, detail='Missing ids')
    db = get_db()
    placeholders = ','.join(['?'] * len(ids))
    db.execute(f"UPDATE links SET synced_to_browser=1 WHERE id IN ({placeholders})", ids)
    db.commit()
    return {'ok': True, 'acked': len(ids)}


# ═══════════════════════════════════════════════════════════
#  ROUTES — SSE
# ═══════════════════════════════════════════════════════════
@app.get('/api/events/stream')
async def api_events_stream(_=Depends(require_auth)):
    async def gen():
        global _SSE_CONNECTIONS
        async with _SSE_LOCK:
            _SSE_CONNECTIONS += 1
        db = get_db()
        row = db.execute("SELECT COALESCE(MAX(id), 0) AS max_id FROM event_log").fetchone()
        last_id = row['max_id'] if row else 0
        try:
            yield f"event: hello\ndata: {json.dumps({'ts': int(time.time()*1000)})}\n\n"
            last_hb = time.time()
            while True:
                await asyncio.sleep(2)
                db = get_db()
                rows = db.execute(
                    "SELECT id, kind, payload, created_ms FROM event_log WHERE id>? ORDER BY id LIMIT 100",
                    (last_id,)
                ).fetchall()
                for r in rows:
                    last_id = r['id']
                    msg = {
                        'kind': r['kind'],
                        'payload': _safe_json(r['payload']) or {},
                        'ts': r['created_ms'],
                    }
                    yield f"event: change\ndata: {json.dumps(msg, ensure_ascii=False)}\n\n"
                if time.time() - last_hb > 25:
                    yield ": heartbeat\n\n"
                    last_hb = time.time()
        except (asyncio.CancelledError, GeneratorExit):
            pass
        finally:
            async with _SSE_LOCK:
                _SSE_CONNECTIONS = max(0, _SSE_CONNECTIONS - 1)

    return StreamingResponse(
        gen(),
        media_type='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
            'Connection': 'keep-alive',
        }
    )


# ═══════════════════════════════════════════════════════════
#  ROUTES — Data API
# ═══════════════════════════════════════════════════════════
@app.get('/api/data')
async def api_get_data():
    return {'groups': await asyncio.to_thread(_get_all_data_threadsafe)}


@app.post('/api/groups', status_code=201)
async def api_create_group(request: Request, _=Depends(require_auth)):
    data = await request.json() or {}
    name = data.get('name', '').strip()
    if not name:
        raise HTTPException(400, detail='名称不能为空')
    icon = data.get('icon', '📁')
    gtype = data.get('type', 'tab')
    db = get_db()
    max_order = db.execute("SELECT COALESCE(MAX(sort_order), -1) FROM groups_table").fetchone()[0]
    cur = db.execute(
        "INSERT INTO groups_table (name, icon, type, sort_order) VALUES (?,?,?,?)",
        (name, icon, gtype, max_order + 1)
    )
    _log_action('create_group', 'group', {'id': cur.lastrowid, 'name': name})
    db.commit()
    await _notify_change('group_created', {'id': cur.lastrowid, 'name': name})
    return {'id': cur.lastrowid, 'name': name, 'icon': icon, 'type': gtype, 'links': []}


@app.put('/api/groups/{gid}')
async def api_update_group(gid: int, request: Request, _=Depends(require_auth)):
    data = await request.json() or {}
    db = get_db()
    for field in ['name', 'icon', 'type', 'display_mode', 'sort_order']:
        if field in data:
            db.execute(f"UPDATE groups_table SET {field}=? WHERE id=?", (data[field], gid))
    db.commit()
    row = db.execute("SELECT * FROM groups_table WHERE id=?", (gid,)).fetchone()
    if not row:
        raise HTTPException(404, detail='Not found')
    _log_action('update_group', 'group', {'id': gid})
    await _notify_change('group_updated', {'id': gid})
    return dict(row)


@app.delete('/api/groups/{gid}')
async def api_delete_group(gid: int, _=Depends(require_auth)):
    db = get_db()
    row = db.execute("SELECT name FROM groups_table WHERE id=?", (gid,)).fetchone()
    if not row:
        return {'ok': True}
    group_name = row['name']
    db.execute("DELETE FROM groups_table WHERE id=?", (gid,))
    _log_action('delete_group', 'group', {'id': gid, 'name': group_name})
    db.commit()
    await _notify_change('group_deleted', {'id': gid, 'name': group_name})
    return {'ok': True}


@app.post('/api/links', status_code=201)
async def api_create_link(request: Request, _=Depends(require_auth)):
    data = await request.json() or {}
    group_id = data.get('group_id')
    group_name = data.get('group_name', '').strip()
    group_type = data.get('group_type', 'tab')
    title = data.get('title', '').strip()
    url = data.get('url', '').strip()

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
            _log_action('create_group', 'group', {'id': cur.lastrowid, 'name': group_name})
            db.commit()
            group_id = cur.lastrowid
            await _notify_change('group_created', {'id': group_id, 'name': group_name})

    if not title or not url or not group_id:
        raise HTTPException(400, detail='缺少必填字段')
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
    _log_action('create_link', 'link', {'id': cur.lastrowid, 'title': title, 'url': url, 'group_id': group_id})
    db.commit()
    await _notify_change('link_created', {'id': cur.lastrowid, 'group_id': group_id, 'title': title})
    return {'id': cur.lastrowid}


@app.put('/api/links/{lid}')
async def api_update_link(lid: int, request: Request, _=Depends(require_auth)):
    data = await request.json() or {}
    db = get_db()
    for field in ['title', 'url', 'description', 'icon', 'icon_type', 'group_id', 'sort_order']:
        if field in data:
            db.execute(f"UPDATE links SET {field}=? WHERE id=?", (data[field], lid))
    db.commit()
    row = db.execute("SELECT * FROM links WHERE id=?", (lid,)).fetchone()
    if not row:
        raise HTTPException(404, detail='Not found')
    _log_action('update_link', 'link', {'id': lid})
    await _notify_change('link_updated', {'id': lid})
    return dict(row)


@app.delete('/api/links/{lid}')
async def api_delete_link(lid: int, _=Depends(require_auth)):
    db = get_db()
    row = db.execute(
        "SELECT l.url, g.name as group_name FROM links l JOIN groups_table g ON l.group_id = g.id WHERE l.id=?",
        (lid,)
    ).fetchone()
    url = row['url'] if row else None
    group_name = row['group_name'] if row else None
    db.execute("DELETE FROM links WHERE id=?", (lid,))
    if url:
        _log_action('delete_link', 'link', {'id': lid, 'url': url, 'group_name': group_name})
    if group_name:
        remaining = db.execute(
            "SELECT COUNT(*) as cnt FROM links l JOIN groups_table g ON l.group_id = g.id WHERE g.name=?",
            (group_name,)
        ).fetchone()
        if remaining and remaining['cnt'] == 0:
            db.execute("DELETE FROM groups_table WHERE name=?", (group_name,))
            await _notify_change('group_deleted', {'name': group_name})
    db.commit()
    await _notify_change('link_deleted', {'id': lid, 'url': url, 'group_name': group_name})
    return {'ok': True}

@app.post('/api/reorder/groups')
async def api_reorder_groups(request: Request, _=Depends(require_auth)):
    data = await request.json() or {}
    ids = [int(x) for x in data.get('ids', [])]
    db = get_db()
    for idx, gid in enumerate(ids):
        db.execute("UPDATE groups_table SET sort_order=? WHERE id=?", (idx, gid))
    _log_action('reorder_groups', 'group', {'ids': ids})
    db.commit()
    await _notify_change('groups_reordered', {'ids': ids})
    return {'ok': True}

@app.post('/api/reorder/links')
async def api_reorder_links(request: Request, _=Depends(require_auth)):
    data = await request.json() or {}
    group_id = int(data.get('group_id') or 0)
    ids = [int(x) for x in data.get('ids', [])]
    if not group_id or not ids:
        raise HTTPException(400, detail='缺少分组或链接')
    db = get_db()
    for idx, lid in enumerate(ids):
        db.execute("UPDATE links SET group_id=?, sort_order=?, synced_to_browser=0 WHERE id=?", (group_id, idx, lid))
    _log_action('reorder_links', 'link', {'group_id': group_id, 'ids': ids})
    db.commit()
    await _notify_change('links_reordered', {'group_id': group_id, 'ids': ids})
    return {'ok': True}

@app.get('/api/tools/duplicates')
async def api_find_duplicates(_=Depends(require_auth)):
    db = get_db()
    rows = db.execute(
        "SELECT l.id, l.title, l.url, g.name AS group_name FROM links l JOIN groups_table g ON l.group_id=g.id ORDER BY l.id"
    ).fetchall()
    buckets = {}
    for r in rows:
        buckets.setdefault(_normalize_url(r['url']), []).append(dict(r))
    groups = [{'url_key': key, 'items': items} for key, items in buckets.items() if len(items) > 1]
    return {'total_groups': len(groups), 'total_duplicates': sum(len(g['items']) - 1 for g in groups), 'groups': groups}

@app.post('/api/tools/duplicates/delete')
async def api_delete_duplicates(request: Request, _=Depends(require_auth)):
    data = await request.json() or {}
    ids = [int(x) for x in data.get('ids', [])]
    if not ids:
        return {'deleted': 0}
    placeholders = ','.join('?' * len(ids))
    db = get_db()
    db.execute(f"DELETE FROM links WHERE id IN ({placeholders})", ids)
    _log_action('delete_duplicates', 'link', {'ids': ids})
    db.commit()
    await _notify_change('duplicates_deleted', {'ids': ids})
    return {'deleted': len(ids)}

@app.get('/api/ops/logs')
async def api_operation_logs(limit: int = Query(50, ge=1, le=200), _=Depends(require_auth)):
    rows = get_db().execute(
        "SELECT * FROM operation_log ORDER BY id DESC LIMIT ?", (limit,)
    ).fetchall()
    return {'logs': [dict(r) | {'detail': _safe_json(r['detail']) or {}} for r in rows]}


# ═══════════════════════════════════════════════════════════
#  ROUTES — Export
# ═══════════════════════════════════════════════════════════
@app.get('/api/export')
async def api_export_bookmarks(_=Depends(require_auth)):
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
    return Response(html, media_type='text/html; charset=utf-8',
                    headers={'Content-Disposition': 'attachment; filename=suenweb_bookmarks.html'})


# ═══════════════════════════════════════════════════════════
#  ROUTES — Settings
# ═══════════════════════════════════════════════════════════
@app.get('/api/settings')
async def api_get_settings(request: Request):
    db = get_db()
    token = request.headers.get('Authorization', '').replace('Bearer ', '').strip()
    if _is_bearer_authorized(token):
        rows = db.execute("SELECT key, value FROM settings WHERE key NOT LIKE 'auth_%'").fetchall()
    else:
        public_keys = [
            'theme', 'pattern', 'glass_intensity', 'weather_city',
            'clock_format', 'weather_size', 'widget_style', 'clock_size', 'search_engines', 'search_default',
            'background_type', 'wallpaper_interval',
            'font_body', 'font_title', 'font_body_en', 'font_code', 'font_size',
            'accent_color', 'color_scheme', 'style', 'bg_solid_color'
        ]
        placeholders = ','.join('?' * len(public_keys))
        rows = db.execute(f"SELECT key, value FROM settings WHERE key IN ({placeholders})", public_keys).fetchall()
    return {r['key']: r['value'] for r in rows}

@app.put('/api/settings')
async def api_update_settings(request: Request, _=Depends(require_auth)):
    data = await request.json() or {}
    allowed = ['pattern', 'glass_intensity', 'weather_city',
               'clock_format', 'weather_size', 'widget_style', 'clock_size', 'search_engines', 'search_default',
               'llm_url', 'llm_key', 'llm_model',
               'background_type', 'wallpaper_interval',
               'font_body', 'font_title', 'font_body_en', 'font_code', 'font_size',
               'accent_color', 'style', 'bg_solid_color', 'color_scheme',
               'steamgriddb_api_key']
    for key in allowed:
        if key in data:
            _set_setting(key, str(data[key]))
    return {'ok': True}


# ═══════════════════════════════════════════════════════════
#  ROUTES — Config Export/Import
# ═══════════════════════════════════════════════════════════
@app.get('/api/config/export')
async def api_config_export(_=Depends(require_auth)):
    """导出所有配置（设置、分组、链接、壁纸源）"""
    db = get_db()
    
    # 导出所有设置（包括密码、API Key等）
    settings_rows = db.execute("SELECT key, value FROM settings").fetchall()
    settings = {r['key']: r['value'] for r in settings_rows}
    
    # 导出分组
    groups_rows = db.execute("SELECT id, name, icon, display_mode, sort_order FROM groups_table ORDER BY sort_order").fetchall()
    groups = []
    for g in groups_rows:
        links_rows = db.execute("SELECT title, url, description, icon, icon_type, sort_order FROM links WHERE group_id=? ORDER BY sort_order", (g['id'],)).fetchall()
        links = [dict(l) for l in links_rows]
        groups.append({
            'name': g['name'],
            'icon': g['icon'],
            'display_mode': g['display_mode'],
            'sort_order': g['sort_order'],
            'links': links
        })
    
    # 导出壁纸源（排除内置源，只导出用户自定义的）
    wp_rows = db.execute("SELECT name, url, category, enabled, sort_order, source_type FROM wallpapers WHERE category!='builtin' ORDER BY sort_order").fetchall()
    wallpapers = [dict(w) for w in wp_rows]
    
    # 导出字体设置（排除内置字体）
    font_rows = db.execute("SELECT name, family, category, cdn_url, language, sort_order FROM fonts WHERE category!='builtin' ORDER BY sort_order").fetchall()
    fonts = [dict(f) for f in font_rows]
    
    return {
        'version': 1,
        'exported_at': datetime.datetime.now().isoformat(),
        'settings': settings,
        'groups': groups,
        'wallpapers': wallpapers,
        'fonts': fonts
    }

@app.post('/api/config/import')
async def api_config_import(request: Request, _=Depends(require_auth)):
    """导入配置"""
    data = await request.json() or {}
    
    if data.get('version') != 1:
        raise HTTPException(400, detail='不支持的配置版本')
    
    db = get_db()
    imported = {'settings': 0, 'groups': 0, 'links': 0, 'wallpapers': 0, 'fonts': 0}
    
    # 导入设置（包括密码、API Key等）
    if 'settings' in data:
        allowed = ['pattern', 'glass_intensity', 'weather_city',
                   'clock_format', 'weather_size', 'widget_style', 'clock_size', 'search_engines', 'search_default',
                   'llm_url', 'llm_key', 'llm_model',
                   'background_type', 'wallpaper_interval',
                   'font_body', 'font_title', 'font_body_en', 'font_code', 'font_size',
                   'accent_color', 'style', 'bg_solid_color', 'color_scheme',
                   'steamgriddb_api_key',
                   'auth_password', 'auth_password_hash']
        for key, value in data['settings'].items():
            if key in allowed:
                _set_setting(key, str(value))
                imported['settings'] += 1
    
    # 导入分组和链接
    if 'groups' in data:
        # 清空现有分组和链接
        db.execute("DELETE FROM links")
        db.execute("DELETE FROM groups_table WHERE id > 0")
        
        for g in data['groups']:
            cur = db.execute(
                "INSERT INTO groups_table (name, icon, display_mode, sort_order) VALUES (?,?,?,?)",
                (g.get('name', ''), g.get('icon', '📁'), g.get('display_mode', 'grid'), g.get('sort_order', 0))
            )
            gid = cur.lastrowid
            imported['groups'] += 1
            
            for l in g.get('links', []):
                db.execute(
                    "INSERT INTO links (group_id, title, url, description, icon, icon_type, sort_order) VALUES (?,?,?,?,?,?,?)",
                    (gid, l.get('title', ''), l.get('url', ''), l.get('description', ''), l.get('icon', ''), l.get('icon_type', 'emoji'), l.get('sort_order', 0))
                )
                imported['links'] += 1
    
    # 导入壁纸源
    if 'wallpapers' in data:
        for w in data['wallpapers']:
            try:
                db.execute(
                    "INSERT INTO wallpapers (name, url, category, enabled, sort_order, source_type) VALUES (?,?,?,?,?,?)",
                    (w.get('name', ''), w.get('url', ''), w.get('category', 'custom'), int(w.get('enabled', 1)), w.get('sort_order', 0), w.get('source_type', 'url'))
                )
                imported['wallpapers'] += 1
            except Exception:
                pass
    
    # 导入字体
    if 'fonts' in data:
        for f in data['fonts']:
            try:
                db.execute(
                    "INSERT INTO fonts (name, family, category, cdn_url, language, sort_order) VALUES (?,?,?,?,?,?)",
                    (f.get('name', ''), f.get('family', ''), f.get('category', 'custom'), f.get('cdn_url', ''), f.get('language', 'zh'), f.get('sort_order', 0))
                )
                imported['fonts'] += 1
            except Exception:
                pass
    
    db.commit()
    return {'ok': True, 'imported': imported}


# ═══════════════════════════════════════════════════════════
#  ROUTES — Wallpaper
# ═══════════════════════════════════════════════════════════
@app.get('/api/wallpaper')
async def api_wallpaper():
    db = get_db()
    state = db.execute("SELECT * FROM wallpaper_state WHERE id=1").fetchone()
    url = state['current_url'] if state else ''
    if not url:
        url = await _fetch_wallpaper_url(db)
        if url:
            db.execute("UPDATE wallpaper_state SET current_url=?, last_refresh_at=datetime('now','localtime') WHERE id=1", (url,))
            db.commit()
    return {'url': url, 'background_type': _get_setting('background_type', 'pattern')}

@app.get('/api/wallpaper/sources')
async def api_wallpaper_sources():
    db = get_db()
    rows = db.execute("SELECT * FROM wallpapers ORDER BY sort_order, id").fetchall()
    sources = [dict(r) for r in rows]
    interval = _get_setting('wallpaper_interval', '900')
    bg_type = _get_setting('background_type', 'pattern')
    state = db.execute("SELECT * FROM wallpaper_state WHERE id=1").fetchone()
    sgdb_key = _get_setting('steamgriddb_api_key', '')
    return {
        'sources': sources,
        'interval': int(interval),
        'background_type': bg_type,
        'current_index': state['current_index'] if state else 0,
        'steamgriddb_api_key': sgdb_key[:4] + '****' + sgdb_key[-4:] if len(sgdb_key) > 8 else sgdb_key,
        'steamgriddb_configured': bool(sgdb_key.strip()),
    }

@app.post('/api/wallpaper/source', status_code=201)
async def api_add_wallpaper_source(request: Request, _=Depends(require_auth)):
    data = await request.json() or {}
    name = data.get('name', '').strip()
    url = data.get('url', '').strip()
    source_type = data.get('source_type', 'url')
    if not name or not url:
        raise HTTPException(400, detail='名称和URL/游戏ID不能为空')
    if source_type == 'url' and not _is_safe_remote_url(url):
        raise HTTPException(400, detail='URL 不安全或不可访问')
    db = get_db()
    max_order = db.execute("SELECT COALESCE(MAX(sort_order), -1) FROM wallpapers").fetchone()[0]
    cur = db.execute(
        "INSERT INTO wallpapers (name, url, category, enabled, sort_order, source_type) VALUES (?,?,?,1,?,?)",
        (name, url, 'custom', max_order + 1, source_type)
    )
    db.commit()
    return {'id': cur.lastrowid, 'name': name, 'url': url, 'category': 'custom', 'enabled': 1, 'source_type': source_type}

@app.delete('/api/wallpaper/source/{sid}')
async def api_delete_wallpaper_source(sid: int, _=Depends(require_auth)):
    db = get_db()
    row = db.execute("SELECT * FROM wallpapers WHERE id=?", (sid,)).fetchone()
    if not row:
        raise HTTPException(404, detail='Not found')
    if row['category'] == 'builtin':
        raise HTTPException(400, detail='内置源不可删除')
    db.execute("DELETE FROM wallpapers WHERE id=?", (sid,))
    db.commit()
    return {'ok': True}

@app.put('/api/wallpaper/source/{sid}')
async def api_update_wallpaper_source(sid: int, request: Request, _=Depends(require_auth)):
    data = await request.json() or {}
    db = get_db()
    if 'enabled' in data:
        db.execute("UPDATE wallpapers SET enabled=? WHERE id=?", (int(data['enabled']), sid))
        db.commit()
    return {'ok': True}

@app.post('/api/wallpaper/refresh')
async def api_refresh_wallpaper(request: Request, _=Depends(require_auth)):
    data = await request.json() or {}
    direction = data.get('direction', 'next')
    db = get_db()
    url = await _fetch_wallpaper_url(db, direction)
    if url:
        db.execute("UPDATE wallpaper_state SET current_url=?, last_refresh_at=datetime('now','localtime') WHERE id=1", (url,))
        db.commit()
    return {'url': url}

@app.post('/api/wallpaper/sgdb-test')
async def api_sgdb_test(request: Request, _=Depends(require_auth)):
    data = await request.json() or {}
    api_key = (data.get('api_key') or '').strip()
    if not api_key:
        raise HTTPException(400, detail='请填写 API Key')
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f'{SGDB_BASE}/search/autocomplete/Cyberpunk',
                headers={'Authorization': f'Bearer {api_key}'}
            )
            if resp.status_code == 401:
                return {'ok': False, 'error': 'API Key 无效 (401)'}
            if resp.status_code == 403:
                return {'ok': False, 'error': 'API Key 无权限 (403)'}
            if not resp.is_success:
                return {'ok': False, 'error': f'HTTP {resp.status_code}'}
            data = resp.json()
            count = len(data.get('data', []))
            return {'ok': True, 'message': f'连接成功，找到 {count} 个匹配游戏'}
    except httpx.TimeoutException:
        return {'ok': False, 'error': '连接超时'}
    except Exception as e:
        return {'ok': False, 'error': str(e)}

# SteamGridDB constants
SGDB_BASE = 'https://www.steamgriddb.com/api/v2'
SGDB_HEROES_URL = f'{SGDB_BASE}/heroes/steam/{{appid}}'

async def _fetch_wallpaper_url(db, direction='next'):
    sources = db.execute(
        "SELECT * FROM wallpapers WHERE enabled=1 ORDER BY sort_order, id"
    ).fetchall()
    if not sources:
        return ''
    state = db.execute("SELECT * FROM wallpaper_state WHERE id=1").fetchone()
    current_index = state['current_index'] if state else 0
    current_image_idx = state['current_image_idx'] if state and 'current_image_idx' in state else 0
    total = len(sources)
    if direction == 'next':
        current_index = (current_index + 1) % total
    elif direction == 'prev':
        current_index = (current_index - 1) % total
    elif direction == 'random':
        current_index = random.randint(0, total - 1)
        current_image_idx = 0
    # Try every source starting from current_index, wrap around if needed
    for offset in range(total):
        idx = (current_index + offset) % total
        source = sources[idx]
        stype = source['source_type'] if 'source_type' in source.keys() else 'url'
        # Skip steamgriddb sources when API key is not configured
        if stype == 'steamgriddb':
            api_key = _get_setting('steamgriddb_api_key', '')
            if not api_key:
                continue
        url = ''
        if stype == 'steamgriddb':
            url = await _resolve_steamgriddb(db, source['url'], source['name'])
            current_image_idx = 0
        elif 'bing.com' in source['url']:
            url, current_image_idx = await _resolve_bing_wallpaper(source['url'], current_image_idx, direction)
        else:
            url = await _resolve_wallpaper(source['url'])
            current_image_idx = 0
        if url:
            db.execute("UPDATE wallpaper_state SET current_index=?, current_image_idx=? WHERE id=1", (idx, current_image_idx))
            db.commit()
            return url
    return ''

async def _resolve_steamgriddb(db, steam_app_id, game_name=''):
    api_key = _get_setting('steamgriddb_api_key', '')
    if not api_key:
        return ''
    cached = db.execute(
        "SELECT image_url FROM steamgriddb_cache WHERE game_id=? "
        "AND datetime(fetched_at) > datetime('now','-1 day')",
        (steam_app_id,)
    ).fetchall()
    if cached:
        return random.choice([r['image_url'] for r in cached])
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            resp = await client.get(
                SGDB_HEROES_URL.format(appid=steam_app_id),
                headers={'Authorization': f'Bearer {api_key}'}
            )
            if not resp.is_success:
                return ''
            data = resp.json()
            heroes = data.get('data', []) if data.get('success') else []
            if not heroes:
                return ''
            preferred_styles = ['material', 'blurred', 'alternate']
            scored = []
            for h in heroes:
                style = h.get('style', '')
                score = preferred_styles.index(style) if style in preferred_styles else 99
                scored.append((score, h['url'], style))
            scored.sort(key=lambda x: x[0])
            top = scored[:max(3, len(scored) // 2)][:8]
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
            return random.choice([url for _, url, _ in top])
    except Exception:
        return ''

async def _resolve_bing_wallpaper(api_url, current_idx, direction):
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(api_url, headers={'User-Agent': 'Mozilla/5.0'})
            if resp.is_success:
                data = resp.json()
                images = data.get('images', [])
                if images:
                    if direction == 'next':
                        current_idx = (current_idx + 1) % len(images)
                    elif direction == 'prev':
                        current_idx = (current_idx - 1) % len(images)
                    elif direction == 'random':
                        current_idx = random.randint(0, len(images) - 1)
                    return 'https://cn.bing.com' + images[current_idx]['url'], current_idx
        return '', 0
    except Exception:
        return '', 0

async def _resolve_wallpaper(api_url):
    try:
        if not _is_safe_remote_url(api_url):
            return ''
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(api_url, follow_redirects=True, headers={'User-Agent': 'Mozilla/5.0'})
            if resp.status_code == 200:
                content_type = resp.headers.get('Content-Type', '')
                if 'image' in content_type:
                    return api_url
        return ''
    except Exception:
        return ''


# ═══════════════════════════════════════════════════════════
#  ROUTES — Font System
# ═══════════════════════════════════════════════════════════
@app.get('/api/fonts')
async def api_fonts():
    db = get_db()
    rows = db.execute("SELECT * FROM fonts ORDER BY sort_order, id").fetchall()
    fonts = [dict(r) for r in rows]
    return {
        'fonts': fonts,
        'font_body': _get_setting('font_body', ''),
        'font_title': _get_setting('font_title', ''),
        'font_body_en': _get_setting('font_body_en', ''),
        'font_code': _get_setting('font_code', ''),
        'font_size': _get_setting('font_size', '14'),
    }

@app.post('/api/fonts', status_code=201)
async def api_add_font(request: Request, _=Depends(require_auth)):
    data = await request.json() or {}
    name = data.get('name', '').strip()
    family = data.get('family', '').strip()
    cdn_url = data.get('cdn_url', '').strip()
    language = data.get('language', 'zh')
    if not name or not family or not cdn_url:
        raise HTTPException(400, detail='名称、font-family 和 CDN URL 不能为空')
    if not _is_safe_remote_url(cdn_url):
        raise HTTPException(400, detail='CDN URL 不安全或不可访问')
    db = get_db()
    max_order = db.execute("SELECT COALESCE(MAX(sort_order), -1) FROM fonts").fetchone()[0]
    cur = db.execute(
        "INSERT INTO fonts (name, family, category, cdn_url, language, sort_order) VALUES (?,?,?,?,?,?)",
        (name, family, 'custom', cdn_url, language, max_order + 1)
    )
    db.commit()
    return {'id': cur.lastrowid, 'name': name, 'family': family, 'cdn_url': cdn_url}

@app.delete('/api/fonts/{fid}')
async def api_delete_font(fid: int, _=Depends(require_auth)):
    db = get_db()
    row = db.execute("SELECT * FROM fonts WHERE id=?", (fid,)).fetchone()
    if not row:
        raise HTTPException(404, detail='Not found')
    if row['category'] == 'builtin':
        raise HTTPException(400, detail='内置字体不可删除')
    db.execute("DELETE FROM fonts WHERE id=?", (fid,))
    db.commit()
    return {'ok': True}

def _normalize_font_css(raw_css: str, family_id: str) -> str:
    base_local = f"/api/font-woff?family={family_id}&file="
    css = raw_css
    css = re.sub(r'url\(\s*(["\']?)(?!https?:|data:|/api/)([^"\')\s]+)\1\s*\)',
                  lambda m: f'url({base_local}{m.group(2).lstrip("./")})', css)
    css = re.sub(r'\s*local\([^)]+\),?\s*', '', css)
    css = re.sub(r'\s+format\([^)]+\)', '', css)
    return css

@app.get('/api/font-css/{fid}.css')
async def api_font_css(fid: int):
    db = get_db()
    row = db.execute("SELECT * FROM fonts WHERE id=?", (fid,)).fetchone()
    if not row:
        return Response("/* not found */", media_type='text/css', status_code=404)
    cdn_url = row['cdn_url']
    if not cdn_url:
        return Response("/* no cdn */", media_type='text/css', status_code=404)
    if not _is_safe_remote_url(cdn_url):
        return Response("/* unsafe cdn */", media_type='text/css', status_code=400)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(cdn_url, headers={'User-Agent': 'Mozilla/5.0'})
            raw = resp.text
        css = _normalize_font_css(raw, str(fid))
        return Response(css, media_type='text/css; charset=utf-8',
                       headers={'Cache-Control': 'public, max-age=3600'})
    except Exception as e:
        return Response(f"/* fetch error: {e} */", media_type='text/css', status_code=502)

@app.get('/api/font-woff')
async def api_font_woff(family: str = Query(''), file: str = Query('')):
    if not family or not file:
        return Response("", status_code=404)
    if '/' in file or '\\' in file or '..' in file:
        return Response("", status_code=404)
    try:
        fid_int = int(family)
    except ValueError:
        return Response("", status_code=404)
    db = get_db()
    row = db.execute("SELECT cdn_url FROM fonts WHERE id=?", (fid_int,)).fetchone()
    if not row:
        return Response("", status_code=404)
    cdn = row['cdn_url']
    base = cdn.rsplit('/', 1)[0] + '/'
    target = base + file
    if not _is_safe_remote_url(target):
        return Response("", status_code=404)
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(target, headers={'User-Agent': 'Mozilla/5.0'})
            data = resp.content
        return Response(data, media_type='font/woff2',
                       headers={'Cache-Control': 'public, max-age=86400'})
    except Exception as e:
        return Response(f"woff2 fetch error: {e}", media_type='text/plain', status_code=502)


# ═══════════════════════════════════════════════════════════
#  ROUTES — Icon Proxy (async, concurrent sources)
# ═══════════════════════════════════════════════════════════
_DEFAULT_ICON_SVG = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <rect width="32" height="32" rx="6" fill="#333"/>
    <text x="16" y="22" text-anchor="middle" fill="#888" font-size="18">🔗</text>
</svg>'''

async def _try_fetch_icon(client: httpx.AsyncClient, src: str) -> tuple[str, bytes, str] | None:
    """Try one favicon source. Returns (content_type, content, source_url) or None."""
    try:
        resp = await client.get(src, timeout=2, headers={'User-Agent': 'Mozilla/5.0'})
        if resp.status_code == 200 and len(resp.content) > 60:
            ct = resp.headers.get('Content-Type', 'image/x-icon')
            if 'text/html' in ct or 'text/plain' in ct:
                return None
            return (ct, resp.content, src)
    except Exception:
        pass
    return None

async def _extract_icons_from_html_async(client: httpx.AsyncClient, domain: str) -> list[str]:
    icons = []
    try:
        resp = await client.get(f'https://{domain}/', timeout=4,
                               headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'})
        if resp.status_code != 200:
            return icons
        html = resp.text[:200000]
        patterns = [
            r'<link[^>]*rel=["\'](?:shortcut\s+)?icon["\'][^>]*href=["\']([^"\'\s>]+)',
            r'<link[^>]*href=["\']([^"\'\s>]+)[^>]*rel=["\'](?:shortcut\s+)?icon["\']',
            r'<link[^>]*rel=["\']apple-touch-icon["\'][^>]*href=["\']([^"\'\s>]+)',
            r'<link[^>]*href=["\']([^"\'\s>]+)[^>]*rel=["\']apple-touch-icon["\']',
        ]
        seen = set()
        for pat in patterns:
            for m in re.findall(pat, html, re.IGNORECASE):
                if m.startswith('//'): m = f'https:{m}'
                elif m.startswith('/'): m = f'https://{domain}{m}'
                elif not m.startswith('http'): m = f'https://{domain}/{m}'
                if m not in seen:
                    seen.add(m)
                    icons.append(m)
    except Exception:
        pass
    return icons

@app.get('/api/icon/proxy')
async def api_icon_proxy(url: str = Query(''), domain: str = Query('')):
    """异步图标代理：直连 favicon 加两个测速最快的第三方 API。"""
    if not url and not domain:
        return Response('', status_code=400)

    if domain and not url:
        parsed = urlparse(domain if '://' in domain else f'https://{domain}')
        domain = parsed.netloc or parsed.path
    elif url and not domain:
        try:
            domain = urlparse(url).netloc or urlparse(url).hostname or ''
        except Exception:
            domain = ''
    if domain and not _is_safe_remote_url(f'https://{domain}/'):
        return Response(_DEFAULT_ICON_SVG, media_type='image/svg+xml')
    if url and not _is_safe_remote_url(url):
        url = ''

    # Check cache
    if domain:
        db = get_db()
        neg = db.execute(
            "SELECT 1 FROM icon_cache WHERE domain=? AND content_type='x-negative' "
            "AND updated_at > datetime('now','localtime','-1 hours')",
            (domain,)
        ).fetchone()
        if neg:
            return Response(_DEFAULT_ICON_SVG, media_type='image/svg+xml')

        row = db.execute(
            "SELECT content, content_type FROM icon_cache "
            "WHERE domain=? AND content_type!='x-negative' "
            "AND updated_at > datetime('now','localtime','-7 days')",
            (domain,)
        ).fetchone()
        if row:
            return Response(row['content'], media_type=row['content_type'],
                           headers={'Cache-Control': 'public, max-age=86400', 'X-Icon-Cache': 'hit'})

    # 构建来源列表：优先直连 favicon，再使用可靠的第三方 API。
    sources = []
    if domain:
        sources.append(f'https://{domain}/favicon.ico')
        sources.append(f'https://favicon.vemetric.com/{domain}')
        sources.append(f'https://a.favicon.im/{domain}?larger=true')
    if url:
        sources.insert(0, url)

    # Concurrent fetch across all sources, capped at 2s total
    async with httpx.AsyncClient(timeout=httpx.Timeout(2.0, connect=2.0), follow_redirects=True) as client:
        try:
            tasks = [_try_fetch_icon(client, src) for src in sources]
            results = await asyncio.wait_for(asyncio.gather(*tasks, return_exceptions=True), timeout=2.5)
        except asyncio.TimeoutError:
            results = []

        for r in results:
            if isinstance(r, tuple) and r is not None:
                ct, content, src = r
                if domain:
                    try:
                        db2 = get_db()
                        db2.execute(
                            "INSERT OR REPLACE INTO icon_cache (domain, content, content_type, source_url, updated_at) "
                            "VALUES (?,?,?,?,datetime('now','localtime'))",
                            (domain, content, ct, src)
                        )
                        db2.commit()
                    except Exception:
                        pass
                return Response(content, media_type=ct,
                               headers={'Cache-Control': 'public, max-age=86400', 'X-Icon-Cache': 'miss'})

    # All failed — write negative cache
    if domain:
        try:
            db3 = get_db()
            db3.execute(
                "INSERT OR REPLACE INTO icon_cache (domain, content, content_type, source_url, updated_at) "
                "VALUES (?,?,?,?,datetime('now','localtime'))",
                (domain, b'', 'x-negative', '')
            )
            db3.commit()
        except Exception:
            pass

    return Response(_DEFAULT_ICON_SVG, media_type='image/svg+xml')

@app.post('/api/icon/refresh')
async def api_icon_refresh(request: Request, _=Depends(require_auth)):
    data = await request.json() or {}
    url = (data.get('url') or '').strip()
    domain = (data.get('domain') or '').strip()
    if url and not domain:
        domain = urlparse(url).netloc or urlparse(url).hostname or ''
    if domain:
        get_db().execute("DELETE FROM icon_cache WHERE domain=?", (domain,))
        get_db().commit()
        _log_action('refresh_icon', 'icon', {'domain': domain})
        return {'ok': True, 'domain': domain}
    raise HTTPException(400, detail='缺少域名或 URL')


# ═══════════════════════════════════════════════════════════
#  ROUTES — Built-in Icon Library
# ═══════════════════════════════════════════════════════════
@app.get('/api/builtin-icons')
async def api_builtin_icons():
    icons_dir = BASE_DIR / 'static' / 'icons'
    icons = []
    if icons_dir.exists():
        for f in sorted(icons_dir.iterdir()):
            if f.suffix.lower() == '.svg':
                icons.append({'name': f.stem, 'path': f'/static/icons/{f.name}'})
    return {'icons': icons}


# ═══════════════════════════════════════════════════════════
#  ROUTES — Extension Download
# ═══════════════════════════════════════════════════════════
@app.get('/extension/download/chrome')
async def download_extension_chrome():
    return _make_extension_zip('chrome')

@app.get('/extension/download/firefox')
async def download_extension_firefox():
    xpi = BASE_DIR / 'extension' / 'suenweb-firefox.xpi'
    if xpi.exists():
        return FileResponse(xpi, media_type='application/x-xpinstall',
                           filename='suenweb-firefox.xpi')
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
            if arcname == 'manifest_firefox.json' and browser == 'chrome':
                continue
            if arcname == 'manifest.json' and browser == 'firefox':
                continue
            if arcname == 'manifest_firefox.json' and browser == 'firefox':
                arcname = 'manifest.json'
            zf.write(f, arcname)
    buf.seek(0)
    name = f'suenweb-extension-{browser}.zip'
    return Response(buf.read(), media_type='application/zip',
                   headers={'Content-Disposition': f'attachment; filename={name}'})


# ═══════════════════════════════════════════════════════════
#  ROUTES — AI Features
# ═══════════════════════════════════════════════════════════
@app.post('/api/ai/describe')
async def api_ai_describe(request: Request, _=Depends(require_auth)):
    data = await request.json() or {}
    llm_url = data.get('llm_url', '').strip()
    llm_key = data.get('llm_key', '').strip()
    llm_model = data.get('llm_model', '').strip()
    link_id = data.get('link_id')
    group_ids = data.get('group_ids')

    if not llm_url:
        raise HTTPException(400, detail='请填写 LLM API 地址')
    if urlparse(llm_url).scheme not in ('http', 'https'):
        raise HTTPException(400, detail='LLM API 地址必须是 http 或 https')
    if not llm_key:
        raise HTTPException(400, detail='请填写 API Key')
    if not llm_model:
        raise HTTPException(400, detail='请填写模型名称')

    db = get_db()

    if link_id:
        link = db.execute("SELECT id, title, url FROM links WHERE id=?", (link_id,)).fetchone()
        if not link:
            raise HTTPException(404, detail='链接不存在')
        prompt = f"""为这个网站写一句简短中文描述（不超过15字）。只返回纯文本描述，不要任何其他内容。

网站：{link["title"]}
网址：{link["url"]}"""
        try:
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(
                    llm_url.rstrip('/') + '/chat/completions',
                    headers={'Authorization': f'Bearer {llm_key}', 'Content-Type': 'application/json'},
                    json={'model': llm_model, 'messages': [{'role': 'user', 'content': prompt}], 'temperature': 0.3},
                )
                if not resp.is_success:
                    raise HTTPException(502, detail=f'LLM API 返回: {resp.status_code}')
                result = _safe_json(resp.text)
                if not result:
                    raise HTTPException(502, detail='LLM 返回格式异常')
                msg = result['choices'][0]['message']
                desc = msg.get('content', '') or msg.get('reasoning_content', '')
                desc = desc.strip()[:50]
                if not desc:
                    raise HTTPException(502, detail='LLM 返回内容为空')
                db.execute("UPDATE links SET description=? WHERE id=?", (desc, link_id))
                db.commit()
                return JSONResponse({'description': desc, 'count': 1})
        except HTTPException:
            raise
        except httpx.TimeoutException:
            raise HTTPException(504, detail='LLM 请求超时 (120s)')
        except Exception as e:
            raise HTTPException(500, detail=str(e))

    # Bulk mode
    query = "SELECT l.id, l.title, l.url FROM links l WHERE (l.description IS NULL OR l.description = '')"
    params = []
    if group_ids:
        placeholders = ','.join('?' * len(group_ids))
        query += f" AND l.group_id IN ({placeholders})"
        params = group_ids
    links = db.execute(query, params).fetchall()
    if not links:
        return {'message': '所有链接已有描述', 'count': 0}

    total = len(links)
    links_json = json.dumps([{'id': i, 'title': l['title'], 'url': l['url']} for i, l in enumerate(links)], ensure_ascii=False)
    prompt = f"""为以下网站列表生成中文描述（每项不超过15字）。严格按照 JSON 数组格式返回，不要任何其他内容。

格式：[{{"id": 索引, "desc": "描述"}}, ...]

网站列表：
{links_json}"""

    try:
        async with httpx.AsyncClient(timeout=180) as client:
            resp = await client.post(
                llm_url.rstrip('/') + '/chat/completions',
                headers={'Authorization': f'Bearer {llm_key}', 'Content-Type': 'application/json'},
                json={'model': llm_model, 'messages': [{'role': 'user', 'content': prompt}], 'temperature': 0.3},
            )
            if not resp.is_success:
                raise HTTPException(502, detail=f'LLM API 返回: {resp.status_code}')
            result = _safe_json(resp.text)
            if not result:
                raise HTTPException(502, detail='LLM 返回格式异常')
            content = result['choices'][0]['message'].get('content', '') or ''
            descs = _safe_json(content)
            updated = 0
            if isinstance(descs, list):
                for item in descs:
                    idx = item.get('id', -1)
                    desc = str(item.get('desc', ''))[:50]
                    if 0 <= idx < len(links) and desc:
                        db.execute("UPDATE links SET description=? WHERE id=?", (desc, links[idx]['id']))
                        updated += 1
            else:
                updated = _parse_descriptions_fallback(content, links, db)
            db.commit()
            return {'message': f'已为 {updated} 个链接生成描述', 'count': updated}
    except HTTPException:
        raise
    except httpx.TimeoutException:
        raise HTTPException(504, detail='LLM 请求超时 (180s)')
    except Exception as e:
        raise HTTPException(500, detail=str(e))


def _safe_json(text: str):
    text = text.strip()
    text = re.sub(r'data:\s*\[DONE\]\s*$', '', text)
    if text.startswith('```'):
        text = re.sub(r'^```\w*\n?', '', text)
        text = re.sub(r'\n?```$', '', text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start = text.find('{')
    end = text.rfind('}')
    if start >= 0 and end > start:
        try:
            return json.loads(text[start:end+1])
        except json.JSONDecodeError:
            pass
    start = text.find('[')
    end = text.rfind(']')
    if start >= 0 and end > start:
        try:
            return json.loads(text[start:end+1])
        except json.JSONDecodeError:
            pass
    return None

def _parse_descriptions_fallback(content, links, db):
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


@app.post('/api/ai/check')
async def api_ai_check(request: Request, _=Depends(require_auth)):
    data = await request.json() or {}
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
        raise HTTPException(400, detail='没有找到链接')

    total = len(links)
    results = []
    working = 0
    broken = 0

    sem = asyncio.Semaphore(12)
    async with httpx.AsyncClient(timeout=8, follow_redirects=True) as client:
        async def check_one(link):
            async with sem:
                status = await _check_url_async(client, link['url'])
                return link, status
        checked = await asyncio.gather(*(check_one(link) for link in links))
        for link, status in checked:
            item = {
                'id': link['id'], 'title': link['title'], 'url': link['url'],
                'group': link['group_name'], 'status': status['code'],
                'ok': status['ok'], 'error': status.get('error', ''),
            }
            results.append(item)
            if status['ok']: working += 1
            else: broken += 1

    return {'total': total, 'working': working, 'broken': broken, 'results': results}

async def _check_url_async(client: httpx.AsyncClient, url: str) -> dict:
    try:
        if urlparse(url).scheme not in ('http', 'https'):
            return {'ok': False, 'code': 0, 'error': '不支持的 URL 协议'}
        resp = await client.head(url, headers={'User-Agent': 'Mozilla/5.0 SuenWeb/1.0'})
        if resp.status_code in (405, 403) or resp.status_code >= 500:
            resp = await client.get(url, headers={'User-Agent': 'Mozilla/5.0 SuenWeb/1.0'})
        ok = 200 <= resp.status_code < 400 or resp.status_code in (401, 403)
        return {'ok': ok, 'code': resp.status_code}
    except Exception as e:
        return {'ok': False, 'code': 0, 'error': str(e)[:100]}


# ═══════════════════════════════════════════════════════════
#  Main
# ═══════════════════════════════════════════════════════════
if __name__ == '__main__':
    import uvicorn
    uvicorn.run('app:app', host='0.0.0.0', port=5000, log_level='info')
