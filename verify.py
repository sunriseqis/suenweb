import requests, json, sys
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, '.')
import urllib.request

# Get token from server
r = urllib.request.urlopen(urllib.request.Request(
    'http://localhost:5000/api/auth/login',
    data=json.dumps({'password':'test'}).encode('utf-8'),
    headers={'Content-Type':'application/json'}
))
TOKEN = json.loads(r.read())['token']
BASE = 'http://localhost:5000'
h = {'Content-Type':'application/json', 'Authorization': f'Bearer {TOKEN}'}

print('=' * 50)
print('E2E VERIFICATION (utf-8)')
print('=' * 50)

print('\n[D] list fonts:')
r = requests.get(BASE + '/api/fonts', timeout=5)
d = r.json()
for f in d['fonts']:
    print('  [' + f['category'] + '] ' + f['name'] + ' lang=' + f['language'])

print('\n[E] list wp sources:')
r = requests.get(BASE + '/api/wallpaper/sources', timeout=5)
d = r.json()
for s in d['sources']:
    print('  [' + s['category'] + '] ' + s['name'] + ' enabled=' + str(s['enabled']))

print('\n[F] change settings:', end=' ')
r = requests.put(BASE + '/api/settings', json={'background_type': 'wallpaper', 'font_body': 'TestFont', 'font_size': '16'}, headers=h, timeout=5)
print(r.status_code, r.json())

print('\n[G] read back:')
r = requests.get(BASE + '/api/settings', timeout=5)
d = r.json()
for k in ['background_type', 'font_body', 'font_size', 'wallpaper_interval', 'theme', 'pattern']:
    print('  ' + k + ': ' + str(d.get(k)))

print('\n[H] refresh wallpaper 3x:')
for direction in ['next', 'prev', 'random']:
    r = requests.post(BASE + '/api/wallpaper/refresh', json={'direction': direction}, headers=h, timeout=5)
    print('  ' + direction + ': ' + r.json().get('url', '(empty)')[:60])

print('\n[I] delete custom font 12:', end=' ')
r = requests.delete(BASE + '/api/fonts/12', headers=h, timeout=5)
print(r.status_code, r.json())

print('\n[J] delete builtin font 1 (should fail):', end=' ')
r = requests.delete(BASE + '/api/fonts/1', headers=h, timeout=5)
print(r.status_code, r.json())

print('\n[K] delete builtin wp source 2 (should fail):', end=' ')
r = requests.delete(BASE + '/api/wallpaper/source/2', headers=h, timeout=5)
print(r.status_code, r.json())

print('\n[L] validation empty name:', end=' ')
r = requests.post(BASE + '/api/wallpaper/source', json={'name': '', 'url': ''}, headers=h, timeout=5)
print(r.status_code, r.json())

print('\n[N] disable custom source 9:', end=' ')
r = requests.put(BASE + '/api/wallpaper/source/9', json={'enabled': 0}, headers=h, timeout=5)
print(r.status_code, r.json())

print('\n[O] get current wallpaper:', end=' ')
r = requests.get(BASE + '/api/wallpaper', timeout=5)
print(r.json())

print('\n[P] un-auth call to wallpaper/sources:', end=' ')
r = requests.get(BASE + '/api/wallpaper/sources', timeout=5)
print(r.status_code, 'sources=' + str(len(r.json()['sources'])))

print('\n[Q] un-auth call to add wp source (should fail):', end=' ')
r = requests.post(BASE + '/api/wallpaper/source', json={'name': 'x', 'url': 'y'}, timeout=5)
print(r.status_code, r.json())
