# -*- coding: utf-8 -*-
"""
ScanBall · Beta 5 · atualizador com ESPN (base) + FotMob (xG e rodada)

Grava "dados5.js" (lido pela página de teste) e "cache5.json" (estatísticas de cada jogo já baixadas,
para nunca baixar o mesmo jogo duas vezes). A football-data.org continua como reserva: o atualizador
antigo (atualizar_dados.py) segue gravando "dados.js", e a página usa ele se este aqui falhar.

Uso:  python atualizar_b5.py              (todas as competições)
      python atualizar_b5.py BSA PL       (só as que você passar)

Variáveis opcionais (para testes): ESPN_BASE, ESPN_V2_BASE, FOTMOB_BASE, B5_MAX_SUMARIOS, B5_AGORA.
Só usa a biblioteca padrão do Python.
"""

import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

# ---------------------------------------------------------------- competições
# código do site, liga na ESPN, nome, país, liga na FotMob (para xG/rodada), código de país da FotMob
COMPETICOES = [
    ("BSA", "bra.1", "Brasileirão Série A", "Brasil", 268, "BRA"),
    ("BSB", "bra.2", "Brasileirão Série B", "Brasil", 8814, "BRA"),
    ("PL", "eng.1", "Premier League", "Inglaterra", 47, "ENG"),
    ("ELC", "eng.2", "Championship", "Inglaterra", 48, "ENG"),
    ("PD", "esp.1", "La Liga", "Espanha", 87, "ESP"),
    ("SA", "ita.1", "Serie A", "Itália", 55, "ITA"),
    ("BL1", "ger.1", "Bundesliga", "Alemanha", 54, "GER"),
    ("FL1", "fra.1", "Ligue 1", "França", 53, "FRA"),
    ("PPL", "por.1", "Liga Portugal", "Portugal", 61, "POR"),
    ("DED", "ned.1", "Eredivisie", "Holanda", 57, "NED"),
    ("LMX", "mex.1", "Liga MX", "México", 230, "MEX"),
    ("MLS", "usa.1", "MLS", "Estados Unidos", 130, "USA"),
    ("ARG", "arg.1", "Liga Profesional", "Argentina", 112, "ARG"),
    ("CHI", "chi.1", "Primera División", "Chile", 273, "CHI"),
    ("COL", "col.1", "Primera A", "Colômbia", 274, "COL"),
    ("CL", "uefa.champions", "Champions League", "Europa", 42, "INT"),
    ("UEL", "uefa.europa", "Europa League", "Europa", 73, "INT"),
    ("UECL", "uefa.europa.conf", "Conference League", "Europa", 10216, "INT"),
    ("LIB", "conmebol.libertadores", "Libertadores", "América do Sul", 45, "INT"),
    ("SUL", "conmebol.sudamericana", "Sul-Americana", "América do Sul", 299, "INT"),
    # beta 6: competições novas (ao vivo pela 5DollarFootballAPI; pré-jogo pela ESPN + FotMob, com o que tiver)
    ("UNL", "uefa.nations", "Nations League", "Europa", 9806, "INT"),
    ("SPL", "ksa.1", "Saudi Pro League", "Arábia Saudita", 536, "KSA"),
    ("BEL", "bel.1", "Pro League", "Bélgica", 40, "BEL"),
    ("SPR", "sco.1", "Premiership", "Escócia", 64, "SCO"),
    ("J1", "jpn.1", "J1 League", "Japão", 223, "JPN"),
    ("NOR", "nor.1", "Eliteserien", "Noruega", 59, "NOR"),
    ("SWE", "swe.1", "Allsvenskan", "Suécia", 67, "SWE"),
    ("DEN", "den.1", "Superliga", "Dinamarca", 46, "DEN"),
    ("ECU", "ecu.1", "LigaPro", "Equador", 246, "ECU"),
]
COPAS = {"CL", "UEL", "UECL", "LIB", "SUL", "UNL"}

ESPN = os.environ.get("ESPN_BASE", "https://site.api.espn.com/apis/site/v2/sports/soccer/")
ESPN_V2 = os.environ.get("ESPN_V2_BASE", "https://site.api.espn.com/apis/v2/sports/soccer/")
FOTMOB = os.environ.get("FOTMOB_BASE", "https://www.fotmob.com/api/data/")
MAX_SUMARIOS = int(os.environ.get("B5_MAX_SUMARIOS", "600"))   # detalhes de jogo baixados por execução
DIAS_A_FRENTE = 40                                              # jogos futuros que entram nos dados
PARALELO = 6

PASTA = os.path.dirname(os.path.abspath(__file__))
ARQ_SAIDA = os.path.join(PASTA, "dados5.js")
ARQ_CACHE = os.path.join(PASTA, "cache5.json")
ARQ_FD = os.path.join(PASTA, "dados.js")   # dados da football-data (só para reaproveitar as odds)

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def agora_utc():
    fixo = os.environ.get("B5_AGORA")
    return datetime.fromisoformat(fixo.replace("Z", "+00:00")) if fixo else datetime.now(timezone.utc)


def iso_para_dt(iso):
    iso = str(iso).replace("Z", "+00:00")
    if re.match(r".*T\d\d:\d\d\+", iso):          # "2026-10-02T23:00+00:00" (ESPN, sem segundos)
        iso = iso.replace("+", ":00+", 1)
    return datetime.fromisoformat(iso)


def iso_curto(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------- rede
_n_chamadas = [0]


def buscar(url, tentativas=3, timeout=30):
    """GET que devolve o JSON ou None (nunca derruba o atualizador)."""
    for t in range(tentativas):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0 (compatible; ScanBall/5.0)",
                "Accept": "application/json",
            })
            with urllib.request.urlopen(req, timeout=timeout) as r:
                _n_chamadas[0] += 1
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code in (400, 403, 404):
                return None
            if e.code == 429:
                time.sleep(15 * (t + 1))
                continue
        except Exception:
            pass
        time.sleep(2 * (t + 1))
    return None


# ---------------------------------------------------------------- nomes parecidos (casamento de times)
GENERICOS = {"fc", "afc", "cf", "sc", "ec", "ac", "as", "ss", "club", "clube", "de", "da", "do", "del",
             "futebol", "football", "calcio", "cd", "ud", "fk", "sv", "sad", "the", "and", "esporte", "cf", "cr", "ca"}


def tokens(nome):
    nome = unicodedata.normalize("NFD", nome or "").encode("ascii", "ignore").decode().lower()
    return {t for t in re.split(r"[^a-z0-9]+", nome) if len(t) >= 2 and t not in GENERICOS}


def parecido(a, b):
    if not a or not b:
        return 0.0
    hits = sum(1 for x in a if any(x == y or (min(len(x), len(y)) >= 4 and (x.startswith(y) or y.startswith(x))) for y in b))
    return hits / min(len(a), len(b))


# ---------------------------------------------------------------- leitura dos lances
def minuto(disp):
    """"45'+2'" -> (45, 1º tempo); "90'+3'" -> 90; "67'" -> 67. Devolve (minuto, tempo) ou (None, None)."""
    m = re.match(r"\s*(\d+)'?\s*(?:\+\s*(\d+))?", str(disp or ""))
    if not m:
        return None, None
    base = int(m.group(1))
    tempo = 1 if base <= 45 else 2 if base <= 90 else 3
    return base, tempo


def flags_do_texto(texto, tipo_txt=""):
    """Tipo do gol: c cabeça · f falta direta · p pênalti · o contra · e após escanteio · b bola parada ·
    k contra-ataque · x de fora da área · r após cruzamento."""
    t = (texto or "").lower()
    tt = (tipo_txt or "").lower()
    f = ""
    if "own goal" in t or "own-goal" in tt or "own goal" in tt:
        return "o"
    if "penalty" in tt or "converts the penalty" in t:
        f += "p"
    if "header" in t or "header" in tt:
        f += "c"
    if "free-kick" in tt or "free kick" in tt or "direct free kick" in t:
        f += "f"
    if "following a corner" in t:
        f += "e"
    elif "set piece" in t:
        f += "b"
    if "fast break" in t:
        f += "k"
    if "outside the box" in t or "from long range" in t:
        f += "x"
    if "with a cross" in t:
        f += "r"
    return "".join(sorted(set(f), key=f.index))


def gols_do_placar(comp, casa_id):
    """Gols a partir do placar da ESPN (minuto, lado, tipos básicos), sem consulta extra."""
    gl = []
    for d in comp.get("details") or []:
        if not d.get("scoringPlay") or d.get("shootout"):
            continue
        base, _ = minuto((d.get("clock") or {}).get("displayValue"))
        if base is None:
            continue
        lado = "h" if str((d.get("team") or {}).get("id")) == str(casa_id) else "a"
        tipo = ((d.get("type") or {}).get("text") or "")
        fl = "o" if d.get("ownGoal") else ("p" if d.get("penaltyKick") else "") + flags_do_texto("", tipo).replace("p", "")
        gl.append([base, lado, fl, bool(d.get("ownGoal"))])
    return gl


def conferir_lados(gl, fh, fa):
    """O lado do gol contra varia entre fontes: confere com o placar e, se precisar, inverte os gols contra."""
    for inverter in (False, True):
        h = a = 0
        saida = []
        for g in gl:
            lado = g[1]
            if inverter and g[3]:
                lado = "a" if lado == "h" else "h"
            if lado == "h":
                h += 1
            else:
                a += 1
            saida.append([g[0], lado, g[2]])
        if h == fh and a == fa:
            return saida
    return None


# ---------------------------------------------------------------- ESPN: partidas
def mapear_status(st):
    tp = (st or {}).get("type") or {}
    nome, estado = tp.get("name") or "", tp.get("state")
    if "POSTPONED" in nome:
        return "POSTPONED"
    if "CANCEL" in nome:
        return "CANCELLED"
    if "SUSPENDED" in nome or "ABANDON" in nome:
        return "SUSPENDED"
    if estado == "in":
        return "PAUSED" if "HALFTIME" in nome else "IN_PLAY"
    if estado == "post" and tp.get("completed"):
        return "FINISHED"
    return "TIMED"


def ler_evento(ev, times):
    comps = ev.get("competitions") or [{}]
    c = comps[0]
    cs = c.get("competitors") or []
    casa = next((x for x in cs if x.get("homeAway") == "home"), None)
    fora = next((x for x in cs if x.get("homeAway") == "away"), None)
    if not casa or not fora:
        return None
    for x in (casa, fora):
        t = x.get("team") or {}
        tid = str(t.get("id"))
        atual = times.get(tid, {})
        times[tid] = {
            "n": t.get("displayName") or atual.get("n") or "?",
            "c": t.get("shortDisplayName") or atual.get("c") or t.get("displayName") or "?",
            "t": t.get("abbreviation") or atual.get("t") or "",
            "e": t.get("logo") or atual.get("e") or "",
        }
        if x.get("form"):
            times[tid]["_forma"] = x.get("form")
    st = ev.get("status") or c.get("status") or {}
    s = mapear_status(st)
    nome_st = ((st.get("type") or {}).get("name")) or ""
    p = {
        "i": str(ev.get("id")),
        "d": iso_curto(iso_para_dt(ev.get("date") or c.get("date"))),
        "s": s,
        "h": str((casa.get("team") or {}).get("id")),
        "a": str((fora.get("team") or {}).get("id")),
        "fh": None, "fa": None, "hh": None, "ha": None,
    }
    notas = [n.get("headline") for n in (c.get("notes") or []) if n.get("headline")]
    if notas:
        p["fn"] = notas[0]
    if s in ("FINISHED", "IN_PLAY", "PAUSED"):
        try:
            p["fh"], p["fa"] = int(casa.get("score")), int(fora.get("score"))
        except (TypeError, ValueError):
            pass
    if "AET" in nome_st or "EXTRA" in nome_st:
        p["du"] = "EXTRA_TIME"
    if "PEN" in nome_st:
        p["du"] = "PENALTY_SHOOTOUT"
    if s == "FINISHED" and p["fh"] is not None:
        gl = conferir_lados(gols_do_placar(c, p["h"]), p["fh"], p["fa"])
        if gl is not None:
            if p.get("du"):
                # prorrogação: as estatísticas usam só o tempo normal (como a football-data)
                gl = [g for g in gl if g[0] <= 90]
                p["fh"] = sum(1 for g in gl if g[1] == "h")
                p["fa"] = sum(1 for g in gl if g[1] == "a")
            p["gl"] = gl
            p["hh"] = sum(1 for g in gl if g[1] == "h" and g[0] <= 45)
            p["ha"] = sum(1 for g in gl if g[1] == "a" and g[0] <= 45)
        if p["fh"] is not None and p["fa"] is not None:
            p["w"] = "HOME_TEAM" if p["fh"] > p["fa"] else "AWAY_TEAM" if p["fa"] > p["fh"] else "DRAW"
    return p


def meses_entre(inicio, fim):
    y, m = inicio.year, inicio.month
    while (y, m) <= (fim.year, fim.month):
        yield f"{y}{m:02d}"
        m += 1
        if m > 12:
            y, m = y + 1, 1


def baixar_partidas(code, lg, times, agora):
    """Partidas da temporada atual (do início da temporada até ~40 dias à frente)."""
    atual = buscar(f"{ESPN}{lg}/scoreboard?dates={agora:%Y%m}&limit=200")
    if not atual:
        return None, None
    liga = (atual.get("leagues") or [{}])[0]
    temporada = liga.get("season") or {}
    try:
        inicio = iso_para_dt(temporada["startDate"])
    except Exception:
        inicio = agora - timedelta(days=330)
    fim = agora + timedelta(days=DIAS_A_FRENTE)
    try:
        fim = min(fim, iso_para_dt(temporada["endDate"]) + timedelta(days=2))
    except Exception:
        pass
    if inicio > agora:          # temporada nova ainda não começou: mostra a anterior até lá
        inicio = agora - timedelta(days=330)
    respostas = {f"{agora:%Y%m}": atual}
    faltam = [m for m in meses_entre(inicio, fim) if m not in respostas]
    with ThreadPoolExecutor(PARALELO) as ex:
        for m, r in zip(faltam, ex.map(lambda mm: buscar(f"{ESPN}{lg}/scoreboard?dates={mm}&limit=200"), faltam)):
            if r:
                respostas[m] = r
    vistos, partidas, outra_temporada = set(), [], []
    tipo_temp = (temporada.get("type") or {}).get("type") if isinstance(temporada.get("type"), dict) else None
    for m in sorted(respostas):
        for ev in respostas[m].get("events") or []:
            if ev.get("id") in vistos:
                continue
            # mesma temporada (evita misturar com a anterior quando o mês tem as duas)
            se = ev.get("season") or {}
            if temporada.get("year") and se.get("year") and se.get("year") != temporada.get("year"):
                outra_temporada.append(ev)
                continue
            vistos.add(ev.get("id"))
            try:
                p = ler_evento(ev, times)
            except Exception as e:
                print(f"   {code}: jogo {ev.get('id')} ignorado ({e})")
                continue
            if p:
                partidas.append(p)
    if not partidas and outra_temporada:
        # virada de temporada (a nova ainda sem jogos): usa os jogos da que está terminando
        for ev in outra_temporada:
            if ev.get("id") in vistos:
                continue
            vistos.add(ev.get("id"))
            try:
                p = ler_evento(ev, times)
            except Exception:
                p = None
            if p:
                partidas.append(p)
    partidas.sort(key=lambda p: p["d"])
    info = {
        "nome_espn": liga.get("name"), "id_espn": liga.get("id"),
        "emblema": ((liga.get("logos") or [{}])[0] or {}).get("href", ""),
        "temporada": {"nome": temporada.get("displayName"), "ano": temporada.get("year"),
                      "inicio": temporada.get("startDate"), "fim": temporada.get("endDate"), "tipo": tipo_temp},
    }
    return partidas, info


# ---------------------------------------------------------------- ESPN: detalhe de cada jogo (estatísticas e tipos de gol)
EST = ["wonCorners", "yellowCards", "redCards", "totalShots", "shotsOnTarget", "possessionPct", "foulsCommitted"]


def resumir_detalhe(r, p):
    """Do detalhe do jogo: estatísticas [esc, amarelos, vermelhos, chutes, no gol, posse, faltas] (casa, fora)
    e os gols com minuto, lado e tipo (pela narração)."""
    hdr = ((r.get("header") or {}).get("competitions") or [{}])[0]
    lado = {}
    for c in hdr.get("competitors") or []:
        t = c.get("team") or {}
        lado[str(t.get("id"))] = "h" if c.get("homeAway") == "home" else "a"
        lado[t.get("displayName")] = lado[str(t.get("id"))]
    es = None
    for t in ((r.get("boxscore") or {}).get("teams") or []):
        i = 0 if (t.get("homeAway") == "home" or lado.get(str((t.get("team") or {}).get("id"))) == "h") else 1
        vals = {s.get("name"): s.get("displayValue") for s in t.get("statistics") or []}
        if not vals:
            continue
        es = es or [None] * (len(EST) * 2)
        for k, nome in enumerate(EST):
            try:
                v = float(str(vals.get(nome)).replace("%", ""))
                es[k * 2 + i] = round(v, 1) if nome == "possessionPct" else int(v)
            except (TypeError, ValueError):
                pass
    # gols pela narração (texto diz cabeça, escanteio, contra-ataque...)
    gl = []
    for c in r.get("commentary") or []:
        pl = c.get("play") or {}
        tp = ((pl.get("type") or {}).get("type") or "")
        if not (re.match(r"^goal(---|$)", tp) or tp in ("own-goal", "penalty---scored")):
            continue
        if "shootout" in tp:
            continue
        base, _ = minuto((c.get("time") or {}).get("displayValue") or (pl.get("clock") or {}).get("displayValue"))
        lt = lado.get(str((pl.get("team") or {}).get("id"))) or lado.get((pl.get("team") or {}).get("displayName"))
        if base is None or not lt:
            continue
        fl = flags_do_texto(c.get("text"), tp.replace("---", " ").replace("-", " "))
        if tp == "own-goal":
            fl = "o"
        elif tp == "penalty---scored" and "p" not in fl:
            fl = "p" + fl
        gl.append([base, lt, fl, tp == "own-goal"])
    return es, gl


def aplicar_detalhe(p, det):
    """Usa o detalhe salvo no cache: estatísticas e gols com tipo (só o tempo normal entra nas contas)."""
    if not det:
        return
    if det.get("es"):
        p["es"] = det["es"]
    if p.get("fh") is None or p.get("fa") is None:
        return
    base = [g if len(g) > 3 else g + [False] for g in det.get("gl") or []]
    if p.get("du"):
        base = [g for g in base if g[0] <= 90]
    conferido = conferir_lados(base, p["fh"], p["fa"])
    if conferido is not None:
        p["gl"] = conferido


def baixar_detalhes(todas, cache, agora):
    """Busca o detalhe dos jogos encerrados que ainda não estão no cache (os mais recentes primeiro)."""
    faltam = [(code, lg, p) for code, lg, p in todas
              if p["s"] == "FINISHED" and p["i"] not in cache and iso_para_dt(p["d"]) < agora - timedelta(hours=2)]
    faltam.sort(key=lambda x: x[2]["d"], reverse=True)
    faltam = faltam[:MAX_SUMARIOS]
    if not faltam:
        return 0

    def um(item):
        code, lg, p = item
        r = buscar(f"{ESPN}{lg}/summary?event={p['i']}")
        if not r:
            return p["i"], None
        try:
            es, gl = resumir_detalhe(r, p)
        except Exception:
            return p["i"], None
        return p["i"], {"es": es, "gl": [g[:3] + [bool(g[3])] for g in gl]}

    ok = 0
    with ThreadPoolExecutor(PARALELO) as ex:
        for pid, det in ex.map(um, faltam):
            if det is not None:
                cache[pid] = det
                ok += 1
    return ok


# ---------------------------------------------------------------- ESPN: classificação e artilharia
def baixar_classificacao(lg, times, copa):
    r = buscar(f"{ESPN_V2}{lg}/standings")
    if not r:
        return []
    grupos = r.get("children") or ([r] if r.get("standings") else [])
    tabelas = []
    for g in grupos:
        entradas = ((g.get("standings") or {}).get("entries") or [])
        linhas = []
        for e in entradas:
            t = e.get("team") or {}
            tid = str(t.get("id"))
            if tid not in times:
                times[tid] = {"n": t.get("displayName") or "?", "c": t.get("shortDisplayName") or t.get("displayName") or "?",
                              "t": t.get("abbreviation") or "", "e": ((t.get("logos") or [{}])[0] or {}).get("href", "")}
            v = {s.get("name"): s.get("value") for s in e.get("stats") or []}
            num = lambda k: int(v[k]) if v.get(k) is not None else None
            linhas.append({"p": num("rank"), "t": tid, "j": num("gamesPlayed"), "v": num("wins"), "e": num("ties"),
                           "d": num("losses"), "gp": num("pointsFor"), "gc": num("pointsAgainst"),
                           "sg": num("pointDifferential"), "pts": num("points")})
        linhas.sort(key=lambda x: (x["p"] is None, x["p"] or 0))
        if linhas:
            nome = g.get("name") or ""
            tabelas.append({"fase": "LEAGUE_STAGE" if copa else "REGULAR_SEASON", "tipo": "TOTAL",
                            "grupo": nome if len(grupos) > 1 else None, "tabela": linhas})
    return tabelas


def baixar_artilharia(lg, times):
    r = buscar(f"{ESPN}{lg}/statistics")
    if not r:
        return []
    cats = {c.get("name"): c.get("leaders") or [] for c in r.get("stats") or []}
    ass = {}
    for l in cats.get("assistsLeaders", []):
        a = l.get("athlete") or {}
        ass[str(a.get("id"))] = l.get("value")
    art = []
    for l in cats.get("goalsLeaders", [])[:40]:
        a = l.get("athlete") or {}
        t = a.get("team") or {}
        jogos = re.search(r"Matches:\s*(\d+)", l.get("displayValue") or "")
        art.append({"nome": a.get("displayName"), "nac": None, "pos": (a.get("position") or {}).get("abbreviation") if isinstance(a.get("position"), dict) else None,
                    "t": str(t.get("id")) if t.get("id") else None, "jogos": int(jogos.group(1)) if jogos else None,
                    "gols": int(l.get("value") or 0), "ass": int(ass[str(a.get("id"))]) if ass.get(str(a.get("id"))) is not None else None, "pen": None})
    return art


# ---------------------------------------------------------------- FotMob: xG da temporada e rodada
def casar_times_fotmob(nomes_fm, ids_espn, times):
    """{id FotMob: id ESPN} pelo nome dos times (cada time da ESPN só pode ser usado uma vez)."""
    pares = []
    for fid, nomes in nomes_fm.items():
        tf = set()
        for n in nomes:
            tf |= tokens(n)
        for eid in ids_espn:
            t = times.get(eid, {})
            te = tokens(t.get("n")) | tokens(t.get("c"))
            nota = parecido(tf, te)
            if nota >= 0.5:
                pares.append((nota, fid, eid))
    pares.sort(reverse=True)
    usado_f, usado_e, mapa = set(), set(), {}
    for nota, fid, eid in pares:
        if fid in usado_f or eid in usado_e:
            continue
        mapa[fid] = eid
        usado_f.add(fid)
        usado_e.add(eid)
    return mapa


def baixar_fotmob(fm_id, pais, partidas, times):
    """xG da temporada por time e número da rodada de cada jogo. Se não casar bem, não usa (melhor sem que errado)."""
    r = buscar(f"{FOTMOB}leagues?id={fm_id}")
    if not r:
        return None
    det = r.get("details") or {}
    if pais and det.get("country") and det.get("country") != pais:
        print(f"   FotMob {fm_id}: país {det.get('country')} diferente do esperado ({pais}); xG ignorado")
        return None
    ids_espn = sorted({p["h"] for p in partidas} | {p["a"] for p in partidas})
    nomes_fm, xg_linhas = {}, []
    for tb in r.get("table") or []:
        dados = tb.get("data") or {}
        blocos = [dados] + (dados.get("tables") or [])
        for b in blocos:
            tab = (b or {}).get("table") or {}
            for linha in tab.get("all") or []:
                nomes_fm.setdefault(str(linha.get("id")), set()).update({linha.get("name"), linha.get("shortName")})
            xg_linhas += tab.get("xg") or []
    fixtures = ((r.get("fixtures") or {}).get("allMatches")) or []
    for f in fixtures:
        for lado in ("home", "away"):
            t = f.get(lado) or {}
            if t.get("id"):
                nomes_fm.setdefault(str(t.get("id")), set()).update({t.get("name"), t.get("shortName")})
    mapa = casar_times_fotmob(nomes_fm, ids_espn, times)
    if ids_espn and len(mapa) < 0.6 * min(len(ids_espn), len(nomes_fm) or 1):
        print(f"   FotMob {fm_id}: só {len(mapa)} de {len(ids_espn)} times casaram; xG ignorado")
        return None
    xg = {}
    for l in xg_linhas:
        eid = mapa.get(str(l.get("teamId") or l.get("id")))
        if not eid or l.get("xg") is None:
            continue
        xg[eid] = [round(float(l.get("xg") or 0), 2), round(float(l.get("xgConceded") or 0), 2),
                   int(l.get("played") or 0), round(float(l.get("xPoints") or 0), 1)]
    # rodada: casa o jogo da FotMob com o da ESPN (mesmos times, até 36 h de diferença)
    por_par = {}
    for p in partidas:
        por_par.setdefault((p["h"], p["a"]), []).append(p)
    rodadas = 0
    for f in fixtures:
        h, a = mapa.get(str((f.get("home") or {}).get("id"))), mapa.get(str((f.get("away") or {}).get("id")))
        rd = f.get("round")
        if not h or not a or rd is None:
            continue
        try:
            quando = iso_para_dt(((f.get("status") or {}).get("utcTime")))
        except Exception:
            continue
        for p in por_par.get((h, a), []):
            if abs((iso_para_dt(p["d"]) - quando).total_seconds()) <= 36 * 3600:
                if str(rd).isdigit():
                    p["r"] = int(rd)
                    rodadas += 1
                break
    for fid, eid in mapa.items():
        times.setdefault(eid, {})["fm"] = fid
    return {"xg": xg, "casados": len(mapa), "rodadas": rodadas}


# ---------------------------------------------------------------- odds: reaproveita as da football-data (sem gastar créditos)
def odds_da_reserva(competicoes, times):
    if not os.path.exists(ARQ_FD):
        return
    try:
        txt = open(ARQ_FD, encoding="utf-8").read()
        fd = json.loads(txt[txt.index("{"):txt.rindex("}") + 1])
    except Exception:
        return
    tfd = fd.get("times") or {}
    for code, comp in competicoes.items():
        cfd = (fd.get("competicoes") or {}).get(code) or {}
        odds = cfd.get("odds") or {}
        if not odds:
            continue
        por_id = {str(p.get("i")): p for p in cfd.get("partidas") or []}
        novas = {}
        for pid, o in odds.items():
            pf = por_id.get(str(pid))
            if not pf or not pf.get("d"):
                continue
            th = tokens((tfd.get(str(pf.get("h"))) or {}).get("n")) | tokens((tfd.get(str(pf.get("h"))) or {}).get("c"))
            ta = tokens((tfd.get(str(pf.get("a"))) or {}).get("n")) | tokens((tfd.get(str(pf.get("a"))) or {}).get("c"))
            quando = iso_para_dt(pf["d"])
            melhor, nota_m = None, 0
            for p in comp["partidas"]:
                dif = abs((iso_para_dt(p["d"]) - quando).total_seconds())
                if dif > 3 * 3600:
                    continue
                sh = parecido(th, tokens(times.get(p["h"], {}).get("n")) | tokens(times.get(p["h"], {}).get("c")) | tokens(times.get(p["h"], {}).get("t")))
                sa = parecido(ta, tokens(times.get(p["a"], {}).get("n")) | tokens(times.get(p["a"], {}).get("c")) | tokens(times.get(p["a"], {}).get("t")))
                if sh == 0 or sa == 0:
                    continue
                nota = sh + sa - dif / 86400
                if nota > nota_m:
                    melhor, nota_m = p, nota
            if melhor:
                novas[melhor["i"]] = o
        if novas:
            comp["odds"] = novas
            comp["odds_em"] = cfd.get("odds_em")


# ---------------------------------------------------------------- arquivos
def ler_js(caminho):
    if not os.path.exists(caminho):
        return None
    try:
        txt = open(caminho, encoding="utf-8").read()
        return json.loads(txt[txt.index("{"):txt.rindex("}") + 1])
    except Exception:
        return None


def ler_cache():
    try:
        with open(ARQ_CACHE, encoding="utf-8") as f:
            c = json.load(f)
        return c.get("jogos") or {}
    except Exception:
        return {}


def main():
    pedidas = [a.upper() for a in sys.argv[1:]] or [c[0] for c in COMPETICOES]
    agora = agora_utc()
    anterior = ler_js(ARQ_SAIDA) or {}
    cache = ler_cache()
    times = dict(anterior.get("times") or {})
    competicoes = dict(anterior.get("competicoes") or {})
    falhas, atualizadas = [], 0
    print(f"Beta 5: {len(pedidas)} competição(ões) · ESPN + FotMob · {len(cache)} jogos já no cache\n")
    todas = []
    for code, lg, nome, pais, fm_id, fm_pais in COMPETICOES:
        if code not in pedidas:
            continue
        print(f"[{code}] {nome} ({lg})")
        partidas, info = baixar_partidas(code, lg, times, agora)
        if not partidas:
            falhas.append(code)
            print("   ESPN não respondeu: mantidos os dados anteriores" if code in competicoes else "   ESPN não respondeu")
            continue
        comp = {"code": code, "nome": nome, "pais": pais, "espn": lg, "copa": code in COPAS,
                "emblema": info["emblema"], "temporada": info["temporada"], "partidas": partidas,
                "atualizado_em": iso_curto(agora)}
        comp["classificacao"] = baixar_classificacao(lg, times, code in COPAS)
        comp["artilharia"] = baixar_artilharia(lg, times)
        fm = baixar_fotmob(fm_id, fm_pais, partidas, times) if fm_id else None
        if fm:
            comp["xg"] = fm["xg"]
            print(f"   FotMob: {fm['casados']} times casados · xG de {len(fm['xg'])} · rodada em {fm['rodadas']} jogos")
        elif (competicoes.get(code) or {}).get("xg"):
            comp["xg"] = competicoes[code]["xg"]            # mantém o xG anterior se a FotMob falhar
        fin = sum(1 for p in partidas if p["s"] == "FINISHED")
        print(f"   {len(partidas)} jogos ({fin} encerrados) · tabela: {sum(len(t['tabela']) for t in comp['classificacao'])} linhas · artilharia: {len(comp['artilharia'])}")
        competicoes[code] = comp
        atualizadas += 1
        todas += [(code, lg, p) for p in partidas]

    novos = baixar_detalhes(todas, cache, agora)
    com_det = 0
    for code, lg, p in todas:
        if p["i"] in cache:
            aplicar_detalhe(p, cache[p["i"]])
            com_det += 1 if p.get("es") else 0
    print(f"\nDetalhe dos jogos: {novos} baixados agora · {com_det} jogos com estatísticas")
    # competição com pré-jogo incompleto (a ESPN não traz tudo): o site mostra um aviso nela
    for code in {c for c, _, _ in todas}:
        comp = competicoes[code]
        fin = [p for p in comp["partidas"] if p["s"] == "FINISHED"]
        baixados = [p for p in fin if p["i"] in cache]
        falta = []
        if len(baixados) >= 10 and sum(1 for p in baixados if p.get("es")) / len(baixados) < 0.6:
            falta.append("estatísticas dos jogos")
        if not comp.get("artilharia") and code not in COPAS:
            falta.append("artilharia")
        if falta:
            comp["incompleto"] = falta
            print(f"   [{code}] pré-jogo incompleto: falta {', '.join(falta)}")
        else:
            comp.pop("incompleto", None)
    odds_da_reserva(competicoes, times)

    # forma recente vem do placar da ESPN (não precisa ir para o site)
    for t in times.values():
        t.pop("_forma", None)
    ordem = [c[0] for c in COMPETICOES if c[0] in competicoes]
    saida = {
        "versao": 5, "fonte": "espn", "gerado_em": iso_curto(agora),
        "ok_em": iso_curto(agora) if atualizadas else anterior.get("ok_em"),
        "falhas": falhas, "ordem": ordem, "times": times, "competicoes": competicoes,
    }
    with open(ARQ_SAIDA, "w", encoding="utf-8") as f:
        f.write("window.DADOS5 = ")
        json.dump(saida, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    with open(ARQ_CACHE, "w", encoding="utf-8") as f:
        json.dump({"v": 1, "gerado_em": iso_curto(agora), "jogos": cache}, f, separators=(",", ":"))
    kb = os.path.getsize(ARQ_SAIDA) / 1024
    print(f"\nPronto: dados5.js ({kb:.0f} KB) · cache5.json ({len(cache)} jogos) · {_n_chamadas[0]} consultas")
    if falhas:
        print("Sem resposta da ESPN (ficaram com os dados anteriores, se havia): " + ", ".join(falhas))
    if not atualizadas:
        sys.exit(1)


if __name__ == "__main__":
    main()
