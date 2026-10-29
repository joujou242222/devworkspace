#!/usr/bin/env python3
"""Generate React entries for the workspace/project/portal/404/loading pages.

Same contract as the hand-ported auth pages:
- HTML shell = original <head> minus <style> blocks + <div id="root"> + module entry.
- Body markup kept verbatim (scripts stripped, ../public/index.html links re-rooted).
- CSS moved verbatim into per-cluster files; each page runs its original scripts
  unmodified, in original order, executed as classic scripts.
"""
import re, os, glob, hashlib, posixpath

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(ROOT)
SITE = os.path.join(os.path.dirname(OUT), 'pages ')

def md5(b): return hashlib.md5(b).hexdigest()

def w(path, text):
    full = os.path.join(OUT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, 'w', encoding='utf-8') as f:
        f.write(text)

# ---------- gather ----------
files = sorted(glob.glob(os.path.join(SITE, '*.html')) +
               glob.glob(os.path.join(SITE, '*/*.html')))
files = [f for f in files if os.path.basename(os.path.dirname(f)) != 'public']

pages, css_by_h, script_by_h = {}, {}, {}
for fp in files:
    rel = os.path.relpath(fp, SITE)
    src = open(fp, encoding='utf-8').read()
    pre = src[:src.index('<head>')]          # <!DOCTYPE html> + <html ...> — REQUIRED (standards mode)
    bodytag = re.search(r'<body[^>]*>', src).group(0)   # e.g. <body data-view="loading"> — MUST keep attrs
    head = re.search(r'<head>.*?</head>', src, re.S).group(0)
    inner = re.search(r'<body[^>]*>(.*?)</body>', src, re.S).group(1)
    styles = re.findall(r'<style>(.*?)</style>', head, re.S)
    scripts = re.findall(r'<script>(.*?)</script>', inner, re.S)
    assert not re.search(r'<script\s', src), f'src-script in {rel}'
    assert '<style' not in inner, f'style in body of {rel}'
    for s in styles:
        css_by_h.setdefault(md5(s.encode()), {'text': s, 'files': []})['files'].append(rel)
    for s in scripts:
        script_by_h.setdefault(md5(s.encode()), {'text': s, 'files': []})['files'].append(rel)
    pages[rel] = dict(pre=pre, bodytag=bodytag, head=head, styles=styles, scripts=scripts,
                      body=re.sub(r'<script>.*?</script>', '', inner, flags=re.S))

# ---------- cluster CSS ----------
clusters = {                      # short hash -> cluster css under src/pages/
    '4eefad8': 'workspace/main.css',
    'c0ed0bc': 'workspace/acct.css',
    '845cde9': 'project/main.css',
    'adc0a9b': 'project/task.css',
    '3187d6f': 'portal/main.css',
}
cluster_hashes = {}
for sh, path in clusters.items():
    full = [h for h in css_by_h if h.startswith(sh)][0]
    w('src/pages/' + path, css_by_h[full]['text'])
    cluster_hashes[full] = os.path.basename(path)

# ---------- shared scripts ----------
SHELL = [h for h in script_by_h if h.startswith('fee22e9')][0]
w('src/app/shell.js.txt', script_by_h[SHELL]['text'])
PORTAL = [h for h in script_by_h if h.startswith('2577f2c')][0]
w('src/pages/portal/extra.js.txt', script_by_h[PORTAL]['text'])

# ---------- clean-URL link resolution ----------
# Every page link becomes root-absolute and extension-free: the URL style
# /workspace/dashboard, /login, /pricing ... (React-style routes).
def abs_url(ref, base):
    """ref = value of a link inside a page living in folder `base`
    ('' for root pages). Returns a root-absolute URL without .html."""
    p, _, frag = ref.partition('#')
    p = posixpath.normpath(posixpath.join('/' + base, p))
    if p.startswith('/public/'):
        p = p[len('/public'):]
    if p.endswith('.html'):
        p = p[:-len('.html')]
    if p == '/index':
        p = '/'
    return p + ('#' + frag if frag else '')

def rewrite_nav(s, base):
    """Same resolution inside page scripts (JS-built hrefs + location.href)."""
    def rep(m):
        return 'href=' + m.group(1) + abs_url(m.group(2), base) + m.group(1)
    s = re.sub(r"href=([\"'])((?:[^\"'])*?\.html(?:#[\w-]*)?)\1", rep, s)
    def repl(m):
        return "location.href='" + abs_url(m.group(1), base) + "'"
    s = re.sub(r"location\.href\s*=\s*'([^']*?\.html(?:#[\w-]*)?)'", repl, s)
    return s

inputs = []
for rel in list(pages.keys()):
    p = pages[rel]
    group = os.path.dirname(rel) or 'misc'
    base = '' if group == 'misc' else group        # URL base: '' | workspace | project | portal
    name = os.path.splitext(os.path.basename(rel))[0]
    folder = f"{group}/{'p' + name if group == 'misc' else name}"
    page_dir = f'src/pages/{folder}'

    # ---- css
    hashes = list(dict.fromkeys(md5(s.encode()) for s in p['styles']))
    if all(h in cluster_hashes for h in hashes):
        assert len(hashes) == 1, (rel, hashes)
        css_import = '../' + cluster_hashes[hashes[0]]
    else:
        css_file = {'dashboard': 'dashboard.css', '404': 'p404.css', 'loading': 'loading.css'}[name]
        w(f'{page_dir}/{css_file}', '\n'.join(p['styles']))
        css_import = './' + css_file

    # ---- scripts: [unique..., SHELL(, PORTAL)]
    uniq = []
    for s in p['scripts']:
        h = md5(s.encode())
        if h not in (SHELL, PORTAL):
            uniq.append(rewrite_nav(s, base))
    w(f'{page_dir}/page.js.txt', '\n/*@@BLOCK@@*/\n'.join(uniq))

    # ---- body + head: every linked page gets a root-absolute, extension-free URL
    body = re.sub(r'href=([\'"])([^\'"]*?\.html[^\'"]*)\1',
                  lambda m: 'href=' + m.group(1) + abs_url(m.group(2), base) + m.group(1),
                  p['body'])
    w(f'{page_dir}/body.html', body)
    head = re.sub(r'<style>.*?</style>', '', p['head'], flags=re.S)
    head = re.sub(r'\n\s*\n', '\n', head)
    entry = f'/src/pages/{folder}/page.jsx'
    w(rel, p['pre'] + head + '\n' + p['bodytag'] + '\n  <div id="root"></div>\n'
       f'  <script type="module" src="{entry}"></script>\n</body>\n</html>\n')

    key = f'{group}-{name}' if group != 'misc' else name
    inputs.append((key, rel, folder, css_import, group))

# ---------- page.jsx ----------
for key, html_out, folder, css_import, group in inputs:
    extra_import = "import PortalScriptRaw from '../extra.js.txt?raw'\n" if group == 'portal' else ''
    parts = (['seg(PageScriptRaw)', 'seg(ShellScriptRaw)'] +
             (['seg(PortalScriptRaw)'] if group == 'portal' else []))
    w(f'src/pages/{folder}/page.jsx',
      "import React from 'react'\n"
      "import { createRoot } from 'react-dom/client'\n"
      f"import './{css_import}'\n"
      "import Doc from '../../../app/Doc.jsx'\n"
      "import Body from './body.html?raw'\n"
      "import PageScriptRaw from './page.js.txt?raw'\n"
      "import ShellScriptRaw from '../../../app/shell.js.txt?raw'\n"
      + extra_import + '\n'
      "const seg = t => t.split('/*@@BLOCK@@*/').map(s => s.trim()).filter(Boolean)\n"
      f"const scripts = [{', '.join(parts)}]\n\n"
      "createRoot(document.getElementById('root')).render(<Doc body={Body} scripts={scripts} />)\n")

# ---------- Doc component ----------
w('src/app/Doc.jsx', '''import React, { useLayoutEffect, useRef } from 'react'

/* Renders the page's original static markup verbatim, then executes its
   original <script> blocks as classic scripts inside the host node —
   same order and global semantics as the source page's end-of-body code. */
export default function Doc({ body, scripts = [] }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const host = ref.current
    host.innerHTML = body
    for (const code of scripts) {
      const el = document.createElement('script')
      el.textContent = code
      host.appendChild(el)
    }
  }, [])
  return <div ref={ref} />
}
''')

# ---------- report ----------
print('generated pages:')
for key, html_out, folder, css_import, group in inputs:
    print(f'  {html_out:44s} css={css_import}')
print('total:', len(inputs))
