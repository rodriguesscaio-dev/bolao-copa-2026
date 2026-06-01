# 🔁 Como continuar este projeto no PC

Este projeto (um **Bolão da Copa do Mundo 2026** dentro do site "Starte-se")
foi começado pelo Claude Code na web. Use este guia para retomar no seu
computador.

---

## 1. Baixar o código

```bash
git clone https://github.com/caiorodriguess/starte-se.git
cd starte-se
git checkout claude/betting-pool-ranking-8VPKO
```

> Já tem o repo clonado? Então: `git fetch origin` e
> `git checkout claude/betting-pool-ranking-8VPKO`.

Depois abra a pasta no Claude Code (rode `claude` dentro de `starte-se`).

---

## 2. Prompt para colar no Claude Code do PC

Cole isto na primeira mensagem (troque a última linha pelo próximo passo):

```text
Estou continuando um projeto que comecei pelo Claude Code na web. É um "Bolão
da Copa do Mundo 2026" para jogar com os amigos do trabalho, dentro de um site
estático que já existia (projeto "Starte-se", HTML/CSS/JS + Bootstrap).

Tudo do bolão está na pasta bolao/ e já está commitado na branch atual
(claude/betting-pool-ranking-8VPKO). Estrutura:

- bolao/index.html      -> entrada: jogador digita o nome
- bolao/palpites.html   -> cada jogador dá seus palpites de placar
- bolao/ranking.html    -> ranking ao vivo + vencedor final
- bolao/admin.html      -> painel (PIN) p/ cadastrar jogos e lançar resultados
- bolao/js/db.js        -> camada de dados (Firebase Realtime DB) + pontuação
- bolao/js/firebase-config.js -> config do Firebase (ainda com placeholders)
- bolao/js/teams.js     -> bandeiras das seleções
- bolao/css/bolao.css   -> estilo (tema verde/amarelo da Copa)
- bolao/preview.html    -> preview estático com dados de exemplo (sem Firebase)
- bolao/README.md       -> passo a passo de Firebase + GitHub Pages

Sincroniza em tempo real via Firebase. Pontuação: 10 cravou o placar, 7 acertou
vencedor+saldo, 5 só o vencedor, 0 errou (configurável no admin).

Leia a pasta bolao/ (principalmente o README.md e o db.js) para se situar.
Ainda preciso: [DESCREVA AQUI O QUE QUER FAZER A SEGUIR].
```

---

## 3. Rodar e testar localmente

O site é estático, mas o Firebase precisa ser acessado via `http://` (não abra
o arquivo direto com `file://`). Suba um servidor simples:

```bash
python3 -m http.server 8000
```

Depois acesse:
- `http://localhost:8000/bolao/`            → o bolão de verdade
- `http://localhost:8000/bolao/preview.html` → só o visual (dados fictícios)

---

## 4. O que ainda falta fazer

- [ ] Criar o projeto no Firebase e preencher `bolao/js/firebase-config.js`
      (passo a passo completo no `bolao/README.md`).
- [ ] Trocar o `ADMIN_PIN` no mesmo arquivo.
- [ ] (Opcional) Pré-cadastrar os jogos da fase de grupos da Copa.
- [ ] Publicar no GitHub Pages e enviar o link para os amigos.

---

## 5. Salvar mudanças

```bash
git add -A
git commit -m "sua mensagem"
git push origin claude/betting-pool-ranking-8VPKO
```
