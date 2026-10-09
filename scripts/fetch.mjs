// Fetches FPL data and inlines it into index.html. Run by GitHub Actions; never called from the browser.
// Only rewrites the file when fixtures actually changed, so the cron doesn't spam commits.
import { readFileSync, writeFileSync } from 'node:fs';
const API = 'https://fantasy.premierleague.com/api/';
const get = async p => {
  const r = await fetch(API + p, { headers: { 'User-Agent': 'FPLSnap (+https://fplsnap.com)' } });
  if (!r.ok) throw new Error(`${p}: ${r.status}`);
  return r.json();
};
const [boot, fixtures] = await Promise.all([get('bootstrap-static/'), get('fixtures/')]);
const next = boot.events.find(e => e.is_next) ?? boot.events.find(e => e.is_current);
const from = next.id;

// Attack/defence difficulty 1-5. The API's own attack/defence strength fields are all zero, so we derive them
// from this season's results: opponent goals conceded (hard to score vs) and scored (hard to keep a clean sheet vs),
// shrunk toward the league average so a few early games don't swing it.
const S = boot.teams;
const gf = {}, ga = {}, gp = {};
for (const t of S) gf[t.id] = ga[t.id] = gp[t.id] = 0;
for (const f of fixtures) {
  if (!f.finished) continue;
  gf[f.team_h] += f.team_h_score; ga[f.team_h] += f.team_a_score;
  gf[f.team_a] += f.team_a_score; ga[f.team_a] += f.team_h_score; gp[f.team_h]++; gp[f.team_a]++;
}
const K = 3, AVG = 1.4; // K = games of prior; AVG = rough league goals per team per game
const rateOf = (g, id) => (g[id] + AVG * K) / (gp[id] + K);
const bucketer = fn => {
  const s = S.map(t => fn(t.id)).sort((a, b) => a - b);
  return id => 1 + Math.min(4, Math.floor((5 * s.indexOf(fn(id))) / s.length));
};
const atkDiff = bucketer(id => -rateOf(ga, id)); // opponent concedes little => hard to score
const defDiff = bucketer(id => rateOf(gf, id)); // opponent scores a lot => hard to keep a clean sheet

const teams = S.map(t => ({ id: t.id, short: t.short_name, name: t.name, f: [] }));
const byId = Object.fromEntries(teams.map(t => [t.id, t]));
// g=gameweek o=opponent h=home r=official FDR a=attack d=defence k=kickoff
const add = (me, opp, home, g, r, k) => {
  byId[me].f.push({
    g, o: opp, h: home, r,
    a: atkDiff(opp),
    d: defDiff(opp),
    ...(k && { k: k.slice(0, 16) + 'Z' }),
  });
};
for (const f of fixtures) {
  if (!f.event || f.event < from) continue;
  add(f.team_h, f.team_a, 1, f.event, f.team_h_difficulty, f.kickoff_time);
  add(f.team_a, f.team_h, 0, f.event, f.team_a_difficulty, f.kickoff_time);
}
const ev = { id: from, dl: next.deadline_time };
const re = /(<script id="d" type="application\/json">)([\s\S]*?)(<\/script>)/;
const html = readFileSync('index.html', 'utf8');
const old = JSON.parse(html.match(re)[2] || 'null');
if (old && JSON.stringify({ ...old, updated: 0 }) === JSON.stringify({ updated: 0, ev, teams })) {
  console.log('no change'); process.exit(0);
}
const data = JSON.stringify({ updated: new Date().toISOString(), ev, teams });
writeFileSync('index.html', html.replace(re, (_, a, __, c) => a + data + c));
console.log(`wrote GW${from}, ${data.length} bytes`);
