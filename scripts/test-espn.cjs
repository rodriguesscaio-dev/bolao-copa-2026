// Teste read-only da lógica ESPN (mesma do /api/refresh), via fetch puro.
const DB = "https://bolao-copa-2026-e393b-default-rtdb.firebaseio.com";
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world";
const TEAMS = {
  "Brazil":"Brasil","Argentina":"Argentina","Uruguay":"Uruguai","Chile":"Chile","Colombia":"Colômbia","Peru":"Peru",
  "Paraguay":"Paraguai","Ecuador":"Equador","Bolivia":"Bolívia","Venezuela":"Venezuela","United States":"Estados Unidos",
  "USA":"Estados Unidos","Mexico":"México","Canada":"Canadá","Costa Rica":"Costa Rica","Panama":"Panamá",
  "Honduras":"Honduras","Jamaica":"Jamaica","Haiti":"Haiti","Curacao":"Curaçao","Curaçao":"Curaçao","France":"França",
  "Germany":"Alemanha","Spain":"Espanha","Portugal":"Portugal","England":"Inglaterra","Italy":"Itália",
  "Netherlands":"Holanda","Belgium":"Bélgica","Croatia":"Croácia","Switzerland":"Suíça","Denmark":"Dinamarca",
  "Poland":"Polônia","Serbia":"Sérvia","Austria":"Áustria","Wales":"País de Gales","Scotland":"Escócia",
  "Norway":"Noruega","Sweden":"Suécia","Ukraine":"Ucrânia","Turkey":"Turquia","Türkiye":"Turquia","Greece":"Grécia",
  "Czech Republic":"República Tcheca","Czechia":"República Tcheca","Hungary":"Hungria","Morocco":"Marrocos",
  "Senegal":"Senegal","Tunisia":"Tunísia","Algeria":"Argélia","Egypt":"Egito","Cameroon":"Camarões","Ghana":"Gana",
  "Nigeria":"Nigéria","Côte d'Ivoire":"Costa do Marfim","Ivory Coast":"Costa do Marfim","South Africa":"África do Sul",
  "Mali":"Mali","Cape Verde":"Cabo Verde","DR Congo":"Congo (RD)","Congo DR":"Congo (RD)",
  "Bosnia and Herzegovina":"Bósnia e Herzegovina","Bosnia & Herzegovina":"Bósnia e Herzegovina","Japan":"Japão",
  "Korea Republic":"Coreia do Sul","South Korea":"Coreia do Sul","Saudi Arabia":"Arábia Saudita","IR Iran":"Irã",
  "Iran":"Irã","Iraq":"Iraque","Qatar":"Catar","United Arab Emirates":"Emirados Árabes","Australia":"Austrália",
  "New Zealand":"Nova Zelândia","Uzbekistan":"Uzbequistão","Jordan":"Jordânia",
};
const pt = (n) => (n ? (TEAMS[n] || n) : "A definir");
const norm = (s) => (s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
const pairKey = (h,a) => `${norm(h)}|${norm(a)}`;
const ymd = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,"0")}${String(d.getUTCDate()).padStart(2,"0")}`;
const ESPN_STATS = [["possessionPct","Posse de bola","%"],["totalShots","Finalizações",""],["shotsOnTarget","Fin. no gol",""],["wonCorners","Escanteios",""],["foulsCommitted","Faltas",""],["saves","Defesas",""],["yellowCards","Amarelos",""],["redCards","Vermelhos",""],["totalPasses","Passes",""],["totalTackles","Desarmes",""]];
function espnStats(s){const teams=(s.boxscore&&s.boxscore.teams)||[];const H=teams.find(t=>t.homeAway==="home"),A=teams.find(t=>t.homeAway==="away");if(!H||!A)return{stats:[],homeName:null};const mapOf=t=>Object.fromEntries((t.statistics||[]).map(x=>[x.name,x.displayValue]));const hm=mapOf(H),am=mapOf(A);const fmt=(v,suf)=>v==null?null:(suf==="%"?Math.round(parseFloat(v))+"%":String(v));const stats=[];for(const[n,l,suf]of ESPN_STATS){if(hm[n]!=null||am[n]!=null)stats.push({label:l,home:fmt(hm[n],suf)||"-",away:fmt(am[n],suf)||"-"});}return{stats,homeId:H.team&&H.team.id,homeName:H.team&&H.team.displayName};}
function espnGoals(s,homeId){return(s.keyEvents||[]).filter(e=>e.scoringPlay||/goal/i.test((e.type&&e.type.text)||"")).map(e=>{const min=parseInt(String((e.clock&&e.clock.displayValue)||"").replace(/[^0-9]/g,""),10);let player="—";const m=String(e.text||"").match(/\.\s+([^.()]+?)\s+\(/);if(m)player=m[1].trim();return{team:String(e.team&&e.team.id)===String(homeId)?"home":"away",player,minute:isNaN(min)?null:min};}).sort((a,b)=>(a.minute==null?999:a.minute)-(b.minute==null?999:b.minute));}

(async () => {
  const ours = await (await fetch(`${DB}/matches.json`)).json();
  const finished = Object.entries(ours).filter(([id,m]) => m.finished===true && m.datetime);
  console.log(`finalizados no banco: ${finished.length}`);
  const dates = new Set();
  for (const [id,m] of finished) { const d=new Date(m.datetime); for(const off of[-1,0,1]) dates.add(ymd(new Date(d.getTime()+off*86400000))); }
  const H={ "User-Agent":"Mozilla/5.0" };
  const pairMap={};
  for (const ds of dates) {
    try { const sb=await(await fetch(`${ESPN}/scoreboard?dates=${ds}`,{headers:H})).json();
      for (const ev of sb.events||[]) { const c=ev.competitions&&ev.competitions[0]; if(!c)continue; const h=c.competitors.find(x=>x.homeAway==="home"),a=c.competitors.find(x=>x.homeAway==="away"); if(!h||!a)continue; pairMap[pairKey(pt(h.team.displayName),pt(a.team.displayName))]=ev.id; }
    } catch(e){ console.log("scoreboard erro", ds, e.message); }
  }
  console.log(`eventos ESPN mapeados: ${Object.keys(pairMap).length}`);
  let casou=0, naoCasou=[];
  for (const [id,m] of finished) {
    const evId = pairMap[pairKey(m.home,m.away)] || pairMap[pairKey(m.away,m.home)];
    if (!evId) { naoCasou.push(`${m.home} x ${m.away}`); continue; }
    const sum = await (await fetch(`${ESPN}/summary?event=${evId}`,{headers:H})).json();
    const { stats, homeId, homeName } = espnStats(sum);
    let goals = espnGoals(sum, homeId);
    const ourHomeIsEspnHome = norm(pt(homeName))===norm(m.home);
    if (!ourHomeIsEspnHome) goals = goals.map(g=>({...g,team:g.team==="home"?"away":"home"}));
    const gh = goals.filter(g=>g.team==="home").length, ga = goals.filter(g=>g.team==="away").length;
    const okPlacar = (gh===m.homeScore && ga===m.awayScore);
    console.log(`${okPlacar?"✓":"✗"} ${m.home} ${m.homeScore}x${m.awayScore} ${m.away} | ESPN gols ${gh}x${ga} | ${stats.length} stats | orient ${ourHomeIsEspnHome?"ok":"INVERTIDA(corrigida)"}`);
    casou++;
  }
  console.log(`\ncasaram: ${casou}/${finished.length}`);
  if (naoCasou.length) { console.log("NAO casaram:"); naoCasou.forEach(x=>console.log("  "+x)); }
})().catch(e=>{console.error("ERRO:",e.message);process.exit(1);});
