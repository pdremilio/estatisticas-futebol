#!/usr/bin/env python3
"""ScanBall · prévia com dados da API-Football (Brasileirão 2024, liberado no plano grátis).

Baixa todos os jogos da temporada com estatísticas (escanteios, cartões, xG, finalizações...) e lances,
e grava "dados-2024.js" (window.PREVIA), lido só pela página previa.html. Não mexe nos dados do site.

Gasto: ~20 requisições (a API entrega até 20 jogos completos por chamada). Plano grátis: 100/dia.
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


def main():
    print(f"Liga {LIGA}, temporada {TEMPORADA}")
    lista, rest = chamar(f"/fixtures?league={LIGA}&season={TEMPORADA}")
    print(f"{len(lista)} jogos na temporada (restam {rest} requisições hoje)")
    if not lista:
        sys.exit("Nenhum jogo encontrado. O plano grátis libera de 2022 a 2024.")
    times, nome_liga = {}, (lista[0].get("league") or {}).get("name", "")
    for f in lista:
        for lado in ("home", "away"):
            t = f["teams"][lado]
            times[str(t["id"])] = {"n": t["name"], "l": t.get("logo") or ""}
    encerrados = [f["fixture"]["id"] for f in lista if f["fixture"]["status"]["short"] in FINAIS]
    jogos = {}
    for i in range(0, len(encerrados), 20):
        time.sleep(PAUSA)
        lote = encerrados[i:i + 20]
        resp, rest = chamar("/fixtures?ids=" + "-".join(map(str, lote)))
        for f in resp:
            jogos[f["fixture"]["id"]] = compactar(f)
        print(f"   detalhes {min(i + 20, len(encerrados))}/{len(encerrados)} (restam {rest})")
    for f in lista:  # jogos sem detalhe (adiados etc.) entram só com o básico
        if f["fixture"]["id"] not in jogos:
            jogos[f["fixture"]["id"]] = compactar(f)
    saida = {
        "fonte": "API-Football", "liga": nome_liga, "liga_id": LIGA, "temporada": TEMPORADA,
        "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "times": times, "jogos": sorted(jogos.values(), key=lambda j: j["d"]),
    }
    com_st = sum(1 for j in saida["jogos"] if j["e"])
    with open(os.path.join(PASTA, "dados-2024.js"), "w", encoding="utf-8") as arq:
        arq.write("window.PREVIA = ")
        json.dump(saida, arq, ensure_ascii=False, separators=(",", ":"))
        arq.write(";\n")
    tam = os.path.getsize(os.path.join(PASTA, "dados-2024.js")) / 1024
    print(f"Pronto: dados-2024.js ({tam:.0f} KB), {len(saida['jogos'])} jogos, {com_st} com estatísticas, "
          f"{len(times)} times. Requisições usadas: {gastas}.")


if __name__ == "__main__":
    main()
