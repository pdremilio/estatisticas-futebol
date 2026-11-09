#!/usr/bin/env python3
"""ScanBall · números extras de pré-jogo pela 5DollarFootballAPI (ataques, ataques perigosos, 1º tempo).

Roda no GitHub Actions depois do atualizar_b5.py. A chave fica no cofre de segredos do GitHub
(FIVE_DOLLAR_KEY) e nunca vai para o site: o site só recebe o resultado pronto (extra5d.js).

Cuidados com o limite (plano Pro: 10 pedidos por minuto, por conta):
- espera ~6,5 s entre um pedido e outro e faz no máximo MAX_PEDIDOS por execução;
- não roda enquanto houver jogo ao vivo (para não disputar o limite com o ao vivo do site);
- guarda tudo no cache5d.json: a cada execução só busca os jogos novos.

Saída: extra5d.js  ->  window.EXTRA5D = { gerado_em, campos, comps: { code: { id_time: { g, c, f } } } }
cada g/c/f é uma lista com as somas na ordem de CAMPOS (g = geral, c = em casa, f = fora).
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
MAX_PEDIDOS = int(os.environ.get("D5_MAX_PEDIDOS", "40"))
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
    if not (j["at"] or j["da"]):
        return False
    cache["jogos"][str(fx.get("id"))] = j
    return True


def baixar_jogos(cache, code, liga_id, desde_ts, ate_ts):
    novos, pagina = 0, 1
    while True:
        r = pedir(f"leagues/{liga_id}/fixtures", {"start_time": int(desde_ts), "end_time": int(ate_ts), "order": "asc",
                                                    "include": "stats", "per_page": 50, "page": pagina})
        if not r:
            return novos, False
        for fx in r.get("data") or []:
            if fx.get("status") == "finished" or str(fx.get("status_code") or "").lower() in ("full", "ft", "aet", "pen"):
                if guardar_jogo(cache, code, fx):
                    novos += 1
        if not (r.get("pagination") or {}).get("has_more"):
            return novos, True
        pagina += 1


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
    print(f"\nSomando por time ({len(cache['jogos'])} jogos no cache):")
    comps = somar(comps_site, times_site, cache)
    saida = {"gerado_em": agora.strftime("%Y-%m-%dT%H:%M:%SZ"), "fonte": "5DollarFootballAPI", "campos": CAMPOS, "comps": comps}
    with open(ARQ_SAIDA, "w", encoding="utf-8") as f:
        f.write("window.EXTRA5D = ")
        json.dump(saida, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    with open(ARQ_CACHE, "w", encoding="utf-8") as f:
        json.dump(cache, f, separators=(",", ":"))
    print(f"\nPronto: extra5d.js ({os.path.getsize(ARQ_SAIDA) / 1024:.0f} KB) · {_pedidos[0]} pedidos nesta execução")


if __name__ == "__main__":
    main()
