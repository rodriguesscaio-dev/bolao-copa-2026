// =============================================================
//  Atualizador automático de jogos e resultados do Bolão
//  Roda no GitHub Actions (ver .github/workflows/atualizar-resultados.yml).
//
//  O que faz:
//   1. Busca os jogos da Copa do Mundo na API football-data.org
//   2. Traduz nomes/fases para português e monta o nosso formato
//   3. Grava (upsert) no Realtime Database via REST — o site lê sozinho
//
//  Variáveis de ambiente:
//   FOOTBALL_DATA_TOKEN  (obrigatória)  chave grátis de football-data.org
//   FIREBASE_DB_URL      (opcional)     URL do Realtime Database
//   COMPETITION          (opcional)     código da competição (padrão: WC)
// =============================================================

const TOKEN = process.env.FOOTBALL_DATA_TOKEN;
const DB_URL = (process.env.FIREBASE_DB_URL ||
  "https://bolao-copa-2026-e393b-default-rtdb.firebaseio.com").replace(/\/$/, "");
const COMPETITION = process.env.COMPETITION || "WC";

if (!TOKEN) {
  console.error("❌ Falta a variável FOOTBALL_DATA_TOKEN (secret do GitHub).");
  process.exit(1);
}

// ---- Tradução de fases (football-data -> nosso padrão) ----
const STAGE = {
  GROUP_STAGE:    "Fase de Grupos",
  LAST_32:        "16-avos de Final",
  LAST_16:        "Oitavas de Final",
  QUARTER_FINALS: "Quartas de Final",
  SEMI_FINALS:    "Semifinal",
  THIRD_PLACE:    "Disputa de 3º",
  FINAL:          "Final"
};

// ---- Tradução de nomes de seleções (EN -> PT) ----
const TEAMS = {
  "Brazil": "Brasil", "Argentina": "Argentina", "Uruguay": "Uruguai",
  "Chile": "Chile", "Colombia": "Colômbia", "Peru": "Peru",
  "Paraguay": "Paraguai", "Ecuador": "Equador", "Bolivia": "Bolívia",
  "Venezuela": "Venezuela",
  "United States": "Estados Unidos", "USA": "Estados Unidos",
  "Mexico": "México", "Canada": "Canadá", "Costa Rica": "Costa Rica",
  "Panama": "Panamá", "Honduras": "Honduras", "Jamaica": "Jamaica",
  "France": "França", "Germany": "Alemanha", "Spain": "Espanha",
  "Portugal": "Portugal", "England": "Inglaterra", "Italy": "Itália",
  "Netherlands": "Holanda", "Belgium": "Bélgica", "Croatia": "Croácia",
  "Switzerland": "Suíça", "Denmark": "Dinamarca", "Poland": "Polônia",
  "Serbia": "Sérvia", "Austria": "Áustria", "Wales": "País de Gales",
  "Scotland": "Escócia", "Norway": "Noruega", "Sweden": "Suécia",
  "Ukraine": "Ucrânia", "Turkey": "Turquia", "Türkiye": "Turquia",
  "Greece": "Grécia", "Czech Republic": "República Tcheca",
  "Czechia": "República Tcheca", "Hungary": "Hungria",
  "Morocco": "Marrocos", "Senegal": "Senegal", "Tunisia": "Tunísia",
  "Algeria": "Argélia", "Egypt": "Egito", "Cameroon": "Camarões",
  "Ghana": "Gana", "Nigeria": "Nigéria", "Côte d'Ivoire": "Costa do Marfim",
  "Ivory Coast": "Costa do Marfim", "South Africa": "África do Sul",
  "Mali": "Mali", "Cape Verde": "Cabo Verde", "Cape Verde Islands": "Cabo Verde",
  "DR Congo": "Congo (RD)", "Congo DR": "Congo (RD)",
  "Bosnia and Herzegovina": "Bósnia e Herzegovina", "Bosnia-Herzegovina": "Bósnia e Herzegovina",
  "Curaçao": "Curaçao", "Haiti": "Haiti",
  "Japan": "Japão", "Korea Republic": "Coreia do Sul",
  "South Korea": "Coreia do Sul", "Saudi Arabia": "Arábia Saudita",
  "IR Iran": "Irã", "Iran": "Irã", "Iraq": "Iraque", "Qatar": "Catar",
  "United Arab Emirates": "Emirados Árabes", "Australia": "Austrália",
  "New Zealand": "Nova Zelândia", "Uzbekistan": "Uzbequistão",
  "Jordan": "Jordânia"
};

const pt = (name) => (name ? (TEAMS[name] || name) : "A definir");

async function buscarJogos() {
  const url = `https://api.football-data.org/v4/competitions/${COMPETITION}/matches`;
  const res = await fetch(url, { headers: { "X-Auth-Token": TOKEN } });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`API football-data respondeu ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.matches || [];
}

function montarJogo(m) {
  const finished = m.status === "FINISHED";
  const ft = m.score?.fullTime || {};
  return {
    id:        `wc-${m.id}`,
    home:      pt(m.homeTeam?.name),
    away:      pt(m.awayTeam?.name),
    datetime:  m.utcDate || "",
    stage:     STAGE[m.stage] || "Fase de Grupos",
    group:     m.group ? String(m.group).replace(/GROUP[_ ]?/i, "").trim() : "",
    finished,
    homeScore: finished && ft.home != null ? Number(ft.home) : null,
    awayScore: finished && ft.away != null ? Number(ft.away) : null,
    fonte:     "football-data.org"
  };
}

async function gravar(payload) {
  const res = await fetch(`${DB_URL}/matches.json`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Firebase respondeu ${res.status}: ${txt.slice(0, 300)}`);
  }
}

(async () => {
  console.log(`⏳ Buscando jogos da competição ${COMPETITION}…`);
  const jogos = await buscarJogos();
  if (!jogos.length) {
    console.log("Nenhum jogo retornado pela API (talvez a tabela ainda não esteja publicada).");
    return;
  }

  const payload = {};
  let finalizados = 0;
  for (const m of jogos) {
    const jogo = montarJogo(m);
    payload[jogo.id] = jogo;
    if (jogo.finished) finalizados++;
  }

  await gravar(payload);
  console.log(`✅ ${jogos.length} jogos gravados no Firebase (${finalizados} finalizados).`);
})().catch((err) => {
  console.error("❌ Erro:", err.message);
  process.exit(1);
});
