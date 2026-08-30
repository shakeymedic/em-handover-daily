#!/usr/bin/env python3
"""Build preview.html — a single self-contained file (no fetch, no modules) for
looking at the site without running a server. Not part of the deployed site."""
import json, pathlib, re

root = pathlib.Path(__file__).resolve().parent.parent
read = lambda p: (root / p).read_text()

css  = read('assets/style.css')
app  = read('assets/app.js')
qr   = read('assets/qr.js')
alr  = read('assets/alerts.js')
pap  = read('assets/papers.js')
mods = read('data/modules.json')
paps = read('data/papers.json')
html = read('index.html')

def strip(src):
    return re.sub(r"^import .*?;\s*$", "", src.replace('export ', ''), flags=re.M)

def scoped(src, exports):
    """Wrap a module body so concatenated modules don't collide on shared
    private names (CACHE_KEY, esc, readCache ...), then publish its API."""
    names = ", ".join(exports)
    return "(() => {\n" + strip(src) + f"\nObject.assign(globalThis, {{ {names} }});\n}})();"

qr  = scoped(qr,  ['qrSVG', 'qrMatrix', 'qrInfo'])
alr = scoped(alr, ['getAlerts', 'renderAlerts', 'alertLines'])
pap = scoped(pap, ['loadPapers', 'pickPaperForDate', 'renderPaper', 'paperLink', 'citation', 'parseCSV'])

# no local file reads in a single-file preview
alr = alr.replace("const res = await fetch('data/rcem-alerts.json', { cache: 'no-cache' });",
                  "const res = { ok: false, json: async () => ({}) };")

html = html.replace('<link rel="stylesheet" href="assets/style.css">', f'<style>\n{css}\n</style>')
html = html.replace('<link rel="manifest" href="manifest.webmanifest">', '')
html = html.replace('<title>EM Handover Daily</title>', '<title>EM Handover Daily — preview</title>')

inline = f"""<script>
{app}
</script>
<script>
{qr}
{alr}
{pap}

const INLINE_MODULES = {mods};
const INLINE_PAPERS  = {paps};
loadModules = async () => INLINE_MODULES.modules.slice()
  .sort((a,b)=>(a.date||'').localeCompare(b.date||''));

(async () => {{
  try {{ renderAlerts(document.getElementById('alerts'), await getAlerts({{ limit: 3 }})); }} catch (e) {{}}

  const iso = localISODate();
  document.querySelector('[data-today-label]').textContent = longDate(iso);

  const modules = await loadModules();
  const picked = pickForDate(modules, iso);
  renderModule(document.getElementById('today'), picked.module,
    {{ eyebrow: picked.scheduled ? longDate(iso) : longDate(iso) + ' — from the archive' }});

  const papers = INLINE_PAPERS.papers.map(p => ({{ ...p, tags: p.tags || [] }}));
  renderPaper(document.getElementById('paper'), pickPaperForDate(papers, iso),
    {{ degraded: false, message: '' }});
}})();
</script>
"""
start = html.index('<script src="assets/app.js"></script>')
end   = html.index('</body>')
out   = html[:start] + inline + html[end:]
(root / 'preview.html').write_text(out)
print('preview.html', len(out), 'bytes')
