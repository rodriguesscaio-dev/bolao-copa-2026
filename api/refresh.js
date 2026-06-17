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
  "Cape Verde":"Cabo Verde","DR Congo":"Congo (RD)","Congo DR":"Congo (RD)",
  "Bosnia and Herzegovina":"Bósnia e Herzegovina","Japan":"Japão","Korea Republic":"Coreia do Sul",
  "South Korea":"Coreia do Sul","Saudi Arabia":"Arábia Saudita","IR Iran":"Irã","Iran":"Irã","Iraq":"Iraque",
  "Qatar":"Catar","United Arab Emirates":"Emirados Árabes","Australia":"Austrália","New Zealand":"Nova Zelândia",
  "Uzbekistan":"Uzbequistão","Jordan":"Jordânia",
};
const pt = (n) => (n ? (TEAMS[n] || n) : "A definir");

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

      // revela adversários do mata-mata conforme definem
      const homePT = pt(m.homeTeam && m.homeTeam.name);
      const awayPT = pt(m.awayTeam && m.awayTeam.name);
      if (homePT !== "A definir" && cur.home !== homePT) { updates[`${id}/home`] = homePT; changed++; }
      if (awayPT !== "A definir" && cur.away !== awayPT) { updates[`${id}/away`] = awayPT; changed++; }
      if (m.utcDate && cur.datetime !== m.utcDate) updates[`${id}/datetime`] = m.utcDate;

      if (fin) {
        const hs = Number(ft.home), as = Number(ft.away);
        if (cur.finished !== true || cur.homeScore !== hs || cur.awayScore !== as) {
          updates[`${id}/finished`] = true;
          updates[`${id}/homeScore`] = hs;
          updates[`${id}/awayScore`] = as;
          updates[`${id}/fonte`] = "football-data.org";
          changed++;
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
    res.status(200).json({ ok: true, changed });
  } catch (e) {
    res.status(200).json({ ok: false, reason: String(e && e.message || e) });
  }
};
