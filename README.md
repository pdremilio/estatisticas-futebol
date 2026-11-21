# ScanBall

Site de estatísticas de futebol: https://pdremilio.github.io/estatisticas-futebol

## Como funciona

| Parte | O que faz | Onde |
|---|---|---|
| Site | Páginas, gráficos, filtros, projeções (tudo no navegador) | `estatisticas-futebol/` (`index.html`, `app.js`, `aovivo.js`, `motor.js`, `estilo.css`, `contas.js`, `config.js`) |
| Página de teste | Mesma coisa, com as novidades antes de ir para o site | `teste.html` + arquivos `*-teste` |
| Robô (GitHub Actions) | Tabelas, estatísticas e odds; publica o site | `.github/workflows/atualizar.yml` + `atualizar_b5.py` (ESPN + FotMob), `atualizar_odds.py` (média das casas), `atualizar_5d.py` (5Dollar: números extras e odds bet365) |
| Servidor do ao vivo (Cloudflare) | Busca a 5Dollar a cada 8 s para todos e guarda o minuto a minuto | `worker/` (publicado pelo `worker.yml`) |
| Contas | Login e preferências sincronizadas (Supabase) | `contas.js`, `supabase/1-contas.sql` |

## Segredos (ficam só no GitHub / Cloudflare, nunca no código)

- `FIVE_DOLLAR_KEY` — 5DollarFootballAPI (GitHub e Worker)
- `ODDS_API_KEY` — The Odds API (GitHub)
- `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` — publicar o Worker
