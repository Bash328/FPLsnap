// Shared by every page: storage, team chips, nav highlight, sortable tables, ad consent, service worker.
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} },
};
// Own colour chips (not club crests). Unknown/new clubs fall back to grey.
const KIT = {ARS:['#dc2626','#fff'],AVL:['#7b1c3e','#9fd3f0'],BOU:['#dc2626','#111'],BRE:['#dc2626','#fff'],BHA:['#1d6fd1','#fff'],CHE:['#1d4ed8','#fff'],COV:['#7dd3fc','#0f172a'],CRY:['#1d4ed8','#dc2626'],EVE:['#1d4ed8','#fff'],FUL:['#f8fafc','#111'],HUL:['#f59e0b','#111'],IPS:['#2563eb','#fff'],LEE:['#f8fafc','#1d4ed8'],LIV:['#dc2626','#fff'],MCI:['#7dd3fc','#0f172a'],MUN:['#dc2626','#fbbf24'],NEW:['#111827','#fff'],NFO:['#b91c1c','#fff'],TOT:['#f8fafc','#0f172a'],SUN:['#dc2626','#fff'],WHU:['#7b1c3e','#9fd3f0'],WOL:['#f59e0b','#111'],BUR:['#7b1c3e','#9fd3f0'],LEI:['#2563eb','#fff'],SOU:['#dc2626','#fff']};
const chip = (s, sm) => { const [b, f] = KIT[s] || ['#475569', '#fff']; return `<span class="b${sm ? ' s' : ''}" style="background:${b};color:${f}" aria-hidden="true">${s}</span>` };
const POS = ['', 'GKP', 'DEF', 'MID', 'FWD'];

// Page data (everything except the ticker, which inlines its own)
const loadSite = () => fetch('data/site.json').then(r => r.json());

// Sortable table. cols: [{h, f: row=>html, v: row=>sortValue, cls, asc}]. Returns redraw(newRows).
function table(el, cols, rows, o = {}) {
  let si = o.sort ?? 0, dir = cols[si].asc ? 1 : -1;
  const draw = () => {
    const c = cols[si], r = [...rows].sort((a, b) => { const x = c.v(a), y = c.v(b); return (x > y ? 1 : x < y ? -1 : 0) * dir }).slice(0, o.limit || 100);
    el.innerHTML = '<thead><tr>' + cols.map((c, i) => `<th scope="col" data-i="${i}" class="${c.cls || ''}" aria-sort="${i === si ? (dir < 0 ? 'descending' : 'ascending') : 'none'}">${c.h}${i === si ? (dir < 0 ? ' ▼' : ' ▲') : ''}</th>`).join('') + '</tr></thead><tbody>' +
      (r.map(x => '<tr>' + cols.map(c => `<td class="${c.cls || ''}">${c.f(x)}</td>`).join('') + '</tr>').join('') || `<tr><td colspan="${cols.length}" class="w">Nothing to show.</td></tr>`) + '</tbody>';
  };
  el.classList.add('dt');
  el.onclick = e => { const th = e.target.closest('th'); if (!th) return; const i = +th.dataset.i; dir = i === si ? -dir : (cols[i].asc ? 1 : -1); si = i; draw() };
  draw();
  return nr => { rows = nr; draw() };
}

// Nav highlight
{
  const here = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.links a').forEach(a => { if ((a.getAttribute('href') === './' ? 'index.html' : a.getAttribute('href')) === here) a.classList.add('on') });
}

// Ads load only after consent. Set PUB to your AdSense publisher id once approved.
const PUB = '';
function ads() {
  if (store.get('ads') !== true || !PUB) return;
  const s = document.createElement('script'); s.async = true;
  s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + PUB; document.head.append(s);
  // ponytail: slots are still placeholders; swap each .ad for an <ins class="adsbygoogle"> once units exist
}
const choose = v => { store.set('ads', v); $('cb').classList.remove('on'); ads() };
$('yes').onclick = () => choose(true); $('no').onclick = () => choose(false);
$('adc').onclick = e => { e.preventDefault(); $('cb').classList.add('on') };
if (store.get('ads') === null) $('cb').classList.add('on'); else ads();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
