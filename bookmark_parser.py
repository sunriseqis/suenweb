"""
Browser bookmark parser.
Supports:
  1. Netscape Bookmark HTML (export from Chrome / Firefox / Edge)
  2. Chrome/Edge JSON format (direct Bookmarks file read)
"""

import json
import re
from datetime import datetime
from bs4 import BeautifulSoup


def parse_bookmark_html(content: str) -> list[dict]:
    """
    Parse Netscape Bookmark HTML format.
    Returns list of folders: [{name, icon, links: [{title, url, icon, add_date}]}]
    """
    soup = BeautifulSoup(content, 'html.parser')
    root_dl = soup.find('dl')
    if not root_dl:
        return _parse_with_regex(content) if '<DL>' in content.upper() else []

    # Detect if html.parser nested DTs wrong (DT inside another DT)
    for dt in root_dl.find_all('dt'):
        if dt.find('dt'):
            return _parse_with_regex(content)

    folders = []
    _parse_dl(root_dl, folders, level=0)
    return folders


def _parse_with_regex(content: str) -> list[dict]:
    """Fallback: regex-based parser for Netscape bookmark format."""
    folders = []
    h3_re = re.compile(r'<DT>\s*<H3[^>]*>(.*?)</H3>', re.IGNORECASE | re.DOTALL)
    a_re  = re.compile(r'<DT>\s*<A\s+HREF="([^"]*)"[^>]*>(.*?)</A>', re.IGNORECASE | re.DOTALL)

    matches = list(h3_re.finditer(content))
    for i, m in enumerate(matches):
        name = m.group(1).strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(content)
        section = content[start:end]

        links = []
        for a in a_re.finditer(section):
            url = a.group(1).strip()
            title = a.group(2).strip()
            if url and title:
                links.append({'title': title, 'url': url, 'icon': '', 'add_date': ''})
        if links:
            folders.append({'name': name, 'icon': '📁', 'links': links})

    return folders


def _get_direct_dts(dl):
    """Get DT elements that belong directly to this DL (not nested DLs).
    Handles `<DL><p><DT>` where DT is wrapped in a <p> tag."""
    dts = []
    for child in dl.children:
        if not hasattr(child, 'name') or child.name is None:
            continue
        if child.name == 'dt':
            dts.append(child)
        elif child.name == 'p':
            for dt in child.find_all('dt', recursive=False):
                dts.append(dt)
        elif child.name not in ('dl',):
            # Check if this wrapper contains direct DTs
            for dt in child.find_all('dt', recursive=False):
                dts.append(dt)
    return dts


def _parse_dl(dl, folders: list, level: int = 0):
    """Recursively parse a <DL> element."""
    for dt in _get_direct_dts(dl):
        h3 = dt.find('h3')
        a_tag = dt.find('a')
        if h3:
            folder_name = h3.get_text(strip=True)
            folder_links = []
            nested_dl = dt.find('dl')
            if nested_dl:
                _parse_dl_links(nested_dl, folder_links)
            if folder_links:
                folders.append({'name': folder_name, 'icon': '📁', 'links': folder_links})
        elif a_tag:
            link = _extract_link(a_tag)
            if link:
                _add_to_uncategorized(folders, link)


def _parse_dl_links(dl, links: list):
    """Parse links from a <DL>, handling nested folders."""
    for dt in _get_direct_dts(dl):
        h3 = dt.find('h3')
        a_tag = dt.find('a')
        if h3:
            nested_dl = dt.find('dl')
            if nested_dl:
                _parse_dl_links(nested_dl, links)
        elif a_tag:
            link = _extract_link(a_tag)
            if link:
                links.append(link)


def _extract_link(a_tag) -> dict | None:
    """Extract link info from an <A> tag."""
    href = a_tag.get('href', '').strip()
    title = a_tag.get_text(strip=True)
    if not href or not title:
        return None

    add_date = a_tag.get('add_date', '')
    icon = a_tag.get('icon', '') or ''

    # Try to convert add_date to readable format
    date_str = ''
    if add_date and add_date.isdigit():
        try:
            dt = datetime.fromtimestamp(int(add_date))
            date_str = dt.strftime('%Y-%m-%d')
        except (ValueError, OSError):
            pass

    return {
        'title': title,
        'url': href,
        'icon': icon,
        'add_date': date_str,
    }


def _add_to_uncategorized(folders: list, link: dict):
    """Add a link to an '未分类' (uncategorized) group."""
    for f in folders:
        if f['name'] == '未分类':
            f['links'].append(link)
            return
    folders.append({
        'name': '未分类',
        'icon': '📋',
        'links': [link],
    })


def parse_chrome_bookmarks_json(content: str) -> list[dict]:
    """
    Parse Chrome/Edge JSON bookmarks file.
    The file is located at:
      - Chrome: %LOCALAPPDATA%\\Google\\Chrome\\User Data\\Default\\Bookmarks
      - Edge:   %LOCALAPPDATA%\\Microsoft\\Edge\\User Data\\Default\\Bookmarks
    """
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        return []

    folders = []
    roots = data.get('roots', {})

    for root_key in ['bookmark_bar', 'other', 'synced']:
        root = roots.get(root_key)
        if not root:
            continue
        children = root.get('children', [])
        _parse_chrome_children(children, folders)

    return folders


def _parse_chrome_children(children: list, folders: list):
    """Parse Chrome bookmark children (recursive)."""
    for child in children:
        child_type = child.get('type', '')
        if child_type == 'folder':
            folder_name = child.get('name', 'Unnamed')
            folder_links = []
            sub_children = child.get('children', [])
            for sub in sub_children:
                if sub.get('type') == 'url':
                    link = {
                        'title': sub.get('name', ''),
                        'url': sub.get('url', ''),
                        'icon': '',
                        'add_date': _ts_to_date(sub.get('date_added', '')),
                    }
                    if link['title'] and link['url']:
                        folder_links.append(link)
                elif sub.get('type') == 'folder':
                    # Flatten nested folders for now
                    _parse_chrome_children([sub], folders)

            if folder_links:
                folders.append({
                    'name': folder_name,
                    'icon': '📁',
                    'links': folder_links,
                })
        elif child_type == 'url':
            link = {
                'title': child.get('name', ''),
                'url': child.get('url', ''),
                'icon': '',
                'add_date': _ts_to_date(child.get('date_added', '')),
            }
            if link['title'] and link['url']:
                _add_to_uncategorized(folders, link)


def _ts_to_date(ts_str: str) -> str:
    """Convert Chrome's timestamp (microseconds since 1601) to date string."""
    if not ts_str:
        return ''
    try:
        ts = int(ts_str)
        # Chrome uses microseconds since 1601-01-01
        # Convert to Unix timestamp
        if ts > 10000000000000000:  # microseconds
            unix_ts = (ts / 1000000) - 11644473600
        else:
            unix_ts = ts
        if unix_ts > 0:
            dt = datetime.fromtimestamp(unix_ts)
            return dt.strftime('%Y-%m-%d')
    except (ValueError, OSError):
        pass
    return ''


def detect_format(content: str) -> str:
    """Detect bookmark file format: 'html', 'json', or 'unknown'."""
    stripped = content.strip()
    if stripped.startswith('<!DOCTYPE') or stripped.startswith('<HTML') or stripped.startswith('<META') or '<DT><A' in stripped or '<DL>' in stripped:
        return 'html'
    if stripped.startswith('{'):
        try:
            data = json.loads(stripped)
            if 'roots' in data or 'checksum' in data:
                return 'json'
        except json.JSONDecodeError:
            pass
    return 'unknown'


def parse_bookmarks(content: str) -> list[dict]:
    """Auto-detect format and parse bookmarks."""
    fmt = detect_format(content)
    if fmt == 'html':
        return parse_bookmark_html(content)
    elif fmt == 'json':
        return parse_chrome_bookmarks_json(content)
    else:
        raise ValueError('Unsupported bookmark file format')
