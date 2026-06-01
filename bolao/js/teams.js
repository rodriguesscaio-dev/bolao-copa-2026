// Mapa de seleções -> código ISO do país, para montar a bandeira como
// IMAGEM (flagcdn.com). Usamos imagem em vez de emoji porque o Windows não
// renderiza emoji de bandeira de país (mostra "BR" no lugar de 🇧🇷).
import { slug } from "./db.js";

const ISO = {
  // América do Sul
  brasil: "br", argentina: "ar", uruguai: "uy", chile: "cl",
  colombia: "co", peru: "pe", paraguai: "py", equador: "ec",
  bolivia: "bo", venezuela: "ve",
  // América do Norte / Central / Caribe
  "estados-unidos": "us", eua: "us", mexico: "mx", canada: "ca",
  "costa-rica": "cr", panama: "pa", honduras: "hn", jamaica: "jm",
  haiti: "ht", curacao: "cw",
  // Europa
  franca: "fr", alemanha: "de", espanha: "es", portugal: "pt",
  inglaterra: "gb-eng", italia: "it", holanda: "nl", "paises-baixos": "nl",
  belgica: "be", croacia: "hr", suica: "ch", dinamarca: "dk",
  polonia: "pl", servia: "rs", austria: "at", "pais-de-gales": "gb-wls",
  escocia: "gb-sct", noruega: "no", suecia: "se", ucrania: "ua",
  turquia: "tr", grecia: "gr", "republica-tcheca": "cz", hungria: "hu",
  "bosnia-e-herzegovina": "ba", "bosnia-herzegovina": "ba",
  // África
  marrocos: "ma", senegal: "sn", tunisia: "tn", argelia: "dz",
  egito: "eg", camaroes: "cm", gana: "gh", nigeria: "ng",
  "costa-do-marfim": "ci", "africa-do-sul": "za", mali: "ml",
  "cabo-verde": "cv", "cape-verde-islands": "cv",
  "congo-rd": "cd", "congo-dr": "cd",
  // Ásia / Oceania
  japao: "jp", "coreia-do-sul": "kr", "arabia-saudita": "sa",
  ira: "ir", iraque: "iq", catar: "qa", "emirados-arabes": "ae",
  jordania: "jo", jordan: "jo",
  australia: "au", "nova-zelandia": "nz", uzbequistao: "uz"
};

export function isoOf(team) {
  return ISO[slug(team)] || null;
}

// Retorna o HTML da bandeira (imagem). Se não conhecermos o país, mostra ⚽.
export function flagOf(team) {
  const code = isoOf(team);
  if (!code) return `<span class="flag-fallback">⚽</span>`;
  const name = String(team || "").replace(/"/g, "");
  return `<img class="flag-img" loading="lazy" width="28" height="21" alt="${name}"` +
    ` src="https://flagcdn.com/28x21/${code}.png"` +
    ` srcset="https://flagcdn.com/56x42/${code}.png 2x">`;
}
