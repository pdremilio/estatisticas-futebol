#!/usr/bin/env python3
"""ScanBall · escudos dos times e das ligas guardados no próprio site (pasta escudos/).

Por quê: os escudos vinham direto da ESPN (a.espncdn.com) e bloqueadores de anúncios escondem esse endereço.
Agora o robô baixa cada escudo uma vez só, pequeno (96 px), e o site usa o arquivo dele. A pasta fica guardada
entre as execuções (cache do GitHub Actions), então cada execução só baixa os escudos novos.

Depois de baixar, marca no dados5.js quais times ("l": 1) e ligas ("eml": 1) têm escudo local.
Roda depois do atualizar_b5.py. Só usa a biblioteca padrão do Python.
"""
import json
import os
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

PASTA = os.path.dirname(os.path.abspath(__file__))
ARQ_DADOS5 = os.path.join(PASTA, "dados5.js")
DIR = os.path.join(PASTA, "escudos")
TAM = 96   # 96 px: nítido também em tela de celular (2x) e ainda leve (~3-6 KB)
MAX_NOVOS = int(os.environ.get("ESCUDOS_MAX", "2500"))

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def url_pequena(url):
    """Escudo da ESPN em 96 px (o serviço "combiner" da própria ESPN redimensiona)."""
    u = urllib.parse.urlparse(url)
    if "espncdn.com" in u.netloc and u.path.startswith("/i/"):
        return f"https://a.espncdn.com/combiner/i?img={urllib.parse.quote(u.path)}&w={TAM}&h={TAM}"
    return url


def baixar(item):
    nome, url = item
    destino = os.path.join(DIR, nome)
    try:
        req = urllib.request.Request(url_pequena(url), headers={"User-Agent": "ScanBall/8 (escudos)"})
        with urllib.request.urlopen(req, timeout=20) as r:
            dados = r.read()
        # só guarda se for mesmo uma imagem (PNG, JPEG, WEBP ou GIF)
        if len(dados) < 100 or not (dados[:8].startswith(b"\x89PNG") or dados[:3] == b"\xff\xd8\xff" or dados[8:12] == b"WEBP" or dados[:3] == b"GIF"):
            return False
        with open(destino, "wb") as f:
            f.write(dados)
        return True
    except Exception:
        return False


def main():
    try:
        txt = open(ARQ_DADOS5, encoding="utf-8").read()
        d = json.loads(txt[txt.index("{"):txt.rindex("}") + 1])
    except Exception as e:
        print(f"Sem dados5.js ({e}): nada a fazer.")
        return
    os.makedirs(DIR, exist_ok=True)
    times, comps = d.get("times") or {}, d.get("competicoes") or {}
    pedidos = {}
    for tid, t in times.items():
        if t.get("e") and not os.path.exists(os.path.join(DIR, f"{tid}.png")):
            pedidos[f"{tid}.png"] = t["e"]
    for code, c in comps.items():
        if c.get("emblema") and not os.path.exists(os.path.join(DIR, f"liga-{code}.png")):
            pedidos[f"liga-{code}.png"] = c["emblema"]
    lista = list(pedidos.items())[:MAX_NOVOS]
    ok = 0
    if lista:
        with ThreadPoolExecutor(max_workers=16) as ex:
            ok = sum(1 for r in ex.map(baixar, lista) if r)
    # marca no dados5.js o que tem arquivo local (o site usa o local; a ESPN fica de reserva)
    n_t = n_c = 0
    for tid, t in times.items():
        if os.path.exists(os.path.join(DIR, f"{tid}.png")):
            t["l"] = 1; n_t += 1
        else:
            t.pop("l", None)
    for code, c in comps.items():
        if os.path.exists(os.path.join(DIR, f"liga-{code}.png")):
            c["eml"] = 1; n_c += 1
        else:
            c.pop("eml", None)
    with open(ARQ_DADOS5, "w", encoding="utf-8") as f:
        f.write("window.DADOS5 = ")
        json.dump(d, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    kb = sum(os.path.getsize(os.path.join(DIR, x)) for x in os.listdir(DIR)) / 1024
    print(f"Escudos: {ok} novos de {len(lista)} pedidos · {n_t} times e {n_c} ligas com escudo local · pasta com {kb:.0f} KB")


if __name__ == "__main__":
    main()
