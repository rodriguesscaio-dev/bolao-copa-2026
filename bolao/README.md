# ⚽ Bolão da Copa do Mundo 2026

Um bolão completo para jogar com os amigos do trabalho:

- 🧑‍🤝‍🧑 **Cada um no seu ambiente** — a pessoa entra com o nome e dá os palpites
  de placar de cada jogo (`palpites.html`).
- 🏆 **Ranking ao vivo** — pontuação automática, posição de cada um e o
  **campeão final** quando todos os jogos acabam (`ranking.html`).
- 🔒 **Painel do admin** — você cadastra os jogos e lança os resultados
  oficiais (`admin.html`), protegido por um PIN.

Tudo sincroniza em tempo real entre todos os participantes usando o
**Firebase Realtime Database** (plano gratuito).

---

## 1. Criar o projeto no Firebase (grátis, ~5 min)

1. Acesse <https://console.firebase.google.com> e clique em **Adicionar projeto**.
   Dê um nome, ex.: `bolao-copa-2026`. Pode pular o Google Analytics.
2. No menu lateral, vá em **Build → Realtime Database → Criar banco de dados**.
   - Escolha a localização (pode deixar a padrão).
   - Selecione **Iniciar em modo de teste** e confirme.
3. Volte para a visão geral do projeto e clique no ícone **`</>` (Web)** para
   registrar um app. Dê um apelido e clique em registrar.
4. O Firebase mostra um trecho com `const firebaseConfig = { ... }`.
   **Copie esses valores.**

## 2. Colar a configuração

Abra o arquivo [`js/firebase-config.js`](js/firebase-config.js) e substitua os
valores `SEU_...` pelos que você copiou. Troque também o `ADMIN_PIN` por uma
senha que só você saiba (é o PIN do painel de admin).

## 3. Definir as regras de segurança (recomendado)

O "modo de teste" do Firebase **expira em 30 dias**. Para o bolão funcionar o
ano todo, vá em **Realtime Database → Regras** e cole isto:

```json
{
  "rules": {
    "players": { ".read": true, ".write": true },
    "bets":    { ".read": true, ".write": true },
    "matches": { ".read": true, ".write": true },
    "config":  { ".read": true, ".write": true }
  }
}
```

> Observação: estas regras são abertas (qualquer pessoa com o link pode ler e
> escrever). Para um bolão entre amigos isso é suficiente. O cadastro de jogos e
> o lançamento de resultados ficam atrás do PIN do admin no app.

## 4. Publicar o site

Já que o repositório é estático, a forma mais fácil é o **GitHub Pages**:

1. No GitHub, vá em **Settings → Pages**.
2. Em *Source*, escolha a branch (ex.: `master`) e a pasta `/ (root)`.
3. Salve. Em alguns minutos o site fica no ar em
   `https://caiorodriguess.github.io/starte-se/bolao/`.

Mande esse link para a galera. 🎉

---

## Como funciona

### Para os amigos
1. Abrem o link e entram com o nome (sempre o mesmo nome!).
2. Em **Meus Palpites**, digitam o placar que acham que vai dar em cada jogo.
   Os palpites salvam sozinhos e **travam quando o jogo começa**.
3. Acompanham a posição deles em **Ranking**.

### Para você (admin)
1. Em **Admin**, digite o PIN.
2. Os jogos da Copa entram **sozinhos** (ver "Resultados automáticos" abaixo).
   Se precisar, ainda dá para cadastrar/editar jogos manualmente aqui.
3. Os placares também chegam sozinhos — mas você pode corrigir/lançar um
   resultado manualmente a qualquer momento.
4. O ranking recalcula tudo automaticamente.

---

## Resultados automáticos (GitHub Actions + API)

Os jogos e placares da Copa são buscados de forma automática numa API de
futebol e gravados no Firebase a cada ~15 min — ninguém precisa lançar nada
à mão. Quem cuida disso é o robô em `.github/workflows/atualizar-resultados.yml`
(script: `scripts/atualizar-resultados.mjs`).

**Configuração (uma vez só):**

1. **Pegue uma chave grátis** em <https://www.football-data.org/client/register>.
   Confirme o e-mail e copie o seu *API Token*.
2. No GitHub, vá em **Settings → Secrets and variables → Actions → New
   repository secret** e crie:
   - `FOOTBALL_DATA_TOKEN` → o token que você copiou.
   - `FIREBASE_DB_URL` → `https://bolao-copa-2026-e393b-default-rtdb.firebaseio.com`
     (opcional; o script já usa essa URL por padrão).
3. Em **Actions**, habilite os workflows se for pedido, abra **"Atualizar
   resultados do bolão"** e clique em **Run workflow** para a primeira carga.

A partir daí ele roda sozinho de 15 em 15 minutos. Os palpites continuam
travando no horário de início de cada jogo.

> ⚠️ O plano gratuito da football-data.org pode ter limite de competições.
> Se a Copa do Mundo 2026 (`WC`) não estiver inclusa no seu plano, o robô vai
> avisar no log do Actions — nesse caso dá para trocar a API ou lançar os
> resultados manualmente pelo Admin (o sistema aceita os dois).

### Pontuação (configurável no admin)
| Situação | Pontos |
|---|---|
| 🎯 Cravou o placar exato | **10** |
| ➗ Acertou o vencedor **e** o saldo de gols | **7** |
| ✅ Acertou só quem venceu (ou o empate) | **5** |
| ❌ Errou o resultado | **0** |

Em caso de empate no ranking, desempata por: mais placares cravados → mais
acertos no total.
