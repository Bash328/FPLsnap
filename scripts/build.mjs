// Builds _site/: copies site/, injects shared partials, inlines ticker data into index.html and writes
// data/site.json for the other pages. Run by GitHub Actions on a schedule; never called from the browser.
import { compute } from '../shared/compute.mjs';
import { cpSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
const API = 'https://fantasy.premierleague.com/api/';
const get = async (p, tries = 3) => {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(API + p, { headers: { 'User-Agent': 'FPLSnap (+https://fplsnap.com)' } });
      if (!r.ok) throw new Error(`${p}: ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i >= tries) throw e;
      await new Promise(r => setTimeout(r, 2000 * i));
    }
  }
};
const [boot, fixtures] = await Promise.all([get('bootstrap-static/'), get('fixtures/')]);
const { ticker: tk, site } = compute(boot, fixtures);

rmSync('_site', { recursive: true, force: true });
cpSync('site', '_site', { recursive: true });
mkdirSync('_site/data');
writeFileSync('_site/data/site.json', JSON.stringify(site));

// Partials: <!--nav--> and <!--foot--> are replaced in every page.
const nav = readFileSync('site/_nav.html', 'utf8'), foot = readFileSync('site/_foot.html', 'utf8');
const ticker = JSON.stringify(tk);
for (const f of readdirSync('_site').filter(f => f.endsWith('.html') && !f.startsWith('_'))) {
  let h = readFileSync('_site/' + f, 'utf8').replace('<!--nav-->', nav).replace('<!--foot-->', foot);
  if (f === 'index.html') h = h.replace(/(<script id="d" type="application\/json">)[\s\S]*?(<\/script>)/, (_, a, c) => a + ticker + c);
  writeFileSync('_site/' + f, h);
}
for (const f of readdirSync('_site').filter(f => f.startsWith('_'))) rmSync('_site/' + f);
console.log(`built GW${site.ev.id}: ${site.players.length} players, site.json ${JSON.stringify(site).length} bytes`);
