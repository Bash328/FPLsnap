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

// FPLSnap API worker: caching CORS proxy for public FPL manager/live data (see worker/)
const API = 'https://fplsnap-api.cwakiku.workers.dev';
const api = path => fetch(API + '/api/' + path).then(r => { if (!r.ok) throw new Error(r.status); return r.json() });
const fpl = path => api('fpl/' + path);
// Remembered Team ID, shared by every manager tool. Stored on this device only.
const teamId = { get: () => store.get('tid', ''), set: v => store.set('tid', String(v)) };

// Points a manager's picks have scored in a gameweek: starters x multiplier (bench players come in where FPL
// has set auto-subs), minus transfer hits. Does not re-pick the vice-captain if the captain didn't play.
function scorePicks(pk, live) {
  const pts = Object.fromEntries(live.elements.map(e => [e.id, e.stats.total_points]));
  const subs = pk.automatic_subs || [], inn = new Set(subs.map(x => x.element_in)), out = new Set(subs.map(x => x.element_out));
  const cost = pk.entry_history.event_transfers_cost || 0;
  const rows = pk.picks.map(p => {
    const start = (p.position <= 11 && !out.has(p.element)) || inn.has(p.element);
    const mult = start ? (p.position <= 11 ? p.multiplier : 1) : 0, raw = pts[p.element] ?? 0;
    return { ...p, start, mult, raw, v: raw * mult };
  });
  return { rows, cost, total: rows.reduce((a, r) => a + r.v, 0) - cost };
}
// Provisional bonus from BPS (3/2/1, ties share the points of the places they occupy)
function bonusFor(list) {
  const out = {}, pts = [3, 2, 1], l = [...list].sort((a, b) => b.value - a.value);
  for (let i = 0, pos = 0; i < l.length && pos < 3;) {
    let j = i; while (j < l.length && l[j].value === l[i].value) j++;
    for (let k = i; k < j; k++) out[l[k].element] = pts[pos];
    pos += j - i; i = j;
  }
  return out;
}
// Team ID input: fills #tid, wires #go, calls onLoad(id)
function teamInput(onLoad) {
  $('tid').value = teamId.get();
  const go = () => { const v = $('tid').value.trim(); if (!/^\d{1,9}$/.test(v)) { $('out').innerHTML = '<div class="msg err">Enter your numeric Team ID.</div>'; return } teamId.set(v); onLoad(+v) };
  $('go').onclick = go; $('tid').onkeydown = e => { if (e.key === 'Enter') go() };
  if (teamId.get()) go();
}
const idHelp = '<p>Find your Team ID in the URL when you open your team on the FPL site: fantasy.premierleague.com/entry/<b>123456</b>/event/1. No login needed, and the ID is only stored on this device.</p>';

// Page data (everything except the ticker, which inlines its own)
// Fresh data comes from the API worker (refreshed every 5 minutes); the build's copy is the fallback.
let loadedAt = '', act = Date.now(), banner, watching;
const loadSite = () => api('site').catch(() => fetch('data/site.json').then(r => r.json())).then(d => { loadedAt = d.updated; watch(); return d });
['pointerdown', 'keydown', 'scroll'].forEach(e => addEventListener(e, () => act = Date.now(), { passive: true }));
// While a page stays open, pick up newer data: reload quietly if the visitor is idle, otherwise offer a refresh
function watch() {
  if (watching) return;
  watching = setInterval(async () => {
    if (document.hidden) return;
    try {
      const v = await api('version');
      if (!v.site || v.site <= loadedAt) return;
      if (Date.now() - act > 30000) return location.reload();
      if (!banner) {
        banner = document.createElement('div'); banner.className = 'msg';
        banner.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:16px;z-index:8;cursor:pointer';
        banner.textContent = 'Fresh data available · tap to refresh'; banner.onclick = () => location.reload(); document.body.append(banner);
      }
    } catch {}
  }, 120000);
}
// "Updated 3 min ago", amber when older than an hour. Keeps itself current.
function stamp(el, iso, label = 'Updated') {
  const f = () => {
    const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 6e4));
    el.textContent = `${label} ${m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago'}`;
    el.title = new Date(iso).toLocaleString(); el.style.color = m > 60 ? '#fbbf24' : '';
  };
  f(); clearInterval(el._t); el._t = setInterval(f, 30000);
}

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

// Navigation: four groups in the top bar, sibling pages as a tab strip inside the hero banner
{
  const GROUPS = {
    plan: [['./', 'Fixtures'], ['chips.html', 'Chips'], ['planner.html', 'Planner']],
    market: [['prices.html', 'Prices'], ['players.html', 'Players'], ['captains.html', 'Captains'], ['news.html', 'News'], ['elite.html', 'Elite']],
    live: [['live.html', 'Live'], ['league.html', 'League']],
    insights: [['totw.html', 'Team of the Week'], ['accuracy.html', 'Accuracy']],
  };
  const here = location.pathname.split('/').pop() || 'index.html', norm = h => h === './' ? 'index.html' : h;
  const g = Object.keys(GROUPS).find(k => GROUPS[k].some(([h]) => norm(h) === here));
  // each group becomes a pill with a dropdown of its pages (opens on hover, or on click/Enter for touch and keyboard)
  document.querySelectorAll('.links>a[data-g]').forEach(a => {
    const k = a.dataset.g, dd = document.createElement('div');
    dd.className = 'dd' + (k === g ? ' cur' : '');
    a.replaceWith(dd);
    if (k === g) a.classList.add('on');
    dd.innerHTML = `<button class="chev" aria-label="${a.textContent} menu" aria-expanded="false"></button><div class="menu">` +
      GROUPS[k].map(([h, t]) => `<a href="${h}"${norm(h) === here ? ' class="on"' : ''}>${t}</a>`).join('') + '</div>';
    dd.prepend(a);
    dd.querySelector('.chev').onclick = e => {
      e.stopPropagation();
      document.querySelectorAll('.dd.open').forEach(o => { if (o !== dd) { o.classList.remove('open'); o.querySelector('.chev').setAttribute('aria-expanded', 'false') } });
      dd.querySelector('.chev').setAttribute('aria-expanded', dd.classList.toggle('open'));
    };
  });
  const close = () => document.querySelectorAll('.dd.open').forEach(o => { o.classList.remove('open'); o.querySelector('.chev').setAttribute('aria-expanded', 'false') });
  document.addEventListener('click', close); document.addEventListener('keydown', e => { if (e.key === 'Escape') close() });
  const navEl = document.querySelector('.nav');
  if (navEl) addEventListener('scroll', () => navEl.classList.toggle('scrolled', scrollY > 4), { passive: true });
  const hero = document.querySelector('.hero .in');
  if (hero && g) hero.insertAdjacentHTML('beforeend', '<div class="sub">' + GROUPS[g].map(([h, t]) => `<a href="${h}"${norm(h) === here ? ' class="on"' : ''}>${t}</a>`).join('') + '</div>');
}

// Custom dropdowns styled like the nav menus. The native <select> stays in the DOM (hidden) so page code keeps working:
// its value, change events and options still drive everything.
function enhanceSelect(sel) {
  const valueProp = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  const wrap = document.createElement('div'); wrap.className = 'sel';
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'selbtn';
  btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-label', sel.getAttribute('aria-label') || '');
  btn.innerHTML = '<span class="lbl"></span><i class="cv"></i>';
  const menu = document.createElement('ul'); menu.className = 'menu'; menu.setAttribute('role', 'listbox');
  sel.before(wrap); wrap.append(btn, menu, sel); sel.tabIndex = -1; sel.setAttribute('aria-hidden', 'true');
  const sync = () => { btn.firstChild.textContent = sel.selectedOptions[0]?.textContent ?? '' };
  const items = () => [...menu.children];
  let act = -1;
  const mark = () => items().forEach((li, i) => li.classList.toggle('act', i === act));
  const close = () => { wrap.classList.remove('open'); btn.setAttribute('aria-expanded', 'false') };
  const open = () => {
    document.querySelectorAll('.sel.open').forEach(o => o !== wrap && o.classList.remove('open'));
    menu.innerHTML = [...sel.options].map((o, i) => `<li role="option" aria-selected="${i === sel.selectedIndex}">${esc(o.textContent)}</li>`).join('');
    wrap.classList.add('open'); btn.setAttribute('aria-expanded', 'true');
    const r = menu.getBoundingClientRect(); menu.classList.toggle('r', r.right > innerWidth - 8 && wrap.getBoundingClientRect().right - r.width > 8);
    act = sel.selectedIndex; mark(); items()[act]?.scrollIntoView({ block: 'nearest' });
  };
  const pick = i => { if (i < 0) return; sel.selectedIndex = i; sel.dispatchEvent(new Event('change', { bubbles: true })); close(); btn.focus() };
  // keep the label right when page code sets .value or replaces the options
  Object.defineProperty(sel, 'value', { get() { return valueProp.get.call(sel) }, set(v) { valueProp.set.call(sel, v); sync() }, configurable: true });
  new MutationObserver(sync).observe(sel, { childList: true });
  sel.addEventListener('change', sync); sync();
  btn.onclick = e => { e.stopPropagation(); wrap.classList.contains('open') ? close() : open() };
  menu.onclick = e => { const li = e.target.closest('li'); if (li) { e.stopPropagation(); pick(items().indexOf(li)) } };
  btn.onkeydown = e => {
    const isOpen = wrap.classList.contains('open');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); if (!isOpen) return open();
      act = Math.min(items().length - 1, Math.max(0, act + (e.key === 'ArrowDown' ? 1 : -1))); mark(); items()[act].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); isOpen ? pick(act) : open() }
    else if (e.key === 'Escape' && isOpen) { e.preventDefault(); close() }
  };
}
document.querySelectorAll('.bar select').forEach(enhanceSelect);
document.addEventListener('click', () => document.querySelectorAll('.sel.open').forEach(o => { o.classList.remove('open'); o.querySelector('.selbtn').setAttribute('aria-expanded', 'false') }));

// Ads load only after consent. Fill these in once AdSense approves the site:
// PUB = your publisher id ('ca-pub-1234567890123456'); SLOTS = the ad unit ids for each position.
// Until then the empty .ad boxes stay hidden. With PUB set but a slot id empty, Google's Auto ads (if enabled in AdSense) still work.
const PUB = '';
const SLOTS = { top: '', bottom: '', side: '' };
function ads() {
  if (store.get('ads') !== true || !PUB) return;
  const s = document.createElement('script'); s.async = true; s.crossOrigin = 'anonymous';
  s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + PUB; document.head.append(s);
  document.querySelectorAll('.ad').forEach((el, i) => {
    const id = SLOTS[el.classList.contains('side') ? 'side' : i === 0 ? 'top' : 'bottom'];
    if (!id) return;
    el.innerHTML = `<ins class="adsbygoogle" style="display:block;width:100%" data-ad-client="${PUB}" data-ad-slot="${id}" data-ad-format="auto" data-full-width-responsive="true"></ins>`;
    el.classList.add('on');
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  });
}
const choose = v => { store.set('ads', v); $('cb').classList.remove('on'); ads() };
$('yes').onclick = () => choose(true); $('no').onclick = () => choose(false);
$('adc').onclick = e => { e.preventDefault(); $('cb').classList.add('on') };
if (store.get('ads') === null) $('cb').classList.add('on'); else ads();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
