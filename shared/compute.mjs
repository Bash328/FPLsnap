// Turns FPL's bootstrap-static + fixtures into the two payloads the site uses.
// Shared by the Cloudflare Worker (refreshes every few minutes) and scripts/build.mjs (static fallback).
//   ticker: slim fixture data for the ticker page   site: everything the other pages need
export function compute(boot, fixtures) {
  const next = boot.events.find(e => e.is_next) ?? boot.events.find(e => e.is_current);
  const from = next.id;
  const cur = boot.events.find(e => e.is_current)?.id ?? from - 1;
  const S = boot.teams;

  // Attack/defence difficulty 1-5. The API's own attack/defence strength fields are all zero, so we derive them
  // from this season's results: opponent goals conceded (hard to score vs) and scored (hard to keep a clean sheet vs),
  // shrunk toward the league average so a few early games don't swing it.
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
  const add = (me, opp, home, g, r, k) => byId[me].f.push({
    g, o: opp, h: home, r, a: atkDiff(opp), d: defDiff(opp), ...(k && { k: k.slice(0, 16) + 'Z' }),
  });
  for (const f of fixtures) {
    if (!f.event || f.event < from) continue;
    add(f.team_h, f.team_a, 1, f.event, f.team_h_difficulty, f.kickoff_time);
    add(f.team_a, f.team_h, 0, f.event, f.team_a_difficulty, f.kickoff_time);
  }
  const ev = { id: from, dl: next.deadline_time };

  // Blank/double gameweeks across the rest of the season
  const gw = {};
  for (const t of teams) for (const f of t.f) (gw[f.g] ??= {})[t.id] = (gw[f.g][t.id] ?? 0) + 1;
  const gwInfo = Object.fromEntries(Object.entries(gw).map(([g, c]) => [g, {
    dgw: teams.filter(t => c[t.id] > 1).map(t => t.id),
    bgw: teams.filter(t => !c[t.id]).map(t => t.id),
  }]));

  // Slim player records. Short keys keep the JSON small.
  const num = v => (v == null || v === '' ? 0 : +v);
  const players = boot.elements.filter(p => p.status !== 'u' || +p.selected_by_percent > 0).map(p => ({
    i: p.id, n: p.web_name, t: p.team, e: p.element_type, c: p.now_cost / 10,
    st: p.status, nw: p.news, ch: p.chance_of_playing_next_round, na: p.news_added,
    f: num(p.form), pt: p.total_points, ep: num(p.ep_next), pg: num(p.points_per_game),
    o: num(p.selected_by_percent), ti: p.transfers_in_event, to: p.transfers_out_event,
    cc: p.cost_change_event / 10, cs: p.cost_change_start / 10, m: p.minutes, g: p.goals_scored, a: p.assists,
    cl: p.clean_sheets, b: p.bonus, xg: num(p.expected_goals), xa: num(p.expected_assists),
    xi: num(p.expected_goal_involvements), xc: num(p.expected_goals_conceded), ict: num(p.ict_index), ev: p.event_points,
    // official FPL price-change progress: +-100 = a change is due; lk = likelihood -5..5 for tonight
    pp: num(p.price_change_percent), pr: num(p.price_change_projections?.[0]?.projected_percent),
    lk: p.price_change_projections?.[0]?.likelihood ?? 0, pl: p.price_change_locked_until,
  }));
  const updated = new Date().toISOString();
  return {
    ticker: { updated, ev, teams },
    site: {
      updated, ev: { ...ev, cur },
      teams: Object.fromEntries(teams.map(t => [t.id, { short: t.short, name: t.name, nx: t.f.filter(f => f.g === from) }])),
      chips: boot.chips.map(c => ({ n: c.name, a: c.start_event, z: c.stop_event })),
      evs: boot.events.map(e => ({ id: e.id, avg: e.average_entry_score, hi: e.highest_score, fin: e.finished })),
      fx: Object.fromEntries(teams.map(t => [t.id, t.f.map(f => ({ g: f.g, o: f.o, h: f.h, r: f.r }))])),
      gw: gwInfo, players,
    },
  };
}
