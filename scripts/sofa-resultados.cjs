// =============================================================
//  Atualizador de resultados do Bolao via SofaScore (browser real)
//  Substitui a dependencia do football-data token. Passa o Cloudflare
//  usando Chrome real (perfil persistente, janela fora da tela) e le a
//  API same-origin www.sofascore.com/api/v1.
//
//  O que faz:
//   1. Busca eventos finalizados/proximos da Copa 2026 (unique-tournament 16, season 58210)
//   2. Casa cada jogo com os nossos (matches no RTDB) por nome (EN->PT) + data
//   3. Grava placar/finished + o sofaId (id do jogo no SofaScore, p/ o modal de stats)
//      via PATCH cirurgico (preserva os demais campos do jogo)
// =============================================================
const path = require("path");
const { chromium } = require("C:/Users/caio2/.claude/skills/gstack/node_modules/playwright");

const USER_DIR = path.join(__dirname, "..", ".sofa-profile");
const DB_URL = "https://bolao-copa-2026-e393b-default-rtdb.firebaseio.com";
const UT = 16;        // unique-tournament FIFA World Cup
const SEASON = 58210; // World Cup 2026
const BASE = "https://www.sofascore.com/api/v1";

// EN (SofaScore) -> PT (igual ao que esta gravado no nosso RTDB)
const TEAMS = {
  "Brazil": "Brasil", "Argentina": "Argentina", "Uruguay": "Uruguai", "Chile": "Chile",
  "Colombia": "Colômbia", "Peru": "Peru", "Paraguay": "Paraguai", "Ecuador": "Equador",
  "Bolivia": "Bolívia", "Venezuela": "Venezuela",
  "United States": "Estados Unidos", "USA": "Estados Unidos", "Mexico": "México",
  "Canada": "Canadá", "Costa Rica": "Costa Rica", "Panama": "Panamá", "Honduras": "Honduras",
  "Jamaica": "Jamaica", "Haiti": "Haiti", "Curacao": "Curaçao", "Curaçao": "Curaçao",
  "France": "França", "Germany": "Alemanha", "Spain": "Espanha", "Portugal": "Portugal",
  "England": "Inglaterra", "Italy": "Itália", "Netherlands": "Holanda", "Belgium": "Bélgica",
  "Croatia": "Croácia", "Switzerland": "Suíça", "Denmark": "Dinamarca", "Poland": "Polônia",
  "Serbia": "Sérvia", "Austria": "Áustria", "Wales": "País de Gales", "Scotland": "Escócia",
  "Norway": "Noruega", "Sweden": "Suécia", "Ukraine": "Ucrânia", "Turkey": "Turquia",
  "Türkiye": "Turquia", "Greece": "Grécia", "Czechia": "República Tcheca",
  "Czech Republic": "República Tcheca", "Hungary": "Hungria",
  "Morocco": "Marrocos", "Senegal": "Senegal", "Tunisia": "Tunísia", "Algeria": "Argélia",
  "Egypt": "Egito", "Cameroon": "Camarões", "Ghana": "Gana", "Nigeria": "Nigéria",
  "Ivory Coast": "Costa do Marfim", "Côte d'Ivoire": "Costa do Marfim", "South Africa": "África do Sul",
  "Mali": "Mali", "Cape Verde": "Cabo Verde", "DR Congo": "Congo (RD)", "Congo DR": "Congo (RD)",
  "Bosnia & Herzegovina": "Bósnia e Herzegovina", "Bosnia and Herzegovina": "Bósnia e Herzegovina",
  "Japan": "Japão", "South Korea": "Coreia do Sul", "Korea Republic": "Coreia do Sul",
  "Saudi Arabia": "Arábia Saudita", "Iran": "Irã", "IR Iran": "Irã", "Iraq": "Iraque",
  "Qatar": "Catar", "United Arab Emirates": "Emirados Árabes", "Australia": "Austrália",
  "New Zealand": "Nova Zelândia", "Uzbekistan": "Uzbequistão", "Jordan": "Jordânia",
};

// Estatisticas do SofaScore (EN) -> rotulo PT, na ordem em que aparecem no modal.
const STAT_PT = [
  ["Ball possession", "Posse de bola"],
  ["Expected goals", "Gols esperados (xG)"],
  ["Total shots", "Finalizações"],
  ["Shots on target", "Finalizações no gol"],
  ["Big chances", "Grandes chances"],
  ["Saves", "Defesas do goleiro"],
  ["Corner kicks", "Escanteios"],
  ["Fouls", "Faltas"],
  ["Passes", "Passes"],
  ["Tackles", "Desarmes"],
  ["Free kicks", "Tiros livres"],
  ["Yellow cards", "Cartões amarelos"],
  ["Red cards", "Cartões vermelhos"],
  ["Offsides", "Impedimentos"],
];

const pt = (name) => TEAMS[name] || name;
const norm = (s) =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "").trim();
const key = (h, a) => `${norm(h)}|${norm(a)}`;

(async () => {
  const ctx = await chromium.launchPersistentContext(USER_DIR, {
    headless: false,
    channel: "chrome",
    locale: "pt-BR",
    viewport: { width: 1280, height: 900 },
    args: ["--window-position=-3200,-3200", "--window-size=1280,900"],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const apiFetch = (url) =>
    page.evaluate(async (u) => {
      const r = await fetch(u, { headers: { Accept: "application/json" } });
      return { status: r.status, body: await r.text() };
    }, url);

  // captura passiva de estatisticas/incidents: a pagina do jogo carrega esses
  // endpoints sozinha (passam o Cloudflare). Guardamos por event id.
  const capture = {};
  page.on("response", async (resp) => {
    if (resp.status() !== 200) return;
    const u = resp.url();
    const ms = u.match(/\/api\/v1\/event\/(\d+)\/statistics(\?|$)/);
    const mi = u.match(/\/api\/v1\/event\/(\d+)\/incidents(\?|$)/);
    try {
      if (ms) capture[`${ms[1]}:stats`] = await resp.json();
      else if (mi) capture[`${mi[1]}:inc`] = await resp.json();
    } catch {}
  });

  console.log("→ abrindo SofaScore p/ liberar clearance ...");
  await page.goto(`https://www.sofascore.com/tournament/football/world/world-cup/${UT}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  // garante que a API same-origin responde 200
  let ok = false;
  for (let i = 0; i < 10 && !ok; i++) {
    await page.waitForTimeout(2500);
    const t = await apiFetch(`${BASE}/unique-tournament/${UT}/season/${SEASON}/events/last/0`);
    if (t.status === 200) ok = true;
    else console.log(`   clearance... (${t.status})`);
  }
  if (!ok) { console.error("❌ Cloudflare nao liberou."); await ctx.close(); process.exit(2); }

  // coleta eventos finalizados (last) e proximos (next), varias paginas
  const collect = async (kind) => {
    const out = [];
    for (let pg = 0; pg < 8; pg++) {
      const r = await apiFetch(`${BASE}/unique-tournament/${UT}/season/${SEASON}/events/${kind}/${pg}`);
      if (r.status !== 200) break;
      const j = JSON.parse(r.body);
      const evs = j.events || [];
      out.push(...evs);
      if (!j.hasNextPage && evs.length === 0) break;
      if (!j.hasNextPage) break;
    }
    return out;
  };
  const last = await collect("last");
  const next = await collect("next");
  console.log(`→ SofaScore: ${last.length} finalizados/passados + ${next.length} proximos`);

  // nossos jogos
  const ours = await (await fetch(`${DB_URL}/matches.json`)).json();
  const byKey = new Map();
  for (const [id, m] of Object.entries(ours)) {
    if (m.home && m.away && m.home !== "A definir" && m.away !== "A definir") {
      byKey.set(key(m.home, m.away), { id, m });
    }
  }

  const updates = {};
  const changes = [];
  const naoCasou = [];
  const matched = []; // {id, m, ev} p/ a fase de enriquecimento

  const handle = (ev) => {
    const homePT = pt(ev.homeTeam?.name);
    const awayPT = pt(ev.awayTeam?.name);
    const found = byKey.get(key(homePT, awayPT));
    if (!found) {
      naoCasou.push(`${ev.homeTeam?.name} x ${ev.awayTeam?.name}`);
      return;
    }
    const { id, m } = found;
    matched.push({ id, m, ev });
    // sempre garante o sofaId (p/ o modal de stats)
    if (m.sofaId !== ev.id) updates[`${id}/sofaId`] = ev.id;

    const fin = ev.status?.type === "finished" && ev.homeScore?.current != null && ev.awayScore?.current != null;
    if (fin) {
      const hs = Number(ev.homeScore.current);
      const as = Number(ev.awayScore.current);
      if (m.finished !== true || m.homeScore !== hs || m.awayScore !== as) {
        updates[`${id}/finished`] = true;
        updates[`${id}/homeScore`] = hs;
        updates[`${id}/awayScore`] = as;
        updates[`${id}/fonte`] = "sofascore.com";
        changes.push(`${homePT} ${hs} x ${as} ${awayPT}`);
      }
    }
  };
  for (const ev of last) handle(ev);
  for (const ev of next) handle(ev);

  if (Object.keys(updates).length) {
    const res = await fetch(`${DB_URL}/matches.json`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) { console.error("❌ Firebase PATCH falhou:", res.status, await res.text()); await ctx.close(); process.exit(1); }
  }

  console.log(`\n✅ ${changes.length} placares novos/atualizados:`);
  changes.forEach((c) => console.log("   " + c));
  if (!changes.length) console.log("   (nenhum placar novo — ja estava tudo em dia)");
  if (naoCasou.length) {
    const uniq = [...new Set(naoCasou)];
    console.log(`\n⚠ ${uniq.length} jogos do SofaScore sem par no nosso banco (revisar nomes):`);
    uniq.slice(0, 20).forEach((c) => console.log("   " + c));
  }

  // ============ FASE 2: enriquecer com venue (lista) + gols/stats (match page) ============
  const venueOf = (ev) => {
    const v = ev.venue;
    if (!v) return null;
    const st = v.stadium?.name || v.name || "";
    const city = v.city?.name || "";
    return [st, city].filter(Boolean).join(" — ") || null;
  };

  const parseGoals = (inc) =>
    (inc?.incidents || [])
      .filter((x) => x.incidentType === "goal")
      .map((x) => ({
        team: x.isHome ? "home" : "away",
        player: x.player?.name || x.playerName || "—",
        minute: x.time ?? null,
        note: x.incidentClass === "penalty" ? "pên" : x.incidentClass === "ownGoal" ? "contra" : "",
      }))
      .sort((a, b) => (a.minute ?? 999) - (b.minute ?? 999));

  const parseStats = (stt) => {
    const all = stt?.statistics?.find((p) => p.period === "ALL");
    if (!all) return [];
    const flat = {};
    for (const g of all.groups || []) for (const it of g.statisticsItems || []) flat[it.name] = it;
    const out = [];
    for (const [en, ptl] of STAT_PT) {
      const it = flat[en];
      if (it && (it.home != null || it.away != null))
        out.push({ label: ptl, home: String(it.home), away: String(it.away) });
    }
    return out;
  };

  const enrich = {};
  let nVenue = 0, nStats = 0;
  // jogos finalizados que ainda nao tem estatisticas guardadas
  const needStats = matched.filter(
    ({ m, ev }) => ev.status?.type === "finished" && !(Array.isArray(m.sofa?.stats) && m.sofa.stats.length)
  );

  // 1) venue p/ todos (de graca, vem na lista)
  for (const { id, m, ev } of matched) {
    const venue = venueOf(ev);
    const base = { id: ev.id, updatedAt: Date.now(), ...(m.sofa || {}) };
    if (venue && m.sofa?.venue !== venue) { enrich[`${id}/sofa`] = { ...base, venue }; nVenue++; }
  }

  // 2) gols + estatisticas: navega na pagina de cada jogo finalizado novo
  console.log(`\n→ buscando estatisticas de ${needStats.length} jogo(s) finalizado(s)...`);
  for (const { id, m, ev } of needStats) {
    const sid = ev.id;
    delete capture[`${sid}:stats`]; delete capture[`${sid}:inc`];
    const url = `https://www.sofascore.com/${ev.slug}/${ev.customId}#id:${sid}`;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(2500);
      try { await page.getByText(/Estat[ií]stic|Statistics/i).first().click({ timeout: 3000 }); } catch {}
      await page.waitForTimeout(2500);
    } catch (e) { console.log(`   ⚠ falha ao abrir ${ev.homeTeam?.name} x ${ev.awayTeam?.name}: ${e.message}`); }

    const goals = parseGoals(capture[`${sid}:inc`]);
    const stats = parseStats(capture[`${sid}:stats`]);
    const prev = enrich[`${id}/sofa`] || { id: sid, updatedAt: Date.now(), ...(m.sofa || {}) };
    const sofa = { ...prev };
    if (goals.length) sofa.goals = goals;
    if (stats.length) sofa.stats = stats;
    if (goals.length || stats.length) { enrich[`${id}/sofa`] = sofa; nStats++; }
    console.log(`   ${ev.homeTeam?.name} x ${ev.awayTeam?.name}: ${goals.length} gol(s), ${stats.length} estatistica(s)`);
  }

  if (Object.keys(enrich).length) {
    const res = await fetch(`${DB_URL}/matches.json`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(enrich),
    });
    if (!res.ok) console.error("⚠ enrich PATCH falhou:", res.status, await res.text());
  }
  console.log(`\n📊 venue gravado em ${nVenue} jogo(s); estatisticas em ${nStats} jogo(s).`);

  await ctx.close();
})().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
