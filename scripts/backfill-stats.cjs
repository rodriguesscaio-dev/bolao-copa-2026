// =============================================================
//  backfill-stats.cjs — repreenche estatísticas/gols/estádio de TODOS
//  os jogos finalizados via API pública do ESPN (grátis, sem chave).
//  Sem cap e sem trava (ao contrário do /api/refresh), p/ zerar atraso
//  de uma vez e CORRIGIR jogos que entraram com mandante/visitante
//  invertidos. Roda na máquina do Caio (ESPN é alcançável daqui).
//
//  Uso:  node scripts/backfill-stats.cjs
//        node scripts/backfill-stats.cjs --dry   (não grava, só mostra)
// =============================================================
const DB = "https://bolao-copa-2026-e393b-default-rtdb.firebaseio.com";
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world";
const DRY = process.argv.includes("--dry");

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
const ESPN_STATS = [
  ["possessionPct","Posse de bola","%"],["totalShots","Finalizações",""],["shotsOnTarget","Finalizações no gol",""],
  ["wonCorners","Escanteios",""],["foulsCommitted","Faltas",""],["offsides","Impedimentos",""],
  ["saves","Defesas do goleiro",""],["yellowCards","Cartões amarelos",""],["redCards","Cartões vermelhos",""],
  ["totalPasses","Passes",""],["totalTackles","Desarmes",""],
];
const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
const pairKey = (h,a) => `${norm(h)}|${norm(a)}`;
const ymd = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,"0")}${String(d.getUTCDate()).padStart(2,"0")}`;
const H = { "User-Agent": "Mozilla/5.0" };

function espnVenue(s){
  const v = s && s.gameInfo && s.gameInfo.venue;
  if (!v) return null;
  const city = v.address && v.address.city ? v.address.city : "";
  return [v.fullName, city].filter(Boolean).join(" — ") || null;
}
function espnGoals(s, homeId){
  const evs = (s.keyEvents||[]).filter((e)=>e.scoringPlay || /goal/i.test((e.type&&e.type.text)||""));
  return evs.map((e)=>{
    const min = parseInt((String((e.clock&&e.clock.displayValue)||"").match(/\d+/)||[])[0],10);
    let player = "—";
    const m = String(e.text||"").match(/\.\s+([^.()]+?)\s+\(/);
    if (m) player = m[1].trim();
    const note = /penalty/i.test(e.text||"") ? "pên" : /own goal/i.test(e.text||"") ? "contra" : "";
    return { team: String(e.team&&e.team.id)===String(homeId)?"home":"away", player, minute: isNaN(min)?null:min, note };
  }).sort((a,b)=>(a.minute==null?999:a.minute)-(b.minute==null?999:b.minute));
}
function espnStats(s){
  const teams = (s.boxscore && s.boxscore.teams) || [];
  const Ht = teams.find((t)=>t.homeAway==="home");
  const At = teams.find((t)=>t.homeAway==="away");
  if (!Ht || !At) return { stats: [], homeId: null, homeName: null };
  const mapOf = (t)=>Object.fromEntries((t.statistics||[]).map((x)=>[x.name,x.displayValue]));
  const hm = mapOf(Ht), am = mapOf(At);
  const fmt = (v,suf)=>(v==null?null:suf==="%"?Math.round(parseFloat(v))+"%":String(v));
  const stats = [];
  for (const [name,label,suf] of ESPN_STATS)
    if (hm[name]!=null || am[name]!=null) stats.push({ label, home: fmt(hm[name],suf)||"-", away: fmt(am[name],suf)||"-" });
  return { stats, homeId: Ht.team&&Ht.team.id, homeName: Ht.team&&Ht.team.displayName };
}

(async () => {
  const ours = (await (await fetch(`${DB}/matches.json`)).json()) || {};
  let needing = Object.keys(ours).filter((id)=>ours[id].finished===true && ours[id].datetime);
  needing.sort((a,b)=>String(ours[a].datetime).localeCompare(String(ours[b].datetime)));
  console.log(`Finalizados a processar: ${needing.length} (modo ${DRY?"DRY-RUN":"GRAVAÇÃO"})`);

  // 1) mapa confronto -> eventId do ESPN (vizinhança ±1 dia p/ cobrir fuso)
  const dates = new Set();
  for (const id of needing){ const d = new Date(ours[id].datetime); for (const off of [-1,0,1]) dates.add(ymd(new Date(d.getTime()+off*86400000))); }
  const pairMap = {};
  for (const ds of dates){
    try {
      const sb = await (await fetch(`${ESPN}/scoreboard?dates=${ds}`,{headers:H})).json();
      for (const ev of sb.events||[]){
        const comp = ev.competitions && ev.competitions[0];
        if (!comp || !comp.competitors) continue;
        const h = comp.competitors.find((c)=>c.homeAway==="home");
        const a = comp.competitors.find((c)=>c.homeAway==="away");
        if (!h || !a) continue;
        pairMap[pairKey(pt(h.team.displayName), pt(a.team.displayName))] = ev.id;
      }
    } catch(e){}
  }

  // 2) summary de cada jogo -> grava sofa com orientação CORRETA
  const updates = {};
  let ok=0, miss=0, swapped=0;
  for (const id of needing){
    const m = ours[id];
    const evId = pairMap[pairKey(m.home,m.away)] || pairMap[pairKey(m.away,m.home)];
    if (!evId){ miss++; console.log("  [sem ESPN] "+m.home+" x "+m.away); continue; }
    try {
      const sum = await (await fetch(`${ESPN}/summary?event=${evId}`,{headers:H})).json();
      const { stats, homeId, homeName } = espnStats(sum);
      let goals = espnGoals(sum, homeId);
      const venue = espnVenue(sum);
      const ourHomeIsEspnHome = norm(pt(homeName)) === norm(m.home);
      let st = stats;
      if (!ourHomeIsEspnHome){
        swapped++;
        st = stats.map((s)=>({ label: s.label, home: s.away, away: s.home }));
        goals = goals.map((g)=>({ team: g.team==="home"?"away":"home", player: g.player, minute: g.minute, note: g.note }));
      }
      if (st.length || goals.length){
        const sofa = Object.assign({}, m.sofa||{}, { updatedAt: Date.now(), fonte: "espn" });
        if (venue) sofa.venue = venue;
        if (goals.length) sofa.goals = goals;
        if (st.length) sofa.stats = st;
        updates[`${id}/sofa`] = sofa;
        ok++;
        const poss = st.find((x)=>/posse/i.test(x.label));
        console.log(`  [OK${ourHomeIsEspnHome?"":" *invertido-corrigido*"}] ${m.home} ${m.homeScore}x${m.awayScore} ${m.away}`+(poss?`  posse ${poss.home}/${poss.away}`:""));
      } else { miss++; console.log("  [sem dados] "+m.home+" x "+m.away); }
    } catch(e){ miss++; console.log("  [erro] "+m.home+" x "+m.away+" :: "+e.message); }
  }

  console.log(`\nResumo: gravar=${ok} | sem-match/sem-dados=${miss} | orientações corrigidas=${swapped}`);
  if (!DRY && Object.keys(updates).length){
    const r = await fetch(`${DB}/matches.json`,{ method:"PATCH", headers:{"Content-Type":"application/json"}, body: JSON.stringify(updates) });
    console.log("PATCH Firebase:", r.status, r.ok?"OK":await r.text());
  } else if (DRY){
    console.log("DRY-RUN: nada gravado.");
  }
})();
