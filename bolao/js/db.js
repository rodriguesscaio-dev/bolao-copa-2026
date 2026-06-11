// =============================================================
//  Camada de dados do Bolão da Copa 2026 (Firebase Realtime DB)
// =============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, set, update, remove, onValue, get, child
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
  exact:  10, // cravou o placar exato
  diff:    7, // acertou vencedor/empate E a diferença de gols (saldo)
  winner:  5  // acertou só quem venceu (ou que foi empate)
};

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

// =====================================================================
//  Escritas
// =====================================================================
export const saveBet = (playerId, matchId, home, away) =>
  set(ref(db, `bets/${playerId}/${matchId}`), {
    home: Number(home), away: Number(away), at: Date.now()
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

// Quantos pontos um palpite vale contra um jogo já finalizado.
export function scoreBet(bet, match, scoring = DEFAULT_SCORING) {
  if (!bet || !hasResult(match)) return 0;
  const bh = Number(bet.home),   ba = Number(bet.away);
  const rh = Number(match.homeScore), ra = Number(match.awayScore);
  if ([bh, ba, rh, ra].some((n) => Number.isNaN(n))) return 0;

  if (bh === rh && ba === ra) return scoring.exact;            // cravou
  if (sign(bh, ba) !== sign(rh, ra)) return 0;                 // errou o resultado
  if (bh - ba === rh - ra) return scoring.diff;                // acertou resultado + saldo
  return scoring.winner;                                        // acertou só o resultado
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
      if (pts === scoring.exact) exact++;
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
