#!/usr/bin/env python3
"""ScanBall · números extras de pré-jogo pela 5DollarFootballAPI (ataques, ataques perigosos, 1º tempo).

Roda no GitHub Actions depois do atualizar_b5.py. A chave fica no cofre de segredos do GitHub
(FIVE_DOLLAR_KEY) e nunca vai para o site: o site só recebe o resultado pronto (extra5d.js).

Cuidados com o limite (plano Pro: 10 pedidos por minuto, por conta):
- espera ~6,5 s entre um pedido e outro e faz no máximo MAX_PEDIDOS por execução;
- não roda enquanto houver jogo ao vivo (para não disputar o limite com o ao vivo do site);
- guarda tudo no cache5d.json: a cada execução só busca os jogos novos.

Saída: extra5d.js  ->  window.EXTRA5D = { gerado_em, campos, comps: { code: { id_time: { g, c, f } } }, odds: { code: { id_jogo: {...} } } }
cada g/c/f é uma lista com as somas na ordem de CAMPOS (g = geral, c = em casa, f = fora).

Odds (plano Pro: bet365): 1X2 de todos os jogos dos próximos 7 dias numa lista por liga (a cada 3 h), e para os jogos
das próximas ~26 h também over/under 2,5 e ambas marcam (um pedido por jogo, poucos por execução). Com jogo ao vivo,
só o mínimo e devagar, para não disputar o limite com o ao vivo do site.
"""
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

BASE = os.environ.get("D5_BASE", "https://api.5dollarfootballapi.com/v1/")
CHAVE = os.environ.get("FIVE_DOLLAR_KEY", "").strip()
MAX_PEDIDOS = int(os.environ.get("D5_MAX_PEDIDOS", "60"))
MAX_ODDS_JOGO = int(os.environ.get("D5_MAX_ODDS_JOGO", "12"))   # pedidos de odds completas (over/ambas) por execução
ESPERA = float(os.environ.get("D5_ESPERA", "6.5"))

PASTA = os.path.dirname(os.path.abspath(__file__))
ARQ_DADOS5 = os.path.join(PASTA, "dados5.js")
ARQ_CACHE = os.path.join(PASTA, "cache5d.json")
ARQ_SAIDA = os.path.join(PASTA, "extra5d.js")

# competição do site -> (países aceitos, palavras que o nome da liga deve ter, palavras proibidas extras)
LIGAS = {
    "BSA": (["brazil"], ["serie a"], []),
    "BSB": (["brazil"], ["serie b"], []),
    "PL": (["england"], ["premier league"], []),
    "ELC": (["england"], ["championship"], []),
    "PD": (["spain"], ["la liga", "laliga", "primera division"], []),
    "SA": (["italy"], ["serie a"], []),
    "BL1": (["germany"], ["bundesliga"], ["2.", "2 "]),
    "FL1": (["france"], ["ligue 1"], []),
    "PPL": (["portugal"], ["primeira", "liga portugal"], ["2"]),
    "DED": (["netherlands", "holland"], ["eredivisie"], []),
    "LMX": (["mexico"], ["liga mx"], ["expansion"]),
    "MLS": (["usa", "united states"], ["mls", "major league soccer"], ["next pro"]),
    "ARG": (["argentina"], ["liga profesional", "primera division", "superliga"], ["nacional", "b "]),
    "CHI": (["chile"], ["primera division", "primera"], ["b "]),
    "COL": (["colombia"], ["primera a", "liga betplay", "primera"], ["b "]),
    "CL": ([], ["champions league"], ["afc", "caf", "concacaf", "ofc"]),
    "UEL": ([], ["europa league"], []),
    "UECL": ([], ["conference league"], []),
    "LIB": ([], ["libertadores"], []),
    "SUL": ([], ["sudamericana", "sul-americana"], []),
    "UNL": ([], ["nations league"], ["concacaf", "women"]),
    "SPL": (["saudi"], ["pro league", "professional league", "premier league"], []),
    "BEL": (["belgium"], ["pro league", "first division a", "jupiler", "first division"], ["challenger", "division b"]),
    "SPR": (["scotland"], ["premiership"], []),
    "J1": (["japan"], ["j1", "j. league", "j-league", "j league"], ["j2", "j3"]),
    "NOR": (["norway"], ["eliteserien"], []),
    "SWE": (["sweden"], ["allsvenskan"], []),
    "DEN": (["denmark"], ["superliga", "superligaen"], []),
    "ECU": (["ecuador"], ["ligapro", "liga pro", "serie a"], ["serie b"]),
}
PROIBIDAS = ["women", "woman", "femin", "u17", "u18", "u19", "u20", "u21", "u23", "youth", "reserve", "amateur", "cup", "copa", "qualif", "play-off", "playoff"]

CAMPOS = ["n", "at", "atc", "da", "dac", "ch", "chc", "cf", "cfc", "pos", "at1", "at1c", "da1", "da1c", "ch1", "ch1c"]

_pedidos = [0]
_ultimo = [0.0]


def agora_utc():
    return datetime.now(timezone.utc)


def pedir(caminho, params=None):
    """GET na API respeitando o limite. Devolve o JSON (dict) ou None."""
    if _pedidos[0] >= MAX_PEDIDOS:
        return None
    url = BASE + caminho + ("?" + urllib.parse.urlencode(params) if params else "")
    for tentativa in range(3):
        falta = ESPERA - (time.time() - _ultimo[0])
        if falta > 0:
            time.sleep(falta)
        _ultimo[0] = time.time()
        _pedidos[0] += 1
        try:
            req = urllib.request.Request(url, headers={"Authorization": "Bearer " + CHAVE, "Accept": "application/json",
                                                       "User-Agent": "ScanBall/5 (atualizador)"})
            with urllib.request.urlopen(req, timeout=40) as r:
                j = json.loads(r.read().decode("utf-8"))
                return j if j.get("success") else None
        except urllib.error.HTTPError as e:
            if e.code == 429:
                espera = int(e.headers.get("Retry-After") or 30)
                print(f"   limite atingido: esperando {espera} s")
                time.sleep(min(espera, 90))
                continue
            if e.code in (401, 403):
                print(f"   chave recusada (erro {e.code}): confira o segredo FIVE_DOLLAR_KEY")
                _pedidos[0] = MAX_PEDIDOS
                return None
            print(f"   erro {e.code} em {caminho}")
            return None
        except Exception as e:
            print(f"   falha em {caminho}: {e}")
            time.sleep(3)
        if _pedidos[0] >= MAX_PEDIDOS:
            break
    return None


# ---------------------------------------------------------------- nomes parecidos (igual ao atualizar_b5.py)
GENERICOS = {"fc", "afc", "cf", "sc", "ec", "ac", "as", "ss", "club", "clube", "de", "da", "do", "del",
             "futebol", "football", "calcio", "cd", "ud", "fk", "sv", "sad", "the", "and", "esporte", "cr", "ca"}


def tokens(nome):
    nome = unicodedata.normalize("NFD", nome or "").encode("ascii", "ignore").decode().lower()
    return {t for t in re.split(r"[^a-z0-9]+", nome) if len(t) >= 2 and t not in GENERICOS}


def parecido(a, b):
    if not a or not b:
        return 0.0
    hits = sum(1 for x in a if any(x == y or (min(len(x), len(y)) >= 4 and (x.startswith(y) or y.startswith(x))) for y in b))
    return hits / min(len(a), len(b))


def sem_acento(s):
    return unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().lower()


# ---------------------------------------------------------------- arquivos
def ler_js(caminho):
    try:
        with open(caminho, encoding="utf-8") as f:
            txt = f.read()
        return json.loads(txt[txt.index("{"):txt.rindex("}") + 1])
    except Exception:
        return None


def ler_cache():
    try:
        with open(ARQ_CACHE, encoding="utf-8") as f:
            c = json.load(f)
        if c.get("v") == 1:
            return c
    except Exception:
        pass
    return {"v": 1, "ligas": {}, "todas_ligas": None, "jogos": {}}


# ---------------------------------------------------------------- 1) achar a liga de cada competição
def baixar_ligas(cache):
    if cache.get("todas_ligas"):
        return cache["todas_ligas"]
    todas, pagina = [], 1
    while pagina <= 6:
        r = pedir("leagues", {"per_page": 100, "page": pagina})
        if not r:
            break
        for l in r.get("data") or []:
            todas.append({"id": l.get("id"), "nome": l.get("name") or "", "pais": ((l.get("country") or {}).get("name") or ""),
                          "pop": bool(l.get("is_popular"))})
        if not (r.get("pagination") or {}).get("has_more"):
            break
        pagina += 1
    if todas:
        cache["todas_ligas"] = todas
        print(f"Ligas da 5Dollar: {len(todas)}")
    return todas


def escolher_liga(code, todas):
    paises, palavras, proib = LIGAS[code]
    melhor, nota = None, -1
    for l in todas:
        nome, pais = sem_acento(l["nome"]), sem_acento(l["pais"])
        if paises and not any(p in pais or p in nome for p in paises):
            continue
        if not any(p in nome for p in palavras):
            continue
        if any(x in nome for x in PROIBIDAS + proib):
            continue
        n = (2 if l["pop"] else 0) - len(nome) / 100
        if n > nota:
            melhor, nota = l, n
    return melhor


# ---------------------------------------------------------------- 2) jogos encerrados com estatísticas
def par(x):
    if isinstance(x, dict) and x.get("home") is not None and x.get("away") is not None:
        try:
            return [float(x["home"]), float(x["away"])]
        except (TypeError, ValueError):
            return None
    return None


def guardar_jogo(cache, code, fx):
    st = fx.get("statistics") or fx.get("stats")
    if not isinstance(st, dict):
        return False
    fh = st.get("first_half") or {}
    j = {
        "c": code, "d": fx.get("kickoff_utc"), "ts": fx.get("kickoff_ts"),
        "h": ((fx.get("teams") or {}).get("home") or {}).get("name"),
        "a": ((fx.get("teams") or {}).get("away") or {}).get("name"),
        "at": par(st.get("attacks")), "da": par(st.get("dangerous_attacks")),
        "ch": par(st.get("shots_on_target")), "cf": par(st.get("shots_off_target")), "pos": par(st.get("possession")),
        "at1": par(fh.get("attacks")), "da1": par(fh.get("dangerous_attacks")), "ch1": par(fh.get("shots_on_target")),
    }
    od = odds_1x2(fx.get("odds"))
    if od:
        j["od"] = od
    if not (j["at"] or j["da"]):
        return False
    cache["jogos"][str(fx.get("id"))] = j
    return True


def baixar_jogos(cache, code, liga_id, desde_ts, ate_ts):
    novos, pagina = 0, 1
    while True:
        r = pedir(f"leagues/{liga_id}/fixtures", {"start_time": int(desde_ts), "end_time": int(ate_ts), "order": "asc",
                                                    "include": "stats,odds", "per_page": 50, "page": pagina})
        if not r:
            return novos, False
        for fx in r.get("data") or []:
            if fx.get("status") == "finished" or str(fx.get("status_code") or "").lower() in ("full", "ft", "aet", "pen"):
                if guardar_jogo(cache, code, fx):
                    novos += 1
        if not (r.get("pagination") or {}).get("has_more"):
            return novos, True
        pagina += 1


# ---------------------------------------------------------------- odds (bet365, plano Pro)
def num(x):
    try:
        v = float(x)
        return v if v > 1.0 else None
    except (TypeError, ValueError):
        return None


def odds_1x2(o):
    """{"1x2": {"opening": {...}, "closing": {...}}} -> {"c": [casa, empate, fora], "a": [abertura]} (closing = a atual)"""
    m = (o or {}).get("1x2") or {}
    def tri(x):
        x = x or {}
        t = [num(x.get("home")), num(x.get("draw")), num(x.get("away"))]
        return t if all(t) else None
    cl, ab = tri(m.get("closing")), tri(m.get("opening"))
    if not (cl or ab):
        return None
    r = {"c": cl or ab}
    if ab:
        r["a"] = ab
    return r


def odds_completas(bk):
    """odds de /fixtures/{id}/odds (uma casa) -> over/under 2,5 e ambas marcam"""
    o = (bk or {}).get("odds") or {}
    r = {}
    for x in o.get("goal_line_fixed") or []:
        if abs(float(x.get("line") or 0) - 2.5) < 0.01:
            c = x.get("closing") or x.get("opening") or {}
            if num(c.get("over")) and num(c.get("under")):
                r["o25"] = [num(c["over"]), num(c["under"])]
    b = (o.get("btts") or {})
    c = b.get("closing") or b.get("opening") or {}
    if num(c.get("yes")) and num(c.get("no")):
        r["btts"] = [num(c["yes"]), num(c["no"])]
    m = odds_1x2(o)
    if m:
        r["od"] = m
    return r


def baixar_odds_lista(cache, code, liga, ate_dias=7):
    """1X2 dos próximos jogos da liga (um pedido por página de 50 jogos)."""
    agora, pagina, n = time.time(), 1, 0
    fut = cache.setdefault("odds_fut", {})
    while True:
        r = pedir(f"leagues/{liga['id']}/fixtures", {"start_time": int(agora - 2 * 3600), "end_time": int(agora + ate_dias * 86400),
                                                     "order": "asc", "include": "odds", "per_page": 50, "page": pagina})
        if not r:
            return n, False
        for fx in r.get("data") or []:
            od = odds_1x2(fx.get("odds"))
            if not od:
                continue
            e = fut.setdefault(str(fx.get("id")), {})
            e.update({"comp": code, "ts": fx.get("kickoff_ts"), "d": fx.get("kickoff_utc"), "od": od,
                      "h": ((fx.get("teams") or {}).get("home") or {}).get("name"),
                      "a": ((fx.get("teams") or {}).get("away") or {}).get("name")})
            n += 1
        if not (r.get("pagination") or {}).get("has_more"):
            return n, True
        pagina += 1


def baixar_odds_completas(cache, limite):
    """over/under 2,5 e ambas marcam dos jogos das próximas ~26 h (os mais próximos primeiro; refaz a cada 3 h)."""
    agora, feitos = time.time(), 0
    fut = cache.get("odds_fut") or {}
    fila = sorted((e.get("ts") or 0, fid) for fid, e in fut.items()
                  if e.get("ts") and agora - 2 * 3600 < e["ts"] < agora + 26 * 3600 and agora - (e.get("em") or 0) > 3 * 3600)
    for _, fid in fila:
        if feitos >= limite or _pedidos[0] >= MAX_PEDIDOS:
            break
        r = pedir(f"fixtures/{fid}/odds")
        feitos += 1
        if not r:
            continue
        bks = ((r.get("data") or {}).get("bookmakers")) or []
        bk = next((b for b in bks if (b.get("slug") or "") == "bet365"), bks[0] if bks else None)
        x = odds_completas(bk)
        fut[fid]["em"] = agora
        fut[fid].update(x)
    return feitos


def montar_odds(comps_site, times_site, cache):
    """liga as odds (jogos futuros e encerrados) aos jogos do site: mesma competição, times parecidos, horário até 3 h de diferença"""
    saida = {}
    fontes = list((cache.get("odds_fut") or {}).values()) + [j for j in cache["jogos"].values() if j.get("od")]
    por_comp = {}
    for e in fontes:
        por_comp.setdefault(e.get("comp") or e.get("c"), []).append(e)
    for code, lista in por_comp.items():
        comp = comps_site.get(code)
        if not comp:
            continue
        nomes = {}
        for p in comp.get("partidas") or []:
            for tid in (p.get("h"), p.get("a")):
                t = times_site.get(str(tid)) or {}
                nomes[str(tid)] = tokens(" ".join(str(t.get(k) or "") for k in ("n", "c", "t")))
        porDia = {}
        for p in comp.get("partidas") or []:
            if p.get("d"):
                porDia.setdefault(p["d"][:10], []).append(p)
        res = {}
        for e in lista:
            d = (e.get("d") or "")[:10]
            if not d:
                continue
            try:
                ts = datetime.fromisoformat(e["d"].replace("Z", "+00:00")).timestamp()
            except Exception:
                continue
            th, ta = tokens(e.get("h")), tokens(e.get("a"))
            melhor, nota = None, 0.0
            for dia in {d, (datetime.fromtimestamp(ts - 86400, timezone.utc)).strftime("%Y-%m-%d"), (datetime.fromtimestamp(ts + 86400, timezone.utc)).strftime("%Y-%m-%d")}:
                for p in porDia.get(dia, []):
                    try:
                        dif = abs(datetime.fromisoformat(p["d"].replace("Z", "+00:00")).timestamp() - ts)
                    except Exception:
                        continue
                    if dif > 3 * 3600:
                        continue
                    sh, sa = parecido(th, nomes.get(str(p.get("h")))), parecido(ta, nomes.get(str(p.get("a"))))
                    if sh >= 0.5 and sa >= 0.5 and sh + sa > nota:
                        melhor, nota = p, sh + sa
            if not melhor:
                continue
            od = e.get("od") or {}
            if not isinstance(od.get("c"), list):
                continue
            o = {"x": [round(v, 2) for v in od["c"]]}
            if od.get("a"):
                o["ab"] = [round(v, 2) for v in od["a"]]
            if e.get("o25"):
                o["o25"] = [round(v, 3) for v in e["o25"]]
            if e.get("btts"):
                o["btts"] = [round(v, 3) for v in e["btts"]]
            res[str(melhor.get("i"))] = o
        if res:
            saida[code] = res
    return saida


# ---------------------------------------------------------------- teste: o que vem nas odds (plano Pro)
def resumir(obj, limite=1800):
    t = json.dumps(obj, ensure_ascii=False)
    return t if len(t) <= limite else t[:limite] + " …(cortado)"


def testar_odds(cache):
    """Só mostra no registro do GitHub o formato das odds (3 pedidos, no máximo 1 vez a cada 12 h). Não muda o site."""
    if time.time() - (cache.get("teste_odds_em") or 0) < 12 * 3600 and not os.environ.get("D5_TESTE_ODDS"):
        return
    cache["teste_odds_em"] = time.time()
    print("\n[odds] TESTE: o que a 5Dollar manda de odds")
    liga = cache["ligas"].get("BSA") or cache["ligas"].get("PL") or next(iter(cache["ligas"].values()), None)
    if not liga:
        print("[odds] nenhuma liga no cache ainda")
        return
    agora = time.time()
    r = pedir(f"leagues/{liga['id']}/fixtures", {"start_time": int(agora), "end_time": int(agora + 7 * 86400), "order": "asc",
                                                 "include": "odds", "per_page": 3, "page": 1})
    jogos = (r or {}).get("data") or []
    print(f"[odds] {liga['nome']}: {len(jogos)} jogos nos próximos 7 dias (lista com include=odds)")
    if jogos:
        fx = jogos[0]
        print(f"[odds] campos do jogo: {sorted(fx.keys())}")
        print(f"[odds] jogo: {(fx.get('teams') or {})} · {fx.get('kickoff_utc')}")
        print(f"[odds] odds na lista: {resumir(fx.get('odds'))}")
        r2 = pedir(f"fixtures/{fx.get('id')}/odds")
        if r2:
            print(f"[odds] /fixtures/{fx.get('id')}/odds -> chaves: {sorted(r2.keys())}")
            print(f"[odds] conteúdo: {resumir(r2.get('data'), 3000)}")
        else:
            print("[odds] /fixtures/{id}/odds não respondeu")
    r3 = pedir("bookmakers")
    print(f"[odds] casas: {resumir((r3 or {}).get('data'), 600)}")


# ---------------------------------------------------------------- 3) somar por time (ids do site)
def somar(comps_site, times_site, cache):
    saida = {}
    por_comp = {}
    for j in cache["jogos"].values():
        por_comp.setdefault(j["c"], []).append(j)
    for code, jogos in por_comp.items():
        comp = comps_site.get(code)
        if not comp:
            continue
        ids = set()
        for p in comp.get("partidas") or []:
            ids.add(str(p.get("h"))); ids.add(str(p.get("a")))
        cand = []
        for tid in ids:
            t = times_site.get(tid) or {}
            cand.append((tid, tokens(" ".join(str(t.get(k) or "") for k in ("n", "c", "t")))))
        memo = {}

        def time_do(nome):
            if nome in memo:
                return memo[nome]
            tk, melhor, nota = tokens(nome), None, 0.0
            for tid, tt in cand:
                n = parecido(tk, tt)
                if n > nota:
                    melhor, nota = tid, n
            memo[nome] = melhor if nota >= 0.5 else None
            return memo[nome]

        res = {}
        for j in jogos:
            for lado, nome, pro, contra in (("c", j["h"], 0, 1), ("f", j["a"], 1, 0)):
                tid = time_do(nome)
                if not tid:
                    continue
                r = res.setdefault(tid, {"g": [0.0] * len(CAMPOS), "c": [0.0] * len(CAMPOS), "f": [0.0] * len(CAMPOS)})
                vals = {"n": 1}
                for k in ("at", "da", "ch", "cf", "at1", "da1", "ch1"):
                    v = j.get(k)
                    if v:
                        vals[k] = v[pro]; vals[k + "c"] = v[contra]
                if j.get("pos"):
                    vals["pos"] = j["pos"][pro]
                for parte in ("g", lado):
                    for i, campo in enumerate(CAMPOS):
                        r[parte][i] += vals.get(campo, 0)
        for r in res.values():
            for parte in r:
                r[parte] = [round(x, 1) for x in r[parte]]
        if res:
            saida[code] = res
            print(f"   [{code}] {len(jogos)} jogos · {len(res)} times casados · sem par: {sorted(n for n, t in memo.items() if not t)[:6]}")
    return saida


def main():
    if not CHAVE:
        print("Sem a chave FIVE_DOLLAR_KEY: nada a fazer.")
        return
    d5 = ler_js(ARQ_DADOS5)
    if not d5:
        print("Sem dados5.js: nada a fazer.")
        return
    comps_site, times_site = d5.get("competicoes") or {}, d5.get("times") or {}
    agora = agora_utc()
    vivos = sum(1 for c in comps_site.values() for p in c.get("partidas") or [] if p.get("s") in ("IN_PLAY", "PAUSED"))
    cache = ler_cache()
    if vivos and not os.environ.get("D5_FORCAR"):
        print(f"{vivos} jogo(s) ao vivo agora: não busco nada (o limite fica para o ao vivo do site). Só remonto o arquivo.")
    else:
        todas = baixar_ligas(cache)
        # para decidir as próximas competições: estas existem na 5Dollar?
        for rot, chaves in (("Amistosos de seleção", ["friendl"]), ("Copa Africana", ["africa cup", "nations cup", "afcon"]),
                            ("Bundesliga 2", ["2. bundesliga", "2 bundesliga", "bundesliga 2"]), ("La Liga 2", ["laliga2", "la liga 2", "segunda", "laliga hypermotion"]),
                            ("Irlanda", ["ireland"])):
            achou = [f"{l['nome']} ({l['pais']}, id {l['id']})" for l in todas or [] if any(c in sem_acento(l["nome"] + " " + l["pais"]) for c in chaves)]
            print(f"   5Dollar tem {rot}? {'sim: ' + '; '.join(achou[:4]) if achou else 'não achei'}")
        if os.environ.get("D5_TESTE_ODDS"):
            testar_odds(cache)
        for code in LIGAS:
            if code not in comps_site or _pedidos[0] >= MAX_PEDIDOS:
                continue
            liga = cache["ligas"].get(code)
            if not liga and todas:
                l = escolher_liga(code, todas)
                if l:
                    liga = cache["ligas"][code] = {"id": l["id"], "nome": l["nome"], "pais": l["pais"], "ate": None}
                    print(f"[{code}] liga da 5Dollar: {l['nome']} ({l['pais']}) id {l['id']}")
                else:
                    print(f"[{code}] não achei a liga na 5Dollar")
                    continue
            if not liga:
                continue
            if liga.get("ate") and agora.timestamp() - liga["ate"] < 6 * 3600:
                continue  # já buscado há pouco: economiza o limite
            # começo: o 1º jogo encerrado desta temporada no site; depois, de onde parou (com 2 dias de folga)
            datas = [p.get("d") for p in comps_site[code].get("partidas") or [] if p.get("s") == "FINISHED" and p.get("d")]
            if not datas:
                continue
            inicio = min(datetime.fromisoformat(d.replace("Z", "+00:00")) for d in datas).timestamp() - 86400
            desde = max(inicio, (liga.get("ate") or 0) - 2 * 86400)
            ate = agora.timestamp()
            # janelas de até 30 dias (a API devolve aos poucos; se o limite acabar, continua na próxima execução)
            while desde < ate and _pedidos[0] < MAX_PEDIDOS:
                fim = min(desde + 30 * 86400, ate)
                novos, completo = baixar_jogos(cache, code, liga["id"], desde, fim)
                if not completo:
                    break
                liga["ate"] = fim
                if novos:
                    print(f"[{code}] +{novos} jogos ({datetime.fromtimestamp(desde, timezone.utc):%d/%m} a {datetime.fromtimestamp(fim, timezone.utc):%d/%m})")
                desde = fim
    # odds: com jogo ao vivo, só o mínimo e devagar (o limite é da conta toda e o ao vivo do site vem antes)
    global ESPERA
    try:
        fut = cache.setdefault("odds_fut", {})
        for fid in [k for k, e in fut.items() if (e.get("ts") or 0) < agora.timestamp() - 3 * 86400]:
            del fut[fid]
        if vivos and not os.environ.get("D5_FORCAR"):
            ESPERA, limite_listas, limite_jogos = 35.0, 4, 0
        else:
            limite_listas, limite_jogos = 40, MAX_ODDS_JOGO
        odds_em = cache.setdefault("odds_em", {})
        # ligas com jogo mais cedo primeiro
        prox = {}
        for code, c in comps_site.items():
            for p in c.get("partidas") or []:
                if p.get("s") not in ("FINISHED", "IN_PLAY", "PAUSED") and p.get("d"):
                    try:
                        ts = datetime.fromisoformat(p["d"].replace("Z", "+00:00")).timestamp()
                    except Exception:
                        continue
                    if ts > agora.timestamp():
                        prox[code] = min(prox.get(code, 9e12), ts)
        feitas = 0
        for code in sorted(prox, key=prox.get):
            liga = cache["ligas"].get(code)
            if not liga or feitas >= limite_listas or _pedidos[0] >= MAX_PEDIDOS:
                continue
            if prox[code] > agora.timestamp() + 7 * 86400 or agora.timestamp() - (odds_em.get(code) or 0) < 3 * 3600:
                continue
            n, ok = baixar_odds_lista(cache, code, liga)
            feitas += 1
            if ok:
                odds_em[code] = agora.timestamp()
                print(f"[odds {code}] {n} jogos com odds")
        if limite_jogos:
            k = baixar_odds_completas(cache, limite_jogos)
            if k:
                print(f"[odds] over 2,5 e ambas marcam: {k} jogos")
    except Exception as e:
        print(f"[odds] falhou: {e}")

    print(f"\nSomando por time ({len(cache['jogos'])} jogos no cache):")
    comps = somar(comps_site, times_site, cache)
    odds = montar_odds(comps_site, times_site, cache)
    print("Odds ligadas aos jogos do site: " + (", ".join(f"{c} {len(v)}" for c, v in odds.items()) or "nenhuma"))
    saida = {"gerado_em": agora.strftime("%Y-%m-%dT%H:%M:%SZ"), "fonte": "5DollarFootballAPI", "campos": CAMPOS, "comps": comps, "odds": odds}
    with open(ARQ_SAIDA, "w", encoding="utf-8") as f:
        f.write("window.EXTRA5D = ")
        json.dump(saida, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    with open(ARQ_CACHE, "w", encoding="utf-8") as f:
        json.dump(cache, f, separators=(",", ":"))
    print(f"\nPronto: extra5d.js ({os.path.getsize(ARQ_SAIDA) / 1024:.0f} KB) · {_pedidos[0]} pedidos nesta execução")


if __name__ == "__main__":
    main()
