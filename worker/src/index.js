// FPLSnap API: a caching, CORS-enabled read-only proxy for public FPL endpoints, plus a 30-minute cron that
// records price/captain prediction accuracy and samples elite-manager ownership.
import { compute } from '../../shared/compute.mjs';

const FPL = 'https://fantasy.premierleague.com/api/';
const UA = 'FPLSnap (+https://fplsnap.com)';
const ALLOW = [
  /^entry\/\d+\/$/, /^entry\/\d+\/history\/$/, /^entry\/\d+\/event\/\d+\/picks\/$/,
  /^event\/\d+\/live\/$/, /^leagues-classic\/\d+\/standings\/$/, /^fixtures\/$/,
];
const QUERY = ['event', 'page_standings', 'page_new_entries', 'phase'];
const ttl = p => (p.startsWith('event/') || p.startsWith('fixtures') ? 60 : 300);
const ELITE_SAMPLE_PAGES = 3; // overall league pages of 50 managers => top 150
const BATCH = 30; // picks fetched per cron run, stays inside the subrequest limit

const corsFor = (req, env) => {
  const o = req.headers.get('Origin') || '';
  const ok = (env.ALLOWED_ORIGINS || '').split(',').includes(o) || /^http:\/\/localhost(:\d+)?$/.test(o);
  return ok ? { 'Access-Control-Allow-Origin': o, Vary: 'Origin' } : {};
};
const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...extra } });

async function fpl(path) {
  const r = await fetch(FPL + path, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

async function proxy(req, url, ctx, cors) {
  const path = url.pathname.slice('/api/fpl/'.length);
  if (!ALLOW.some(r => r.test(path))) return json({ error: 'not allowed' }, 404, cors);
  const qs = new URLSearchParams();
  for (const k of QUERY) { const v = url.searchParams.get(k); if (v && /^\d+$/.test(v)) qs.set(k, v) }
  const up = FPL + path + ([...qs].length ? '?' + qs : '');
  const key = new Request(up), cache = caches.default;
  let res = await cache.match(key);
  if (!res) {
    const r = await fetch(up, { headers: { 'User-Agent': UA } });
    if (!r.ok) return json({ error: r.status }, r.status === 404 ? 404 : 502, cors);
    res = new Response(r.body, { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttl(path)}` } });
    ctx.waitUntil(cache.put(key, res.clone()));
  }
  return new Response(res.body, { status: 200, headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttl(path)}`, ...cors } });
}

// Serve the precomputed payloads from KV, cached at the edge for a minute
async function served(req, url, env, ctx, cors) {
  const key = url.pathname === '/api/site' ? 'site' : 'ticker', cache = caches.default, ck = new Request(url.origin + url.pathname);
  let res = await cache.match(ck);
  if (!res) {
    const [body, l] = await Promise.all([env.KV.get(key), env.KV.list({ prefix: 'site' })]);
    if (!body) return json({ error: 'not ready' }, 503, cors);
    res = new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60', 'x-checked': l.keys[0]?.metadata?.updated ?? '' } });
    ctx.waitUntil(cache.put(ck, res.clone()));
  }
  return new Response(res.body, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60', 'x-checked': res.headers.get('x-checked') || '', 'access-control-expose-headers': 'x-checked', ...cors } });
}

// ---- cron: data refresh, accuracy tracking, elite sampling ----
const push = async (env, key, row, cap) => {
  const log = (await env.KV.get(key, 'json')) || [];
  log.push(row);
  await env.KV.put(key, JSON.stringify(log.slice(-cap)));
};

async function trackPrices(env, boot) {
  const cost = {}, rise = [], fall = [];
  for (const p of boot.elements) {
    cost[p.id] = p.now_cost;
    const pp = +p.price_change_percent;
    if (pp >= 100) rise.push(p.id); else if (pp <= -100) fall.push(p.id);
  }
  const snap = await env.KV.get('snap', 'json');
  if (snap) {
    const actRise = [], actFall = [];
    for (const id in cost) if (snap.cost[id] != null) {
      if (cost[id] > snap.cost[id]) actRise.push(+id); else if (cost[id] < snap.cost[id]) actFall.push(+id);
    }
    // A price change just happened: grade the predictions we held before it.
    if (actRise.length || actFall.length) {
      const hit = (pred, act) => pred.filter(i => act.includes(i)).length;
      await push(env, 'plog', {
        t: new Date().toISOString(), predRise: snap.rise, actRise, predFall: snap.fall, actFall,
        hitRise: hit(snap.rise, actRise), hitFall: hit(snap.fall, actFall),
      }, 90);
    }
  }
  await env.KV.put('snap', JSON.stringify({ t: Date.now(), cost, rise, fall }));
}

async function trackCaptains(env, boot) {
  const next = boot.events.find(e => e.is_next);
  if (next) { // overwritten each run until the deadline, so the last one is the pre-deadline view
    const top = boot.elements.filter(p => p.status === 'a' && +p.ep_next > 0)
      .sort((a, b) => b.ep_next - a.ep_next).slice(0, 10).map(p => ({ id: p.id, ep: +p.ep_next }));
    const v = JSON.stringify(top);
    if ((await env.KV.get('capt:' + next.id)) !== v) await env.KV.put('capt:' + next.id, v);
  }
  const clog = (await env.KV.get('clog', 'json')) || [];
  const last = clog.at(-1)?.gw ?? 0;
  for (const e of boot.events.filter(e => e.finished && e.id > last).slice(0, 1)) {
    const top = await env.KV.get('capt:' + e.id, 'json');
    if (!top) continue;
    const live = await fpl(`event/${e.id}/live/`);
    const pts = Object.fromEntries(live.elements.map(x => [x.id, x.stats.total_points]));
    const rows = top.map(t => ({ ...t, actual: pts[t.id] ?? 0 }));
    const avg = a => a.reduce((s, x) => s + x.actual, 0) / (a.length || 1);
    await push(env, 'clog', { gw: e.id, rows, top3: avg(rows.slice(0, 3)), top10: avg(rows), best: Math.max(...Object.values(pts)) }, 60);
  }
}

async function sampleElite(env, boot) {
  const cur = boot.events.find(e => e.is_current);
  if (!cur) return;
  let st = await env.KV.get('elite', 'json');
  if (!st || st.gw !== cur.id) {
    const ids = [];
    for (let p = 1; p <= ELITE_SAMPLE_PAGES; p++) {
      const s = await fpl(`leagues-classic/314/standings/?page_standings=${p}`);
      ids.push(...s.standings.results.map(r => r.entry));
    }
    st = { gw: cur.id, ids, done: 0, n: 0, counts: {} };
  }
  if (st.done >= st.ids.length) return;
  const batch = st.ids.slice(st.done, st.done + BATCH);
  const res = await Promise.allSettled(batch.map(id => fpl(`entry/${id}/event/${cur.id}/picks/`)));
  for (const r of res) {
    if (r.status !== 'fulfilled') continue;
    // Free Hit squads are one-week squads, so they would distort ownership; skip them
    if (r.value.active_chip === 'freehit') continue;
    st.n++;
    for (const p of r.value.picks) st.counts[p.element] = (st.counts[p.element] || 0) + 1;
  }
  st.done += batch.length;
  await env.KV.put('elite', JSON.stringify(st));
}

// Refresh the data every page reads. KV writes are bounded (free plan allows 1000/day): the site payload is
// written each run, the ticker only when fixtures really changed, accuracy tracking every other run.
async function refreshSite(env, boot, fx) {
  const { site, ticker } = compute(boot, fx);
  await env.KV.put('site', JSON.stringify(site), { metadata: { updated: site.updated } });
  const t = JSON.stringify(ticker), strip = x => x.replace(/"updated":"[^"]*"/, '');
  const old = await env.KV.get('ticker');
  if (!old || strip(old) !== strip(t)) await env.KV.put('ticker', t);
}

async function cron(env) {
  const [boot, fx] = await Promise.all([fpl('bootstrap-static/'), fpl('fixtures/')]);
  const slow = new Date().getUTCMinutes() % 10 < 5;
  const jobs = [(e, b) => refreshSite(e, b, fx), ...(slow ? [trackPrices, trackCaptains] : []), sampleElite];
  for (const job of jobs) {
    try { await job(env, boot) } catch (e) { console.log('cron job failed', String(e)) }
  }
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url), cors = corsFor(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { headers: { ...cors, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' } });
    if (req.method !== 'GET') return json({ error: 'GET only' }, 405, cors);
    if (url.pathname.startsWith('/api/fpl/')) return proxy(req, url, ctx, cors);
    const pub = { ...cors, 'cache-control': 'public, max-age=60' };
    if (url.pathname === '/api/site' || url.pathname === '/api/ticker') return served(req, url, env, ctx, cors);
    if (url.pathname === '/api/version') {
      const l = await env.KV.list({ prefix: 'site' });
      return json({ site: l.keys[0]?.metadata?.updated ?? null }, 200, { ...cors, 'cache-control': 'public, max-age=30' });
    }
    if (url.pathname === '/api/accuracy') {
      return json({ price: (await env.KV.get('plog', 'json')) || [], captain: (await env.KV.get('clog', 'json')) || [] }, 200, pub);
    }
    if (url.pathname === '/api/elite') {
      const st = (await env.KV.get('elite', 'json')) || { gw: 0, n: 0, ids: [], done: 0, counts: {} };
      return json({ gw: st.gw, n: st.n, sample: st.ids.length, done: st.done, counts: st.counts }, 200, pub);
    }
    return json({ name: 'fplsnap-api', ok: true }, 200, cors);
  },
  async scheduled(_ev, env, ctx) { ctx.waitUntil(cron(env)) },
};
