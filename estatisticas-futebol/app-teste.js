/* Estatísticas de Futebol — interface */
(function () {
  "use strict";

  const DADOS = window.DADOS || window.DADOS_DEMO || null;
  const DEMO = !window.DADOS && !!window.DADOS_DEMO;
  const M = window.Motor;

  const COMP_INFO = {
    BSA: { nome: "Brasileirão", pais: "Brasil" },
    PL: { nome: "Premier League", pais: "Inglaterra" },
    PD: { nome: "La Liga", pais: "Espanha" },
    SA: { nome: "Serie A", pais: "Itália" },
    BL1: { nome: "Bundesliga", pais: "Alemanha" },
    FL1: { nome: "Ligue 1", pais: "França" },
    PPL: { nome: "Liga Portugal", pais: "Portugal" },
    DED: { nome: "Eredivisie", pais: "Holanda" },
    ELC: { nome: "Championship", pais: "Inglaterra" },
    CL: { nome: "Champions League", pais: "Europa" },
    WC: { nome: "Copa do Mundo", pais: "Mundo" },
    EC: { nome: "Eurocopa", pais: "Europa" },
  };
  const ORDEM = ["BSA", "PL", "PD", "SA", "BL1", "FL1", "PPL", "DED", "ELC", "CL"];
  const OCULTAS = new Set(["WC", "EC"]); // torneios que já acabaram
  const STATUS = {
    SCHEDULED: "Agendado", TIMED: "Agendado", IN_PLAY: "Ao vivo", PAUSED: "Intervalo", LIVE: "Ao vivo",
    FINISHED: "Encerrado", POSTPONED: "Adiado", SUSPENDED: "Suspenso", CANCELLED: "Cancelado", AWARDED: "Decidido",
  };
  const FASES = {
    REGULAR_SEASON: "Temporada regular", LEAGUE_STAGE: "Fase de liga", GROUP_STAGE: "Fase de grupos",
    PLAYOFFS: "Playoffs", LAST_32: "16 avos", LAST_16: "Oitavas", QUARTER_FINALS: "Quartas",
    SEMI_FINALS: "Semifinal", THIRD_PLACE: "Disputa de 3º", FINAL: "Final",
  };

  // ------------------------------------------------------------ armazenamento local (tolerante a falhas)
  const guardar = (k, v) => { try { localStorage.setItem("ef_" + k, JSON.stringify(v)); } catch (e) {} if (window.Contas) window.Contas.marcarAlteracao(k); };
  const ler = (k, padrao) => { try { const v = localStorage.getItem("ef_" + k); return v == null ? padrao : JSON.parse(v); } catch (e) { return padrao; } };

  // ------------------------------------------------------------ preparo
  const app = document.getElementById("app");
  const preps = {};
  const comps = [];
  if (DADOS && DADOS.competicoes) {
    for (const code of ORDEM.concat(Object.keys(DADOS.competicoes).filter((c) => !ORDEM.includes(c)))) {
      const c = DADOS.competicoes[code];
      if (!c || !c.partidas || !c.partidas.length || OCULTAS.has(code)) continue;
      preps[code] = M.prepararCompeticao(c);
      comps.push(code);
    }
  }
  const TIMES = (DADOS && DADOS.times) || {};
  const favTimes = new Set(ler("fav_times", []).map(String));
  const favLigas = new Set(ler("fav_ligas", []));
  const ESTRELA_SVG = (t) => `<svg viewBox="0 0 24 24" width="${t}" height="${t}" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" stroke-linejoin="round"/></svg>`;
  function botaoEstrela(attr, valor, ativo, nome, t = 17, extra = "") {
    return `<button class="estrela ${extra}" type="button" ${attr}="${h(valor)}" aria-pressed="${ativo}" aria-label="${ativo ? "Remover " + h(nome) + " dos favoritos" : "Favoritar " + h(nome)}" title="${ativo ? "Remover dos favoritos" : "Favoritar"}">${ESTRELA_SVG(t)}</button>`;
  }
  const estrelaTime = (tid, t = 17, extra = "") => botaoEstrela("data-favtime", tid, favTimes.has(String(tid)), nomeTime(tid), t, extra);
  const estrelaLiga = (code, t = 17) => botaoEstrela("data-favliga", code, favLigas.has(code), nomeComp(code), t);
  const compsOrd = () => [...comps].sort((a, b) => (favLigas.has(b) ? 1 : 0) - (favLigas.has(a) ? 1 : 0));
  const estado = {
    comp: comps.includes(ler("comp", "")) ? ler("comp", "") : comps[0],
    dia: null, compJogos: "todas", vistaTabela: "TOTAL",
    ordem: ler("ordem", "hora"), ocultarEncerrados: ler("ocultar", false), soFavoritos: false, busca: "",
    abaJogo: "inteiro", recorte: "lado", ultimos: 5, subClass: "tabela", tempo: 1,
    rkOrdem: ler("rk_ordem", "elo"), rkN: ler("rk_n", 5), rkFiltro: "todos",
  };

  // ------------------------------------------------------------ utilidades
  const h = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const virgula = (x, d) => x.toFixed(d).replace(".", ",");
  const fPct = (v) => (v == null || !isFinite(v) ? "–" : Math.round(v) + "%");
  const fNum = (v, d = 2) => (v == null || !isFinite(v) ? "–" : virgula(v, d));
  const fProb = (p) => (p == null ? "–" : Math.round(p * 100) + "%");
  const fOdd = (p) => (p > 0.001 ? virgula(1 / p, 2) : "–");
  const pad = (n) => String(n).padStart(2, "0");
  const chaveDia = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const diaDe = (iso) => chaveDia(new Date(iso));
  const hora = (iso) => { const d = new Date(iso); return pad(d.getHours()) + ":" + pad(d.getMinutes()); };
  const dataCurta = (iso) => { const d = new Date(iso); return pad(d.getDate()) + "/" + pad(d.getMonth() + 1); };
  const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  const dataLonga = (iso) => {
    const d = new Date(iso);
    return ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"][d.getDay()] + ", " + pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear();
  };
  const somarDias = (chave, n) => { const [a, m, d] = chave.split("-").map(Number); return chaveDia(new Date(a, m - 1, d + n)); };
  const hoje = () => chaveDia(new Date());

  const nomeTime = (id) => (TIMES[id] ? TIMES[id].c || TIMES[id].n : "A definir");
  const nomeLongo = (id) => (TIMES[id] ? TIMES[id].n : "A definir");
  function corDe(id) {
    const n = parseInt(id, 10);
    let x = isFinite(n) ? n : 0;
    if (!isFinite(n)) { const s = String(id); for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0; }
    return "hsl(" + Math.round((x * 137.508) % 360) + " 45% 38%)";
  }
  function siglaTime(id) {
    const t = TIMES[id];
    if (!t) return "?";
    return (t.t || t.c || t.n || "?").slice(0, 3).toUpperCase();
  }
  function escudo(id, cls = "esc") {
    const t = TIMES[id];
    const sig = h(siglaTime(id)), cor = corDe(id);
    if (t && t.e) return `<img class="${cls}" src="${h(t.e)}" alt="" loading="lazy" data-f="${sig}" data-cor="${cor}">`;
    return `<span class="${cls} esc-falso" style="background:${cor}" aria-hidden="true">${sig}</span>`;
  }
  function seloComp(code) {
    const c = DADOS.competicoes[code];
    if (c && c.emblema) return `<img class="comp-sigla" src="${h(c.emblema)}" alt="" loading="lazy" data-f="${h(code)}" data-cor="var(--tinta)">`;
    return `<span class="comp-sigla" aria-hidden="true">${h(code)}</span>`;
  }
  document.addEventListener("error", (ev) => {
    const el = ev.target;
    if (el && el.tagName === "IMG" && el.dataset.f) {
      const s = document.createElement("span");
      s.className = el.className + " esc-falso";
      s.style.background = el.dataset.cor;
      s.textContent = el.dataset.f;
      el.replaceWith(s);
    }
  }, true);
  const nomeComp = (code) => (COMP_INFO[code] ? COMP_INFO[code].nome : (DADOS.competicoes[code] || {}).nome || code);
  const forma = (lista) => `<span class="forma" aria-label="Últimos resultados: ${lista.join(", ")}">${lista.map((r) => `<i class="${r}" title="${{ V: "Vitória", E: "Empate", D: "Derrota" }[r]}">${r}</i>`).join("")}</span>`;
  const encerrada = (p) => M.encerrada(p);
  const aoVivo = (p) => ["IN_PLAY", "PAUSED", "LIVE"].includes(p.s);

  function chipsComp(rotaBase, atual, extra = "") {
    return `<div class="chips" role="group" aria-label="Competição">${extra}${compsOrd().map((c) =>
      `<button class="chip" type="button" data-ir="${rotaBase}/${c}" aria-pressed="${c === atual}">${seloComp(c)}${h(nomeComp(c))}</button>`).join("")}</div>`;
  }

  // projeção de um jogo: antes do jogo para encerrados, estado atual para futuros
  const memoProj = new Map();
  function projecaoDo(code, p) {
    const chave = code + ":" + p.i;
    if (memoProj.has(chave)) return memoProj.get(chave);
    const r = projecaoCalc(code, p);
    memoProj.set(chave, r);
    return r;
  }
  function projecaoCalc(code, p) {
    const prep = preps[code];
    const foto = prep.fotos[p.i] || { h: M.fotoAtual(prep, p.h), a: M.fotoAtual(prep, p.a), liga: prep.liga };
    return { foto, proj: M.projetar(foto.h, foto.a, foto.liga), previa: !!prep.fotos[p.i] };
  }

  function todasPartidas() {
    if (todasPartidas.cache) return todasPartidas.cache;
    const l = [];
    for (const code of comps) for (const p of preps[code].partidas) l.push({ code, p, dia: diaDe(p.d) });
    l.sort((a, b) => (a.p.d < b.p.d ? -1 : a.p.d > b.p.d ? 1 : 0));
    return (todasPartidas.cache = l);
  }
  function acharPartida(code, id) {
    const prep = preps[code];
    if (!prep) return null;
    return prep.partidas.find((p) => String(p.i) === String(id)) || null;
  }
  function posicaoNaTabela(code, tid) {
    const comp = DADOS.competicoes[code];
    const tabs = (comp.classificacao || []).filter((t) => t.tipo === "TOTAL");
    for (const t of tabs) {
      const l = t.tabela.find((x) => String(x.t) === String(tid));
      if (l) return { pos: l.p, pts: l.pts, grupo: t.grupo };
    }
    const calc = M.tabela(preps[code], "TOTAL").find((x) => String(x.t) === String(tid));
    return calc ? { pos: calc.p, pts: calc.pts } : null;
  }
  function posElo(code, tid) {
    const r = M.ranking(preps[code]);
    const x = r.find((y) => String(y.t) === String(tid));
    return x ? { pos: x.pos, elo: x.elo, total: r.length } : null;
  }

  // ------------------------------------------------------------ topo e aviso
  function montarTopo() {
    const meta = document.getElementById("topo-meta");
    if (DADOS && DADOS.gerado_em) {
      const d = new Date(DADOS.gerado_em);
      meta.innerHTML = DEMO ? "Dados de demonstração" : `Dados de ${pad(d.getDate())}/${pad(d.getMonth() + 1)} às ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    if (DEMO) {
      const naWeb = /^https?:$/.test(location.protocol);
      document.getElementById("aviso").innerHTML = `<div class="aviso"><div>Você está vendo dados de demonstração, com resultados inventados. ${naWeb ? "Os dados reais aparecem depois que a primeira atualização automática terminar (aba Actions do GitHub)." : "Rode o <b>atualizar.bat</b> para baixar os dados reais das competições."}</div></div>`;
    }
    const temaSalvo = ler("tema", null);
    if (temaSalvo) document.documentElement.dataset.tema = temaSalvo;
    document.getElementById("tema").addEventListener("click", () => {
      const escuroAgora = document.documentElement.dataset.tema
        ? document.documentElement.dataset.tema === "escuro"
        : matchMedia("(prefers-color-scheme: dark)").matches;
      const novo = escuroAgora ? "claro" : "escuro";
      document.documentElement.dataset.tema = novo;
      guardar("tema", novo);
    });
  }

  // ------------------------------------------------------------ JOGOS (lista)
  const normal = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const favoritos = new Set(ler("favoritos", []));
  const chaveFav = (code, p) => code + ":" + p.i;
  const recolhidas = new Set();
  const ROT_STATUS = (p) => (aoVivo(p) ? `<span class="vivo">${STATUS[p.s]}</span>` : STATUS[p.s] || p.s);

  // ---------- ao vivo: estatísticas, lances, pressão e escalações (dados da ESPN, ver aovivo.js)
  const EST_VIVO = [["posse", "Posse de bola", "%"], ["xg", "Gols esperados (xG)"], ["chutes", "Finalizações"], ["alvo", "No alvo"],
    ["esc", "Escanteios"], ["faltas", "Faltas"], ["amarelos", "Cartões amarelos"], ["vermelhos", "Cartões vermelhos"], ["imped", "Impedimentos"],
    ["defesas", "Defesas do goleiro"], ["passes", "Passes"]];
  const temAoVivo = (p) => !!(p.vv && p.vv.espn);
  let infoPressao = "";
  function graficoPressao(p) {
    const pr = p.vv && p.vv.pr;
    if (!pr) return `<div class="pressao vazio-p"><p class="sub">${p.vv && p.vv.st === "pre" ? "O gráfico de pressão começa quando a bola rolar." : "Gráfico de pressão indisponível para este jogo."}</p></div>`;
    // barras: SVG que estica na largura (só retângulos, nada que distorça)
    const n = pr.n, L = 6, W = n * L, H = 100, meio = H / 2;
    let max = 1;
    for (let m = 1; m <= n; m++) max = Math.max(max, pr.h[m] || 0, pr.a[m] || 0);
    const alt = (v) => ((v || 0) / max) * (meio - 2);
    let barras = "";
    for (let m = 1; m <= n; m++) {
      const x = (m - 1) * L + 0.5;
      if (pr.h[m]) barras += `<rect class="p-c" x="${x}" y="${(meio - alt(pr.h[m])).toFixed(1)}" width="${L - 1}" height="${alt(pr.h[m]).toFixed(1)}"/>`;
      if (pr.a[m]) barras += `<rect class="p-f" x="${x}" y="${meio}" width="${L - 1}" height="${alt(pr.a[m]).toFixed(1)}"/>`;
    }
    const agora = pr.ate < n && p.s !== "FINISHED" ? `<line x1="${pr.ate * L}" x2="${pr.ate * L}" y1="0" y2="${H}" class="p-agora"/>` : "";
    // marcas: tamanho fixo em pixels, posicionadas pelo minuto (não distorcem)
    const PRIOR = { gol: 5, trave: 4, alvo: 3, fora: 2, bloq: 1 };
    const NOME = { gol: "gol", trave: "bola na trave", alvo: "chute no gol", fora: "chute para fora", bloq: "chute bloqueado" };
    // em tela estreita os minutos ficam colados: junta as marcas em blocos de 2 ou 3 minutos
    const bloco = window.innerWidth < 560 ? 3 : window.innerWidth < 900 ? 2 : 1;
    const grupos = {};
    for (const mk of pr.marcas || (pr.gols || []).map((g) => ({ ...g, k: "gol", j: "", min: g.m + "'" }))) {
      const chave = mk.l + Math.floor((mk.m - 1) / bloco);
      (grupos[chave] = grupos[chave] || []).push(mk);
    }
    const marcas = Object.values(grupos).map((g) => {
      const top = g.slice().sort((a, b) => PRIOR[b.k] - PRIOR[a.k])[0];
      const info = g.map((x) => `${x.min} ${x.j ? x.j + " · " : ""}${NOME[x.k]}`).join(" | ") + ` (${nomeTime(top.l === "h" ? p.h : p.a)})`;
      return `<button type="button" class="mk mk-${top.k} ${top.l === "h" ? "mk-c" : "mk-f"}${g.length > 1 ? " mk-mais" : ""}" style="left:${(((top.m - 0.5) / n) * 100).toFixed(2)}%" data-info="${h(info)}" title="${h(info)}" aria-label="${h(info)}">${top.k === "gol" ? "⚽" : ""}</button>`;
    }).join("");
    const conta = (l, ks) => (pr.marcas || []).filter((x) => x.l === l && ks.includes(x.k)).length;
    const resumo = (l) => `${conta(l, ["gol", "alvo", "trave"])} no gol/trave · ${conta(l, ["fora", "bloq"])} fora/bloq.`;
    return `<div class="pressao">
      <div class="pressao-cab"><h3>Pressão</h3><span class="sub">chutes, escanteios e gols por minuto</span></div>
      <div class="pressao-area">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" x2="${W}" y1="${meio}" y2="${meio}" class="p-eixo"/><line x1="${45 * L}" x2="${45 * L}" y1="0" y2="${H}" class="p-tempo"/>${barras}${agora}</svg>
        ${marcas}
      </div>
      <div class="pressao-eixo" aria-hidden="true"><span style="left:0">0'</span><span style="left:${((45 / n) * 100).toFixed(1)}%">45'</span><span style="right:0">${n}'</span></div>
      <div class="pressao-leg"><span><i class="marcador c"></i>${h(nomeTime(p.h))} <small class="sub">${resumo("h")}</small></span><span><small class="sub">${resumo("a")}</small> ${h(nomeTime(p.a))}<i class="marcador f"></i></span></div>
      <div class="pressao-simb"><span><i class="mk-ex mk-gol">⚽</i>gol</span><span><i class="mk-ex mk-trave"></i>trave</span><span><i class="mk-ex mk-alvo"></i>no gol</span><span><i class="mk-ex mk-fora"></i>para fora</span><span><i class="mk-ex mk-bloq"></i>bloqueado</span></div>
      <p class="pressao-info" aria-live="polite">${infoPressao ? h(infoPressao) : "Toque numa marca para ver o lance."}</p>
    </div>`;
  }
  document.addEventListener("click", (e) => {
    const mk = e.target.closest && e.target.closest(".pressao .mk");
    if (!mk) return;
    infoPressao = mk.dataset.info || "";
    const caixa = mk.closest(".pressao").querySelector(".pressao-info");
    if (caixa) caixa.textContent = infoPressao;
  });
  function abaEscalacoes(p) {
    const e = p.vv && p.vv.esc;
    if (!e || (!e.h && !e.a)) return `<div class="painel-corpo"><div class="vazio"><strong>Escalações ainda não divulgadas</strong>Elas costumam sair cerca de 1 hora antes do jogo.</div></div>`;
    const icones = (j) => `${"⚽".repeat(j.g)}${j.a ? `<span class="esc-a" title="Assistências">A${j.a > 1 ? j.a : ""}</span>` : ""}${j.am ? '<i class="ic amarelo" title="Cartão amarelo"></i>' : ""}${j.vm ? '<i class="ic vermelho" title="Cartão vermelho"></i>' : ""}${j.ent ? '<span class="esc-ent" title="Entrou">▲</span>' : ""}${j.sai ? '<span class="esc-sai" title="Saiu">▼</span>' : ""}`;
    const linha = (j) => `<tr class="${j.ent || j.tit ? "" : "apagado"}"><td>${h(j.num)}</td><td class="esq">${h(j.n)}</td><td class="esc-pos">${h(j.pos === "SUB" ? "" : j.pos)}</td><td class="esc-ic">${icones(j)}</td></tr>`;
    const lado = (l, tid, cls) => {
      const t = e[l];
      if (!t) return `<div class="esc-lado"><p class="sub">Sem escalação.</p></div>`;
      const tit = t.jog.filter((j) => j.tit).sort((a, b) => a.ordem - b.ordem), res = t.jog.filter((j) => !j.tit).sort((a, b) => (b.ent ? 1 : 0) - (a.ent ? 1 : 0));
      return `<div class="esc-lado"><div class="esc-cab ${cls}">${escudo(tid)}<b>${h(nomeTime(tid))}</b><span class="sub">${h(t.form)}</span></div>
        <table class="dados esc-tab"><thead><tr><th>#</th><th class="esq">Titulares</th><th></th><th></th></tr></thead><tbody>${tit.map(linha).join("")}</tbody></table>
        ${res.length ? `<table class="dados esc-tab"><thead><tr><th>#</th><th class="esq">Reservas</th><th></th><th></th></tr></thead><tbody>${res.map(linha).join("")}</tbody></table>` : ""}</div>`;
    };
    return `<div class="painel-corpo"><div class="esc-grade">${lado("h", p.h, "c")}${lado("a", p.a, "f")}</div>
      <p class="sub nota">Fonte: ESPN. ⚽ gol · A assistência · ▲ entrou · ▼ saiu.</p></div>`;
  }
  function abaAoVivo(p) {
    return `<div class="painel-corpo">${graficoPressao(p)}${blocoAoVivo(p) || '<p class="sub">Estatísticas e lances aparecem quando o jogo começar.</p>'}</div>`;
  }
  function blocoAoVivo(p) {
    const v = p.vv;
    if (!v || (!(v.ev && v.ev.length) && !v.es)) return "";
    const icone = (t) => (t === "gol" ? "⚽" : t === "amarelo" ? '<i class="ic amarelo"></i>' : t === "vermelho" ? '<i class="ic vermelho"></i>' : t === "sub" ? "⇄" : t === "var" ? "VAR" : "");
    const txt = (e) => `<span class="${e.t === "gol" ? "gol" : ""}">${e.l === "h" ? "" : icone(e.t) + " "}${h(e.j || "")}${e.x ? ` <small>${h(e.x)}</small>` : ""}${e.l === "h" ? " " + icone(e.t) : ""}</span>`;
    const minNum = (m) => { const [a, b] = String(m).split("+"); return Number(a) + (Number(b) || 0) / 100; };
    const evs = (v.ev || []).slice().sort((a, b) => minNum(b.m) - minNum(a.m)).map((e) => `<li><span class="c">${e.l === "h" ? txt(e) : ""}</span><span class="m">${h(e.m)}'</span><span>${e.l === "a" ? txt(e) : ""}</span></li>`).join("");
    const num = (x) => (x == null ? null : Number(String(x).replace("%", "")));
    const est = v.es ? EST_VIVO.filter(([k]) => v.es[k] && (num(v.es[k][0]) != null || num(v.es[k][1]) != null)).map(([k, rot, suf = ""]) => {
      const a = num(v.es[k][0]) || 0, b = num(v.es[k][1]) || 0, t = a + b || 1;
      const f = (x) => (k === "xg" ? fNum(x, 2) : x) + suf;
      return `<div class="est-linha"><span class="v">${f(a)}</span><span class="rot">${rot}</span><span class="v">${f(b)}</span>
        <span class="est-trilho"><span style="width:${(a / t) * 100}%"></span><span style="width:${(b / t) * 100}%"></span></span></div>`;
    }).join("") : "";
    const em = v.emDet || v.em ? new Date(v.emDet || v.em) : null;
    const atual = em ? `<span class="atual">· atualizado ${pad(em.getHours())}:${pad(em.getMinutes())}:${pad(em.getSeconds())}</span>` : "";
    return `<div class="vivo-painel">
      <div><h3>Lances ${atual}</h3>${evs ? `<ul class="ev-lista">${evs}</ul>` : '<p class="sub">Nenhum lance registrado ainda.</p>'}</div>
      <div><h3>Estatísticas</h3>${est ? `<div class="est-lista">${est}</div>` : '<p class="sub">Estatísticas ainda não disponíveis.</p>'}</div>
    </div>`;
  }
  const DIA_CURTO = (iso) => { const d = new Date(iso); return SEMANA[d.getDay()] + " " + pad(d.getDate()) + "/" + pad(d.getMonth() + 1); };

  // ---------- janela de datas: no máximo 3 dias para trás e 3 para frente
  const JANELA = 3;
  const diaMin = () => somarDias(hoje(), -JANELA);
  const diaMax = () => somarDias(hoje(), JANELA);
  const limitarDia = (d) => (d < diaMin() ? diaMin() : d > diaMax() ? diaMax() : d);

  // ---------- odds das casas
  const oddsDo = (code, p) => { const o = (DADOS.competicoes[code] || {}).odds; return o ? o[p.i] || o[String(p.i)] || null : null; };
  const TEM_ODDS = comps.some((c) => DADOS.competicoes[c].odds && Object.keys(DADOS.competicoes[c].odds).length);
  const temValor = (odd, prob) => odd && prob > 0 && odd * prob > 1.0;
  const pctValor = (odd, prob) => (odd && prob > 0 ? (odd * prob - 1) * 100 : null);

  // ---------- filtros da lista
  const FILTRO_VAZIO = { quem: "qualquer", chanceMin: 0, ov25Min: 0, bttsMin: 0, valor: false, minJogos: 0, condicoes: [] };
  const PRESETS_LISTA = [
    { nome: "Favorito em casa", quem: "casa", chanceMin: 55, ov25Min: 0, bttsMin: 0, valor: false, minJogos: 5,
      condicoes: [{ suj: "hc", met: "vit", op: ">=", val: 60 }, { suj: "af", met: "der", op: ">=", val: 50 }] },
    { nome: "Favorito forte", quem: "qualquer", chanceMin: 65, ov25Min: 0, bttsMin: 0, valor: false, minJogos: 3, condicoes: [] },
    { nome: "Jogo de gols", quem: "qualquer", chanceMin: 0, ov25Min: 55, bttsMin: 0, valor: false, minJogos: 3, condicoes: [] },
    { nome: "Ambas marcam", quem: "qualquer", chanceMin: 0, ov25Min: 0, bttsMin: 55, valor: false, minJogos: 3, condicoes: [] },
  ];
  const copiaFiltro = (f) => JSON.parse(JSON.stringify(f));
  estado.filtro = Object.assign(copiaFiltro(FILTRO_VAZIO), ler("filtro_lista", {}));
  if (!Array.isArray(estado.filtro.condicoes)) estado.filtro.condicoes = [];
  function nFiltros(f) {
    return (f.chanceMin > 0 ? 1 : 0) + (f.ov25Min > 0 ? 1 : 0) + (f.bttsMin > 0 ? 1 : 0) + (f.valor ? 1 : 0) + (f.minJogos > 0 ? 1 : 0) + f.condicoes.length;
  }
  function passaFiltroLista(code, p) {
    const f = estado.filtro;
    if (!nFiltros(f)) return true;
    if (!p.h || !p.a) return false;
    const { foto, proj } = projecaoDo(code, p);
    const chance = f.quem === "casa" ? proj.p1 : f.quem === "fora" ? proj.p2 : Math.max(proj.p1, proj.p2);
    if (chance * 100 < f.chanceMin) return false;
    if (proj.ov[2] * 100 < f.ov25Min) return false;
    if (proj.btts * 100 < f.bttsMin) return false;
    if (f.valor) {
      const o = oddsDo(code, p);
      if (!o) return false;
      const ok = f.quem === "casa" ? temValor(o.c, proj.p1) : f.quem === "fora" ? temValor(o.f, proj.p2)
        : temValor(o.c, proj.p1) || temValor(o.e, proj.px) || temValor(o.f, proj.p2);
      if (!ok) return false;
    }
    return M.passa({ minJogos: f.minJogos, condicoes: f.condicoes }, foto, proj);
  }

  function jogosVisiveis() {
    const termo = normal(estado.busca);
    const l = todasPartidas().filter((x) => {
      if (x.dia !== estado.dia) return false;
      if (estado.compJogos !== "todas" && x.code !== estado.compJogos) return false;
      if (estado.ocultarEncerrados && (encerrada(x.p) || ["CANCELLED", "AWARDED"].includes(x.p.s))) return false;
      if (estado.soFavoritos && !(favoritos.has(chaveFav(x.code, x.p)) || favTimes.has(String(x.p.h)) || favTimes.has(String(x.p.a)) || favLigas.has(x.code))) return false;
      if (termo) {
        const alvo = normal(nomeLongo(x.p.h) + " " + nomeTime(x.p.h) + " " + nomeLongo(x.p.a) + " " + nomeTime(x.p.a) + " " + nomeComp(x.code) + " " + (DADOS.competicoes[x.code].nome || ""));
        if (!alvo.includes(termo)) return false;
      }
      return passaFiltroLista(x.code, x.p);
    });
    if (estado.ordem === "chance") {
      const ch = (x) => (x.p.h && x.p.a ? (() => { const { proj } = projecaoDo(x.code, x.p); return Math.max(proj.p1, proj.p2); })() : 0);
      l.sort((a, b) => ch(b) - ch(a));
    }
    return l;
  }

  function painelFiltros() {
    const f = estado.filtro;
    const faixa = (id, rot, val) => `<div class="pf-campo"><label for="${id}">${rot}</label>
      <div class="faixa"><input type="range" id="${id}" min="0" max="90" step="5" value="${val}"><b id="${id}-v">${val ? "≥ " + val + "%" : "qualquer"}</b></div></div>`;
    const conds = f.condicoes.map((c, i) => {
      const mets = c.suj === "pj" ? M.METRICAS_PROJ : c.suj === "cmp" ? M.METRICAS_CMP : M.METRICAS_TIME;
      return `<div class="cond" data-i="${i}">
        <select data-campo="suj" aria-label="Quem">${M.SUJEITOS.map((s) => `<option value="${s.id}" ${s.id === c.suj ? "selected" : ""}>${s.nome}</option>`).join("")}</select>
        <select data-campo="met" aria-label="Estatística">${mets.map((m) => `<option value="${m.id}" ${m.id === c.met ? "selected" : ""}>${m.nome}</option>`).join("")}</select>
        <div class="op-val">
          <select data-campo="op" aria-label="Comparação"><option value=">=" ${c.op === ">=" ? "selected" : ""}>≥</option><option value="<=" ${c.op === "<=" ? "selected" : ""}>≤</option></select>
          <input data-campo="val" type="number" step="any" value="${c.val}" aria-label="Valor">
          <button class="remover" type="button" data-lremover="${i}" aria-label="Remover condição">✕</button>
        </div></div>`;
    }).join("");
    const salvos = ler("filtros_lista", []);
    return `<div class="painel-filtros">
      <div class="pf-grade">
        <div class="pf-campo"><span class="rotulo">Chance de vitória de</span>
          <div class="alternar" role="group" aria-label="De quem">
            ${[["qualquer", "Qualquer time"], ["casa", "Mandante"], ["fora", "Visitante"]].map(([k, r]) => `<button type="button" data-fquem="${k}" aria-pressed="${f.quem === k}">${r}</button>`).join("")}</div>
          <div class="faixa"><input type="range" id="f-chance" min="0" max="90" step="5" value="${f.chanceMin}" aria-label="Chance mínima de vitória"><b id="f-chance-v">${f.chanceMin ? "≥ " + f.chanceMin + "%" : "qualquer"}</b></div></div>
        ${faixa("f-ov25", "Chance de mais de 2,5 gols", f.ov25Min)}
        ${faixa("f-btts", "Chance de ambas marcarem", f.bttsMin)}
        <div class="pf-campo"><label for="f-minj">Mínimo de jogos de cada time</label><input id="f-minj" type="number" min="0" value="${f.minJogos}" class="campo-num"></div>
        ${TEM_ODDS ? `<label class="check"><input type="checkbox" id="f-valor" ${f.valor ? "checked" : ""}> Só jogos com valor: odd média das casas acima da odd justa${f.quem !== "qualquer" ? " (no " + (f.quem === "casa" ? "mandante" : "visitante") + ")" : ""}</label>` : ""}
      </div>
      <details class="pf-avancado" ${f.condicoes.length ? "open" : ""}><summary>Condições avançadas${f.condicoes.length ? ` (${f.condicoes.length})` : ""}</summary>
        <p class="sub">Use as estatísticas dos times (casa, fora, geral) ou da projeção. Todas as condições precisam ser verdadeiras.</p>
        ${conds}<button class="botao-q" type="button" id="l-add">Adicionar condição</button></details>
      <div class="pf-acoes">
        <span class="sub">Prontos:</span>${PRESETS_LISTA.map((p, i) => `<button class="chip" type="button" data-lpreset="${i}">${h(p.nome)}</button>`).join("")}
        ${salvos.map((p, i) => `<span class="chip salvo-chip"><button type="button" data-lsalvo="${i}">${h(p.nome)}</button><button type="button" class="x" data-lapagar="${i}" aria-label="Apagar ${h(p.nome)}">✕</button></span>`).join("")}
        <span class="pf-botoes"><button class="botao-q" type="button" id="l-salvar">Salvar filtro</button>
        <button class="botao-q" type="button" id="l-limpar">Limpar filtros</button></span>
      </div>
    </div>`;
  }

  function iconeRecolher() {
    return recolhidas.size
      ? `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 9l5-5 5 5M7 15l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      : `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 4l5 5 5-5M7 20l5-5 5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  function botaoFiltros() {
    const n = nFiltros(estado.filtro);
    return `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M3 5h18l-7 8v6l-4-2v-4z" fill="${n ? "var(--cartao)" : "none"}" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
      <span class="sr">Filtros</span>${n ? `<span class="badge">${n}</span>` : ""}`;
  }

  function telaJogos() {
    estado.dia = limitarDia(estado.dia || hoje());
    const base = hoje();
    const rotDia = estado.dia === base ? "Hoje" : estado.dia === somarDias(base, 1) ? "Amanhã" : estado.dia === somarDias(base, -1) ? "Ontem" : "";
    const [a, m, d] = estado.dia.split("-").map(Number);
    const dt = new Date(a, m - 1, d);
    app.innerHTML = `
      <div class="jogos-pagina">
        <section class="painel lista-v2" aria-label="Lista de jogos">
          <div class="barra-ferramentas compacta">
            <div class="tb-linha">
              <div class="nav-data">
                <button class="botao-q seta" type="button" data-passo="-1" aria-label="Dia anterior" title="Dia anterior" ${estado.dia <= diaMin() ? "disabled" : ""}>‹</button>
                <label class="data-atual" title="Escolher data"><span>${rotDia ? `<b>${rotDia}</b> · ` : ""}${SEMANA[dt.getDay()]} ${pad(d)}/${pad(m)}</span>
                  <input type="date" id="escolher-dia" value="${estado.dia}" min="${diaMin()}" max="${diaMax()}" aria-label="Escolher data"></label>
                <button class="botao-q seta" type="button" data-passo="1" aria-label="Próximo dia" title="Próximo dia" ${estado.dia >= diaMax() ? "disabled" : ""}>›</button>
                ${estado.dia !== base ? `<button class="botao-q texto" type="button" data-passo="0">Hoje</button>` : ""}
              </div>
              <label class="sel-mini"><span>Ordenar por</span>
                <select id="ordenar">${[["hora", "Hora de início"], ["comp", "Campeonato"], ["chance", "Maior chance"]].map(([k, r]) => `<option value="${k}" ${estado.ordem === k ? "selected" : ""}>${r}</option>`).join("")}</select></label>
              <label class="sel-mini"><span class="sr">Competição</span>
                <select id="comp-jogos"><option value="todas">Todas as competições</option>${compsOrd().map((c) => `<option value="${c}" ${estado.compJogos === c ? "selected" : ""}>${h(nomeComp(c))}</option>`).join("")}</select></label>
              <button class="botao-q icone" type="button" id="ocultar" aria-pressed="${!!estado.ocultarEncerrados}" title="${estado.ocultarEncerrados ? "Mostrar jogos encerrados" : "Esconder jogos encerrados"}" aria-label="${estado.ocultarEncerrados ? "Mostrar jogos encerrados" : "Esconder jogos encerrados"}">
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/>${estado.ocultarEncerrados ? '<path d="M3 3l18 18" stroke="currentColor" stroke-width="2"/>' : ""}</svg></button>
            </div>
            <div class="tb-linha">
              <button class="botao-q" type="button" id="so-fav" aria-pressed="${!!estado.soFavoritos}" title="Mostrar só jogos, times e ligas favoritos">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill="${estado.soFavoritos ? "var(--cartao)" : "none"}" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
                Favoritos</button>
              <button class="botao-q icone" type="button" id="recolher" title="${recolhidas.size ? "Expandir jogos" : "Recolher jogos"}" aria-label="${recolhidas.size ? "Expandir jogos" : "Recolher jogos"}">${iconeRecolher()}</button>
              <button class="botao-q icone" type="button" id="abrir-filtros" aria-expanded="${!!estado.painelFiltro}" aria-pressed="${nFiltros(estado.filtro) > 0}" title="Filtros">${botaoFiltros()}</button>
              <label class="busca-caixa"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
                <input class="busca" id="busca" type="search" placeholder="Buscar confronto ou campeonato" value="${h(estado.busca || "")}" aria-label="Buscar confronto ou campeonato"></label>
              <span class="tb-contagem" id="tb-contagem" aria-live="polite"></span>
            </div>
            <div id="painel-filtros" ${estado.painelFiltro ? "" : "hidden"}>${estado.painelFiltro ? painelFiltros() : ""}</div>
          </div>
          <div id="lista-jogos-corpo"></div>
        </section>
        <aside class="destaques" aria-label="Destaques do dia" id="destaques"></aside>
      </div>`;
    renderListaJogos();
    const inp = document.getElementById("escolher-dia");
    inp.addEventListener("change", () => { if (inp.value) { estado.dia = limitarDia(inp.value); telaJogos(); } });
    document.getElementById("ordenar").addEventListener("change", (e) => { estado.ordem = e.target.value; guardar("ordem", estado.ordem); renderListaJogos(); });
    document.getElementById("comp-jogos").addEventListener("change", (e) => { estado.compJogos = e.target.value; renderListaJogos(); });
    document.getElementById("busca").addEventListener("input", (e) => { estado.busca = e.target.value; renderListaJogos(); });
    ligarPainelFiltros();
  }

  function salvarFiltro() { guardar("filtro_lista", estado.filtro); }
  function atualizarBotaoFiltros() {
    const b = document.getElementById("abrir-filtros");
    if (b) { b.innerHTML = botaoFiltros(); b.setAttribute("aria-pressed", nFiltros(estado.filtro) > 0); }
  }
  function redesenharPainel() {
    const pf = document.getElementById("painel-filtros");
    if (pf) { pf.innerHTML = painelFiltros(); ligarPainelFiltros(); }
    atualizarBotaoFiltros(); renderListaJogos();
  }
  function ligarPainelFiltros() {
    const pf = document.getElementById("painel-filtros");
    if (!pf || pf.hidden) return;
    const faixa = (id, chave) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", () => {
        estado.filtro[chave] = Number(el.value);
        document.getElementById(id + "-v").textContent = el.value > 0 ? "≥ " + el.value + "%" : "qualquer";
        salvarFiltro(); atualizarBotaoFiltros(); renderListaJogos();
      });
    };
    faixa("f-chance", "chanceMin"); faixa("f-ov25", "ov25Min"); faixa("f-btts", "bttsMin");
    const mj = document.getElementById("f-minj");
    if (mj) mj.addEventListener("input", () => { estado.filtro.minJogos = Number(mj.value) || 0; salvarFiltro(); atualizarBotaoFiltros(); renderListaJogos(); });
    const v = document.getElementById("f-valor");
    if (v) v.addEventListener("change", () => { estado.filtro.valor = v.checked; salvarFiltro(); atualizarBotaoFiltros(); renderListaJogos(); });
    pf.querySelectorAll(".cond").forEach((el) => {
      const c = estado.filtro.condicoes[Number(el.dataset.i)];
      el.querySelectorAll("[data-campo]").forEach((campo) => {
        campo.addEventListener(campo.tagName === "INPUT" ? "input" : "change", () => {
          const k = campo.dataset.campo;
          c[k] = k === "val" ? Number(campo.value) : campo.value;
          if (k === "suj") { c.met = (c.suj === "pj" ? M.METRICAS_PROJ : c.suj === "cmp" ? M.METRICAS_CMP : M.METRICAS_TIME)[0].id; salvarFiltro(); redesenharPainel(); return; }
          salvarFiltro(); renderListaJogos();
        });
      });
    });
  }

  function renderListaJogos() {
    const corpo = document.getElementById("lista-jogos-corpo");
    if (!corpo) return;
    const lista = jogosVisiveis();
    const totalDia = todasPartidas().filter((x) => x.dia === estado.dia).length;
    const rec = document.getElementById("recolher");
    if (rec) { const t = recolhidas.size ? "Expandir jogos" : "Recolher jogos"; rec.title = t; rec.setAttribute("aria-label", t); rec.innerHTML = iconeRecolher(); }
    const filtrando = lista.length !== totalDia;
    const tbc = document.getElementById("tb-contagem");
    if (tbc) tbc.innerHTML = totalDia ? `${filtrando ? `${lista.length} de ${totalDia} jogos` : `${totalDia} jogo${totalDia > 1 ? "s" : ""}`}${nFiltros(estado.filtro) ? ` · <button class="link" type="button" id="l-limpar2">limpar filtros</button>` : ""}` : "";
    const contagem = "";
    if (!lista.length) {
      let dica = "";
      if (!totalDia) {
        const prox = todasPartidas().find((x) => x.dia > estado.dia && x.dia <= diaMax());
        const ant = [...todasPartidas()].reverse().find((x) => x.dia < estado.dia && x.dia >= diaMin());
        if (prox) dica = `<button class="link" type="button" data-dia="${prox.dia}">Ir para o próximo dia com jogos (${dataCurta(prox.p.d)})</button>`;
        else if (ant) dica = `<button class="link" type="button" data-dia="${ant.dia}">Ir para o último dia com jogos (${dataCurta(ant.p.d)})</button>`;
        else dica = "Não há jogos nos 3 dias antes nem nos 3 dias depois de hoje.";
      } else dica = "Os filtros estão escondendo todos os jogos deste dia.";
      corpo.innerHTML = `${contagem}<div class="vazio"><strong>${totalDia ? "Nenhum jogo com esses filtros" : "Nenhum jogo neste dia"}</strong>${dica}</div>`;
    } else {
      let html = "";
      if (estado.ordem === "comp") {
        const grupos = {};
        for (const x of lista) (grupos[x.code] = grupos[x.code] || []).push(x);
        for (const c of compsOrd()) if (grupos[c]) {
          html += cabGrupo(c, grupos[c].length);
          if (!recolhidas.has(c)) html += grupos[c].map((x) => linhaJogo(x.code, x.p)).join("");
        }
      } else {
        let ultimo = null;
        for (const x of lista) {
          if (x.code !== ultimo) { html += cabGrupo(x.code); ultimo = x.code; }
          if (!recolhidas.has(x.code)) html += linhaJogo(x.code, x.p);
        }
      }
      corpo.innerHTML = `${contagem}<div class="tabela-jogos ${TEM_ODDS ? "com-odds" : ""}">${CAB_COLUNAS}${html}</div>${NOTA_ODD}`;
    }
    const l2 = document.getElementById("l-limpar2");
    if (l2) l2.addEventListener("click", () => { estado.filtro = copiaFiltro(FILTRO_VAZIO); salvarFiltro(); telaJogos(); });
    const dest = document.getElementById("destaques");
    if (dest) {
      if (estado.sel) atualizarPainelJogo();
      else dest.innerHTML = destaquesDoDia(todasPartidas().filter((x) => x.dia === estado.dia));
    }
  }

  function cabGrupo(code, n) {
    const fechado = recolhidas.has(code);
    const info = COMP_INFO[code];
    return `<div class="grupo-v2">${estrelaLiga(code, 16)}
      <button class="grupo-toggle" type="button" data-recolher="${code}" aria-expanded="${!fechado}">
      <svg class="seta" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>
      ${seloComp(code)}<span class="pais">${h(info ? info.pais : "")}</span><b>${h(DADOS.competicoes[code].nome || nomeComp(code))}</b>
      ${n ? `<span class="qtd-grupo">${n}</span>` : ""}</button></div>`;
  }

  const CAB_COLUNAS = `<div class="jogo-v2 cab-colunas" aria-hidden="true"><span></span><span>Horário</span><span class="situacao">Situação</span><span>Jogo</span>
    <span class="chance">Chance de vitória</span><span class="odds">Odd justa*</span>${TEM_ODDS ? '<span class="odds">Odd casas**</span>' : ""}<span class="gols">Placar</span></div>`;
  const NOTA_ODD = `<p class="nota-odd">*Odd justa = 1 ÷ chance calculada pela projeção do site. Não é a odd das casas de apostas: serve para comparar com ela.${TEM_ODDS ? "<br>**Odd casas = média das casas de apostas (The Odds API). Em verde quando está acima da odd justa, ou seja, quando há valor segundo a projeção." : ""}</p>`;

  function linhaJogo(code, p) {
    const fim = encerrada(p), vivo = aoVivo(p);
    const k = chaveFav(code, p), fav = favoritos.has(k);
    let oddH = "", oddA = "", chance = "", casas = "";
    if (p.h && p.a) {
      const { proj } = projecaoDo(code, p);
      oddH = fOdd(proj.p1); oddA = fOdd(proj.p2);
      chance = `<div class="barra3"><span style="width:${proj.p1 * 100}%"></span><span style="width:${proj.px * 100}%"></span><span style="width:${proj.p2 * 100}%"></span></div>
        <small><span class="c">${fProb(proj.p1)}</span><span>${fProb(proj.px)}</span><span class="f">${fProb(proj.p2)}</span></small>`;
      if (TEM_ODDS) {
        const o = oddsDo(code, p);
        const cel = (odd, prob) => (odd ? `<span class="${temValor(odd, prob) ? "valor" : ""}">${fNum(odd, 2)}</span>` : "<span>–</span>");
        casas = `<span class="odds casas" title="${o ? `Média de ${o.n} casas · melhor: ${fNum(o.mc, 2)} / ${fNum(o.mf, 2)}` : "Sem odds das casas para este jogo"}">${o ? cel(o.c, proj.p1) + cel(o.f, proj.p2) : ""}</span>`;
      }
    } else if (TEM_ODDS) casas = '<span class="odds casas"></span>';
    const vH = fim && p.fh > p.fa, vA = fim && p.fa > p.fh;
    const perdeu = (v, outro) => (fim && !v && outro ? "apagado" : "");
    const placar = (g, g1) => (fim || vivo ? `<b>${g ?? "–"}</b>${g1 != null ? ` <span>(${g1})</span>` : ""}` : "");
    const marcaFav = (tid) => (favTimes.has(String(tid)) ? `<i class="fav-time" title="Time favorito">${ESTRELA_SVG(12)}</i>` : "");
    return `<div class="jogo-v2" role="link" tabindex="0" data-ir="jogo/${code}/${p.i}">
      ${botaoEstrela("data-fav", k, fav, "este jogo")}
      <span class="quando">${vivo && p.vv && p.vv.min ? `<span>${hora(p.d)}</span><b class="vivo-min">${h(p.vv.min)}</b>` : `<span>${DIA_CURTO(p.d)}</span><b>${hora(p.d)}</b>`}</span>
      <span class="situacao">${ROT_STATUS(p)}</span>
      <span class="equipes">
        <span class="${vH ? "venc" : perdeu(vH, vA)}">${escudo(p.h)}<span>${h(nomeTime(p.h))}</span>${marcaFav(p.h)}</span>
        <span class="${vA ? "venc" : perdeu(vA, vH)}">${escudo(p.a)}<span>${h(nomeTime(p.a))}</span>${marcaFav(p.a)}</span>
      </span>
      <span class="chance" title="Chance de vitória do mandante, empate e visitante">${chance}</span>
      <span class="odds" title="Odd justa: 1 ÷ chance calculada. Não é a odd da casa de apostas.">${oddH ? `<span>${oddH}</span><span>${oddA}</span>` : ""}</span>
      ${casas}
      <span class="gols"><span>${placar(p.fh, p.hh)}</span><span>${placar(p.fa, p.ha)}</span></span>
    </div>`;
  }

  function destaquesDoDia(doDia) {
    let validos = doDia.filter((x) => x.p.h && x.p.a);
    const abertos = validos.filter((x) => !encerrada(x.p));
    if (abertos.length) validos = abertos;
    if (!validos.length) return "";
    validos = validos.map((x) => ({ ...x, ...projecaoDo(x.code, x.p) }));
    const top = (fn, n = 4) => [...validos].sort((a, b) => fn(b) - fn(a)).slice(0, n);
    const item = (x, valor) => `<li><span class="data">${hora(x.p.d)}</span>${seloComp(x.code)}
      <button type="button" data-ir="jogo/${x.code}/${x.p.i}">${h(nomeTime(x.p.h))} × ${h(nomeTime(x.p.a))}</button>
      <span class="res">${valor}</span></li>`;
    const bloco = (titulo, lista) => `<div class="painel"><div class="painel-cab"><h3>${titulo}</h3></div>
      <div class="painel-corpo"><ul class="lista-mini">${lista}</ul></div></div>`;
    return `
      ${bloco("Maiores favoritos", top((x) => Math.max(x.proj.p1, x.proj.p2)).map((x) => {
        const casa = x.proj.p1 >= x.proj.p2;
        return item(x, `${casa ? escudo(x.p.h) : escudo(x.p.a)} ${fProb(casa ? x.proj.p1 : x.proj.p2)}`);
      }).join(""))}
      ${TEM_ODDS ? (() => {
        const comValor = validos.map((x) => {
          const o = oddsDo(x.code, x.p);
          if (!o) return null;
          const opcoes = [["c", o.c, x.proj.p1, nomeTime(x.p.h)], ["e", o.e, x.proj.px, "Empate"], ["f", o.f, x.proj.p2, nomeTime(x.p.a)]]
            .map(([k, odd, pr, rot]) => ({ k, odd, pr, rot, v: pctValor(odd, pr) })).filter((y) => y.v != null && y.v > 0);
          if (!opcoes.length) return null;
          opcoes.sort((a, b) => b.v - a.v);
          return { ...x, melhor: opcoes[0] };
        }).filter(Boolean).sort((a, b) => b.melhor.v - a.melhor.v).slice(0, 4);
        return comValor.length ? bloco("Maior valor nas odds", comValor.map((x) => item(x, `<span class="valor-tag" title="${h(x.melhor.rot)}: odd média ${fNum(x.melhor.odd, 2)} contra odd justa ${fOdd(x.melhor.pr)}">${h(x.melhor.rot)} +${Math.round(x.melhor.v)}%</span>`)).join("")) : "";
      })() : ""}
      ${bloco("Mais gols esperados", top((x) => x.proj.lh + x.proj.la).map((x) => item(x, fNum(x.proj.lh + x.proj.la, 1))).join(""))}
      ${bloco("Ambas marcam", top((x) => x.proj.btts).map((x) => item(x, fProb(x.proj.btts))).join(""))}`;
  }

  // ------------------------------------------------------------ JOGO (página)
  const ABAS_JOGO = [
    ["inteiro", "Jogo inteiro"], ["tempos", "1º/2º tempo"], ["overs", "Overs"],
    ["proj", "Projeções"], ["tabela", "Classificação e artilharia"], ["rank", "Power Ranking"],
  ];

  // linhas das tabelas centrais: [rótulo, contagem(b), base(b), direção] ou [rótulo, soma(b), base(b), direção, "med"]
  const L = {
    jogos: ["Total de partidas", (b) => b.j, null, 0, "num"],
    vit: ["Vitórias", (b) => b.v, (b) => b.j, 1], emp: ["Empates", (b) => b.e, (b) => b.j, 0],
    der: ["Derrotas", (b) => b.d, (b) => b.j, -1],
    mp: ["Marcou primeiro", (b) => b.mp, (b) => b.j - b.pdes, 1], sp: ["Sofreu primeiro", (b) => b.sp, (b) => b.j - b.pdes, -1],
    marcou: ["Marcou em", (b) => b.j - b.sm, (b) => b.j, 1], sofreu: ["Sofreu em", (b) => b.j - b.cs, (b) => b.j, -1],
    btts: ["Ambas marcam", (b) => b.btts, (b) => b.j, 0], cs: ["Sem sofrer gol", (b) => b.cs, (b) => b.j, 1],
    sm: ["Sem marcar", (b) => b.sm, (b) => b.j, -1],
    gm: ["Gols marcados", (b) => b.gm, (b) => b.j, 1, "med"], gs: ["Gols sofridos", (b) => b.gs, (b) => b.j, -1, "med"],
    gt: ["Total de gols", (b) => b.gm + b.gs, (b) => b.j, 0, "med"], pts: ["Pontos", (b) => b.pts, (b) => b.j, 1, "med"],
    v1: ["Vencendo no intervalo", (b) => b.v1, (b) => b.j1, 1], e1: ["Empatando no intervalo", (b) => b.e1, (b) => b.j1, 0],
    d1: ["Perdendo no intervalo", (b) => b.d1, (b) => b.j1, -1],
    m1: ["Marcou no 1º tempo", (b) => b.m1, (b) => b.j1, 1], s1: ["Sofreu no 1º tempo", (b) => b.s1, (b) => b.j1, -1],
    ht05: ["Gol no 1º tempo", (b) => b.ht05, (b) => b.j1, 0], ht15: ["Mais de 1,5 no 1º tempo", (b) => b.ht15, (b) => b.j1, 0],
    gm1: ["Gols marcados no 1º tempo", (b) => b.gm1, (b) => b.j1, 1, "med"], gs1: ["Gols sofridos no 1º tempo", (b) => b.gs1, (b) => b.j1, -1, "med"],
    m2: ["Marcou no 2º tempo", (b) => b.m2, (b) => b.j1, 1], s2: ["Sofreu no 2º tempo", (b) => b.s2, (b) => b.j1, -1],
    st05: ["Gol no 2º tempo", (b) => b.st05, (b) => b.j1, 0], st15: ["Mais de 1,5 no 2º tempo", (b) => b.st15, (b) => b.j1, 0],
    gm2: ["Gols marcados no 2º tempo", (b) => b.gm2, (b) => b.j1, 1, "med"], gs2: ["Gols sofridos no 2º tempo", (b) => b.gs2, (b) => b.j1, -1, "med"],
    vir: ["Viradas a favor", (b) => b.vir, null, 1, "num"], ced: ["Viradas sofridas", (b) => b.ced, null, -1, "num"],
    ov05: ["Mais de 0,5", (b) => b.ov[0], (b) => b.j, 0], ov15: ["Mais de 1,5", (b) => b.ov[1], (b) => b.j, 0],
    ov25: ["Mais de 2,5", (b) => b.ov[2], (b) => b.j, 0], ov35: ["Mais de 3,5", (b) => b.ov[3], (b) => b.j, 0],
    ov45: ["Mais de 4,5", (b) => b.ov[4], (b) => b.j, 0],
    un15: ["Menos de 1,5", (b) => b.j - b.ov[1], (b) => b.j, 0], un25: ["Menos de 2,5", (b) => b.j - b.ov[2], (b) => b.j, 0],
    un35: ["Menos de 3,5", (b) => b.j - b.ov[3], (b) => b.j, 0],
    btts25: ["Ambas marcam e mais de 2,5", (b) => b.btts25, (b) => b.j, 0],
  };
  const TABELAS_JOGO = {
    inteiro: ["jogos", "vit", "emp", "der", "marcou", "sofreu", "btts", "cs", "sm", "|", "gm", "gs", "gt", "pts"],
    tempos: ["#1º tempo", "v1", "e1", "d1", "m1", "s1", "ht05", "ht15", "gm1", "gs1", "#2º tempo", "m2", "s2", "st05", "st15", "gm2", "gs2", "#Viradas", "vir", "ced"],
    tempo: ["jogos", "vit", "emp", "der", "marcou", "sofreu", "btts", "cs", "sm", "|", "gm", "gs", "gt", "#Gols no tempo", "ov05", "ov15", "ov25"],
    overs: ["#Gols no jogo", "ov05", "ov15", "ov25", "ov35", "ov45", "|", "un15", "un25", "un35", "#Ambas marcam", "btts", "btts25", "#1º tempo", "ht05", "ht15"],
  };

  function corPct(pct, dir) {
    if (pct == null || !dir) return "";
    const bom = dir > 0 ? pct >= 60 : pct <= 35;
    const ruim = dir > 0 ? pct <= 35 : pct >= 60;
    return bom ? "bom" : ruim ? "ruim" : "medio";
  }

  function tabelaCentral(chave, bH, bA) {
    let html = "";
    for (const k of TABELAS_JOGO[chave]) {
      if (k === "|") { html += `<tr class="sep"><td colspan="5"></td></tr>`; continue; }
      if (k[0] === "#") { html += `<tr class="secao"><td colspan="5">${k.slice(1)}</td></tr>`; continue; }
      const [rot, cont, base, dir, tipo] = L[k];
      const cel = (b) => {
        const n = cont(b), d = base ? base(b) : null;
        if (tipo === "num") return [n, "–", ""];
        if (tipo === "med") return [n, d ? fNum(n / d, 2) : "–", ""];
        const pct = d ? (100 * n) / d : null;
        return [n, fPct(pct), corPct(pct, dir)];
      };
      const [nH, vH, cH] = cel(bH), [nA, vA, cA] = cel(bA);
      html += `<tr><td class="n">${nH}</td><td class="p ${cH}">${vH}</td><td class="rot">${rot}</td><td class="p ${cA}">${vA}</td><td class="n">${nA}</td></tr>`;
    }
    return `<table class="stats-central"><tbody>${html}</tbody></table>`;
  }

  // jogos do time antes da data do jogo, no recorte escolhido
  function jogosAntes(code, tid, iso, lado) {
    const t = preps[code].times[tid];
    if (!t) return [];
    let l = t.jogos.filter((j) => j.p.d < iso);
    if (lado === "casa") l = l.filter((j) => j.casa);
    if (lado === "fora") l = l.filter((j) => !j.casa);
    l = l.map((j) => j.p);
    return estado.ultimos ? l.slice(-estado.ultimos) : l;
  }

  // bolinha de quem marcou primeiro: bola de futebol = o time marcou primeiro, bola branca = sofreu primeiro
    const BOLA_FUT = `<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><defs><clipPath id="cb"><circle cx="10" cy="10" r="8.6"/></clipPath></defs><circle cx="10" cy="10" r="8.6" fill="#fff"/><g clip-path="url(#cb)"><g fill="#15212B"><polygon points="10.00,6.70 13.14,8.98 11.94,12.67 8.06,12.67 6.86,8.98"/><polygon points="18.35,-1.49 19.65,2.54 16.23,5.02 12.81,2.54 14.11,-1.49"/><polygon points="23.51,14.39 20.08,16.88 16.66,14.39 17.97,10.36 22.20,10.36"/><polygon points="10.00,24.20 6.58,21.71 7.88,17.69 12.12,17.69 13.42,21.71"/><polygon points="-3.51,14.39 -2.20,10.36 2.03,10.36 3.34,14.39 -0.08,16.88"/><polygon points="1.65,-1.49 5.89,-1.49 7.19,2.54 3.77,5.02 0.35,2.54"/></g><g stroke="#15212B" stroke-width="0.8"><line x1="10.00" y1="6.70" x2="10.00" y2="2.60"/><line x1="13.14" y1="8.98" x2="17.04" y2="7.71"/><line x1="11.94" y1="12.67" x2="14.35" y2="15.99"/><line x1="8.06" y1="12.67" x2="5.65" y2="15.99"/><line x1="6.86" y1="8.98" x2="2.96" y2="7.71"/></g></g><circle cx="10" cy="10" r="8.6" fill="none" stroke="#15212B" stroke-width="1.1"/></svg>`;
  const BOLA_BRANCA = `<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="10" cy="10" r="8.6" fill="#fff" stroke="var(--tinta-3)" stroke-width="1.3"/></svg>`;
  const BOLA_DUVIDA = `<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="10" cy="10" r="8.6" fill="none" stroke="var(--tinta-3)" stroke-width="1.3" stroke-dasharray="2.5 2"/><text x="10" y="14" text-anchor="middle" font-size="11" font-weight="700" fill="var(--tinta-3)" font-family="sans-serif">?</text></svg>`;
  function bolaPrimeiro(p, tid) {
    if (!encerrada(p)) return `<span class="bola"></span>`;
    const casa = String(p.h) === String(tid);
    const pg = casa ? M.primeiroGol(p.fh, p.fa, p.hh, p.ha) : M.primeiroGol(p.fa, p.fh, p.ha, p.hh);
    if (pg === "eu") return `<span class="bola" title="Marcou primeiro">${BOLA_FUT}</span>`;
    if (pg === "eles") return `<span class="bola" title="Sofreu primeiro">${BOLA_BRANCA}</span>`;
    if (pg === "?") return `<span class="bola" title="Não dá para saber quem marcou primeiro: os dois times marcaram no mesmo tempo">${BOLA_DUVIDA}</span>`;
    return `<span class="bola"></span>`;
  }

  // placar só do 1º ou do 2º tempo (jogos sem placar do intervalo ficam de fora)
  function jogosDoTempo(jogos, t) {
    return jogos.filter((p) => p.hh != null && p.ha != null).map((p) => Object.assign({}, p, {
      fh: t === 1 ? p.hh : p.fh - p.hh, fa: t === 1 ? p.ha : p.fa - p.ha, hh: null, ha: null,
    }));
  }

  function controleUltimos() {
    return `<div class="alternar" role="group" aria-label="Quantidade de jogos">
          <button type="button" data-ultimos="5" aria-pressed="${estado.ultimos === 5}">Últimos 5</button>
          <button type="button" data-ultimos="0" aria-pressed="${!estado.ultimos}">Todos</button></div>`;
  }

  // quantos jogos terminaram com 0, 1, 2, 3, 4 e 5+ gols
  function distribuicaoGols(jogos, tid, lado, cls) {
    const titulo = lado === "casa" ? "Gols nos jogos do mandante (casa)" : lado === "fora" ? "Gols nos jogos do visitante (fora)" : "Gols nos jogos de " + nomeTime(tid);
    const fim = jogos.filter(encerrada);
    const cont = [0, 0, 0, 0, 0, 0];
    for (const p of fim) cont[Math.min(5, p.fh + p.fa)]++;
    const n = fim.length, max = Math.max(1, ...cont);
    const linhas = cont.map((c, i) => `<div class="dist-linha"><span class="dist-rot">${i === 5 ? "5+" : i} ${i === 1 ? "gol" : "gols"}</span>
      <div class="dist-trilho ${cls}"><span style="width:${(c / max) * 100}%"></span></div>
      <span class="dist-val"><b>${n ? Math.round((100 * c) / n) : 0}%</b> <span class="sub">${c}</span></span></div>`).join("");
    const media = n ? fNum(fim.reduce((s, p) => s + p.fh + p.fa, 0) / n, 2) : "–";
    return `<div class="lateral">
      <div class="lateral-cab"><h3>${h(titulo)}</h3>${controleUltimos()}</div>
      ${n ? `<div class="dist">${linhas}</div><p class="legenda-bolas"><span>${n} jogos · média de ${media} gols por jogo</span></p>` : `<p class="sub">Sem jogos encerrados antes desta partida.</p>`}
    </div>`;
  }

  function listaLateral(code, tid, jogos, lado, tempo) {
    const base = lado === "casa" ? "Jogos do mandante (casa)" : lado === "fora" ? "Jogos do visitante (fora)" : "Jogos de " + nomeTime(tid);
    const titulo = tempo ? base.replace(/^Jogos/, `${tempo}º tempo`) : base;
    const itens = jogos.slice().reverse().map((p) => {
      const casa = String(p.h) === String(tid);
      const gm = casa ? p.fh : p.fa, gs = casa ? p.fa : p.fh;
      const r = gm > gs ? "V" : gm === gs ? "E" : "D";
      return `<li class="clicavel" data-ir="jogo/${code}/${p.i}" role="link" tabindex="0">
        <span class="data">${dataCurta(p.d)}</span>
        <span class="conf"><span class="${casa ? "eu" : ""}">${h(nomeTime(p.h))}</span> <b>${p.fh} x ${p.fa}</b> <span class="${!casa ? "eu" : ""}">${h(nomeTime(p.a))}</span></span>
        <span class="r ${r}">${r}</span></li>`;
    }).join("");
    return `<div class="lateral">
      <div class="lateral-cab"><h3>${h(titulo)}</h3>
        ${controleUltimos()}</div>
      ${itens ? `<ul class="lista-lateral">${itens}</ul>` : `<p class="sub">Sem jogos encerrados antes desta partida.</p>`}
    </div>`;
  }

  // modo lado a lado: no PC o jogo abre à direita da lista
  const LARGURA_LADO = 1024;
  const ladoALado = () => window.innerWidth >= LARGURA_LADO;
  estado.sel = null; // { code, id } do jogo aberto no painel

  function telaJogo(code, id) {
    const p = acharPartida(code, id);
    if (!p) { estado.sel = null; telaJogos(); return; }
    const dia = diaDe(p.d);
    if (ladoALado() && dia >= diaMin() && dia <= diaMax()) {
      const mesmaTela = document.querySelector(".jogos-pagina") && estado.dia === dia;
      estado.dia = dia; estado.sel = { code, id: String(id) };
      if (mesmaTela) atualizarPainelJogo(); else telaJogos();
      return;
    }
    estado.sel = null;
    estado.dia = dia;
    const r = htmlJogo(code, p);
    const voltar = `<button class="botao-q texto voltar-v2" type="button" data-voltar>‹ Jogos de ${dataCurta(p.d)}</button>`;
    app.innerHTML = `${voltar}<section class="painel jogo-pagina">${r}</section>`;
  }

  function atualizarPainelJogo() {
    const pagina = document.querySelector(".jogos-pagina");
    const aside = document.getElementById("destaques");
    if (!pagina || !aside) return;
    const sel = estado.sel && acharPartida(estado.sel.code, estado.sel.id);
    pagina.classList.toggle("com-jogo", !!sel);
    document.querySelectorAll(".jogo-v2[aria-current]").forEach((el) => el.removeAttribute("aria-current"));
    if (sel) {
      const linha = document.querySelector(`.jogo-v2[data-ir="jogo/${estado.sel.code}/${sel.i}"]`);
      if (linha) linha.setAttribute("aria-current", "true");
      aside.className = "painel jogo-pagina detalhe-lado";
      aside.setAttribute("aria-label", "Jogo selecionado");
      aside.innerHTML = `<button class="fechar-jogo" type="button" data-voltar title="Fechar o jogo e voltar aos destaques" aria-label="Fechar o jogo">✕</button>${htmlJogo(estado.sel.code, sel)}`;
    } else {
      aside.className = "destaques";
      aside.setAttribute("aria-label", "Destaques do dia");
      aside.innerHTML = destaquesDoDia(todasPartidas().filter((x) => x.dia === estado.dia));
    }
  }

  function htmlJogo(code, p) {
    const comp = DADOS.competicoes[code];
    const fim = encerrada(p), vivo = aoVivo(p), temTimes = p.h && p.a;
    const rodada = p.r ? `Rodada ${p.r}` : FASES[p.f] || "";
    const grupo = p.g ? " · " + p.g.replace("GROUP_", "Grupo ") : "";
    const pj = temTimes ? projecaoDo(code, p) : null;
    const posH = temTimes ? posicaoNaTabela(code, p.h) : null, posA = temTimes ? posicaoNaTabela(code, p.a) : null;
    const k = chaveFav(code, p), fav = favoritos.has(k);
    const estrela = (extra) => `<span class="fav-jogo">${botaoEstrela("data-fav", k, fav, "este jogo", 18, extra)}<span class="sub">favoritar jogo</span></span>`;
    const oddsJ = oddsDo(code, p);
    const ladoTime = (tid, pos, prob, cls, oddCasa) => `<div class="cab-time ${cls}">
        <div class="cab-time-nome"><a href="#time/${code}/${tid}"><h2>${h(nomeLongo(tid))}</h2></a>${estrelaTime(tid, 18)}</div>
        <div class="cab-time-linha">${pos ? `<span class="posicao">${pos.pos}º</span>` : ""}${escudo(tid, "esc esc-g")}</div>
        ${oddCasa ? `<span class="sub odd-casa ${temValor(oddCasa, prob) ? "valor" : ""}" title="Média das casas de apostas">casas <b>${fNum(oddCasa, 2)}</b>${temValor(oddCasa, prob) ? " · valor" : ""}</span>` : ""}
        ${prob != null ? `<span class="sub" title="1 ÷ chance calculada pela projeção. Não é a odd da casa de apostas."><span>chance ${fProb(prob)}</span><i class="ponto"> · </i><span>odd justa <b>${fOdd(prob)}</b></span></span>` : ""}</div>`;
    let centro;
    if (fim || vivo) {
      centro = `<span class="situacao-g ${vivo ? "vivo" : ""}">${vivo && p.vv && p.vv.min ? `<span class="vivo-min">${h(p.vv.min)}</span>` : STATUS[p.s] || p.s}</span>
        <div class="placar-num">${p.fh ?? "–"}<span class="sep">x</span>${p.fa ?? "–"}</div>
        ${p.hh != null ? `<div class="sub">(${p.hh}x${p.ha}) no 1º tempo</div>` : ""}
        ${p.du && p.du !== "REGULAR" ? `<div class="sub">decidido na prorrogação/pênaltis</div>` : ""}`;
    } else {
      centro = `<span class="situacao-g">${STATUS[p.s] || p.s}</span><div class="placar-hora">${hora(p.d)}</div>
        ${pj ? `<div class="sub">empate ${fProb(pj.proj.px)} · odd justa ${fOdd(pj.proj.px)}</div>` : ""}`;
    }
    const cab = `
      <div class="cab-jogo">
        <div class="cab-meta">${estrelaLiga(code, 16)}${seloComp(code)}<span>${h(comp.nome || nomeComp(code))} · ${rodada}${grupo} · ${h(dataLonga(p.d))} · ${hora(p.d)}</span></div>
        <div class="cab-grade">
          ${ladoTime(p.h, posH, pj ? pj.proj.p1 : null, "c", oddsJ && oddsJ.c)}
          <div class="cab-centro">${centro}${estrela("")}</div>
          ${ladoTime(p.a, posA, pj ? pj.proj.p2 : null, "f", oddsJ && oddsJ.f)}
        </div>
      </div>`;
    if (!temTimes) return cab;

    const listaAbas = temAoVivo(p) ? [["aovivo", vivo ? '<span class="vivo-min">Ao vivo</span>' : "Ao vivo"], ["escalacoes", "Escalações"], ...ABAS_JOGO] : ABAS_JOGO;
    const chaveJogo = code + ":" + p.i;
    if (estado.abaDoJogo !== chaveJogo) { estado.abaDoJogo = chaveJogo; estado.abaManual = false; }
    let aba = listaAbas.some((a) => a[0] === estado.abaJogo) ? estado.abaJogo : "inteiro";
    if (!estado.abaManual && vivo && temAoVivo(p)) aba = "aovivo";
    const abas = `<nav class="abas-jogo" aria-label="Seções do jogo">${listaAbas.map(([id, rot]) =>
      `<button type="button" data-abajogo="${id}" aria-current="${id === aba}">${rot}</button>`).join("")}</nav>`;

    let conteudo;
    if (TABELAS_JOGO[aba]) {
      const lado = estado.recorte === "total";
      const ladoH = lado ? "total" : "casa", ladoA = lado ? "total" : "fora";
      let jh = jogosAntes(code, p.h, p.d, ladoH), ja = jogosAntes(code, p.a, p.d, ladoA);
      const tempo = aba === "tempos" ? (estado.tempo === 2 ? 2 : 1) : 0;
      if (tempo) { jh = jogosDoTempo(jh, tempo); ja = jogosDoTempo(ja, tempo); }
      const bH = M.bucketDeJogos(jh, p.h), bA = M.bucketDeJogos(ja, p.a);
      const titulos = { inteiro: "Jogo inteiro", tempos: `${tempo}º tempo`, overs: "Overs" };
      const lateral = (tid, jogos, ladoX, cls) => (aba === "overs" ? distribuicaoGols(jogos, tid, ladoX, cls) : listaLateral(code, tid, jogos, ladoX, tempo));
      const botoesTempo = tempo ? `<div class="tempo-botoes" role="group" aria-label="Tempo">
          <button type="button" data-tempo="1" aria-pressed="${tempo === 1}">1º tempo</button>
          <button type="button" data-tempo="2" aria-pressed="${tempo === 2}">2º tempo</button></div>` : "";
      conteudo = `<div class="tres-colunas">
        ${lateral(p.h, jh, ladoH, "c")}
        <div class="centro-stats">
          <div class="centro-cab"><h3>${titulos[aba]}</h3>
            <div class="alternar" role="group" aria-label="Recorte">
              <button type="button" data-recorte="lado" aria-pressed="${!lado}">Casa-Fora</button>
              <button type="button" data-recorte="total" aria-pressed="${lado}">Total</button></div></div>
          <div class="centro-nomes"><span class="c">${h(nomeTime(p.h))}</span><span class="f">${h(nomeTime(p.a))}</span></div>
          ${tabelaCentral(tempo ? "tempo" : aba, bH, bA)}
          ${botoesTempo}
          <p class="sub nota">${tempo ? `Cada jogo conta só pelo placar do ${tempo}º tempo. ` : ""}${fim ? "Números de antes desta partida. " : ""}${estado.ultimos ? "Considerando os últimos 5 jogos" : "Considerando todos os jogos"} ${lado ? "no total" : "do mandante em casa e do visitante fora"}.</p>
        </div>
        ${lateral(p.a, ja, ladoA, "f")}
      </div>`;
    } else if (aba === "aovivo") {
      conteudo = abaAoVivo(p);
    } else if (aba === "escalacoes") {
      conteudo = abaEscalacoes(p);
    } else if (aba === "proj") {
      conteudo = abaProjecoes(code, p, pj);
    } else if (aba === "tabela") {
      conteudo = abaClassificacao(code, p);
    } else {
      conteudo = abaRanking(code, p);
    }
    return `${cab}${abas}<div class="aba-conteudo">${conteudo}</div>`;
  }

  function abaRanking(code, p) {
    const r = M.ranking(preps[code], 5);
    if (!r.length) return `<div class="painel-corpo"><div class="vazio"><strong>Sem jogos encerrados</strong>O ranking aparece depois da primeira rodada.</div></div>`;
    const maxA = Math.max(...r.map((x) => Math.max(x.ataque || 0, x.defesa || 0)), 1.5);
    const cls = (tid) => (String(tid) === String(p.h) ? "destaque-c" : String(tid) === String(p.a) ? "destaque-f" : "");
    const xh = r.find((x) => String(x.t) === String(p.h)), xa = r.find((x) => String(x.t) === String(p.a));
    const resumo = xh && xa ? `<div class="rk-duelo">
        <div class="c"><span>${h(nomeTime(p.h))}</span><b>${Math.round(xh.elo)}</b><small>${xh.pos}º · ${xh.var5 >= 0 ? "+" : "−"}${Math.abs(Math.round(xh.var5))} nos últimos 5</small></div>
        <div class="dif"><small>diferença</small><b>${xh.elo - xa.elo >= 0 ? "+" : "−"}${Math.abs(Math.round(xh.elo - xa.elo))}</b></div>
        <div class="f"><span>${h(nomeTime(p.a))}</span><b>${Math.round(xa.elo)}</b><small>${xa.pos}º · ${xa.var5 >= 0 ? "+" : "−"}${Math.abs(Math.round(xa.var5))} nos últimos 5</small></div></div>` : "";
    return `<div class="painel-corpo">${resumo}
      <div class="sub-abas"><span class="sub">Power Ranking · ${h(DADOS.competicoes[code].nome || nomeComp(code))}</span>
        <button class="link" type="button" data-ir="ranking/${code}">Abrir o ranking completo</button></div>
      <div class="tabela-rolagem"><table class="dados rk">
        <thead><tr><th class="esq">#</th><th class="esq">Time</th><th title="Posição na classificação do campeonato">Tabela</th><th>Elo</th><th>Últimos 5</th><th class="ocultar-celular">Evolução</th>
          <th class="ocultar-celular" title="Gols marcados por jogo em relação à média da liga">Ataque</th>
          <th class="ocultar-celular" title="Gols sofridos por jogo em relação à média da liga (menor é melhor)">Defesa</th><th class="esq ocultar-celular">Forma</th></tr></thead>
        <tbody>${r.map((x) => `<tr class="clicavel ${cls(x.t)}" data-ir="time/${code}/${x.t}">
          <td class="esq"><span class="pos">${x.pos}</span></td>
          <td class="esq"><span class="time-celula">${escudo(x.t)}<span>${h(nomeTime(x.t))}</span></span></td>
          <td>${(() => { const pt = posicaoNaTabela(code, x.t); return pt ? pt.pos + "º" : "–"; })()}</td>
          <td class="forte">${Math.round(x.elo)}</td>
          <td class="${x.var5 >= 0 ? "var-mais" : "var-menos"}">${x.var5 >= 0 ? "+" : "−"}${Math.abs(Math.round(x.var5))}</td>
          <td class="ocultar-celular">${sparkline(x.hist)}</td>
          <td class="ocultar-celular">${fNum(x.ataque, 2)}<span class="indice" style="width:${(x.ataque / maxA) * 40}px"></span></td>
          <td class="ocultar-celular">${fNum(x.defesa, 2)}<span class="indice def" style="width:${(x.defesa / maxA) * 40}px"></span></td>
          <td class="esq ocultar-celular">${forma(x.forma)}</td></tr>`).join("")}</tbody></table></div></div>`;
  }

  function abaProjecoes(code, p, pj) {
    const { foto, proj, previa } = pj;
    const fim = encerrada(p);
    const tot = fim ? p.fh + p.fa : null;
    const poucos = foto.h.geral.j < 3 || foto.a.geral.j < 3;
    const mercado = (rot, prob, real) => `<div class="mercado"><span>${rot}</span><b>${fProb(prob)}</b><small>odd justa ${fOdd(prob)}</small>${real != null ? ` <small class="${real ? "ok" : "nok"}">${real ? "bateu" : "não bateu"}</small>` : ""}</div>`;
    const eH = posElo(code, p.h), eA = posElo(code, p.a);
    return `<div class="painel-corpo proj-aba">
      ${poucos ? `<p class="dica">Um dos times tem menos de 3 jogos na competição, então a projeção ainda é pouco confiável.</p>` : ""}
      <p class="sub" style="margin:0 0 8px">${previa ? "Projeção calculada com os números de antes do jogo. " : ""}Gols esperados: ${h(nomeTime(p.h))} ${fNum(proj.lh, 2)} × ${fNum(proj.la, 2)} ${h(nomeTime(p.a))}.</p>
      <div class="barra3" role="img" aria-label="Mandante ${fProb(proj.p1)}, empate ${fProb(proj.px)}, visitante ${fProb(proj.p2)}"><span style="width:${proj.p1 * 100}%"></span><span style="width:${proj.px * 100}%"></span><span style="width:${proj.p2 * 100}%"></span></div>
      <div class="proj-1x2">
        <div class="c"><b>${fProb(proj.p1)}</b><small>${h(nomeTime(p.h))} · odd ${fOdd(proj.p1)}</small></div>
        <div><b>${fProb(proj.px)}</b><small>Empate · odd ${fOdd(proj.px)}</small></div>
        <div class="f"><b>${fProb(proj.p2)}</b><small>${h(nomeTime(p.a))} · odd ${fOdd(proj.p2)}</small></div>
      </div>
      ${(() => {
        const o = oddsDo(code, p);
        if (!o) return TEM_ODDS ? `<p class="sub">Sem odds das casas para este jogo.</p>` : "";
        const lin = (rot, odd, melhor, pr) => `<tr><td class="esq">${rot}</td><td>${fProb(pr)}</td><td>${fOdd(pr)}</td><td>${fNum(odd, 2)}</td><td>${fNum(melhor, 2)}</td>
          <td class="${temValor(odd, pr) ? "ok" : "sub"}">${pctValor(odd, pr) == null ? "–" : (pctValor(odd, pr) > 0 ? "+" : "") + Math.round(pctValor(odd, pr)) + "%"}</td></tr>`;
        return `<div class="tabela-rolagem"><table class="dados odds-tabela"><thead><tr><th class="esq">Resultado</th><th>Chance</th><th>Odd justa</th><th>Média das casas</th><th>Melhor odd</th><th title="Odd média × chance − 1">Valor</th></tr></thead>
          <tbody>${lin(h(nomeTime(p.h)), o.c, o.mc, proj.p1)}${lin("Empate", o.e, o.me, proj.px)}${lin(h(nomeTime(p.a)), o.f, o.mf, proj.p2)}</tbody></table></div>
          <p class="sub" style="margin:6px 0 0">Odds de ${o.n} casas (The Odds API). Valor positivo = a odd média paga mais do que a chance calculada pelo site sugere.</p>`;
      })()}
      <div class="mercados">
        ${mercado("Mais de 1,5 gol", proj.ov[1], fim ? tot > 1.5 : null)}
        ${mercado("Mais de 2,5 gols", proj.ov[2], fim ? tot > 2.5 : null)}
        ${mercado("Mais de 3,5 gols", proj.ov[3], fim ? tot > 3.5 : null)}
        ${mercado("Ambas marcam", proj.btts, fim ? p.fh > 0 && p.fa > 0 : null)}
        ${mercado("Gol no 1º tempo", proj.ht05, fim && p.hh != null ? p.hh + p.ha > 0 : null)}
        ${mercado("Dupla chance 1X", proj.p1 + proj.px, fim ? p.fh >= p.fa : null)}
        ${mercado("Dupla chance X2", proj.p2 + proj.px, fim ? p.fa >= p.fh : null)}
        ${mercado(h(nomeTime(p.h)) + " marca", proj.casaMarca, fim ? p.fh > 0 : null)}
        ${mercado(h(nomeTime(p.a)) + " marca", proj.foraMarca, fim ? p.fa > 0 : null)}
      </div>
      <div class="placares"><span class="sub">Placares mais prováveis:</span>
        ${proj.placares.map((x) => `<span class="pl"><b>${x.h}-${x.a}</b>${fProb(x.p)}</span>`).join("")}</div>
      ${eH && eA ? `<div class="elo-linha"><span>Power Ranking (Elo atual)</span>
        <span class="c">${h(nomeTime(p.h))} <b>${Math.round(eH.elo)}</b> · ${eH.pos}º</span>
        <span class="f">${h(nomeTime(p.a))} <b>${Math.round(eA.elo)}</b> · ${eA.pos}º</span></div>` : ""}
    </div>`;
  }

  function abaClassificacao(code, p) {
    const comp = DADOS.competicoes[code];
    const prep = preps[code];
    const art = estado.subClass === "art";
    const alvo = [String(p.h), String(p.a)];
    const clsTime = (tid) => (String(tid) === String(p.h) ? "destaque-c" : String(tid) === String(p.a) ? "destaque-f" : "");
    const topo = `<div class="sub-abas">
      <div class="alternar" role="group" aria-label="Mostrar">
        <button type="button" data-subclass="tabela" aria-pressed="${!art}">Classificação</button>
        <button type="button" data-subclass="art" aria-pressed="${art}">Artilharia</button></div>
      ${!art ? `<div class="alternar" role="group" aria-label="Recorte da tabela">
        ${[["TOTAL", "Geral"], ["HOME", "Em casa"], ["AWAY", "Fora"]].map(([k, r]) => `<button type="button" data-tabela="${k}" aria-pressed="${estado.vistaTabela === k}">${r}</button>`).join("")}</div>` : ""}
      <span class="sub">${h(comp.nome || nomeComp(code))}</span></div>`;

    if (art) {
      const lista = comp.artilharia || [];
      if (!lista.length) return `<div class="painel-corpo">${topo}<div class="vazio"><strong>Sem artilharia</strong>A API não devolveu artilheiros para esta competição.</div></div>`;
      return `<div class="painel-corpo">${topo}<div class="tabela-rolagem"><table class="dados">
        <thead><tr><th class="esq">#</th><th class="esq">Jogador</th><th class="esq ocultar-celular">Time</th><th>Gols</th><th>Assist.</th>
          <th class="ocultar-celular">Pênaltis</th><th>Jogos</th><th class="ocultar-celular">Gols/jogo</th></tr></thead>
        <tbody>${lista.map((a, i) => `<tr class="${clsTime(a.t)}">
          <td class="esq"><span class="pos">${i + 1}</span></td>
          <td class="esq"><span class="time-celula">${escudo(a.t)}<span><b>${h(a.nome)}</b><br><span class="sub">${h(a.nac || "")}</span></span></span></td>
          <td class="esq ocultar-celular"><a href="#time/${code}/${a.t}">${h(nomeTime(a.t))}</a></td>
          <td class="forte">${a.gols ?? "–"}</td><td>${a.ass ?? "–"}</td><td class="ocultar-celular">${a.pen ?? "–"}</td>
          <td>${a.jogos ?? "–"}</td><td class="ocultar-celular">${a.jogos ? fNum(a.gols / a.jogos, 2) : "–"}</td></tr>`).join("")}</tbody></table></div></div>`;
    }

    const tipo = estado.vistaTabela;
    let tabs = (comp.classificacao || []).filter((t) => t.tipo === tipo && t.tabela.length);
    if (!tabs.length) tabs = [{ tabela: M.tabela(prep, tipo) }];
    const comTimes = tabs.filter((t) => t.tabela.some((l) => alvo.includes(String(l.t))));
    const usar = comTimes.length ? comTimes : tabs;
    const formaDe = (tid) => {
      const t = prep.times[tid];
      if (!t) return [];
      const b = tipo === "HOME" ? t.casa : tipo === "AWAY" ? t.fora : t.geral;
      return b.forma.slice(-5);
    };
    return `<div class="painel-corpo">${topo}<div class="tabela-rolagem">${usar.map((tb) => `
      ${tb.grupo ? `<h3 style="margin:8px 0 6px">${h(tb.grupo.replace("GROUP_", "Grupo "))}</h3>` : ""}
      <table class="dados"><thead><tr><th class="esq">#</th><th class="esq">Time</th><th>P</th><th>J</th><th>V</th><th>E</th><th>D</th>
        <th class="ocultar-celular">GP</th><th class="ocultar-celular">GC</th><th>SG</th><th class="esq ocultar-celular">Últimos 5</th></tr></thead>
      <tbody>${tb.tabela.map((l) => `<tr class="clicavel ${clsTime(l.t)}" data-ir="time/${code}/${l.t}"><td class="esq"><span class="pos">${l.p}</span></td>
          <td class="esq"><span class="time-celula">${escudo(l.t)}<span>${h(nomeTime(l.t))}</span></span></td>
          <td class="forte">${l.pts}</td><td>${l.j}</td><td>${l.v}</td><td>${l.e}</td><td>${l.d}</td>
          <td class="ocultar-celular">${l.gp}</td><td class="ocultar-celular">${l.gc}</td><td>${l.sg > 0 ? "+" : ""}${l.sg}</td>
          <td class="esq ocultar-celular">${forma(formaDe(l.t))}</td></tr>`).join("")}</tbody></table>`).join("")}</div></div>`;
  }

  function itemJogoDoTime(code, p, tid) {
    const casa = String(p.h) === String(tid);
    const adv = casa ? p.a : p.h;
    const fim = encerrada(p);
    let res = "";
    if (fim) {
      const gm = casa ? p.fh : p.fa, gs = casa ? p.fa : p.fh;
      const r = gm > gs ? "V" : gm === gs ? "E" : "D";
      res = `${p.fh}-${p.fa} ${forma([r])}`;
    } else res = `<span class="sub">${hora(p.d)}</span>`;
    return `<li><span class="data">${dataCurta(p.d)}</span>${escudo(adv)}
      <button type="button" data-ir="jogo/${code}/${p.i}">${casa ? "x" : "em"} ${h(nomeTime(adv))}</button>
      <span class="res">${res}</span></li>`;
  }

  function confrontoDireto(ha, aa) {
    const l = [];
    for (const code of comps) for (const p of preps[code].partidas) {
      if (!encerrada(p)) continue;
      const ids = [String(p.h), String(p.a)];
      if (ids.includes(String(ha)) && ids.includes(String(aa))) l.push({ code, p });
    }
    l.sort((a, b) => (a.p.d < b.p.d ? 1 : -1));
    if (!l.length) return `<p class="sub">Esses times ainda não se enfrentaram nas temporadas baixadas.</p>`;
    let vh = 0, e = 0, va = 0;
    for (const { p } of l) {
      const gh = String(p.h) === String(ha) ? p.fh : p.fa, ga = String(p.h) === String(ha) ? p.fa : p.fh;
      if (gh > ga) vh++; else if (gh === ga) e++; else va++;
    }
    return `<div class="h2h-resumo"><div class="c"><b>${vh}</b><span>${h(nomeTime(ha))}</span></div><div><b>${e}</b><span>empates</span></div><div class="f"><b>${va}</b><span>${h(nomeTime(aa))}</span></div></div>
      <ul class="lista-mini">${l.map(({ code, p }) => `<li><span class="data">${dataCurta(p.d)}</span>${seloComp(code)}
        <button type="button" data-ir="jogo/${code}/${p.i}">${h(nomeTime(p.h))} × ${h(nomeTime(p.a))}</button>
        <span class="res">${p.fh}-${p.fa}${p.hh != null ? ` <span class="sub">(${p.hh}-${p.ha})</span>` : ""}</span></li>`).join("")}</ul>`;
  }

  // ------------------------------------------------------------ CLASSIFICAÇÃO
  function telaClassificacao(code) {
    code = comps.includes(code) ? code : estado.comp;
    estado.comp = code; guardar("comp", code);
    const comp = DADOS.competicoes[code];
    const prep = preps[code];
    const tipo = estado.vistaTabela;
    let tabelas = (comp.classificacao || []).filter((t) => t.tipo === tipo && t.tabela.length);
    let origem = "api";
    if (!tabelas.length) {
      tabelas = [{ grupo: null, fase: null, tabela: M.tabela(prep, tipo) }];
      origem = "calc";
    }
    const formaDe = (tid) => {
      const t = prep.times[tid];
      if (!t) return [];
      const b = tipo === "HOME" ? t.casa : tipo === "AWAY" ? t.fora : t.geral;
      return b.forma.slice(-5);
    };
    const corpo = tabelas.map((tb) => `
      ${tb.grupo || (tabelas.length > 1 && tb.fase) ? `<h3 style="margin:14px 0 6px">${h(tb.grupo ? tb.grupo.replace("GROUP_", "Grupo ") : FASES[tb.fase] || tb.fase)}</h3>` : ""}
      <div class="tabela-rolagem"><table class="dados">
        <thead><tr><th class="esq">#</th><th class="esq">Time</th><th>P</th><th>J</th><th>V</th><th>E</th><th>D</th>
          <th class="ocultar-celular">GP</th><th class="ocultar-celular">GC</th><th>SG</th><th class="esq ocultar-celular">Últimos 5</th></tr></thead>
        <tbody>${tb.tabela.map((l) => `<tr class="clicavel" data-ir="time/${code}/${l.t}">
          <td class="esq"><span class="pos">${l.p}</span></td>
          <td class="esq"><span class="time-celula">${escudo(l.t)}<span>${h(nomeTime(l.t))}</span></span></td>
          <td class="forte">${l.pts}</td><td>${l.j}</td><td>${l.v}</td><td>${l.e}</td><td>${l.d}</td>
          <td class="ocultar-celular">${l.gp}</td><td class="ocultar-celular">${l.gc}</td><td>${l.sg > 0 ? "+" : ""}${l.sg}</td>
          <td class="esq ocultar-celular">${forma(formaDe(l.t))}</td></tr>`).join("")}</tbody></table></div>`).join("");

    app.innerHTML = `${chipsComp("classificacao", code)}
      <section class="painel" style="margin-top:12px">
        <div class="painel-cab"><h2>Classificação · ${h(nomeComp(code))}</h2>
          <div class="alternar" role="group" aria-label="Recorte da tabela">
            ${[["TOTAL", "Geral"], ["HOME", "Em casa"], ["AWAY", "Fora"]].map(([k, r]) => `<button type="button" data-tabela="${k}" aria-pressed="${tipo === k}">${r}</button>`).join("")}
          </div></div>
        <div class="painel-corpo">${corpo}
          ${origem === "calc" ? `<p class="sub">Tabela calculada a partir dos jogos encerrados.</p>` : ""}</div>
      </section>`;
  }

  // ------------------------------------------------------------ TIMES
  function proximoJogo(tid) {
    const agora = new Date().toISOString();
    let melhor = null;
    for (const code of comps) for (const p of preps[code].partidas) {
      if ((String(p.h) === String(tid) || String(p.a) === String(tid)) && !encerrada(p) && p.d >= agora && ["SCHEDULED", "TIMED"].includes(p.s)) {
        if (!melhor || p.d < melhor.p.d) melhor = { code, p };
        break;
      }
    }
    return melhor;
  }
  function compDoTime(tid) {
    for (const code of comps) if (preps[code].times[tid] && !["CL"].includes(code)) return code;
    for (const code of comps) if (preps[code].times[tid]) return code;
    return null;
  }

  function telaTimes(code) {
    code = comps.includes(code) ? code : estado.comp;
    estado.comp = code; guardar("comp", code);
    const ids = Object.keys(preps[code].times).sort((a, b) => nomeTime(a).localeCompare(nomeTime(b), "pt-BR"));
    const favs = [...favTimes].filter((id) => compDoTime(id));
    const cartao = (id, c) => `<div class="cartao-time">${estrelaTime(id, 16)}<button type="button" data-ir="time/${c}/${id}">${escudo(id)}<span>${h(nomeTime(id))}</span></button></div>`;
    const blocoFav = favs.length ? `<section class="painel" style="margin-top:12px">
        <div class="painel-cab"><h2>Seus times favoritos</h2><span class="sub">os jogos deles aparecem no botão Favoritos da lista de jogos</span></div>
        <ul class="lista-mini favs">${favs.map((id) => {
          const c = compDoTime(id), prox = proximoJogo(id);
          return `<li>${estrelaTime(id, 16)}${escudo(id)}<button type="button" data-ir="time/${c}/${id}"><b>${h(nomeLongo(id))}</b> <span class="sub">${h(nomeComp(c))}</span></button>
            <span class="res">${prox ? `<button type="button" class="link" data-ir="jogo/${prox.code}/${prox.p.i}">${dataCurta(prox.p.d)} ${hora(prox.p.d)} · ${String(prox.p.h) === String(id) ? "x" : "em"} ${h(nomeTime(String(prox.p.h) === String(id) ? prox.p.a : prox.p.h))}</button>` : '<span class="sub">sem jogo marcado</span>'}</span></li>`;
        }).join("")}</ul></section>` : "";
    app.innerHTML = `${chipsComp("times", code)}${blocoFav}
      <section class="painel" style="margin-top:12px">
        <div class="painel-cab"><h2>${estrelaLiga(code, 18)} Times · ${h(nomeComp(code))}</h2><span class="sub">${ids.length} times · toque na estrela para favoritar</span></div>
        <div class="grade-times">${ids.map((id) => cartao(id, code)).join("")}</div>
      </section>`;
  }

  const LINHAS_TIME = [
    ["Resultados"], ["Jogos", "jogos", "n"], ["Vitórias", "vit", "%"], ["Empates", "emp", "%"], ["Derrotas", "der", "%"],
    ["Pontos por jogo", "ppj", "d"],
    ["Gols"], ["Marcados por jogo", "gm", "d"], ["Sofridos por jogo", "gs", "d"], ["Gols no jogo", "gt", "d"],
    ["Sem sofrer gol", "cs", "%"], ["Sem marcar", "sm", "%"],
    ["Mercados"], ["Mais de 0,5", "ov05", "%"], ["Mais de 1,5", "ov15", "%"], ["Mais de 2,5", "ov25", "%"],
    ["Mais de 3,5", "ov35", "%"], ["Mais de 4,5", "ov45", "%"], ["Ambas marcam", "btts", "%"],
    ["1º e 2º tempo"], ["Gol no 1º tempo", "ht05", "%"], ["Mais de 1,5 no 1º tempo", "ht15", "%"],
    ["Gol no 2º tempo", "st05", "%"], ["Mais de 1,5 no 2º tempo", "st15", "%"],
    ["Vencendo no intervalo", "v1", "%"], ["Empatando no intervalo", "e1", "%"], ["Perdendo no intervalo", "d1", "%"],
    ["Viradas a favor", "vir", "n"], ["Viradas sofridas", "ced", "n"],
  ];

  function telaTime(code, tid) {
    const prep = preps[code];
    if (!prep || !prep.times[tid]) { telaTimes(code); return; }
    estado.comp = code; guardar("comp", code);
    const t = prep.times[tid];
    const mg = M.metricas(t.geral), mc = M.metricas(t.casa), mf = M.metricas(t.fora);
    const pos = posicaoNaTabela(code, tid), elo = posElo(code, tid);
    const fmt = (v, tp) => (tp === "%" ? fPct(v) : tp === "n" ? (v ?? "–") : fNum(v, 2));
    const linhas = LINHAS_TIME.map((l) => l.length === 1
      ? `<tr><th class="esq" colspan="4" style="padding-top:14px;color:var(--tinta)">${l[0]}</th></tr>`
      : `<tr><td class="esq">${l[0]}</td><td class="forte">${fmt(mg[l[1]], l[2])}</td><td>${fmt(mc[l[1]], l[2])}</td><td>${fmt(mf[l[1]], l[2])}</td></tr>`).join("");

    const barraTempo = (rot, a, b, cls) => {
      const tot = (a || 0) + (b || 0);
      return `<span>${rot}</span><div class="trilho ${cls}" title="1º tempo ${fNum(a, 2)} · 2º tempo ${fNum(b, 2)}">
        <span style="width:${tot ? (a / tot) * 100 : 50}%"></span><span style="width:${tot ? (b / tot) * 100 : 50}%"></span></div>
        <span>${tot ? Math.round((a / tot) * 100) + "%" : "–"}</span>`;
    };
    const jogos = prep.partidas.filter((p) => String(p.h) === String(tid) || String(p.a) === String(tid));
    const encerrados = jogos.filter(encerrada).reverse();
    const proximos = jogos.filter((p) => !encerrada(p) && !["CANCELLED", "POSTPONED"].includes(p.s));

    app.innerHTML = `${chipsComp("times", code)}
      <section class="painel" style="margin-top:12px">
        <div class="time-cab">${escudo(tid, "esc esc-g")}
          <div><h1 class="titulo-fav">${h(nomeLongo(tid))} ${estrelaTime(tid, 22)}</h1><div class="sub">${h(nomeComp(code))}</div><div style="margin-top:6px">${forma(mg.forma)}</div></div>
          <div class="numeros">
            ${pos ? `<div><b>${pos.pos}º</b><span>na tabela</span></div><div><b>${pos.pts}</b><span>pontos</span></div>` : ""}
            ${elo ? `<div><b>${Math.round(elo.elo)}</b><span>Elo · ${elo.pos}º de ${elo.total}</span></div>` : ""}
            <div><b>${fNum(mg.gm, 2)}</b><span>gols por jogo</span></div>
          </div></div>
      </section>
      <div class="lado-a-lado" style="margin-top:14px">
        <section class="painel"><div class="painel-cab"><h3>Estatísticas da temporada</h3></div>
          <div class="painel-corpo tabela-rolagem"><table class="dados">
            <thead><tr><th class="esq"></th><th>Geral</th><th>Em casa</th><th>Fora</th></tr></thead>
            <tbody>${linhas}</tbody></table></div></section>
        <div>
          <section class="painel"><div class="painel-cab"><h3>Quando os gols saem</h3><span class="sub">parte do 1º tempo</span></div>
            <div class="painel-corpo tempos">
              ${barraTempo("Marcados", mg.gm1, mg.gm2, "")}
              ${barraTempo("Sofridos", mg.gs1, mg.gs2, "sofridos")}
            </div>
            <p class="sub" style="padding:0 16px 14px;margin:0">Barra escura = 1º tempo, clara = 2º tempo. Média de ${fNum(mg.gm1, 2)} gols marcados no 1º tempo e ${fNum(mg.gm2, 2)} no 2º.</p></section>
          ${proximos.length ? `<section class="painel"><div class="painel-cab"><h3>Próximos jogos</h3></div>
            <div class="painel-corpo"><ul class="lista-mini">${proximos.slice(0, 5).map((p) => itemJogoDoTime(code, p, tid)).join("")}</ul></div></section>` : ""}
          <section class="painel"><div class="painel-cab"><h3>Resultados</h3><span class="sub">${encerrados.length} jogos</span></div>
            <div class="painel-corpo"><ul class="lista-mini">${encerrados.map((p) => itemJogoDoTime(code, p, tid)).join("") || '<li class="sub">Sem jogos encerrados.</li>'}</ul></div></section>
        </div>
      </div>`;
  }

  // ------------------------------------------------------------ RANKING
  function sparkline(vals) {
    if (vals.length < 2) return "";
    const min = Math.min(...vals), max = Math.max(...vals), amp = max - min || 1;
    const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * 108 + 1},${25 - ((v - min) / amp) * 22 - 1.5}`);
    return `<svg class="spark" viewBox="0 0 110 26" aria-hidden="true"><path d="M${pts.join(" L")}"/></svg>`;
  }
  const ORDENS_RK = [
    ["elo", "Elo (força atual)", (x) => x.elo, -1],
    ["evol", "Melhor evolução", (x) => x.varN, -1],
    ["queda", "Pior evolução", (x) => x.varN, 1],
    ["forma", "Melhor forma recente", (x) => (x.ppjN ?? -1) * 100 + x.varN / 100, -1],
    ["ataque", "Melhor ataque", (x) => x.ataque, -1],
    ["defesa", "Melhor defesa", (x) => x.defesa, 1],
    ["ppj", "Pontos por jogo", (x) => x.ppj, -1],
    ["tabela", "Classificação do campeonato", (x) => (x.posTab == null ? 999 : x.posTab), 1],
  ];
  function telaRanking(code) {
    const todas = code === "todas";
    if (!todas) { code = comps.includes(code) ? code : estado.comp; estado.comp = code; guardar("comp", code); }
    const n = estado.rkN, ordem = ORDENS_RK.find((o) => o[0] === estado.rkOrdem) || ORDENS_RK[0];
    let r = [];
    for (const c of todas ? compsOrd() : [code]) {
      for (const x of M.ranking(preps[c], n)) {
        const pt = posicaoNaTabela(c, x.t);
        r.push({ ...x, code: c, posTab: pt ? pt.pos : null, ptsTab: pt ? pt.pts : null });
      }
    }
    const totalTimes = r.length;
    if (estado.rkFiltro === "alta") r = r.filter((x) => x.varN > 0);
    if (estado.rkFiltro === "queda") r = r.filter((x) => x.varN < 0);
    if (estado.rkFiltro === "fav") r = r.filter((x) => favTimes.has(String(x.t)) || favLigas.has(x.code));
    if (todas && ordem[0] === "elo") r.sort((a, b) => b.varN - a.varN);
    else r.sort((a, b) => ordem[3] * (ordem[2](a) - ordem[2](b)) || b.elo - a.elo);
    const maxA = Math.max(...r.map((x) => Math.max(x.ataque || 0, x.defesa || 0)), 1.5);
    const destaque = (k) => (ordem[0] === k || (k === "evol" && ordem[0] === "queda") ? "ordenada" : "");
    const th = (k, rot, extra = "", title = "") => `<th class="${extra} ${destaque(k)}" ${title ? `title="${title}"` : ""}><button type="button" class="th-ordenar" data-rkordem="${k === "evol" && ordem[0] === "evol" ? "queda" : k}">${rot}</button></th>`;
    const chipsTodas = `<button class="chip" type="button" data-ir="ranking/todas" aria-pressed="${todas}">Todas as ligas</button>`;
    const contagem = r.length === totalTimes ? `${r.length} times` : `${r.length} de ${totalTimes} times`;
    app.innerHTML = `${chipsComp("ranking", todas ? "" : code, chipsTodas)}
      <section class="painel" style="margin-top:12px">
        <div class="painel-cab"><h2>Power Ranking · ${todas ? "todas as ligas" : h(nomeComp(code))}</h2>
          <span class="sub">${todas ? "Com todas as ligas juntas, compare a evolução e a forma. O Elo só vale para comparar times da mesma liga." : "Elo calculado com os jogos desta competição: todos começam com 1500, vencer fora e por mais gols vale mais."}</span></div>
        <div class="rk-filtros">
          <label class="sel-mini"><span>Ordenar por</span><select id="rk-ordem">${ORDENS_RK.map((o) => `<option value="${o[0]}" ${o[0] === ordem[0] ? "selected" : ""}>${o[0] === "elo" && todas ? "Elo (dentro de cada liga)" : o[1]}</option>`).join("")}</select></label>
          <div class="alternar" role="group" aria-label="Evolução medida em">
            ${[3, 5, 10].map((k) => `<button type="button" data-rkn="${k}" aria-pressed="${n === k}">Últimos ${k}</button>`).join("")}</div>
          <div class="alternar" role="group" aria-label="Mostrar">
            ${[["todos", "Todos"], ["alta", "Em alta"], ["queda", "Em queda"], ["fav", "Favoritos"]].map(([k, rot]) => `<button type="button" data-rkfiltro="${k}" aria-pressed="${estado.rkFiltro === k}">${rot}</button>`).join("")}</div>
          <span class="sub rk-cont">${contagem}</span>
        </div>
        <div class="painel-corpo tabela-rolagem">${r.length ? `<table class="dados rk">
          <thead><tr><th class="esq">#</th><th class="esq">Time</th>
            ${th("tabela", "Tabela", "", "Posição na classificação do campeonato")}
            ${th("elo", "Elo")}${th("evol", `Últimos ${n} jogos`, "", "Quanto o Elo subiu ou caiu nos últimos jogos")}
            <th class="ocultar-celular">Evolução</th>
            ${th("ataque", "Ataque", "ocultar-celular", "Gols marcados por jogo em relação à média da liga")}
            ${th("defesa", "Defesa", "ocultar-celular", "Gols sofridos por jogo em relação à média da liga (menor é melhor)")}
            ${th("forma", `Pts nos últimos ${n}`, "ocultar-celular")}
            <th class="esq ocultar-celular">Forma</th></tr></thead>
          <tbody>${r.map((x, i) => `<tr class="clicavel" data-ir="time/${x.code}/${x.t}">
            <td class="esq"><span class="pos">${i + 1}</span></td>
            <td class="esq"><span class="time-celula">${todas ? seloComp(x.code) : ""}${escudo(x.t)}<span>${h(nomeTime(x.t))}</span>${favTimes.has(String(x.t)) ? `<i class="fav-time">${ESTRELA_SVG(12)}</i>` : ""}</span></td>
            <td class="${ordem[0] === "tabela" ? "forte" : ""}">${x.posTab != null ? x.posTab + "º" : "–"}${x.ptsTab != null ? ` <span class="sub">${x.ptsTab} pts</span>` : ""}</td>
            <td class="forte">${Math.round(x.elo)}${ordem[0] !== "elo" || todas ? ` <span class="sub">${x.pos}º</span>` : ""}</td>
            <td class="${x.varN >= 0 ? "var-mais" : "var-menos"}">${x.varN >= 0 ? "+" : "−"}${Math.abs(Math.round(x.varN))}</td>
            <td class="ocultar-celular">${sparkline(x.hist)}</td>
            <td class="ocultar-celular">${fNum(x.ataque, 2)}<span class="indice" style="width:${(x.ataque / maxA) * 40}px"></span></td>
            <td class="ocultar-celular">${fNum(x.defesa, 2)}<span class="indice def" style="width:${(x.defesa / maxA) * 40}px"></span></td>
            <td class="ocultar-celular">${x.ptsN} <span class="sub">de ${Math.min(n, x.j) * 3}</span></td>
            <td class="esq ocultar-celular">${forma(x.forma)}</td></tr>`).join("")}</tbody></table>`
          : `<div class="vazio"><strong>${totalTimes ? "Nenhum time com esse filtro" : "Sem jogos encerrados"}</strong>${totalTimes ? (estado.rkFiltro === "fav" ? "Favorite times ou ligas pela estrela para vê-los aqui." : "Troque o filtro acima.") : "O ranking aparece depois da primeira rodada."}</div>`}
        </div></section>`;
    document.getElementById("rk-ordem").addEventListener("change", (e) => { estado.rkOrdem = e.target.value; guardar("rk_ordem", estado.rkOrdem); telaRanking(todas ? "todas" : code); });
  }

  // ------------------------------------------------------------ ARTILHARIA
  function telaArtilharia(code) {
    code = comps.includes(code) ? code : estado.comp;
    estado.comp = code; guardar("comp", code);
    const lista = DADOS.competicoes[code].artilharia || [];
    app.innerHTML = `${chipsComp("artilharia", code)}
      <section class="painel" style="margin-top:12px">
        <div class="painel-cab"><h2>Artilharia · ${h(nomeComp(code))}</h2></div>
        <div class="painel-corpo tabela-rolagem">${lista.length ? `<table class="dados">
          <thead><tr><th class="esq">#</th><th class="esq">Jogador</th><th class="esq ocultar-celular">Time</th><th>Gols</th><th>Assist.</th>
            <th class="ocultar-celular">Pênaltis</th><th>Jogos</th><th>Gols/jogo</th></tr></thead>
          <tbody>${lista.map((a, i) => `<tr>
            <td class="esq"><span class="pos">${i + 1}</span></td>
            <td class="esq"><span class="time-celula">${escudo(a.t)}<span><b>${h(a.nome)}</b><br><span class="sub">${h(a.nac || "")}</span></span></span></td>
            <td class="esq ocultar-celular"><a href="#time/${code}/${a.t}">${h(nomeTime(a.t))}</a></td>
            <td class="forte">${a.gols ?? "–"}</td><td>${a.ass ?? "–"}</td><td class="ocultar-celular">${a.pen ?? "–"}</td>
            <td>${a.jogos ?? "–"}</td><td>${a.jogos ? fNum(a.gols / a.jogos, 2) : "–"}</td></tr>`).join("")}</tbody></table>`
          : `<div class="vazio"><strong>Sem artilharia</strong>A API não devolveu artilheiros para esta competição.</div>`}
        </div></section>`;
  }

  // ------------------------------------------------------------ FILTROS E BACKTEST
  const PRESETS = [
    { nome: "Favorito em casa", mercado: "casa", minJogos: 5, odd: 1.6, comps: null,
      condicoes: [{ suj: "hc", met: "vit", op: ">=", val: 60 }, { suj: "af", met: "der", op: ">=", val: 50 }] },
    { nome: "Jogo de gols", mercado: "ov25", minJogos: 5, odd: 1.85, comps: null,
      condicoes: [{ suj: "hc", met: "ov25", op: ">=", val: 60 }, { suj: "af", met: "ov25", op: ">=", val: 60 }] },
    { nome: "Ambas marcam", mercado: "btts", minJogos: 5, odd: 1.8, comps: null,
      condicoes: [{ suj: "pj", met: "btts", op: ">=", val: 58 }] },
    { nome: "Gol no 1º tempo", mercado: "ht05", minJogos: 5, odd: 1.4, comps: null,
      condicoes: [{ suj: "hc", met: "ht05", op: ">=", val: 75 }, { suj: "af", met: "ht05", op: ">=", val: 75 }] },
  ];
  let filtro = ler("filtro_atual", null) || JSON.parse(JSON.stringify(PRESETS[0]));
  let resultadoBT = null;

  function metricasDoSujeito(suj) {
    return suj === "pj" ? M.METRICAS_PROJ : suj === "cmp" ? M.METRICAS_CMP : M.METRICAS_TIME;
  }
  function compsDoFiltro() { return (filtro.comps && filtro.comps.length ? filtro.comps : comps).filter((c) => comps.includes(c)); }

  function telaFiltros() {
    const salvos = ler("filtros", []);
    const sel = new Set(compsDoFiltro());
    const conds = filtro.condicoes.map((c, i) => {
      const mets = metricasDoSujeito(c.suj);
      return `<div class="cond" data-i="${i}">
        <select data-campo="suj" aria-label="Quem">${M.SUJEITOS.map((s) => `<option value="${s.id}" ${s.id === c.suj ? "selected" : ""}>${s.nome}</option>`).join("")}</select>
        <select data-campo="met" aria-label="Estatística">${mets.map((m) => `<option value="${m.id}" ${m.id === c.met ? "selected" : ""}>${m.nome}</option>`).join("")}</select>
        <div class="op-val">
          <select data-campo="op" aria-label="Comparação"><option value=">=" ${c.op === ">=" ? "selected" : ""}>≥</option><option value="<=" ${c.op === "<=" ? "selected" : ""}>≤</option></select>
          <input data-campo="val" type="number" step="any" value="${c.val}" aria-label="Valor">
          <button class="remover" type="button" data-remover="${i}" aria-label="Remover condição">✕</button>
        </div></div>`;
    }).join("");

    app.innerHTML = `<div class="filtros-grade">
      <section class="painel" aria-label="Montar filtro">
        <div class="painel-cab"><h2>Montar filtro</h2></div>
        <div class="painel-corpo">
          <p class="dica">As estatísticas de cada jogo do backtest são as que os times tinham antes da partida, então o teste não “vê o futuro”. Percentuais vão de 0 a 100.</p>
          <div class="campo"><label for="f-nome">Nome</label><input id="f-nome" value="${h(filtro.nome || "")}" placeholder="Ex.: Favorito em casa"></div>
          <div class="campo"><span class="rotulo">Competições</span>
            <div class="chips" style="flex-wrap:wrap">${comps.map((c) => `<button class="chip" type="button" data-fcomp="${c}" aria-pressed="${sel.has(c)}">${seloComp(c)}${h(nomeComp(c))}</button>`).join("")}</div></div>
          <div class="campo"><label for="f-mercado">Mercado testado</label>
            <select id="f-mercado">${M.MERCADOS.map((m) => `<option value="${m.id}" ${m.id === filtro.mercado ? "selected" : ""}>${m.nome}</option>`).join("")}</select></div>
          <div class="linha-campos">
            <div class="campo"><label for="f-min">Mínimo de jogos de cada time</label><input id="f-min" type="number" min="0" value="${filtro.minJogos ?? 5}"></div>
            <div class="campo"><label for="f-odd">Odd média para simular</label><input id="f-odd" type="number" min="1.01" step="0.01" value="${filtro.odd ?? 1.8}"></div>
          </div>
          <div class="campo"><span class="rotulo">Condições (todas precisam ser verdadeiras)</span>${conds || '<p class="sub">Sem condições: entram todos os jogos.</p>'}
            <button class="botao secundario" type="button" id="f-add">Adicionar condição</button></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="botao" type="button" id="f-rodar">Rodar backtest</button>
            <button class="botao secundario" type="button" id="f-salvar">Salvar filtro</button>
          </div>
          <h3 style="margin:18px 0 8px">Filtros prontos e salvos</h3>
          <div class="salvos">
            ${PRESETS.map((p, i) => `<div class="salvo"><button type="button" data-preset="${i}">${h(p.nome)}</button><span class="sub">pronto</span></div>`).join("")}
            ${salvos.map((p, i) => `<div class="salvo"><button type="button" data-salvo="${i}">${h(p.nome)}</button><button class="remover" type="button" data-apagar="${i}" aria-label="Apagar ${h(p.nome)}">✕</button></div>`).join("")}
          </div>
        </div>
      </section>
      <section id="bt-resultado" aria-live="polite"></section>
    </div>`;
    rodarBacktest();
  }

  function lerCamposFiltro() {
    const g = (id) => document.getElementById(id);
    if (!g("f-nome")) return;
    filtro.nome = g("f-nome").value.trim();
    filtro.mercado = g("f-mercado").value;
    filtro.minJogos = Number(g("f-min").value) || 0;
    filtro.odd = Number(g("f-odd").value) || 0;
    app.querySelectorAll(".cond").forEach((el) => {
      const c = filtro.condicoes[Number(el.dataset.i)];
      if (!c) return;
      c.suj = el.querySelector('[data-campo="suj"]').value;
      c.met = el.querySelector('[data-campo="met"]').value;
      c.op = el.querySelector('[data-campo="op"]').value;
      c.val = Number(el.querySelector('[data-campo="val"]').value);
    });
    guardar("filtro_atual", filtro);
  }

  function rodarBacktest() {
    lerCamposFiltro();
    const ps = compsDoFiltro().map((c) => preps[c]);
    const r = M.backtest(ps, filtro, filtro.odd);
    const prox = M.proximosNoFiltro(ps, filtro, new Date().toISOString());
    resultadoBT = r;
    const alvo = document.getElementById("bt-resultado");
    if (!alvo) return;
    const mercado = r.mercado;
    const curva = curvaSVG(r.curva);
    const linhasEntradas = (todas) => r.entradas.slice().reverse().slice(0, todas ? undefined : 60).map((e) => `
      <tr class="clicavel" data-ir="jogo/${e.comp}/${e.p.i}"><td class="esq">${dataCurta(e.p.d)}</td><td class="esq">${seloComp(e.comp)}</td>
      <td class="esq">${h(nomeTime(e.p.h))} × ${h(nomeTime(e.p.a))}</td><td>${e.p.fh}-${e.p.fa}${e.p.hh != null ? ` <span class="sub">(${e.p.hh}-${e.p.ha})</span>` : ""}</td>
      <td class="ocultar-celular">${mercado.prob ? fProb(mercado.prob(e.proj)) : "–"}</td>
      <td>${e.green ? '<span class="ok">✓</span>' : '<span class="nok">✕</span>'}</td></tr>`).join("");
    alvo.innerHTML = `
      <div class="painel"><div class="painel-cab"><h2>${h(filtro.nome || "Filtro sem nome")}</h2><span class="sub">${h(mercado.nome)} · ${compsDoFiltro().map(nomeComp).join(", ")}</span></div>
        <div class="painel-corpo">
          ${r.n ? `<div class="resumo">
            <div><b>${r.n}</b><span>entradas</span></div>
            <div><b>${r.greens}</b><span>acertos</span></div>
            <div><b>${fPct(r.taxa * 100)}</b><span>taxa de acerto</span></div>
            <div><b>${fNum(r.oddMinima, 2)}</b><span>odd mínima para não perder</span></div>
            <div><b>${r.maxRed}</b><span>maior sequência de erros</span></div>
            <div><b class="${r.saldo >= 0 ? "ok" : "nok"}">${r.saldo >= 0 ? "+" : ""}${fNum(r.saldo, 2)}u</b><span>saldo na odd ${fNum(filtro.odd, 2)}</span></div>
            <div><b>${fPct(r.roi)}</b><span>retorno por entrada</span></div>
          </div>${curva}
          <p class="sub">Saldo em unidades apostando 1 unidade por entrada na odd média informada. Odd mínima = 1 ÷ taxa de acerto.</p>`
          : `<div class="vazio"><strong>Nenhum jogo passou no filtro</strong>Afrouxe alguma condição ou diminua o mínimo de jogos.</div>`}
        </div></div>
      <div class="painel"><div class="painel-cab"><h3>Próximos jogos que passam no filtro</h3><span class="sub">${prox.length} jogo(s)</span></div>
        <div class="painel-corpo">${prox.length ? `<ul class="lista-mini">${prox.slice(0, 30).map((x) => `<li><span class="data">${dataCurta(x.p.d)} ${hora(x.p.d)}</span>${seloComp(x.comp)}
          <button type="button" data-ir="jogo/${x.comp}/${x.p.i}">${h(nomeTime(x.p.h))} × ${h(nomeTime(x.p.a))}</button>
          <span class="res">${mercado.prob ? fProb(mercado.prob(x.proj)) + ` <span class="sub">odd ${fOdd(mercado.prob(x.proj))}</span>` : ""}</span></li>`).join("")}</ul>`
          : `<p class="sub">Nenhum jogo agendado se encaixa agora.</p>`}</div></div>
      ${r.n ? `<div class="painel"><div class="painel-cab"><h3>Entradas do backtest</h3><span class="sub">mais recentes primeiro</span></div>
        <div class="painel-corpo tabela-rolagem"><table class="dados"><thead><tr><th class="esq">Data</th><th class="esq"></th><th class="esq">Jogo</th><th>Placar</th>
          <th class="ocultar-celular">Projeção</th><th>Resultado</th></tr></thead><tbody id="bt-linhas">${linhasEntradas(false)}</tbody></table>
          ${r.n > 60 ? `<button class="link" type="button" id="bt-todas" style="margin-top:10px">Mostrar todas as ${r.n} entradas</button>` : ""}</div></div>` : ""}`;
    const todas = document.getElementById("bt-todas");
    if (todas) todas.addEventListener("click", () => { document.getElementById("bt-linhas").innerHTML = linhasEntradas(true); todas.remove(); });
  }

  function curvaSVG(vals) {
    if (vals.length < 2) return "";
    const W = 600, H = 170, P = 8;
    const all = [0, ...vals];
    const min = Math.min(...all), max = Math.max(...all), amp = max - min || 1;
    const x = (i) => P + (i / (all.length - 1)) * (W - 2 * P);
    const y = (v) => P + (1 - (v - min) / amp) * (H - 2 * P);
    const d = all.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const final = vals[vals.length - 1];
    return `<svg class="curva" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Evolução do saldo, terminando em ${fNum(final, 2)} unidades">
      <line x1="${P}" x2="${W - P}" y1="${y(0)}" y2="${y(0)}" stroke="var(--linha)" stroke-width="1.5" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>
      <path d="${d}" fill="none" stroke="${final >= 0 ? "var(--vitoria)" : "var(--derrota)"}" stroke-width="2.2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
  }

  // ------------------------------------------------------------ eventos
  app.addEventListener("click", (ev) => {
    const alvo = ev.target.closest("[data-tempo],#abrir-filtros,[data-fquem],#l-add,[data-lremover],[data-lpreset],[data-lsalvo],[data-lapagar],#l-salvar,#l-limpar,[data-rkordem],[data-rkn],[data-rkfiltro],[data-favtime],[data-favliga],[data-subclass],[data-fav],[data-ir],[data-dia],[data-passo],[data-recolher],[data-ultimos],[data-recorte],[data-abajogo],[data-voltar],#ocultar,#so-fav,#recolher,[data-tabela],[data-fcomp],[data-remover],[data-preset],[data-salvo],[data-apagar],#f-add,#f-rodar,#f-salvar");
    if (!alvo) return;
    const ds = alvo.dataset;
    const manterRolagem = (fn) => { const y = window.scrollY; fn(); window.scrollTo(0, y); };
    if (ds.favtime || ds.favliga) {
      ev.stopPropagation();
      const conj = ds.favtime ? favTimes : favLigas, v = ds.favtime || ds.favliga;
      conj.has(v) ? conj.delete(v) : conj.add(v);
      guardar(ds.favtime ? "fav_times" : "fav_ligas", [...conj]);
      manterRolagem(render);
      return;
    }
    if (ds.tempo) { estado.tempo = Number(ds.tempo); manterRolagem(render); return; }
    if (alvo.id === "abrir-filtros") {
      estado.painelFiltro = !estado.painelFiltro;
      const pf = document.getElementById("painel-filtros");
      pf.hidden = !estado.painelFiltro;
      alvo.setAttribute("aria-expanded", estado.painelFiltro);
      if (estado.painelFiltro) { pf.innerHTML = painelFiltros(); ligarPainelFiltros(); } else pf.innerHTML = "";
      return;
    }
    if (ds.fquem) { estado.filtro.quem = ds.fquem; salvarFiltro(); redesenharPainel(); return; }
    if (alvo.id === "l-add") { estado.filtro.condicoes.push({ suj: "hc", met: "vit", op: ">=", val: 50 }); salvarFiltro(); redesenharPainel(); return; }
    if (ds.lremover != null) { estado.filtro.condicoes.splice(Number(ds.lremover), 1); salvarFiltro(); redesenharPainel(); return; }
    if (ds.lpreset != null) { estado.filtro = Object.assign(copiaFiltro(FILTRO_VAZIO), copiaFiltro(PRESETS_LISTA[Number(ds.lpreset)])); salvarFiltro(); redesenharPainel(); return; }
    if (ds.lsalvo != null) { const l = ler("filtros_lista", []); estado.filtro = Object.assign(copiaFiltro(FILTRO_VAZIO), copiaFiltro(l[Number(ds.lsalvo)])); salvarFiltro(); redesenharPainel(); return; }
    if (ds.lapagar != null) {
      const l = ler("filtros_lista", []); const nome = (l[Number(ds.lapagar)] || {}).nome;
      if (confirm(`Apagar o filtro "${nome}"?`)) { l.splice(Number(ds.lapagar), 1); guardar("filtros_lista", l); redesenharPainel(); }
      return;
    }
    if (alvo.id === "l-salvar") {
      if (!nFiltros(estado.filtro)) { alert("Ajuste algum filtro antes de salvar."); return; }
      const nome = (prompt("Nome do filtro:", estado.filtro.nome || "") || "").trim();
      if (!nome) return;
      const l = ler("filtros_lista", []);
      const novo = Object.assign(copiaFiltro(estado.filtro), { nome });
      const i = l.findIndex((x) => x.nome === nome);
      if (i >= 0) l[i] = novo; else l.push(novo);
      guardar("filtros_lista", l); estado.filtro.nome = nome; salvarFiltro(); redesenharPainel(); return;
    }
    if (alvo.id === "l-limpar") { estado.filtro = copiaFiltro(FILTRO_VAZIO); salvarFiltro(); redesenharPainel(); return; }
    if (ds.rkordem) { estado.rkOrdem = ds.rkordem; guardar("rk_ordem", estado.rkOrdem); manterRolagem(render); return; }
    if (ds.rkn) { estado.rkN = Number(ds.rkn); guardar("rk_n", estado.rkN); manterRolagem(render); return; }
    if (ds.rkfiltro) { estado.rkFiltro = ds.rkfiltro; manterRolagem(render); return; }
    if (ds.subclass) { estado.subClass = ds.subclass; manterRolagem(render); return; }
    if (ds.fav) {
      ev.stopPropagation();
      favoritos.has(ds.fav) ? favoritos.delete(ds.fav) : favoritos.add(ds.fav);
      guardar("favoritos", [...favoritos]);
      const on = favoritos.has(ds.fav);
      document.querySelectorAll(`[data-fav="${ds.fav}"]`).forEach((b) => { b.setAttribute("aria-pressed", on); b.setAttribute("aria-label", on ? "Remover dos favoritos" : "Adicionar aos favoritos"); });
      if (estado.soFavoritos) renderListaJogos();
      return;
    }
    if (ds.ir) { ir(ds.ir); return; }
    if (ds.dia) { estado.dia = ds.dia; ir("jogos"); return; }
    if (ds.passo != null) { estado.dia = limitarDia(ds.passo === "0" ? hoje() : somarDias(estado.dia || hoje(), Number(ds.passo))); ir("jogos"); return; }
    if (ds.recolher) { recolhidas.has(ds.recolher) ? recolhidas.delete(ds.recolher) : recolhidas.add(ds.recolher); renderListaJogos(); return; }
    if (alvo.id === "recolher") {
      if (recolhidas.size) recolhidas.clear(); else comps.forEach((c) => recolhidas.add(c));
      renderListaJogos(); return;
    }
    if (alvo.id === "ocultar") { estado.ocultarEncerrados = !estado.ocultarEncerrados; guardar("ocultar", estado.ocultarEncerrados); manterRolagem(telaJogos); return; }
    if (alvo.id === "so-fav") { estado.soFavoritos = !estado.soFavoritos; manterRolagem(telaJogos); return; }
    if (ds.ultimos != null) { estado.ultimos = Number(ds.ultimos); manterRolagem(render); return; }
    if (ds.recorte) { estado.recorte = ds.recorte; manterRolagem(render); return; }
    if (ds.abajogo) { estado.abaJogo = ds.abajogo; estado.abaManual = true; manterRolagem(render); return; }
    if (ds.voltar != null) { ir("jogos"); return; }
    if (ds.tabela) { estado.vistaTabela = ds.tabela; manterRolagem(render); return; }
    if (ds.fcomp) {
      lerCamposFiltro();
      const s = new Set(compsDoFiltro());
      s.has(ds.fcomp) ? s.delete(ds.fcomp) : s.add(ds.fcomp);
      filtro.comps = s.size ? [...s] : null;
      guardar("filtro_atual", filtro); telaFiltros(); return;
    }
    if (ds.remover != null) { lerCamposFiltro(); filtro.condicoes.splice(Number(ds.remover), 1); guardar("filtro_atual", filtro); telaFiltros(); return; }
    if (ds.preset != null) { filtro = JSON.parse(JSON.stringify(PRESETS[Number(ds.preset)])); guardar("filtro_atual", filtro); telaFiltros(); return; }
    if (ds.salvo != null) { filtro = JSON.parse(JSON.stringify(ler("filtros", [])[Number(ds.salvo)])); guardar("filtro_atual", filtro); telaFiltros(); return; }
    if (ds.apagar != null) {
      const l = ler("filtros", []); const nome = (l[Number(ds.apagar)] || {}).nome;
      if (confirm(`Apagar o filtro "${nome}"?`)) { l.splice(Number(ds.apagar), 1); guardar("filtros", l); lerCamposFiltro(); telaFiltros(); }
      return;
    }
    if (alvo.id === "f-add") { lerCamposFiltro(); filtro.condicoes.push({ suj: "hc", met: "vit", op: ">=", val: 50 }); guardar("filtro_atual", filtro); telaFiltros(); return; }
    if (alvo.id === "f-rodar") { rodarBacktest(); return; }
    if (alvo.id === "f-salvar") {
      lerCamposFiltro();
      if (!filtro.nome) { filtro.nome = "Meu filtro " + (ler("filtros", []).length + 1); }
      const l = ler("filtros", []);
      const i = l.findIndex((x) => x.nome === filtro.nome);
      if (i >= 0) l[i] = JSON.parse(JSON.stringify(filtro)); else l.push(JSON.parse(JSON.stringify(filtro)));
      guardar("filtros", l); telaFiltros(); return;
    }
  });
  app.addEventListener("change", (ev) => {
    const el = ev.target;
    if (!el.closest || !el.closest(".filtros-grade")) return; // só a tela antiga de backtest usa este tratador
    if (el.dataset && el.dataset.campo === "suj") {
      lerCamposFiltro();
      const c = filtro.condicoes[Number(el.closest(".cond").dataset.i)];
      c.met = metricasDoSujeito(c.suj)[0].id;
      guardar("filtro_atual", filtro); telaFiltros();
    } else if (el.closest && el.closest(".filtros-grade")) {
      rodarBacktest();
    }
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && estado.sel && !document.querySelector("dialog[open]")) ir("jogos");
  });
  let eraLado = ladoALado();
  window.addEventListener("resize", () => {
    const agora = ladoALado();
    if (agora !== eraLado) { eraLado = agora; if (/^#jogo\//.test(location.hash)) render(); }
  });
  app.addEventListener("keydown", (ev) => {
    if ((ev.key === "Enter" || ev.key === " ") && ev.target.dataset && ev.target.dataset.ir && ev.target.tagName !== "BUTTON") { ev.preventDefault(); ir(ev.target.dataset.ir); }
  });

  // ------------------------------------------------------------ rotas
  function ir(rota) {
    if (location.hash === "#" + rota) render(); else location.hash = rota;
  }
  let ultimaAba = null;
  function render() {
    const partes = decodeURIComponent(location.hash.slice(1)).split("/");
    const aba = partes[0] || "jogos";
    const abaMenu = aba === "jogo" ? "jogos" : aba === "time" ? "times" : aba;
    document.querySelectorAll("#abas a").forEach((a) => a.toggleAttribute("aria-current", false));
    const link = document.querySelector(`#abas a[data-aba="${abaMenu}"]`);
    if (link) link.setAttribute("aria-current", "page");

    if (!DADOS || !comps.length) {
      app.innerHTML = `<div class="painel"><div class="vazio"><strong>Ainda não há dados</strong>
        Dê dois cliques em <b>atualizar.bat</b> (ou rode <code>python atualizar_dados.py</code>) para baixar as competições da football-data.org. Depois recarregue esta página.</div></div>`;
      return;
    }
    switch (aba) {
      case "jogo": telaJogo(partes[1], partes[2]); break;
      case "jogos": case "": estado.sel = null; telaJogos(); break;
      case "classificacao": telaClassificacao(partes[1]); break;
      case "times": telaTimes(partes[1]); break;
      case "time": telaTime(partes[1], partes[2]); break;
      case "ranking": telaRanking(partes[1]); break;
      case "artilharia": telaArtilharia(partes[1]); break;
      case "filtros": estado.painelFiltro = true; telaJogos(); break; // backtest desligado por enquanto
      default: telaJogos();
    }
    const chave = aba + "/" + (partes[1] || "") + "/" + (partes[2] || "");
    const noPainel = aba === "jogo" && estado.sel;
    if (ultimaAba !== chave && !noPainel && !(aba === "jogos" && /^jogo\//.test(ultimaAba || "") && ladoALado())) window.scrollTo(0, 0);
    ultimaAba = chave;
    document.querySelectorAll("tr[data-ir]").forEach((tr) => tr.setAttribute("tabindex", "0"));
  }
  window.addEventListener("hashchange", render);

  // V4: contas e ao vivo
  function recarregarPreferencias() {
    const encher = (set, arr, f) => { set.clear(); (arr || []).forEach((x) => set.add(f ? f(x) : x)); };
    encher(favTimes, ler("fav_times", []), String);
    encher(favLigas, ler("fav_ligas", []));
    encher(favoritos, ler("favoritos", []));
    estado.filtro = Object.assign(copiaFiltro(FILTRO_VAZIO), ler("filtro_lista", {}));
    estado.ordem = ler("ordem", estado.ordem);
    estado.ocultarEncerrados = ler("ocultar", estado.ocultarEncerrados);
    estado.rkOrdem = ler("rk_ordem", estado.rkOrdem);
    estado.rkN = ler("rk_n", estado.rkN);
    const c = ler("comp", ""); if (comps.includes(c)) estado.comp = c;
    const t = ler("tema", null); if (t) document.documentElement.dataset.tema = t;
    render();
  }
  window.App = { dados: DADOS, jogoAberto, recarregarPreferencias, render: () => render(), aoVivoAtualizado };
  function jogoAberto() {
    if (estado.sel) return { code: estado.sel.code, id: estado.sel.id };
    const m = location.hash.match(/^#jogo\/([^/]+)\/([^/]+)/);
    return m ? { code: decodeURIComponent(m[1]), id: decodeURIComponent(m[2]) } : null;
  }
  function aoVivoAtualizado() {
    todasPartidas.cache = null;
    const rolaveis = [...document.querySelectorAll(".detalhe-lado, .detalhe-lado *")].filter((el) => el.scrollTop > 0).map((el) => [el.className, el.scrollTop]);
    const y = window.scrollY;
    render();
    for (const [cls, top] of rolaveis) { const el = cls && document.getElementsByClassName(cls)[0]; if (el) el.scrollTop = top; }
    window.scrollTo(0, y);
  }

  montarTopo();
  render();
  if (window.Contas) window.Contas.iniciar();
  if (window.AoVivo) window.AoVivo.iniciar();
})();
