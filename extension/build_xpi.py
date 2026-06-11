"""Build suenweb-firefox.xpi from source files."""
import zipfile
import os
import json

EXT_DIR = os.path.dirname(os.path.abspath(__file__))
XPI_PATH = os.path.join(EXT_DIR, 'suenweb-firefox.xpi')

# Collect files (exclude xpi, bak, build script)
files = []
for f in os.listdir(EXT_DIR):
    fp = os.path.join(EXT_DIR, f)
    if not os.path.isfile(fp):
        continue
    if f.endswith('.xpi') or f.endswith('.xpi.bak') or f == 'build_xpi.py':
        continue
    files.append((fp, f))

# Include icons
icons_dir = os.path.join(EXT_DIR, 'icons')
for root, _, filenames in os.walk(icons_dir):
    for fn in filenames:
        fp = os.path.join(root, fn)
        arc = os.path.relpath(fp, EXT_DIR)
        files.append((fp, arc))

# Build XPI
with zipfile.ZipFile(XPI_PATH, 'w', zipfile.ZIP_DEFLATED) as zf:
    for fp, arcname in sorted(files):
        if arcname == 'manifest_firefox.json':
            arcname = 'manifest.json'
        elif arcname == 'manifest.json':
            continue  # Skip Chrome manifest
        zf.write(fp, arcname)

# Verify
with zipfile.ZipFile(XPI_PATH, 'r') as zf:
    with zf.open('manifest.json') as mf:
        raw = mf.read()
        text = raw.decode('utf-8')
        m = json.loads(text)
        desc = m.get('description', '')
        if '\u6536\u85cf' in desc and '\u5bfc\u822a' in desc:
            print('OK: XPI built successfully - Chinese encoding correct')
            print(f'    version: {m["version"]}')
            print(f'    description: {desc}')
        else:
            print(f'ERROR: Encoding issue - desc={desc!r}')
            print(f'    Raw bytes first 200: {raw[:200]}')
