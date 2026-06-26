// api/scores.js — Vercel Serverless Function
// Source : football-data.org (API documentée, gratuite, fiable)
// Retourne : scores + buteurs + classements en temps réel

const TLA = {
  ALG:'DZA', DZA:'DZA', MAR:'MAR', EGY:'EGY', SEN:'SEN', GHA:'GHA',
  NGA:'NGA', CMR:'CMR', CIV:"CIV", COD:'COD', TUN:'TUN', RSA:'RSA',
  SAU:'KSA', KSA:'KSA', IRN:'IRN', JPN:'JPN', KOR:'KOR', AUS:'AUS',
  CPV:'CPV', HTI:'HTI', BIH:'BIH', CUW:'CUW', SCO:'SCO', NZL:'NZL',
  URU:'URU', PAR:'PAR', PAN:'PAN', BOL:'BOL',
};
const norm = c => TLA[c] || c;

const ST = {
  FINISHED:'final', IN_PLAY:'live', PAUSED:'live',
  TIMED:'scheduled', SCHEDULED:'scheduled', POSTPONED:'scheduled',
  SUSPENDED:'scheduled'
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=45, stale-while-revalidate=90');

  const TOKEN = process.env.FOOTBALL_DATA_TOKEN;
  if (!TOKEN) {
    return res.status(500).json({
      error:'Token manquant. Ajoutez FOOTBALL_DATA_TOKEN dans Vercel > Settings > Environment Variables.',
      matches:[], standings:[]
    });
  }

  try {
    // ── Matchs (scores + buteurs) ─────────────────────────────────────────────
    const mRes = await fetch(
      'https://api.football-data.org/v4/competitions/WC/matches?status=FINISHED,IN_PLAY,SCHEDULED',
      {headers:{'X-Auth-Token': TOKEN}}
    );
    const mData = await mRes.json();

    const matches = (mData.matches || []).map(m => {
      const st  = ST[m.status] || 'scheduled';
      const hs  = m.score?.fullTime?.home  ?? 0;
      const as_ = m.score?.fullTime?.away  ?? 0;
      const gr  = (m.group || '').replace(/^GROUP_/,'').replace(/^Group\s*/i,'').trim();
      const goals = (m.goals || []).map(g => ({
        s: g.team?.id === m.homeTeam?.id ? 'H' : 'A',
        n: g.type === 'OWN_GOAL'
             ? (g.scorer?.name || '?') + ' og'
             : (g.scorer?.name || null),
        m: g.minute || null
      }));
      return {
        h: norm(m.homeTeam?.tla || ''),
        a: norm(m.awayTeam?.tla || ''),
        hs, as: as_, st,
        d: (m.utcDate || '').slice(0,10),
        gr: gr.length===1 ? gr : '',
        g: goals
      };
    });

    // ── Classements ───────────────────────────────────────────────────────────
    const sRes = await fetch(
      'https://api.football-data.org/v4/competitions/WC/standings',
      {headers:{'X-Auth-Token': TOKEN}}
    );
    const sData = await sRes.json();

    const standings = [];
    (sData.standings || []).forEach(grp => {
      const grCode = (grp.group || '').replace(/^GROUP_/,'').replace(/^Group\s*/i,'').trim();
      if (!grCode || grCode.length !== 1) return;
      (grp.table || []).forEach(row => {
        standings.push({
          gr: grCode,
          t:  norm(row.team?.tla || ''),
          pts: row.points  || 0,
          w:   row.won     || 0,
          d:   row.draw    || 0,
          l:   row.lost    || 0,
        });
      });
    });

    res.json({
      matches,
      standings,
      count:     matches.length,
      liveCount: matches.filter(m => m.st === 'live').length,
      ts:        new Date().toISOString()
    });

  } catch(e) {
    res.status(500).json({error: e.message, matches:[], standings:[]});
  }
}
