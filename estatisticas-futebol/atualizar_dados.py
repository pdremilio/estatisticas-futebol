# -*- coding: utf-8 -*-
"""
Estatísticas de Futebol - atualizador de dados

Baixa partidas, classificação e artilharia das competições do plano grátis
da football-data.org e grava tudo em "dados.js", que o index.html lê.

Uso:  python atualizar_dados.py            (todas as competições da lista)
      python atualizar_dados.py BSA PL     (só as que você passar)

Odds das casas (opcional): coloque a chave da The Odds API (the-odds-api.com,
plano grátis de 500 créditos/mês) em "chave_odds.txt" ou na variável ODDS_API_KEY.

Só usa a biblioteca padrão do Python, não precisa instalar nada.
"""

import json
import os
import re
import unicodedata
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

# ---------------------------------------------------------------- configuração

# Competições baixadas por padrão (códigos da football-data.org).
# Tire da lista as que não quiser para a atualização ficar mais rápida.
COMPETICOES = [
    "BSA",  # Campeonato Brasileiro Série A
    "PL",   # Premier League
    "PD",   # La Liga (Primera División)
    "SA",   # Serie A (Itália)
    "BL1",  # Bundesliga
    "FL1",  # Ligue 1
    "PPL",  # Primeira Liga (Portugal)
    "DED",  # Eredivisie
    "ELC",  # Championship
    "CL",   # Champions League
    # "WC" (Copa do Mundo) e "EC" (Eurocopa) ficam de fora porque já acabaram
]

ARTILHEIROS_POR_COMPETICAO = 30
INTERVALO_ENTRE_CHAMADAS = 6.5   # o plano grátis permite 10 chamadas por minuto

# --- odds das casas de apostas (The Odds API) ---
# Cada liga buscada gasta 1 crédito (mercado 1X2, região "eu"). O plano grátis tem 500 por mês.
# Para economizar, só busca ligas com jogo nos próximos ODDS_DIAS dias e no máximo a cada ODDS_HORAS horas.
ODDS_HORAS = 12
ODDS_DIAS = 3
ODDS_REGIAO = "eu"
ODDS_LIGAS = {
    "BSA": "soccer_brazil_campeonato", "PL": "soccer_epl", "PD": "soccer_spain_la_liga",
    "SA": "soccer_italy_serie_a", "BL1": "soccer_germany_bundesliga", "FL1": "soccer_france_ligue_one",
    "PPL": "soccer_portugal_primeira_liga", "DED": "soccer_netherlands_eredivisie",
    "ELC": "soccer_efl_champ", "CL": "soccer_uefa_champs_league",
}

BASE = "https://api.football-data.org/v4"
PASTA = os.path.dirname(os.path.abspath(__file__))
ARQ_CHAVE = os.path.join(PASTA, "chave_api.txt")
ARQ_CHAVE_ODDS = os.path.join(PASTA, "chave_odds.txt")
ARQ_SAIDA = os.path.join(PASTA, "dados.js")

# ---------------------------------------------------------------- utilidades

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def obter_chave():
    chave = os.environ.get("FOOTBALL_DATA_KEY", "").strip()
    if chave:
        return chave
    if os.path.exists(ARQ_CHAVE):
        with open(ARQ_CHAVE, encoding="utf-8") as f:
            chave = f.read().strip()
        if chave:
            return chave
    if not sys.stdin or not sys.stdin.isatty():
        sys.exit("Chave da football-data.org não encontrada (variável FOOTBALL_DATA_KEY ou chave_api.txt).")
    print("Cole sua chave da football-data.org (fica salva em chave_api.txt):")
    chave = input("> ").strip()
    if not chave:
        sys.exit("Sem chave não dá para baixar os dados.")
    with open(ARQ_CHAVE, "w", encoding="utf-8") as f:
        f.write(chave)
    return chave


_ultima_chamada = [0.0]


def chamar(caminho, chave, tentativas=3):
    """GET na API respeitando o limite de 10 chamadas/minuto."""
    espera = INTERVALO_ENTRE_CHAMADAS - (time.time() - _ultima_chamada[0])
    if espera > 0:
        time.sleep(espera)
    req = urllib.request.Request(
        BASE + caminho,
        headers={"X-Auth-Token": chave, "User-Agent": "estatisticas-futebol/1.0"},
    )
    for tentativa in range(tentativas):
        _ultima_chamada[0] = time.time()
        try:
            with urllib.request.urlopen(req, timeout=40) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 429:
                reset = e.headers.get("X-RequestCounter-Reset") or "60"
                try:
                    segundos = int(reset) + 2
                except ValueError:
                    segundos = 62
                print(f"   limite de chamadas atingido, aguardando {segundos}s...")
                time.sleep(segundos)
                continue
            if e.code in (400, 403, 404):
                corpo = e.read().decode("utf-8", "replace")
                raise RuntimeError(f"HTTP {e.code}: {corpo[:200]}")
            if tentativa == tentativas - 1:
                raise RuntimeError(f"HTTP {e.code}")
            time.sleep(5)
        except urllib.error.URLError as e:
            if tentativa == tentativas - 1:
                raise RuntimeError(f"sem conexão ({e.reason})")
            time.sleep(5)
    raise RuntimeError("falhou após várias tentativas")


def placar(score):
    """Placar do tempo normal (ignora prorrogação e pênaltis)."""
    if not score:
        return None, None, None, None
    ft = score.get("regularTime") or score.get("fullTime") or {}
    ht = score.get("halfTime") or {}
    return ft.get("home"), ft.get("away"), ht.get("home"), ht.get("away")


def registrar_time(times, t):
    if not t or t.get("id") is None:
        return None
    tid = str(t["id"])
    atual = times.get(tid, {})
    times[tid] = {
        "n": t.get("name") or atual.get("n") or "?",
        "c": t.get("shortName") or atual.get("c") or t.get("name") or "?",
        "t": t.get("tla") or atual.get("t") or "",
        "e": t.get("crest") or atual.get("e") or "",
    }
    return tid


# ---------------------------------------------------------------- coleta


def baixar_competicao(code, chave, times):
    comp = {"code": code}

    # 1) partidas da temporada atual
    dados = chamar(f"/competitions/{code}/matches", chave)
    c = dados.get("competition") or {}
    comp["nome"] = c.get("name", code)
    comp["emblema"] = c.get("emblem", "")
    comp["tipo"] = c.get("type", "LEAGUE")
    partidas = []
    temporada = None
    for m in dados.get("matches", []):
        temporada = temporada or m.get("season")
        h = registrar_time(times, m.get("homeTeam"))
        a = registrar_time(times, m.get("awayTeam"))
        fh, fa, hh, ha = placar(m.get("score"))
        partidas.append({
            "i": m.get("id"),
            "d": m.get("utcDate"),
            "s": m.get("status"),
            "r": m.get("matchday"),
            "f": m.get("stage"),
            "g": m.get("group"),
            "h": h, "a": a,
            "fh": fh, "fa": fa, "hh": hh, "ha": ha,
            "du": (m.get("score") or {}).get("duration"),
            "w": (m.get("score") or {}).get("winner"),
        })
    comp["partidas"] = partidas
    if temporada:
        comp["temporada"] = {
            "inicio": temporada.get("startDate"),
            "fim": temporada.get("endDate"),
            "rodada": temporada.get("currentMatchday"),
        }

    # 2) classificação
    try:
        dados = chamar(f"/competitions/{code}/standings", chave)
        tabelas = []
        for st in dados.get("standings", []):
            linhas = []
            for l in st.get("table", []):
                tid = registrar_time(times, l.get("team"))
                linhas.append({
                    "p": l.get("position"), "t": tid,
                    "j": l.get("playedGames"), "v": l.get("won"),
                    "e": l.get("draw"), "d": l.get("lost"),
                    "gp": l.get("goalsFor"), "gc": l.get("goalsAgainst"),
                    "sg": l.get("goalDifference"), "pts": l.get("points"),
                    "forma": l.get("form"),
                })
            tabelas.append({
                "fase": st.get("stage"), "tipo": st.get("type"),
                "grupo": st.get("group"), "tabela": linhas,
            })
        comp["classificacao"] = tabelas
    except RuntimeError as e:
        print(f"   classificação indisponível: {e}")
        comp["classificacao"] = []

    # 3) artilharia
    try:
        dados = chamar(f"/competitions/{code}/scorers?limit={ARTILHEIROS_POR_COMPETICAO}", chave)
        art = []
        for s in dados.get("scorers", []):
            p = s.get("player") or {}
            art.append({
                "nome": p.get("name"), "nac": p.get("nationality"),
                "pos": p.get("section") or p.get("position"),
                "t": registrar_time(times, s.get("team")),
                "jogos": s.get("playedMatches"), "gols": s.get("goals"),
                "ass": s.get("assists"), "pen": s.get("penalties"),
            })
        comp["artilharia"] = art
    except RuntimeError as e:
        print(f"   artilharia indisponível: {e}")
        comp["artilharia"] = []

    comp["atualizado_em"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    return comp


# ---------------------------------------------------------------- odds das casas


def obter_chave_odds():
    chave = os.environ.get("ODDS_API_KEY", "").strip()
    if chave:
        return chave
    if os.path.exists(ARQ_CHAVE_ODDS):
        with open(ARQ_CHAVE_ODDS, encoding="utf-8") as f:
            return f.read().strip() or None
    return None


GENERICOS = {"fc", "afc", "cf", "sc", "ec", "ac", "as", "ss", "club", "clube", "de", "da", "do", "del",
             "futebol", "football", "calcio", "cd", "ud", "fk", "sv", "sad", "the", "and", "esporte"}


def tokens(nome):
    nome = unicodedata.normalize("NFD", nome or "").encode("ascii", "ignore").decode().lower()
    return {t for t in re.split(r"[^a-z0-9]+", nome) if len(t) >= 2 and t not in GENERICOS}


def parecido(a, b):
    """0 a 1: quantas palavras de um nome aparecem no outro (aceita prefixo, ex.: inter/internazionale)."""
    if not a or not b:
        return 0.0
    hits = sum(1 for x in a if any(x == y or (min(len(x), len(y)) >= 4 and (x.startswith(y) or y.startswith(x))) for y in b))
    return hits / min(len(a), len(b))


def iso_para_dt(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def chamar_odds(sport, chave):
    url = (f"https://api.the-odds-api.com/v4/sports/{sport}/odds/?apiKey={chave}"
           f"&regions={ODDS_REGIAO}&markets=h2h&oddsFormat=decimal&dateFormat=iso")
    base = os.environ.get("ODDS_BASE")
    if base:
        url = url.replace("https://api.the-odds-api.com", base)
    req = urllib.request.Request(url, headers={"User-Agent": "estatisticas-futebol/1.0"})
    with urllib.request.urlopen(req, timeout=40) as resp:
        restantes = resp.headers.get("x-requests-remaining")
        return json.loads(resp.read().decode("utf-8")), restantes


def casar_evento(ev, comp, times):
    """Acha a partida da football-data correspondente ao evento da The Odds API (nome + horário)."""
    try:
        quando = iso_para_dt(ev["commence_time"])
    except Exception:
        return None
    th, ta = tokens(ev.get("home_team")), tokens(ev.get("away_team"))
    melhor, melhor_nota = None, 0.0
    for p in comp.get("partidas", []):
        if p.get("s") not in ("SCHEDULED", "TIMED", "IN_PLAY", "PAUSED") or not p.get("h") or not p.get("a"):
            continue
        dif = abs((iso_para_dt(p["d"]) - quando).total_seconds())
        if dif > 3 * 3600:
            continue
        h, a = times.get(p["h"], {}), times.get(p["a"], {})
        sh = parecido(th, tokens(h.get("n")) | tokens(h.get("c")))
        sa = parecido(ta, tokens(a.get("n")) | tokens(a.get("c")))
        if sh == 0 or sa == 0:
            continue
        nota = sh + sa - dif / 86400
        if nota > melhor_nota:
            melhor, melhor_nota = p, nota
    return melhor


def resumir_odds(ev):
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


def precisa_odds(comp, agora):
    if comp.get("code") not in ODDS_LIGAS:
        return False
    ultima = comp.get("odds_em")
    if ultima:
        try:
            if agora - iso_para_dt(ultima) < timedelta(hours=ODDS_HORAS):
                return False
        except Exception:
            pass
    limite = agora + timedelta(days=ODDS_DIAS)
    return any(p.get("s") in ("SCHEDULED", "TIMED") and agora <= iso_para_dt(p["d"]) <= limite
               for p in comp.get("partidas", []) if p.get("d"))


def atualizar_odds(competicoes, times, chave_odds):
    agora = datetime.now(timezone.utc)
    print("\nOdds das casas (The Odds API):")
    for code, comp in competicoes.items():
        if not precisa_odds(comp, agora):
            continue
        try:
            eventos, restantes = chamar_odds(ODDS_LIGAS[code], chave_odds)
        except urllib.error.HTTPError as e:
            print(f"   {code}: erro HTTP {e.code}" + (" (créditos do mês acabaram ou chave inválida)" if e.code in (401, 429) else ""))
            if e.code in (401, 429):
                return
            continue
        except Exception as e:
            print(f"   {code}: erro ({e})")
            continue
        odds = {}
        for ev in eventos:
            p = casar_evento(ev, comp, times)
            r = resumir_odds(ev) if p else None
            if r:
                odds[str(p["i"])] = r
        comp["odds"] = odds
        comp["odds_em"] = agora.isoformat(timespec="seconds")
        print(f"   {code}: odds de {len(odds)} de {len(eventos)} jogos" + (f" · créditos restantes: {restantes}" if restantes else ""))


def ler_dados_existentes():
    """Reaproveita o dados.js anterior para não perder competições que falharem."""
    if not os.path.exists(ARQ_SAIDA):
        return None
    try:
        with open(ARQ_SAIDA, encoding="utf-8") as f:
            txt = f.read()
        inicio = txt.index("{")
        fim = txt.rindex("}")
        return json.loads(txt[inicio:fim + 1])
    except Exception:
        return None


def main():
    pedidas = [a.upper() for a in sys.argv[1:]] or COMPETICOES
    chave = obter_chave()

    anterior = ler_dados_existentes() or {}
    times = dict(anterior.get("times", {}))
    competicoes = {k: v for k, v in anterior.get("competicoes", {}).items() if k not in ("WC", "EC")}

    total = len(pedidas)
    minutos = total * 3 * INTERVALO_ENTRE_CHAMADAS / 60
    print(f"Atualizando {total} competição(ões). Leva cerca de {minutos:.0f} min por causa do limite da API.\n")

    falhas = []
    for n, code in enumerate(pedidas, 1):
        print(f"[{n}/{total}] {code}...")
        try:
            comp = baixar_competicao(code, chave, times)
            velho = competicoes.get(code) or {}
            if velho.get("odds"):
                comp["odds"], comp["odds_em"] = velho["odds"], velho.get("odds_em")
            competicoes[code] = comp
            fin = sum(1 for p in comp["partidas"] if p["s"] == "FINISHED")
            print(f"   ok: {len(comp['partidas'])} partidas ({fin} encerradas)")
        except RuntimeError as e:
            falhas.append(code)
            print(f"   erro: {e}")
            if "HTTP 403" in str(e) or "HTTP 400" in str(e):
                print("   (confira se a chave em chave_api.txt está certa e se a competição está no seu plano)")

    chave_odds = obter_chave_odds()
    if chave_odds:
        atualizar_odds(competicoes, times, chave_odds)
    else:
        print("\n(Odds das casas desligadas: para ligar, coloque a chave da The Odds API em chave_odds.txt.)")

    saida = {
        "versao": 1,
        "fonte": "football-data.org",
        "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "times": times,
        "competicoes": competicoes,
    }
    with open(ARQ_SAIDA, "w", encoding="utf-8") as f:
        f.write("window.DADOS = ")
        json.dump(saida, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")

    tamanho = os.path.getsize(ARQ_SAIDA) / 1024
    print(f"\nPronto: dados.js gravado ({tamanho:.0f} KB).")
    if falhas:
        print("Não atualizadas (ficaram com os dados anteriores, se havia): " + ", ".join(falhas))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nCancelado.")
