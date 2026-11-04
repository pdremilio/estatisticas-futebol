#!/usr/bin/env python3
"""ScanBall · prévia com dados da API-Football (Brasileirão 2024, liberado no plano grátis).

Baixa todos os jogos da temporada com estatísticas (escanteios, cartões, xG, finalizações...) e lances,
e grava "dados-2024.js" (window.PREVIA), lido só pela página previa.html. Não mexe nos dados do site.

O plano grátis só entrega um jogo completo por requisição (o parâmetro "ids" é bloqueado) e dá 100 por dia.
Por isso o download é aos poucos: cada execução baixa até LIMITE jogos (padrão 85), dos mais recentes para os
mais antigos, e guarda o progresso no próprio dados-2024.js. A temporada inteira (380 jogos) fica pronta em ~5 dias.
Uso: API_FOOTBALL_KEY=... python3 baixar_previa_2024.py   [liga] [temporada]
"""
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone

BASE = os.environ.get("API_FOOTBALL_BASE", "https://v3.football.api-sports.io")
PASTA = os.path.dirname(os.path.abspath(__file__))
LIGA = int(sys.argv[1]) if len(sys.argv) > 1 else 71
TEMPORADA = int(sys.argv[2]) if len(sys.argv) > 2 else 2024
PAUSA = float(os.environ.get("PAUSA", "7"))  # plano grátis: 10 requisições por minuto
LIMITE = int(os.environ.get("LIMITE", "85"))  # jogos por execução (deixa folga das 100 diárias)
ARQ = os.path.join(PASTA, "dados-2024.js")

ESTATS = {"Corner Kicks": "esc", "Yellow Cards": "am", "Red Cards": "vm", "expected_goals": "xg", "Total Shots": "ch",
          "Shots on Goal": "al", "Ball Possession": "po", "Fouls": "fa", "Offsides": "im", "Goalkeeper Saves": "de"}
FINAIS = {"FT", "AET", "PEN"}
gastas = 0


def chamar(caminho):
    global gastas
    chave = os.environ.get("API_FOOTBALL_KEY", "")
    if not chave:
        sys.exit("Falta a chave: defina API_FOOTBALL_KEY.")
    req = urllib.request.Request(BASE + caminho, headers={"x-apisports-key": chave, "User-Agent": "scanball/1.0"})
    for tentativa in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                dados = json.loads(r.read().decode("utf-8"))
                restantes = r.headers.get("x-ratelimit-requests-remaining")
            gastas += 1
            erros = dados.get("errors")
            if erros and (len(erros) if isinstance(erros, (list, dict)) else 1):
                if "rateLimit" in str(erros) and tentativa < 2:
                    print("   limite por minuto, esperando 65 s...")
                    time.sleep(65)
                    continue
                raise RuntimeError(json.dumps(erros, ensure_ascii=False))
            return dados.get("response", []), restantes
        except urllib.error.URLError as e:
            if tentativa == 2:
                raise RuntimeError(str(e))
            time.sleep(10)
    raise RuntimeError("sem resposta")


def numero(v):
    if v is None:
        return None
    if isinstance(v, str):
        v = v.replace("%", "").strip()
        try:
            return float(v) if "." in v else int(v)
        except ValueError:
            return None
    return v


def evento(e, id_casa):
    tipo, det = (e.get("type") or "").lower(), e.get("detail") or ""
    t = e.get("time") or {}
    lado = 0 if (e.get("team") or {}).get("id") == id_casa else 1
    jog = (e.get("player") or {}).get("name") or ""
    ass = (e.get("assist") or {}).get("name") or ""
    if tipo == "goal":
        if "missed" in det.lower():
            cod, x = "pp", ""
        elif "own" in det.lower():
            cod, x = "gc", ""
        elif "penalty" in det.lower():
            cod, x = "gp", ""
        else:
            cod, x = "g", ass
    elif tipo == "card":
        cod = "a" if "yellow" in det.lower() and "second" not in det.lower() else "v"
        x = "2º amarelo" if "second" in det.lower() else ""
    elif tipo == "subst":
        cod, jog, x = "s", ass, jog  # entra (assist) / sai (player)
    elif tipo == "var":
        cod, x = "x", det
    else:
        return None
    return [t.get("elapsed"), t.get("extra"), lado, cod, jog, x]


def compactar(f):
    fx, tm = f["fixture"], f["teams"]
    id_casa = tm["home"]["id"]
    st = {}
    for bloco in f.get("statistics") or []:
        lado = 0 if (bloco.get("team") or {}).get("id") == id_casa else 1
        for s in bloco.get("statistics") or []:
            k = ESTATS.get(s.get("type"))
            if k:
                st.setdefault(k, [None, None])[lado] = numero(s.get("value"))
    tem_st = bool(st)
    for k in ("esc", "am", "vm"):  # a API manda null quando é zero
        if tem_st:
            par = st.setdefault(k, [None, None])
            st[k] = [x if x is not None else 0 for x in par]
    rodada = (f.get("league") or {}).get("round") or ""
    num = "".join(c for c in rodada.split("-")[-1] if c.isdigit())
    ev = [x for x in (evento(e, id_casa) for e in f.get("events") or []) if x]
    ht = (f.get("score") or {}).get("halftime") or {}
    return {
        "i": fx["id"], "d": fx["date"], "s": fx["status"]["short"], "r": int(num) if num else None,
        "h": id_casa, "a": tm["away"]["id"], "gh": f["goals"]["home"], "ga": f["goals"]["away"],
        "hh": ht.get("home"), "ha": ht.get("away"), "e": st or None, "ev": ev,
    }


def ler_existente():
    if not os.path.exists(ARQ):
        return None
    with open(ARQ, encoding="utf-8") as f:
        txt = f.read()
    try:
        dados = json.loads(txt[txt.index("{"):txt.rstrip().rstrip(";").rindex("}") + 1])
    except ValueError:
        return None
    return dados if dados.get("liga_id") == LIGA and dados.get("temporada") == TEMPORADA else None


def gravar(saida):
    saida["gerado_em"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    saida["jogos"] = sorted(saida["jogos"], key=lambda j: j["d"])
    saida["total"] = sum(1 for j in saida["jogos"] if j["s"] in FINAIS)
    saida["baixados"] = sum(1 for j in saida["jogos"] if j["s"] in FINAIS and (j.get("e") or j.get("sem")))
    with open(ARQ, "w", encoding="utf-8") as arq:
        arq.write("window.PREVIA = ")
        json.dump(saida, arq, ensure_ascii=False, separators=(",", ":"))
        arq.write(";\n")
    return saida


def main():
    print(f"Liga {LIGA}, temporada {TEMPORADA}")
    saida = ler_existente()
    if saida:
        print(f"Continuando: {saida.get('baixados', 0)} de {saida.get('total', '?')} jogos já baixados.")
    else:
        lista, rest = chamar(f"/fixtures?league={LIGA}&season={TEMPORADA}")
        print(f"{len(lista)} jogos na temporada (restam {rest} requisições hoje)")
        if not lista:
            sys.exit("Nenhum jogo encontrado. O plano grátis libera de 2022 a 2024.")
        times = {}
        for f in lista:
            for lado in ("home", "away"):
                t = f["teams"][lado]
                times[str(t["id"])] = {"n": t["name"], "l": t.get("logo") or ""}
        saida = {"fonte": "API-Football", "liga": (lista[0].get("league") or {}).get("name", ""), "liga_id": LIGA,
                 "temporada": TEMPORADA, "times": times, "jogos": [compactar(f) for f in lista]}
    faltam = sorted((j for j in saida["jogos"] if j["s"] in FINAIS and not j.get("e") and not j.get("sem")),
                    key=lambda j: j["d"], reverse=True)
    if not faltam:
        gravar(saida)
        print("Temporada completa. Nada para baixar.")
        return
    por_id = {j["i"]: k for k, j in enumerate(saida["jogos"])}
    feitos = 0
    try:
        for j in faltam[:LIMITE]:
            time.sleep(PAUSA)
            resp, rest = chamar(f"/fixtures?id={j['i']}")
            if resp:
                novo = compactar(resp[0])
                if not novo["e"]:
                    novo["sem"] = 1  # a API não tem estatística deste jogo: não tentar de novo
                saida["jogos"][por_id[j["i"]]] = novo
            feitos += 1
            if feitos % 10 == 0:
                print(f"   {feitos} jogos baixados nesta execução (restam {rest} requisições hoje)")
            if rest is not None and str(rest).isdigit() and int(rest) < 3:
                print("   limite diário quase no fim; continua na próxima execução.")
                break
    except RuntimeError as e:
        print(f"   parou: {e}")
    finally:
        saida = gravar(saida)
        tam = os.path.getsize(ARQ) / 1024
        print(f"Pronto: dados-2024.js ({tam:.0f} KB). Nesta execução: {feitos} jogos. "
              f"Total: {saida['baixados']} de {saida['total']}. Requisições usadas: {gastas}.")


if __name__ == "__main__":
    main()
