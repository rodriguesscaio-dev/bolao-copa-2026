// =============================================================
//  /api/refresh — atualiza os PLACARES quando alguém abre o bolão.
//  Roda no Vercel (serverless, nuvem) — não depende do PC do Caio.
//  Fonte: football-data.org (API limpa, sem navegador). As estatísticas
//  detalhadas (SofaScore) são enriquecidas à parte.
//
//  Anti-abuso: só consulta a football-data se a última sincronização foi
//  há mais de MIN_INTERVAL (trava global via meta/lastSync no Firebase),
//  então mesmo com vários acessos simultâneos a API externa é poupada.
//
//  Variável de ambiente necessária no Vercel: FOOTBALL_DATA_TOKEN
// =============================================================
const TOKEN = process.env.FOOTBALL_DATA_TOKEN;
const DB = "https://bolao-copa-2026-e393b-default-rtdb.firebaseio.com";
const COMP = process.env.COMPETITION || "WC";
const MIN_INTERVAL = 60 * 1000; // 60s entre consultas reais

const STAGE = {
  GROUP_STAGE: "Fase de Grupos", LAST_32: "16-avos de Final", LAST_16: "Oitavas de Final",
  QUARTER_FINALS: "Quartas de Final", SEMI_FINALS: "Semifinal", THIRD_PLACE: "Disputa de 3º", FINAL: "Final",
};
const TEAMS = {
  "Brazil":"Brasil","Argentina":"Argentina","Uruguay":"Uruguai","Chile":"Chile","Colombia":"Colômbia",
  "Peru":"Peru","Paraguay":"Paraguai","Ecuador":"Equador","Bolivia":"Bolívia","Venezuela":"Venezuela",
  "United States":"Estados Unidos","USA":"Estados Unidos","Mexico":"México","Canada":"Canadá",
  "Costa Rica":"Costa Rica","Panama":"Panamá","Honduras":"Honduras","Jamaica":"Jamaica","Haiti":"Haiti",
  "Curacao":"Curaçao","Curaçao":"Curaçao","France":"França","Germany":"Alemanha","Spain":"Espanha",
  "Portugal":"Portugal","England":"Inglaterra","Italy":"Itália","Netherlands":"Holanda","Belgium":"Bélgica",
  "Croatia":"Croácia","Switzerland":"Suíça","Denmark":"Dinamarca","Poland":"Polônia","Serbia":"Sérvia",
  "Austria":"Áustria","Wales":"País de Gales","Scotland":"Escócia","Norway":"Noruega","Sweden":"Suécia",
  "Ukraine":"Ucrânia","Turkey":"Turquia","Türkiye":"Turquia","Greece":"Grécia","Czech Republic":"República Tcheca",
  "Czechia":"República Tcheca","Hungary":"Hungria","Morocco":"Marrocos","Senegal":"Senegal","Tunisia":"Tunísia",
  "Algeria":"Argélia","Egypt":"Egito","Cameroon":"Camarões","Ghana":"Gana","Nigeria":"Nigéria",
  "Côte d'Ivoire":"Costa do Marfim","Ivory Coast":"Costa do Marfim","South Africa":"África do Sul","Mali":"Mali",
  "Cape Verde":"Cabo Verde","Cape Verde Islands":"Cabo Verde","DR Congo":"Congo (RD)","Congo DR":"Congo (RD)",
  "Bosnia and Herzegovina":"Bósnia e Herzegovina","Bosnia-Herzegovina":"Bósnia e Herzegovina",
  "Bosnia & Herzegovina":"Bósnia e Herzegovina","Japan":"Japão","Korea Republic":"Coreia do Sul",
  "South Korea":"Coreia do Sul","Saudi Arabia":"Arábia Saudita","IR Iran":"Irã","Iran":"Irã","Iraq":"Iraque",
  "Qatar":"Catar","United Arab Emirates":"Emirados Árabes","Australia":"Austrália","New Zealand":"Nova Zelândia",
  "Uzbekistan":"Uzbequistão","Jordan":"Jordânia",
};
const pt = (n) => (n ? (TEAMS[n] || n) : "A definir");

// ---- ESPN (estatísticas + gols + estádio, grátis e sem chave) ----
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world";
const MAX_STATS = 8; // máx. de jogos enriquecidos por chamada (limita latência)
// estatística ESPN -> rótulo PT (ordem do modal). "%" => formata como inteiro%.
const ESPN_STATS = [
  ["possessionPct", "Posse de bola", "%"],
  ["totalShots", "Finalizações", ""],
  ["shotsOnTarget", "Finalizações no gol", ""],
  ["wonCorners", "Escanteios", ""],
  ["foulsCommitted", "Faltas", ""],
  ["offsides", "Impedimentos", ""],
  ["saves", "Defesas do goleiro", ""],
  ["yellowCards", "Cartões amarelos", ""],
  ["redCards", "Cartões vermelhos", ""],
  ["totalPasses", "Passes", ""],
  ["totalTackles", "Desarmes", ""],
];
const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const pairKey = (h, a) => `${norm(h)}|${norm(a)}`;
const ymd = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;

function espnVenue(s) {
  const v = s && s.gameInfo && s.gameInfo.venue;
  if (!v) return null;
  const city = v.address && v.address.city ? v.address.city : "";
  return [v.fullName, city].filter(Boolean).join(" — ") || null;
}
function espnGoals(s, homeId) {
  const evs = (s.keyEvents || []).filter((e) => e.scoringPlay || /goal/i.test((e.type && e.type.text) || ""));
  return evs
    .map((e) => {
      const min = parseInt((String((e.clock && e.clock.displayValue) || "").match(/\d+/) || [])[0], 10);
      let player = "—";
      const m = String(e.text || "").match(/\.\s+([^.()]+?)\s+\(/);
      if (m) player = m[1].trim();
      const note = /penalty/i.test(e.text || "") ? "pên" : /own goal/i.test(e.text || "") ? "contra" : "";
      return { team: String(e.team && e.team.id) === String(homeId) ? "home" : "away", player, minute: isNaN(min) ? null : min, note };
    })
    .sort((a, b) => (a.minute == null ? 999 : a.minute) - (b.minute == null ? 999 : b.minute));
}
function espnStats(s) {
  const teams = (s.boxscore && s.boxscore.teams) || [];
  const H = teams.find((t) => t.homeAway === "home");
  const A = teams.find((t) => t.homeAway === "away");
  if (!H || !A) return { stats: [], homeId: null, homeName: null };
  const mapOf = (t) => Object.fromEntries((t.statistics || []).map((x) => [x.name, x.displayValue]));
  const hm = mapOf(H), am = mapOf(A);
  const fmt = (v, suf) => (v == null ? null : suf === "%" ? Math.round(parseFloat(v)) + "%" : String(v));
  const stats = [];
  for (const [name, label, suf] of ESPN_STATS) {
    if (hm[name] != null || am[name] != null)
      stats.push({ label, home: fmt(hm[name], suf) || "-", away: fmt(am[name], suf) || "-" });
  }
  return { stats, homeId: H.team && H.team.id, homeName: H.team && H.team.displayName };
}

module.exports = async (req, res) => {
  try {
    // ---- trava global anti-abuso ----
    const now = Date.now();
    let last = 0;
    try { last = Number(await (await fetch(`${DB}/config/lastSync.json`)).json()) || 0; } catch {}
    if (now - last < MIN_INTERVAL) {
      res.status(200).json({ skipped: true, agoMs: now - last });
      return;
    }
    // marca já, p/ evitar corrida entre acessos simultâneos (config é gravável)
    await fetch(`${DB}/config/lastSync.json`, { method: "PUT", body: JSON.stringify(now) });

    if (!TOKEN) { res.status(200).json({ ok: false, reason: "sem FOOTBALL_DATA_TOKEN" }); return; }

    const r = await fetch(`https://api.football-data.org/v4/competitions/${COMP}/matches`, {
      headers: { "X-Auth-Token": TOKEN },
    });
    if (!r.ok) { res.status(200).json({ ok: false, reason: `football-data ${r.status}` }); return; }
    const data = await r.json();
    const ours = (await (await fetch(`${DB}/matches.json`)).json()) || {};

    const updates = {};
    let changed = 0;
    for (const m of data.matches || []) {
      const id = `wc-${m.id}`;
      const cur = ours[id];
      if (!cur) continue; // só atualiza jogos já cadastrados
      const ft = m.score && m.score.fullTime ? m.score.fullTime : {};
      const fin = m.status === "FINISHED" && ft.home != null && ft.away != null;

      // revela adversários do mata-mata SÓ quando ainda está "A definir".
      // Nunca sobrescreve um nome já preenchido (evita re-traduzir errado).
      const homePT = pt(m.homeTeam && m.homeTeam.name);
      const awayPT = pt(m.awayTeam && m.awayTeam.name);
      if (homePT !== "A definir" && cur.home === "A definir") { updates[`${id}/home`] = homePT; changed++; }
      if (awayPT !== "A definir" && cur.away === "A definir") { updates[`${id}/away`] = awayPT; changed++; }
      if (m.utcDate && cur.datetime !== m.utcDate) updates[`${id}/datetime`] = m.utcDate;

      if (fin) {
        // Mata-mata: a football-data SOMA os pênaltis no fullTime. No bolão, o
        // que vale é o resultado no fim da prorrogação (= empate, quando o jogo
        // foi decidido nos pênaltis). Então subtraímos o placar dos pênaltis.
        const pen = m.score && m.score.penalties ? m.score.penalties : null;
        const wentToPens = m.score && m.score.duration === "PENALTY_SHOOTOUT"
          && pen && pen.home != null && pen.away != null;
        const hs = Number(ft.home) - (wentToPens ? Number(pen.home) : 0);
        const as = Number(ft.away) - (wentToPens ? Number(pen.away) : 0);
        if (cur.finished !== true || cur.homeScore !== hs || cur.awayScore !== as) {
          updates[`${id}/finished`] = true;
          updates[`${id}/homeScore`] = hs;
          updates[`${id}/awayScore`] = as;
          updates[`${id}/fonte`] = "football-data.org";
          changed++;
        }
        // Guarda o placar dos pênaltis só p/ exibir quem avançou (NÃO pontua).
        if (wentToPens) {
          const pH = Number(pen.home), pA = Number(pen.away);
          const winner = pH > pA ? "home" : "away";
          if (!cur.pen || cur.pen.home !== pH || cur.pen.away !== pA) {
            updates[`${id}/pen`] = { home: pH, away: pA, winner };
            changed++;
          }
        }
      }
    }

    if (Object.keys(updates).length) {
      await fetch(`${DB}/matches.json`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
    }

    // ===== Fase ESPN: estatísticas + gols + estádio dos jogos finalizados =====
    // (ESPN é grátis, sem chave e server-side — dá pra rodar na nuvem)
    let statsAdded = 0;
    const finishedNow = (id) => (ours[id] && ours[id].finished === true) || updates[`${id}/finished`] === true;
    const hasStats = (id) => ours[id] && ours[id].sofa && Array.isArray(ours[id].sofa.stats) && ours[id].sofa.stats.length > 0;
    let needing = Object.keys(ours).filter((id) => finishedNow(id) && !hasStats(id) && ours[id].datetime);
    needing.sort((a, b) => String(ours[b].datetime).localeCompare(String(ours[a].datetime))); // recentes primeiro
    needing = needing.slice(0, MAX_STATS);

    if (needing.length) {
      const H = { "User-Agent": "Mozilla/5.0" };
      // datas a consultar (com vizinhança ±1 dia p/ cobrir fuso)
      const dates = new Set();
      for (const id of needing) {
        const d = new Date(ours[id].datetime);
        for (const off of [-1, 0, 1]) dates.add(ymd(new Date(d.getTime() + off * 86400000)));
      }
      // monta mapa confronto -> eventId do ESPN
      const pairMap = {};
      for (const ds of dates) {
        try {
          const sb = await (await fetch(`${ESPN}/scoreboard?dates=${ds}`, { headers: H })).json();
          for (const ev of sb.events || []) {
            const comp = ev.competitions && ev.competitions[0];
            if (!comp || !comp.competitors) continue;
            const h = comp.competitors.find((c) => c.homeAway === "home");
            const a = comp.competitors.find((c) => c.homeAway === "away");
            if (!h || !a) continue;
            pairMap[pairKey(pt(h.team.displayName), pt(a.team.displayName))] = ev.id;
          }
        } catch {}
      }
      // busca summary de cada jogo e grava sofa (com orientação por nome)
      const statsUpdates = {};
      for (const id of needing) {
        const m = ours[id];
        const evId = pairMap[pairKey(m.home, m.away)] || pairMap[pairKey(m.away, m.home)];
        if (!evId) continue;
        try {
          const sum = await (await fetch(`${ESPN}/summary?event=${evId}`, { headers: H })).json();
          const { stats, homeId, homeName } = espnStats(sum);
          let goals = espnGoals(sum, homeId);
          const venue = espnVenue(sum);
          const ourHomeIsEspnHome = norm(pt(homeName)) === norm(m.home);
          let st = stats;
          if (!ourHomeIsEspnHome) {
            st = stats.map((s) => ({ label: s.label, home: s.away, away: s.home }));
            goals = goals.map((g) => ({ team: g.team === "home" ? "away" : "home", player: g.player, minute: g.minute, note: g.note }));
          }
          if (st.length || goals.length) {
            const sofa = Object.assign({}, m.sofa || {}, { updatedAt: Date.now(), fonte: "espn" });
            if (venue) sofa.venue = venue;
            if (goals.length) sofa.goals = goals;
            if (st.length) sofa.stats = st;
            statsUpdates[`${id}/sofa`] = sofa;
            statsAdded++;
          }
        } catch {}
      }
      if (Object.keys(statsUpdates).length) {
        await fetch(`${DB}/matches.json`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(statsUpdates),
        });
      }
    }

    res.status(200).json({ ok: true, changed, statsAdded });
  } catch (e) {
    res.status(200).json({ ok: false, reason: String(e && e.message || e) });
  }
};
