// =============================================================
//  Camada de dados do Bolão da Copa 2026 (Firebase Realtime DB)
// =============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, set, update, remove, onValue, get, child, goOffline, goOnline
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig, ADMIN_PIN } from "./firebase-config.js";

export { ADMIN_PIN };

// ---- Detecta se o Firebase ainda não foi configurado -----------------
export const isConfigured = !String(firebaseConfig.apiKey).startsWith("SEU_");

let db = null, auth = null, googleProvider = null;
if (isConfigured) {
  const app = initializeApp(firebaseConfig);
  db = getDatabase(app);
  auth = getAuth(app);
  googleProvider = new GoogleAuthProvider();
  // hd = dica para o Google mostrar só contas do domínio da empresa
  googleProvider.setCustomParameters({ hd: "aguacamelo.com.br", prompt: "select_account" });
}

// =====================================================================
//  Autenticação via Google, restrita ao domínio da Água Camelo
// =====================================================================
export const ALLOWED_DOMAIN = "aguacamelo.com.br";
export const emailAllowed = (email) =>
  /@aguacamelo\.com\.br$/i.test(String(email || "").trim());

// Observa o estado de login. Chama cb(user|null) sempre que muda.
export function onAuth(cb) {
  if (!auth) { cb(null); return () => {}; }
  return onAuthStateChanged(auth, cb);
}

export const currentUser = () => (auth ? auth.currentUser : null);

// Login com a conta Google. Se o e-mail não for do domínio, desloga e barra.
export async function loginWithGoogle() {
  const cred = await signInWithPopup(auth, googleProvider);
  const user = cred.user;
  if (!emailAllowed(user.email)) {
    await signOut(auth);
    throw new Error("DOMAIN");
  }
  await savePlayerProfile(user.uid, user.displayName || user.email, user.email);
  return user;
}

export function logOut() { return auth ? signOut(auth) : Promise.resolve(); }

// Perfil do jogador (nome + e-mail) — usado no ranking. Chaveado pelo uid.
export const savePlayerProfile = (uid, name, email) =>
  update(ref(db, `players/${uid}`), { name, email, updatedAt: Date.now() });

// ---- Pontuação padrão (pode ser alterada no admin) -------------------
export const DEFAULT_SCORING = {
  exact:   10, // cravou o placar exato
  diff:     7, // acertou vencedor/empate E a diferença de gols (saldo)
  winner:   5, // acertou só quem venceu (ou que foi empate)
  penBonus: 2  // mata-mata: palpitou empate E acertou quem avança nos pênaltis
};

// Fases de mata-mata (a partir dos 16-avos). Usado para o palpite de pênaltis
// e para o "Ranking Mauricio" (ranking só do mata-mata).
export const KNOCKOUT_STAGES = [
  "16-avos de Final", "Oitavas de Final", "Quartas de Final",
  "Semifinal", "Disputa de 3º", "Final"
];
export const isKnockout = (m) => !!m && KNOCKOUT_STAGES.includes(m.stage);

// =====================================================================
//  Helpers
// =====================================================================
export function slug(str) {
  return String(str)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // tira acentos
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function randomId() {
  return "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// =====================================================================
//  Assinaturas em tempo real
// =====================================================================
function listen(path, cb) {
  if (!db) { cb(null); return () => {}; }
  return onValue(ref(db, path), (snap) => cb(snap.val()));
}

export const onMatches = (cb) => listen("matches", (v) => cb(v || {}));
export const onBets    = (cb) => listen("bets",    (v) => cb(v || {}));
export const onPlayers = (cb) => listen("players", (v) => cb(v || {}));
export const onConfig  = (cb) => listen("config",  (v) => cb({ ...DEFAULT_SCORING, ...(v?.scoring || {}) }));

export async function getConfig() {
  if (!db) return DEFAULT_SCORING;
  const snap = await get(child(ref(db), "config/scoring"));
  return { ...DEFAULT_SCORING, ...(snap.val() || {}) };
}

// ---- Saúde da conexão em tempo real ----------------------------------
// Observa o estado do socket do Firebase. cb(true) quando conectado,
// cb(false) quando caiu. Usado para mostrar "ao vivo / reconectando".
export function onConnection(cb) {
  if (!db) { cb(false); return () => {}; }
  return onValue(ref(db, ".info/connected"), (snap) => cb(snap.val() === true));
}

// Força o Firebase a refazer o socket. Útil ao voltar para a aba: se o
// websocket morreu (PC dormiu, troca de rede), isso reabre e re-dispara
// todos os onValue com os dados frescos — sem precisar de F5.
export function forceReconnect() {
  if (!db) return;
  try { goOffline(db); goOnline(db); } catch (_) {}
}

// =====================================================================
//  Atualização de placares "ao abrir o site" (serverless /api/refresh)
//  Quem está com o bolão aberto durante os jogos cutuca a função na nuvem,
//  que puxa os placares (football-data) e grava no Firebase — aí o onValue
//  reflete pra todo mundo em tempo real. Sem cron, sem PC ligado.
//  Trava dupla: por sessão (aqui, 60s) e global (no servidor, via meta/lastSync).
//  Só dispara se houver jogo "na janela" (do início até ~3h depois).
// =====================================================================
let _lastPoke = 0;
export function pokeRefresh(matches) {
  const now = Date.now();
  const arr = Object.values(matches || {});
  // Tem jogo rolando agora? (do início -10min até +3h depois)
  const inWindow = arr.some((m) => {
    if (!m || !m.datetime) return false;
    const s = new Date(m.datetime).getTime();
    return now >= s - 10 * 60000 && now <= s + 3 * 3600000;
  });
  // Tem jogo já finalizado mas ainda sem estatísticas? (atraso a recuperar)
  const needsStats = arr.some((m) => m && m.finished === true &&
    !(m.sofa && Array.isArray(m.sofa.stats) && m.sofa.stats.length));
  if (!inWindow && !needsStats) return;            // nada a fazer, não cutuca
  const minGap = inWindow ? 60000 : 5 * 60000;     // jogo ao vivo 1x/min; só completar stats 1x/5min
  if (now - _lastPoke < minGap) return;
  _lastPoke = now;
  fetch("/api/refresh").catch(() => {});           // fire-and-forget (trava global de 60s no servidor)
}

// =====================================================================
//  Escritas
// =====================================================================
// pen = "home" | "away" | null — quem o jogador acha que avança nos pênaltis
// (só faz sentido em jogo de mata-mata com palpite de empate).
export const saveBet = (playerId, matchId, home, away, pen = null) =>
  set(ref(db, `bets/${playerId}/${matchId}`), {
    home: Number(home), away: Number(away),
    pen: (pen === "home" || pen === "away") ? pen : null,
    at: Date.now()
  });

export const addMatch = (match) => {
  const id = match.id || randomId();
  return set(ref(db, `matches/${id}`), { ...match, id });
};

export const updateMatch = (id, data) => update(ref(db, `matches/${id}`), data);
export const deleteMatch = (id) => remove(ref(db, `matches/${id}`));

export const setResult = (matchId, home, away) =>
  update(ref(db, `matches/${matchId}`), {
    homeScore: Number(home), awayScore: Number(away), finished: true
  });

export const clearResult = (matchId) =>
  update(ref(db, `matches/${matchId}`), {
    homeScore: null, awayScore: null, finished: false
  });

export const saveScoring = (scoring) => set(ref(db, "config/scoring"), scoring);

// =====================================================================
//  Lógica de pontuação
// =====================================================================
const sign = (a, b) => (a > b ? 1 : a < b ? -1 : 0);

// Um jogo só tem resultado utilizável quando está finalizado E tem placar
// numérico em ambos os lados. Evita estados "finalizado sem placar" (ex.: a
// API marca FINISHED antes de publicar o placar) virarem "undefined x undefined".
export function hasResult(match) {
  return !!match && match.finished === true
    && Number.isFinite(Number(match.homeScore))
    && Number.isFinite(Number(match.awayScore));
}

// Um jogo de mata-mata foi decidido nos pênaltis? (resultado = empate + houve
// disputa de pênaltis registrada). Os pênaltis NÃO entram no placar (homeScore/
// awayScore já é o empate); ficam só em match.pen para exibir quem avançou.
export function wentToPenalties(match) {
  return !!match && !!match.pen
    && (match.pen.winner === "home" || match.pen.winner === "away")
    && Number(match.homeScore) === Number(match.awayScore);
}

// Quantos pontos um palpite vale contra um jogo já finalizado.
export function scoreBet(bet, match, scoring = DEFAULT_SCORING) {
  if (!bet || !hasResult(match)) return 0;
  const bh = Number(bet.home),   ba = Number(bet.away);
  const rh = Number(match.homeScore), ra = Number(match.awayScore);
  if ([bh, ba, rh, ra].some((n) => Number.isNaN(n))) return 0;

  let pts;
  if (bh === rh && ba === ra) pts = scoring.exact;              // cravou
  else if (sign(bh, ba) !== sign(rh, ra)) pts = 0;             // errou o resultado
  else if (bh - ba === rh - ra) pts = scoring.diff;            // acertou resultado + saldo
  else pts = scoring.winner;                                    // acertou só o resultado

  // Bônus de "quem avança nos pênaltis": jogo decidido nos pênaltis e o jogador
  // indicou o time certo. A indicação vem do pick explícito (palpite de empate
  // com o seletor) OU de ter apostado na vitória do time que acabou avançando
  // (cobre os palpites de antes do seletor existir, ex.: apostou Marrocos vencer).
  const penBonus = Number(scoring.penBonus ?? DEFAULT_SCORING.penBonus) || 0;
  if (penBonus && wentToPenalties(match)) {
    const advances = predictedAdvancer(bet);
    if (advances && advances === match.pen.winner) pts += penBonus;
  }
  return pts;
}

// Quem o jogador acha que avança: vencedor do palpite (vitória) ou, no empate,
// o pick explícito de pênaltis (bet.pen). null = não indicou ninguém.
export function predictedAdvancer(bet) {
  if (!bet) return null;
  const bh = Number(bet.home), ba = Number(bet.away);
  if (bh > ba) return "home";
  if (ba > bh) return "away";
  return (bet.pen === "home" || bet.pen === "away") ? bet.pen : null;
}

// Monta o ranking completo. Retorna lista ordenada com estatísticas.
export function computeRanking(players, bets, matches, scoring = DEFAULT_SCORING) {
  const matchList = Object.values(matches || {});
  const finished  = matchList.filter(hasResult);

  const rows = Object.entries(players || {}).map(([id, p]) => {
    const myBets = (bets || {})[id] || {};
    let points = 0, exact = 0, hits = 0, played = 0;

    finished.forEach((m) => {
      const bet = myBets[m.id];
      if (!bet) return;
      played++;
      const pts = scoreBet(bet, m, scoring);
      points += pts;
      // cravada = placar exato (independe do bônus de pênaltis somado em pts)
      if (Number(bet.home) === Number(m.homeScore) && Number(bet.away) === Number(m.awayScore)) exact++;
      if (pts > 0) hits++;
    });

    return { id, name: p.name, points, exact, hits, played };
  });

  rows.sort((a, b) =>
    b.points - a.points ||      // mais pontos
    b.exact  - a.exact  ||      // mais placares cravados
    b.hits   - a.hits   ||      // mais acertos
    a.name.localeCompare(b.name)
  );

  // posição (com empates compartilhando a mesma colocação)
  let lastKey = null, lastPos = 0;
  rows.forEach((r, i) => {
    const key = `${r.points}|${r.exact}|${r.hits}`;
    if (key !== lastKey) { lastPos = i + 1; lastKey = key; }
    r.pos = lastPos;
  });

  return rows;
}
