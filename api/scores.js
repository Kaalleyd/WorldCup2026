// api/scores.js — Vercel Serverless Function
// Scores + Buteurs + Classements ESPN — tout automatique, côté serveur

const MAP = {ALG:'DZA',SAU:'KSA',DRC:'COD',COD:'COD',HAI:'HTI',HTI:'HTI',
             BOH:'BIH',BIH:'BIH',MOR:'MAR',CPV:'CPV',CVI:'CPV',PAR:'PAR',
             URU:'URU',CUW:'CUW',UZB:'UZB',NZL:'NZL',SCO:'SCO',CIV:'CIV'};
const norm = c => MAP[c] || c;
const HDR  = {'User-Agent':'Mozilla/5.0','Accept':'application/json'};

function dateStr(n) {
  const d = new Date(Date.now() - n * 86400000);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`;
}

async function safeGet(url) {
  try {
    const r = await fetch(url, {headers: HDR, signal: AbortSignal.timeout(6000)});
    return r.ok ? r.json() : null;
  } catch { return null; }
}

function parseGoals(summary, hCode, aCode) {
  if (!summary) return [];
  const evs = summary.keyEvents
    || summary.competition?.keyEvents
    || summary.competitions?.[0]?.keyEvents
    || [];
  const goals = [];
  evs.forEach(ev => {
    if (!ev.scoringPlay) return;
    const teamAbbr = norm(ev.team?.abbreviation || '');
    const side = teamAbbr === hCode ? 'H' : teamAbbr === aCode ? 'A' : null;
    if (!side) return;
    const athlete = ev.athletesInvolved?.[0]?.displayName || null;
    const isOG = ev.ownGoal || (ev.text||'').toLowerCase().includes('own goal')
                || (ev.text||'').toLowerCase().includes('but contre');
    const name = athlete ? (isOG ? athlete + ' og' : athlete) : null;
    const raw = (ev.clock?.displayValue || '').replace(/'/g,'').split('+')[0];
    const min = parseInt(raw) || null;
    if (name || min) goals.push({s: side, n: name || undefined, m: min || undefined});
  });
  return goals;
}

function parseStandings(data) {
  if (!data) return [];
  const rows = [];
  const groups = data.standings || data.groups || [];
  groups.forEach(grp => {
    const name = (grp.name || grp.abbreviation || '').replace(/Group\s*/i,'').trim();
    if (!name || name.length !== 1) return;
    (grp.standings?.entries || grp.entries || []).forEach(entry => {
      const t = entry.team?.abbreviation ? norm(entry.team.abbreviation) : null;
      if (!t) return;
      const stats = {};
      (entry.stats || []).forEach(s => { stats[s.name || s.abbreviation] = parseInt(s.value) || 0; });
      rows.push({
        gr: name, t,
        pts: stats.points   || stats.pts || 0,
        w:   stats.wins     || stats.W   || stats.gamesWon  || 0,
        d:   stats.ties     || stats.D   || stats.gamesTied || 0,
        l:   stats.losses   || stats.L   || stats.gamesLost || 0,
      });
    });
  });
  return rows;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=45, stale-while-revalidate=90');

  try {
    // ── 1. Scoreboard (4 derniers jours + live du jour) ───────────────────────
    const sbUrls = [
      'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?limit=100',
      ...Array.from({length:5},(_,i)=>
        `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${dateStr(i)}&limit=50`)
    ];
    const sbResults = await Promise.allSettled(sbUrls.map(safeGet));
    const seen = new Set();
    const matches = [];
    sbResults.forEach(r => {
      if (r.status !== 'fulfilled' || !r.value) return;
      (r.value.events || []).forEach(ev => {
        const comp = ev.competitions?.[0];
        if (!comp) return;
        const home = comp.competitors?.find(c => c.homeAway === 'home');
        const away = comp.competitors?.find(c => c.homeAway === 'away');
        if (!home || !away) return;
        const hc = norm(home.team.abbreviation);
        const ac = norm(away.team.abbreviation);
        const key = `${hc}|${ac}`;
        if (seen.has(key)) return;
        seen.add(key);
        const espnSt = ev.status?.type?.state;
        const st = espnSt === 'in' ? 'live' : espnSt === 'post' ? 'final' : 'scheduled';
        matches.push({
          id: ev.id, h: hc, a: ac,
          hs: st !== 'scheduled' ? parseInt(home.score) || 0 : 0,
          as: st !== 'scheduled' ? parseInt(away.score) || 0 : 0,
          st, d: (ev.date||'').slice(0,10), gr: '', g: []
        });
      });
    });

    // ── 2. Summaries pour les matchs terminés/live → buteurs ─────────────────
    const toFetch = matches.filter(m => m.id && (m.st === 'final' || m.st === 'live'));
    await Promise.allSettled(toFetch.map(async m => {
      const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${m.id}`;
      const data = await safeGet(url);
      const goals = parseGoals(data, m.h, m.a);
      if (goals.length > 0) m.g = goals;
    }));

    // ── 3. Classements ESPN ───────────────────────────────────────────────────
    const stData = await safeGet(
      'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/standings');
    const standings = parseStandings(stData);

    // Extraire le groupe depuis les notes ESPN (bonus si disponible)
    matches.forEach(m => {
      if (!m.gr) {
        const found = standings.find(s => s.t === m.h || s.t === m.a);
        // On ne peut pas déduire le groupe depuis le standing seul sans plus d'info
        // Le HTML utilisera le groupe du INIT_MATCHES via la fusion
      }
    });

    res.json({
      matches,
      standings,
      liveCount: matches.filter(m => m.st === 'live').length,
      count: matches.length,
      ts: new Date().toISOString()
    });

  } catch (e) {
    res.status(500).json({error: e.message, matches: [], standings: []});
  }
}
