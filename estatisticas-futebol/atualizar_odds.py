#!/usr/bin/env python3
"""ScanBall · odds da "média das casas" (The Odds API), a 2ª fonte de odds do site (a 1ª é a bet365 da 5Dollar).

Roda no GitHub Actions antes do atualizar_b5.py. A chave fica no segredo ODDS_API_KEY (plano grátis: 500 créditos/mês;
cada liga buscada gasta 1). Para economizar, cada liga só é buscada a cada ODDS_HORAS e só se tiver jogo nos próximos
ODDS_DIAS dias.

Saída: odds_casas.json -> { "ligas": { code: { "em": iso, "ev": [ { "h", "a", "d", "r": { n, c, e, f, mc, me, mf } } ] } } }
O atualizar_b5.py liga cada evento ao jogo do site (nomes dos times + horário) e grava em competicoes[code].odds.
Só usa a biblioteca padrão do Python.
"""
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

ODDS_HORAS = 12
ODDS_DIAS = 3
ODDS_REGIAO = "eu"
ODDS_LIGAS = {
    "BSA": "soccer_brazil_campeonato", "PL": "soccer_epl", "PD": "soccer_spain_la_liga",
    "SA": "soccer_italy_serie_a", "BL1": "soccer_germany_bundesliga", "FL1": "soccer_france_ligue_one",
    "PPL": "soccer_portugal_primeira_liga", "DED": "soccer_netherlands_eredivisie",
    "ELC": "soccer_efl_champ", "CL": "soccer_uefa_champs_league",
}
PASTA = os.path.dirname(os.path.abspath(__file__))
ARQ_SAIDA = os.path.join(PASTA, "odds_casas.json")
ARQ_DADOS5 = os.path.join(PASTA, "dados5.js")   # a versão já publicada (só para saber quais ligas têm jogo)

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def iso_para_dt(iso):
    return datetime.fromisoformat(str(iso).replace("Z", "+00:00"))


def ler_json(caminho):
    try:
        txt = open(caminho, encoding="utf-8").read()
        return json.loads(txt[txt.index("{"):txt.rindex("}") + 1])
    except Exception:
        return None


def resumir(ev):
    """Média e melhor odd de cada resultado entre as casas."""
    precos = {"c": [], "e": [], "f": []}
    for bk in ev.get("bookmakers", []):
        for mk in bk.get("markets", []):
            if mk.get("key") != "h2h":
                continue
            for o in mk.get("outcomes", []):
                nome, preco = o.get("name"), o.get("price")
                if not preco:
                    continue
                if nome == ev.get("home_team"):
                    precos["c"].append(preco)
                elif nome == ev.get("away_team"):
                    precos["f"].append(preco)
                elif str(nome).lower() == "draw":
                    precos["e"].append(preco)
    if not precos["c"] or not precos["f"]:
        return None
    r = {"n": len(precos["c"])}
    for k, v in precos.items():
        if v:
            r[k] = round(sum(v) / len(v), 2)
            r["m" + k] = round(max(v), 2)
    return r


def tem_jogo_perto(dados5, code, agora):
    comp = ((dados5 or {}).get("competicoes") or {}).get(code)
    if not comp:
        return dados5 is None  # sem o arquivo publicado: busca assim mesmo
    limite = agora + timedelta(days=ODDS_DIAS)
    for p in comp.get("partidas") or []:
        try:
            if p.get("s") in ("SCHEDULED", "TIMED") and agora <= iso_para_dt(p["d"]) <= limite:
                return True
        except Exception:
            continue
    return False


def main():
    chave = os.environ.get("ODDS_API_KEY", "").strip()
    cache = ler_json(ARQ_SAIDA) or {}
    ligas = cache.get("ligas") or {}
    agora = datetime.now(timezone.utc)
    if not chave:
        print("Sem a chave ODDS_API_KEY: mantenho as odds que já estavam guardadas.")
    else:
        dados5 = ler_json(ARQ_DADOS5)
        print("Odds da média das casas (The Odds API):")
        for code, sport in ODDS_LIGAS.items():
            ant = ligas.get(code) or {}
            try:
                if ant.get("em") and agora - iso_para_dt(ant["em"]) < timedelta(hours=ODDS_HORAS):
                    continue
            except Exception:
                pass
            if not tem_jogo_perto(dados5, code, agora):
                continue
            url = (f"https://api.the-odds-api.com/v4/sports/{sport}/odds/?apiKey={chave}"
                   f"&regions={ODDS_REGIAO}&markets=h2h&oddsFormat=decimal&dateFormat=iso")
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "ScanBall/8 (odds)"})
                with urllib.request.urlopen(req, timeout=40) as r:
                    restantes = r.headers.get("x-requests-remaining")
                    eventos = json.loads(r.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                print(f"   {code}: erro {e.code}" + (" (créditos do mês acabaram ou chave inválida)" if e.code in (401, 429) else ""))
                if e.code in (401, 429):
                    break
                continue
            except Exception as e:
                print(f"   {code}: falha ({e})")
                continue
            ev = []
            for x in eventos:
                res = resumir(x)
                if res and x.get("home_team") and x.get("away_team") and x.get("commence_time"):
                    ev.append({"h": x["home_team"], "a": x["away_team"], "d": x["commence_time"], "r": res})
            ligas[code] = {"em": agora.isoformat(timespec="seconds"), "ev": ev}
            print(f"   {code}: {len(ev)} jogos" + (f" · créditos restantes: {restantes}" if restantes else ""))
    # jogos que já passaram não servem mais
    for code, lg in ligas.items():
        lg["ev"] = [x for x in lg.get("ev") or [] if _depois(x.get("d"), agora - timedelta(hours=6))]
    with open(ARQ_SAIDA, "w", encoding="utf-8") as f:
        json.dump({"gerado_em": agora.isoformat(timespec="seconds"), "ligas": ligas}, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Pronto: odds_casas.json ({sum(len(l.get('ev') or []) for l in ligas.values())} jogos)")


def _depois(iso, limite):
    try:
        return iso_para_dt(iso) >= limite
    except Exception:
        return False


if __name__ == "__main__":
    main()
