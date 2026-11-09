/* Estatísticas de Futebol — interface */
(function () {
  "use strict";

  // beta 5: base nova (ESPN + FotMob) em dados5.js; se ela falhar, a página carrega a football-data (reserva)
  const B5 = !!(window.DADOS5_OK && window.DADOS5);
  const RESERVA = !B5 && !!window.DADOS5_TENTOU;
  const DADOS = (B5 ? window.DADOS5 : window.DADOS) || window.DADOS_DEMO || null;
  const DEMO = !B5 && !window.DADOS && !!window.DADOS_DEMO;
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
    BSB: { nome: "Brasileirão Série B", pais: "Brasil" }, LMX: { nome: "Liga MX", pais: "México" }, MLS: { nome: "MLS", pais: "Estados Unidos" },
    ARG: { nome: "Liga Profesional", pais: "Argentina" }, CHI: { nome: "Primera División", pais: "Chile" }, COL: { nome: "Primera A", pais: "Colômbia" },
    UEL: { nome: "Europa League", pais: "Europa" }, UECL: { nome: "Conference League", pais: "Europa" },
    LIB: { nome: "Libertadores", pais: "América do Sul" }, SUL: { nome: "Sul-Americana", pais: "América do Sul" },
    WC: { nome: "Copa do Mundo", pais: "Mundo" },
    EC: { nome: "Eurocopa", pais: "Europa" },
  };
  const ORDEM = (DADOS && DADOS.ordem) || ["BSA", "PL", "PD", "SA", "BL1", "FL1", "PPL", "DED", "ELC", "CL"];
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
  // na beta 5 os códigos de times e jogos são os da ESPN: as preferências ficam separadas ("ef5_") e não vão para a conta
  // a página de teste guarda separado ("ef5_") e não sincroniza com a conta; o site oficial usa as chaves de sempre
  const PREFIXO = B5 && window.SB_TESTE ? "ef5_" : "ef_";
  const guardar = (k, v) => { try { localStorage.setItem(PREFIXO + k, JSON.stringify(v)); } catch (e) {} if (window.Contas && PREFIXO === "ef_") window.Contas.marcarAlteracao(k); };
  const ler = (k, padrao) => { try { const v = localStorage.getItem(PREFIXO + k); return v == null ? padrao : JSON.parse(v); } catch (e) { return padrao; } };

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
  // o dia de cada jogo é pedido milhares de vezes a cada atualização ao vivo: guarda o resultado
  const memoDia = new Map();
  const diaDe = (iso) => { let d = memoDia.get(iso); if (d === undefined) { d = chaveDia(new Date(iso)); if (memoDia.size > 20000) memoDia.clear(); memoDia.set(iso, d); } return d; };

  // troca o conteúdo de um bloco mexendo só no que mudou (em vez de apagar e recriar tudo):
  // é bem mais leve no celular e não perde rolagem, foco, seleção nem o "passar o mouse"
  const compativel = (v, n) => v.nodeType === n.nodeType && v.nodeName === n.nodeName && (v.nodeType !== 1 || v.id === n.id);
  function sincronizarNo(v, n, prof) {
    if (!compativel(v, n)) { v.replaceWith(n); return; }
    if (n.nodeType === 3 || n.nodeType === 8) { if (v.data !== n.data) v.data = n.data; return; }
    if (n.nodeType !== 1) { v.replaceWith(n); return; }
    if (v.isEqualNode(n)) return;
    if (!prof || /^(INPUT|SELECT|TEXTAREA|OPTION)$/i.test(n.nodeName)) { v.replaceWith(n); return; }
    for (const a of [...v.attributes]) if (!n.hasAttribute(a.name)) v.removeAttribute(a.name);
    for (const a of n.attributes) if (v.getAttribute(a.name) !== a.value) v.setAttribute(a.name, a.value);
    sincronizarFilhos(v, [...n.childNodes], prof - 1);
  }
  function sincronizarFilhos(el, novos, prof) {
    const velhos = [...el.childNodes], nv = velhos.length, nn = novos.length;
    if (nv === nn) { for (let i = 0; i < nn; i++) sincronizarNo(velhos[i], novos[i], prof); return; }
    // entrou ou saiu um bloco: aproveita o que bate no começo e no fim e troca só o meio
    const max = Math.min(nv, nn);
    let i = 0, j = 0;
    while (i < max && compativel(velhos[i], novos[i])) i++;
    while (j < max - i && compativel(velhos[nv - 1 - j], novos[nn - 1 - j])) j++;
    const ref = j ? velhos[nv - j] : null;
    for (let k = i; k < nv - j; k++) velhos[k].remove();
    for (let k = i; k < nn - j; k++) el.insertBefore(novos[k], ref);
    for (let k = 0; k < i; k++) sincronizarNo(velhos[k], novos[k], prof);
    for (let k = 1; k <= j; k++) sincronizarNo(velhos[nv - k], novos[nn - k], prof);
  }
  function morfar(el, html) {
    // nada mudou desde a última vez (e ninguém mexeu no bloco por fora): não faz nada
    if (el.__html === html && el.__marca === el.firstChild && el.firstChild) return false;
    const t = document.createElement("template");
    t.innerHTML = html;
    if (el.__html == null || !el.firstChild) el.replaceChildren(t.content);
    else sincronizarFilhos(el, [...t.content.childNodes], 12);
    el.__html = html; el.__marca = el.firstChild;
    return true;
  }
  // telas que se atualizam sozinhas (jogo, painel ao vivo, janela): mesma tela = só o que mudou; outra tela = tudo novo
  function pintarApp(chave, html) {
    if (app.__chave === chave && app.__marca === app.firstChild && app.firstChild) morfar(app, html);
    else { app.innerHTML = html; app.__html = html; app.__marca = app.firstChild; }
    app.__chave = chave;
  }
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
    if (DADOS && (DADOS.ok_em || DADOS.gerado_em)) {
      // beta 5: horário da última atualização que deu certo (se a ESPN falhar numa rodada, não finge que atualizou)
      const d = new Date(DADOS.ok_em || DADOS.gerado_em);
      meta.innerHTML = DEMO ? "Dados de demonstração" : `Dados de ${pad(d.getDate())}/${pad(d.getMonth() + 1)} às ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    if (RESERVA) {
      document.getElementById("aviso").innerHTML = `<div class="aviso aviso-reserva"><div><b>Estamos com instabilidade na fonte principal de dados.</b> Por enquanto o site está usando a fonte reserva: jogos, tabelas e estatísticas básicas continuam funcionando, mas tipos de gol, períodos, escanteios, cartões e xG ficam indisponíveis até a fonte principal voltar.</div></div>`;
    } else if (DEMO) {
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
  const ROT_STATUS = (p) => (aoVivo(p) ? (p.vv && p.vv.min ? `<span class="vivo-min">${h(p.vv.min)}</span>` : `<span class="vivo">${STATUS[p.s]}</span>`) : STATUS[p.s] || p.s);

  // ---------- ao vivo: estatísticas, lances, pressão e escalações (dados da ESPN, ver aovivo.js)
  const EST_VIVO = [["posse", "Posse de bola", "%"], ["xg", "Gols esperados (xG)"], ["da", "Ataques perigosos"], ["atk", "Ataques"], ["cp", "Chances perigosas"], ["chutes", "Finalizações"], ["alvo", "No alvo"], ["fora5", "Para fora"], ["trave", "Na trave"],
    ["esc", "Escanteios"], ["faltas", "Faltas"], ["amarelos", "Cartões amarelos"], ["vermelhos", "Cartões vermelhos"], ["imped", "Impedimentos"],
    ["defesas", "Defesas do goleiro"], ["passes", "Passes"]];
  const temAoVivo = (p) => !!(p.vv && p.vv.espn);
  // aviso quando a ESPN não responde há alguns ciclos (o placar volta a ser o da football-data)
  const avisoFonte = () => (window.AoVivo && window.AoVivo.indisponivel && window.AoVivo.indisponivel()
    ? `<div class="aviso-fonte" role="status"><b>Dados ao vivo temporariamente indisponíveis.</b> A ESPN não está respondendo; tentando de novo a cada 20 s. Enquanto isso, o placar vem da football-data, que atrasa alguns minutos.</div>` : "");
  const horaCurta = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const horaAtualizacao = (p) => { const v = p.vv || {}, t = [v.emDet || v.em, v.emPbp].filter(Boolean).sort().pop(); if (!t) return ""; const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };

  // ---------- gráfico de pressão: uma barra por minuto (para cima o mandante, para baixo o visitante)
  // a barra do minuto atual vai crescendo conforme os lances chegam; minuto sem lance fica sem barra
  const TIPOS_MARCA = [
    ["gol", "Gols"], ["alvo", "Chutes no gol"], ["fora", "Chutes para fora"], ["bloq", "Chutes bloqueados"],
    ["trave", "Bola na trave"], ["esc", "Escanteios"], ["cartao", "Cartões"], ["sub", "Substituições"],
  ];
  const NOME_MARCA = { gol: "gol", alvo: "chute no gol", fora: "chute para fora", bloq: "chute bloqueado", trave: "bola na trave",
    esc: "escanteio", amarelo: "cartão amarelo", vermelho: "cartão vermelho", "2amarelo": "2º amarelo (expulso)", sub: "substituição" };
  const PRIOR = { gol: 9, vermelho: 8, "2amarelo": 8, trave: 7, alvo: 6, amarelo: 5, fora: 4, bloq: 3, sub: 2, esc: 1 };
  const grupoMarca = (k) => (k === "amarelo" || k === "vermelho" || k === "2amarelo" ? "cartao" : k);
  const OPC_PADRAO = { gol: true, alvo: true, fora: true, bloq: true, trave: true, esc: false, cartao: true, sub: true, modo: "tendencia", saldo: true, som: false };
  estado.prOpc = Object.assign({}, OPC_PADRAO, ler("pr_opc", {}));
  estado.prConfig = false;
  let infoPressao = "";
  const iconeMarca = (k) => (k === "gol" ? "⚽" : k === "sub" ? "⇄" : "");

  // peso de cada ataque (365Scores) na barra do minuto; os lances da ESPN (chutes, escanteios, gols) continuam valendo
  const PESO_ATAQUE = 0.45;
  function somarAtaques(pr, atk) {
    if (!atk) return pr;
    const h = pr.h.slice(), a = pr.a.slice();
    pr.slots.forEach((s, i) => {
      const k = s.per + ":" + s.b + ":" + s.ad;
      if (atk.h[k]) h[i] = Math.round((h[i] + atk.h[k] * PESO_ATAQUE) * 10) / 10;
      if (atk.a[k]) a[i] = Math.round((a[i] + atk.a[k] * PESO_ATAQUE) * 10) / 10;
    });
    return Object.assign({}, pr, { h, a });
  }
  // lances "provisórios" (contador do 365Scores subiu e a narração ainda não chegou): mesmo peso dos lances
  const PESO_PROV = { gol: 5, alvo: 3, trave: 2.5, fora: 1.5, bloq: 1.5, esc: 1.5 };
  function somarProvisorios(pr, prov) {
    if (!prov || !prov.length) return pr;
    const h = pr.h.slice(), a = pr.a.slice();
    for (const x of prov) {
      const w = PESO_PROV[x.k];
      if (!w || x.i == null || x.i >= pr.slots.length) continue;
      const alvo = x.l === "h" ? h : a;
      alvo[x.i] = Math.round(((alvo[x.i] || 0) + w) * 10) / 10;
    }
    return Object.assign({}, pr, { h, a });
  }
  // domínio: quem trocou mais passes em cada minuto (365Scores, a cada 6 s) ganha barra pela DIFERENÇA de passes.
  // É o que mostra o "amasso" mesmo sem chute: 12 passes x 4 no minuto = +1,2 (quase um chute para fora)
  const PESO_PASSE = 0.15;
  function somarPasses(pr, pas) {
    if (!pas) return pr;
    const h = pr.h.slice(), a = pr.a.slice();
    pr.slots.forEach((s, i) => {
      const k = s.per + ":" + s.b + ":" + s.ad, ph = pas.h[k] || 0, pa = pas.a[k] || 0;
      // (no máximo 2,5 por minuto: se o 365Scores mandar vários minutos de passes de uma vez, não vira um pico falso)
      if (ph > pa) h[i] = Math.round(((h[i] || 0) + Math.min((ph - pa) * PESO_PASSE, 2.5)) * 10) / 10;
      else if (pa > ph) a[i] = Math.round(((a[i] || 0) + Math.min((pa - ph) * PESO_PASSE, 2.5)) * 10) / 10;
    });
    return Object.assign({}, pr, { h, a });
  }
  // "pressão nos últimos 5 min": parte de cada time nos pontos do gráfico (lances, ataques, domínio de passes e
  // lances provisórios) das 5 últimas barras. Funciona em todo jogo que tem o gráfico.
  function pressaoMomento(p) {
    const pr = p.vv && p.vv.pr;
    if (!pr || pr.fim || p.s === "FINISHED") return null;
    const atual = pr.atual == null ? pr.ultimo : pr.atual;
    if (atual < 0) return null;
    const val = valoresPressao(pr, "minuto", p.vv.atk, p.vv.prov, p.vv.pas, p.vv);
    let sh = 0, sa = 0;
    for (let i = Math.max(0, atual - 4); i <= atual; i++) { sh += val.h[i] || 0; sa += val.a[i] || 0; }
    return { tot: sh + sa, h: sh + sa ? Math.round((sh / (sh + sa)) * 100) : 50 };
  }
  function blocoPressao5(p, compacto) {
    const pm = pressaoMomento(p);
    if (!pm) return "";
    const rot = `<small class="sub">pressão nos últimos 5 min</small>`;
    if (pm.tot < 0.5) return `<div class="pressao-posse vazio${compacto ? " mini" : ""}">${rot}<small class="sub">sem lances</small></div>`;
    return `<div class="pressao-posse${compacto ? " mini" : ""}" title="Parte de cada time nos pontos do gráfico (chutes, escanteios, gols, ataques e domínio de passes) nos últimos 5 minutos">
      <span>${compacto ? "" : h(nomeTime(p.h)) + " "}<b>${pm.h}%</b></span><span class="pp-barra"><i style="width:${pm.h}%"></i></span><span><b>${100 - pm.h}%</b>${compacto ? "" : " " + h(nomeTime(p.a))}</span>${rot}</div>`;
  }
  // 5DollarFootballAPI (teste pessoal, só com a chave salva no navegador): cada ataque perigoso vale 0,6;
  // os ataques comuns (0,12 cada) só entram quando o 365Scores não tem o contador de ataques dele
  const PESO_DA = 0.6, PESO_AT5 = 0.12;
  function somarD5(pr, d5, temAtk) {
    if (!d5 || !d5.da) return pr;
    const h = pr.h.slice(), a = pr.a.slice();
    pr.slots.forEach((s, i) => {
      const k = s.per + ":" + s.b + ":" + s.ad;
      for (const [l, arr] of [["h", h], ["a", a]]) {
        const v = (d5.da[l][k] || 0) * PESO_DA + (temAtk ? 0 : (d5.at[l][k] || 0) * PESO_AT5);
        if (v) arr[i] = Math.round(((arr[i] || 0) + Math.min(v, 4)) * 10) / 10;
      }
    });
    return Object.assign({}, pr, { h, a });
  }
  // quem alimenta as barras: com a 5Dollar em dia, ataques perigosos/ataques dela; na reserva (365Scores),
  // os ataques e o domínio de passes do 365Scores
  const fonteDe = (vv) => (vv && window.AoVivo && AoVivo.modoDe ? AoVivo.modoDe({ vv }) : "365");
  function valoresPressao(pr0, modo, atk, prov, pas, vv, vivo) {
    const reserva = fonteDe(vv) === "365";
    const pr = somarD5(somarPasses(somarProvisorios(somarAtaques(pr0, reserva ? atk : null), prov), reserva ? pas : null), reserva ? null : vv && vv.d5, false);
    if (modo !== "tendencia") return { h: pr.h, a: pr.a };
    // tendência: cada minuto carrega um pouco dos anteriores (o lance "esfria" aos poucos).
    // vivo = { i, e }: no minuto atual, o que veio de antes esfria segundo a segundo (e = fração do minuto já jogada);
    // no fim do minuto a barra chega exatamente ao valor do minuto fechado
    const h = [], a = [];
    let sh = 0, sa = 0;
    for (let i = 0; i < pr.slots.length; i++) {
      const f = vivo && i === vivo.i ? Math.pow(0.55, vivo.e) : 0.55;
      sh = f * sh + (pr.h[i] || 0); sa = f * sa + (pr.a[i] || 0);
      h[i] = Math.round(sh * 10) / 10; a[i] = Math.round(sa * 10) / 10;
    }
    return { h, a };
  }

  const temChave5d = () => { try { return !!localStorage.getItem("sb_5d_chave"); } catch (e) { return false; } };
  const servidor5d = () => !!(window.AoVivo && AoVivo.servidor5d);
  const fonte5d = () => servidor5d() || temChave5d();
  // ---------- alerta de pressão: quem está dominando os últimos minutos (lances da ESPN + ataques do 365Scores)
  // nível 1 "pressão forte": ≥ 68% da pressão das últimas 8 barras; nível 2 "gol pode sair": ≥ 75% e
  // pelo menos 3 lances perigosos (chute no gol, trave ou escanteio) nesse período.
  function alertaPressao(p) {
    const pr = p.vv && p.vv.pr;
    if (!pr || pr.fim || pr.intervalo || p.s !== "IN_PLAY") return null;
    const atual = pr.atual == null ? pr.ultimo : pr.atual;
    if (atual < 6) return null;
    const val = valoresPressao(pr, "minuto", p.vv.atk, p.vv.prov, p.vv.pas, p.vv);
    const ini = Math.max(0, atual - 7);
    let sh = 0, sa = 0;
    for (let i = ini; i <= atual; i++) { sh += val.h[i] || 0; sa += val.a[i] || 0; }
    const l = sh >= sa ? "h" : "a", forte = Math.max(sh, sa), total = sh + sa;
    if (!total) return null;
    const share = forte / total;
    const perigo = pr.ev.concat(p.vv.prov || []).filter((e) => e.l === l && e.i >= ini && ["alvo", "trave", "esc"].includes(e.k)).length;
    // há quantos minutos o time está por cima (média de 3 barras)
    let mins = 0;
    for (let i = atual; i >= 2; i--) {
      const mh = (val.h[i] || 0) + (val.h[i - 1] || 0) + (val.h[i - 2] || 0), ma = (val.a[i] || 0) + (val.a[i - 1] || 0) + (val.a[i - 2] || 0);
      if ((l === "h" ? mh - ma : ma - mh) > 0.5) mins++; else break;
    }
    // gol do próprio time há menos de 2 minutos: a pressão "virou" gol, não alerta
    if (pr.ev.some((e) => e.k === "gol" && e.l === l && e.i >= atual - 1)) return null;
    let nivel = 0;
    if (share >= 0.75 && forte >= 9 && perigo >= 3) nivel = 2;
    else if (share >= 0.68 && forte >= 6) nivel = 1;
    if (!nivel) return null;
    return { nivel, l, mins: Math.max(mins, 3), share: Math.round(share * 100), perigo, tid: l === "h" ? p.h : p.a };
  }
  const textoAlerta = (a) => a.nivel === 2
    ? `<b>${h(nomeTime(a.tid))}</b> com pressão absurda há ${a.mins} min · ${a.perigo} lances perigosos · gol pode estar próximo`
    : `<b>${h(nomeTime(a.tid))}</b> pressionando forte há ${a.mins} min (${a.share}% da pressão)`;
  function blocoAlerta(p, compacto) {
    const a = alertaPressao(p);
    avisarSom(p, a);
    if (!a) return "";
    return `<div class="alerta-pressao n${a.nivel} ${a.l === "h" ? "c" : "f"}${compacto ? " mini" : ""}" role="status"><span class="alerta-ic" aria-hidden="true">${a.nivel === 2 ? "🔥" : "⚡"}</span><span>${textoAlerta(a)}</span></div>`;
  }
  // som do alerta (opcional, ligado no "Exibir"): toca quando o alerta aparece ou sobe de nível
  const nivelAvisado = {};
  let audio = null;
  function avisarSom(p, a) {
    const ch = String(p.i), nivel = a ? a.nivel : 0, antes = nivelAvisado[ch] || 0;
    nivelAvisado[ch] = nivel;
    if (!estado.prOpc.som || nivel <= antes) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const tocar = (t0, freq) => { const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = freq; o.type = "sine";
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
        o.connect(g).connect(audio.destination); o.start(t0); o.stop(t0 + 0.25); };
      const t = audio.currentTime + 0.02;
      tocar(t, 880); tocar(t + 0.3, nivel === 2 ? 1175 : 880);
      if (nivel === 2) tocar(t + 0.6, 1175);
    } catch (e) {}
  }

  // de onde vêm os dados do gráfico (aparece embaixo dele)
  // rodapé do gráfico: só a hora; o resto (fontes, medidor, corrida) fica em "Informações técnicas"
  function notaPressao(p) {
    const v = p.vv || {}, hora = horaAtualizacao(p);
    const linhas = [];
    const L = (rot, txt) => linhas.push(`<div class="dv-l"><dt>${rot}</dt><dd>${txt}</dd></div>`);
    const fonte = fonteDe(v);
    L("Fonte principal", fonte === "5d" ? "5DollarFootballAPI (placar, lances, ataques e ataques perigosos)" : fonte === "espera" ? "esperando a 1ª resposta da 5DollarFootballAPI" : fonte5d() ? "365Scores (reserva: a 5Dollar está sem dados deste jogo)" : "365Scores");
    L("Lances", fonte === "365"
      ? (v.pbp365 ? "contadores e narração do 365Scores + narração da ESPN" : "contadores do 365Scores + narração da ESPN") + " (a cada ~6–10 s)"
      : "contadores e eventos da 5Dollar (a cada ~8 s); a narração da ESPN (a cada ~10 s) completa com os nomes");
    L("xG", v.es365 && v.es365.xg ? `365Scores (a cada ${fonte === "365" ? "~6" : "~30"} s)` : "—");
    if (fonte === "365") {
      L("Ataques (365Scores)", v.temAtk && v.atk ? `sim, a cada ~6 s (desde ${horaCurta(v.atk.desde)})` : v.id365 && v.st === "in" ? "esta liga não tem o contador" : "—");
      L("Domínio de passes", v.temPas && v.pas ? "sim: quem trocou mais passes no minuto ganha barra pela diferença (a cada ~6 s)" : "—");
    }
    if (fonte5d()) {
      const st = (window.AoVivo && AoVivo.d5Status) || {}, d = v.d5;
      const estado5 = st.msg && st.msg !== "ok" ? h(st.msg) : d && d.semJogo ? "este jogo não está na lista ao vivo deles" : !d ? "conectando…" : "ok, lido a cada ~8 s" + (d.desde ? ` (desde ${horaCurta(d.desde)})` : "");
      L("5DollarFootballAPI", estado5 + (servidor5d() ? " · pelo servidor do ScanBall (todos os jogos, para todos)" : " · pela sua chave (só o jogo aberto)"));
      if (d && d.ult && d.ult.da) L("Ataques perigosos", `${d.ult.da[0]} × ${d.ult.da[1]}${d.ult.at ? ` · ataques ${d.ult.at[0]} × ${d.ult.at[1]}` : ""} · último novo ${d.mudDa ? `há ${Math.round((Date.now() - d.mudDa) / 1000)} s` : "ainda não"}`);
    }
    if (v.rap) {
      const c = v.corrida;
      if (c) L("Corrida dos contadores", `5Dollar primeiro em <b>${c.d5} de ${c.n}</b> · 365Scores em ${c.n - c.d5} · diferença média de ${c.media} s`);
      const m = v.medRap;
      if (m) L("Contador × narração", `em ${m.n} ${m.n === 1 ? "lance" : "lances"}, o contador chegou <b>${m.media >= 0 ? `${m.media} s antes` : `${-m.media} s depois`}</b> em média (de ${m.min} a ${m.max} s; ${m.antes} de ${m.n} antes)`);
    }
    return `<div class="pressao-rodape"><span class="sub">${hora ? `Atualizado às ${hora}` : ""}</span>
      <button type="button" class="pressao-engr" data-prdev aria-expanded="${!!estado.prDev}">Informações técnicas ${estado.prDev ? "▴" : "▾"}</button></div>
      ${estado.prDev ? `<dl class="pressao-dev">${linhas.join("")}</dl>` : ""}`;
  }
  // o que entra nas barras, conforme a fonte do momento
  function subPressao(p) {
    const v = p.vv || {}, reserva = fonteDe(v) === "365";
    return [reserva && v.temPas && v.pas ? "domínio (passes)" : "", !reserva && v.d5 && v.d5.da ? "ataques perigosos" : "", reserva && v.temAtk ? "ataques" : "",
      "chutes, escanteios e gols por minuto"].filter(Boolean).join(", ");
  }
  // 5Dollar ligada mas sem dados deste jogo há 2 min: avisa que o 365Scores assumiu
  function avisoReserva(p) {
    if (!fonte5d() || fonteDe(p.vv) !== "365" || !p.vv || p.vv.st !== "in") return "";
    return `<div class="aviso-5d" role="status">5Dollar sem dados deste jogo há mais de 2 min: o 365Scores assumiu o gráfico e as estatísticas.</div>`;
  }
  function graficoPressao(p, compacto) {
    const pr = p.vv && p.vv.pr;
    if (!pr) {
      const msg = p.vv && p.vv.st === "pre" ? "O gráfico de pressão começa quando a bola rolar." : "Gráfico de pressão indisponível para este jogo.";
      return compacto ? "" : `<div class="pressao vazio-p"><p class="sub">${msg}</p></div>`;
    }
    const opc = compacto ? Object.assign({}, OPC_PADRAO, { alvo: false, fora: false, bloq: false, trave: false, cartao: true, sub: false, modo: estado.prOpc.modo, saldo: estado.prOpc.saldo }) : estado.prOpc;
    const n = pr.slots.length, L = 6, W = n * L, H = 100, meio = H / 2;
    const atual = pr.atual == null ? pr.ultimo : pr.atual;
    const prov = p.vv.prov || [];
    // barra viva: guarda quando o minuto atual começou (para o "esfriar" segundo a segundo)
    const vivoAgora = !pr.fim && !pr.intervalo && atual >= 0 && p.s === "IN_PLAY";
    let vivo = null;
    if (vivoAgora) {
      const ini = p.vv._iniMin;
      if (!ini || ini.i !== atual) p.vv._iniMin = { i: atual, t: ini && ini.i === atual - 1 ? Date.now() : Date.now() - 30000 };
      vivo = { i: atual, e: Math.min(1, Math.max(0, (Date.now() - p.vv._iniMin.t) / 60000)) };
    }
    const val0 = valoresPressao(pr, opc.modo, p.vv.atk, prov, p.vv.pas, p.vv, vivo);
    // saldo: em cada minuto só aparece quem dominou, com a barra = a diferença entre os dois times;
    // minuto equilibrado (os dois atacando parecido) vira um tracinho cinza no meio
    const empate = [];
    const val = !opc.saldo ? val0 : { h: [], a: [] };
    if (opc.saldo) for (let i = 0; i < n; i++) {
      const vh = val0.h[i] || 0, va = val0.a[i] || 0, d = Math.round((vh - va) * 10) / 10;
      if (vh && va && Math.abs(d) < Math.max(0.5, 0.2 * Math.max(vh, va))) { empate[i] = true; val.h[i] = 0; val.a[i] = 0; continue; }
      val.h[i] = d > 0 ? d : 0; val.a[i] = d < 0 ? -d : 0;
    }
    const evs = prov.length ? pr.ev.concat(prov) : pr.ev; // narração + provisórias do contador
    // escala: o teto é o "minuto forte típico" do jogo (85% das barras ficam abaixo dele), não o maior pico.
    // Assim um minuto com gol não achata o resto; o que passa do teto encosta no limite
    const vals = [];
    for (let i = 0; i <= atual && i < n; i++) { if (val.h[i]) vals.push(val.h[i]); if (val.a[i]) vals.push(val.a[i]); }
    vals.sort((x, y) => x - y);
    const p85 = vals.length ? vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.85))] : 0;
    const max = Math.max(opc.modo === "tendencia" ? 4 : 3, p85 * 1.2);
    const alt = (v) => Math.max(Math.min((v || 0) / max, 1) * (meio - 3), v ? 2 : 0);
    let barras = "";
    for (let i = 0; i <= atual && i < n; i++) {
      const x = i * L + 0.6;
      if (i === atual && vivoAgora) continue; // a barra viva vem depois, sempre com as duas metades (para animar)
      if (val.h[i]) barras += `<rect class="p-c" x="${x}" y="${(meio - alt(val.h[i])).toFixed(1)}" width="${L - 1.2}" height="${alt(val.h[i]).toFixed(1)}"/>`;
      if (val.a[i]) barras += `<rect class="p-f" x="${x}" y="${meio}" width="${L - 1.2}" height="${alt(val.a[i]).toFixed(1)}"/>`;
      if (empate[i]) barras += `<rect class="p-empate" x="${x}" y="${meio - 3}" width="${L - 1.2}" height="6"/>`;
    }
    // minuto atual: as metades de cima e de baixo existem sempre (altura 0 quando não tem nada), assim a barra
    // desliza suave quando sobe, esfria ou troca de lado
    if (vivoAgora && atual < n) {
      const x = atual * L + 0.6, ah = empate[atual] ? 3 : alt(val.h[atual]), aa = empate[atual] ? 3 : alt(val.a[atual]);
      const cls = empate[atual] ? "p-empate" : "";
      barras += `<rect id="pv-c" class="p-c p-atual ${cls}" x="${x}" width="${L - 1.2}" y="${(meio - ah).toFixed(1)}" height="${ah.toFixed(1)}" style="y:${(meio - ah).toFixed(1)}px;height:${ah.toFixed(1)}px"/>`;
      barras += `<rect id="pv-f" class="p-f p-atual ${cls}" x="${x}" width="${L - 1.2}" y="${meio}" height="${aa.toFixed(1)}" style="height:${aa.toFixed(1)}px"/>`;
    }
    // faixa do minuto atual (mostra onde a barra está "crescendo")
    const faixa = !pr.fim && !pr.intervalo && atual >= 0 ? `<rect class="p-faixa" x="${atual * L}" y="0" width="${L}" height="${H}"/>` : "";
    // separador do intervalo e linhas de gol de alto a baixo
    const iniSeg = pr.slots.findIndex((s) => s.per === 2);
    let linhas = iniSeg > 0 ? `<line x1="${iniSeg * L}" x2="${iniSeg * L}" y1="0" y2="${H}" class="p-tempo"/>` : "";
    const iniProrr = pr.slots.findIndex((s) => s.per === 3);
    if (iniProrr > 0) linhas += `<line x1="${iniProrr * L}" x2="${iniProrr * L}" y1="0" y2="${H}" class="p-tempo"/>`;
    if (opc.gol) for (const e of evs) if (e.k === "gol") linhas += `<line x1="${e.i * L + L / 2}" x2="${e.i * L + L / 2}" y1="0" y2="${H}" class="p-gol ${e.l === "h" ? "c" : "f"}"/>`;

    // marcas: tamanho fixo em pixels, empilhadas (até 2 por minuto e lado); toque mostra todas
    const bloco = compacto ? (window.innerWidth < 560 ? 4 : 3) : window.innerWidth < 560 ? 3 : window.innerWidth < 900 ? 2 : 1;
    const grupos = {};
    for (const e of evs) {
      if (!opc[grupoMarca(e.k)]) continue;
      const chave = e.l + Math.floor(e.i / bloco);
      (grupos[chave] = grupos[chave] || []).push(e);
    }
    const nomeLado = (l) => nomeTime(l === "h" ? p.h : p.a);
    const descr = (x) => `${x.min || pr.slots[x.i].r + "'"} ${x.j ? x.j + " · " : ""}${NOME_MARCA[x.k]}${x.x ? " (" + x.x + ")" : ""}`;
    const marcas = Object.values(grupos).map((g) => {
      const ord = g.slice().sort((a, b) => PRIOR[b.k] - PRIOR[a.k]);
      const info = g.slice().sort((a, b) => a.i - b.i).map(descr).join(" | ") + ` — ${nomeLado(g[0].l)}`;
      const left = (((ord[0].i + 0.5) / n) * 100).toFixed(2);
      return ord.slice(0, 2).map((e, j) => `<button type="button" class="mk mk-${e.k} ${e.l === "h" ? "mk-c" : "mk-f"} mk-n${j}${j === 1 && g.length > 2 ? " mk-mais" : ""}" style="left:${left}%" data-info="${h(info)}" title="${h(info)}" aria-label="${h(info)}">${iconeMarca(e.k)}</button>`).join("");
    }).join("");

    // eixo de 5 em 5 minutos
    let eixo = `<span style="left:0">0</span>`;
    const passo = n > 100 && window.innerWidth < 560 ? 15 : 5;
    pr.slots.forEach((s, i) => {
      if (s.ad || s.b % passo || i === n - 1 && s.b !== 90 && s.b !== 120) return;
      eixo += `<span class="${s.b % 45 === 0 ? "forte" : ""}" style="left:${(((i + 1) / n) * 100).toFixed(2)}%">${s.b}</span>`;
    });
    const ultimoSlot = pr.slots[n - 1];
    if (ultimoSlot.ad) eixo += `<span class="acr" style="left:100%">+${ultimoSlot.ad}</span>`;

    const conta = (l, ks) => evs.filter((x) => x.l === l && ks.includes(x.k)).length;
    const resumo = (l) => `${conta(l, ["gol", "alvo", "trave"])} no gol/trave · ${conta(l, ["fora", "bloq"])} fora/bloq.`;
    const svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${faixa}
          <line x1="0" x2="${W}" y1="${meio}" y2="${meio}" class="p-eixo"/>${linhas}${barras}</svg>`;
    if (compacto) {
      return `${blocoAlerta(p, true)}<div class="pressao pressao-mini"><div class="pressao-area">${svg}${marcas}</div>${blocoPressao5(p, true)}</div>`;
    }
    const simb = TIPOS_MARCA.filter(([k]) => opc[k] && k !== "esc").map(([k]) => {
      const ex = k === "cartao" ? '<i class="mk-ex mk-amarelo"></i><i class="mk-ex mk-vermelho"></i>' : `<i class="mk-ex mk-${k}">${iconeMarca(k)}</i>`;
      return `<span>${ex}${{ gol: "gol", alvo: "no gol", fora: "para fora", bloq: "bloqueado", trave: "trave", cartao: "cartões", sub: "substituição" }[k]}</span>`;
    }).join("") + (opc.esc ? `<span><i class="mk-ex mk-esc"></i>escanteio</span>` : "");
    const config = estado.prConfig ? `<div class="pressao-config" role="group" aria-label="O que aparece no gráfico">
        <div class="pc-linha"><span class="sub">Mostrar</span>${TIPOS_MARCA.map(([k, rot]) => `<button type="button" class="chip" data-propc="${k}" aria-pressed="${!!opc[k]}">${rot}</button>`).join("")}</div>
        <div class="pc-linha"><span class="sub">Barras</span>
          <button type="button" class="chip" data-prmodo="minuto" aria-pressed="${opc.modo !== "tendencia"}">Só o minuto</button>
          <button type="button" class="chip" data-prmodo="tendencia" aria-pressed="${opc.modo === "tendencia"}">Tendência</button>
          <button type="button" class="chip" data-propc="saldo" aria-pressed="${!!opc.saldo}">Só o saldo</button>
          <button type="button" class="chip" data-propc="padrao">Restaurar padrão</button></div>
        <div class="pc-linha pc-chave"><span class="sub">5Dollar</span>${servidor5d() ? `<span class="sub">ligado para todos pelo servidor do ScanBall ✓</span>` : temChave5d()
          ? `<span class="sub">chave salva neste navegador ✓</span><button type="button" class="chip" data-chave5d="remover">Remover chave</button>`
          : `<input id="chave5d" type="password" autocomplete="off" placeholder="cole a chave da 5DollarFootballAPI" aria-label="Chave da 5DollarFootballAPI"><button type="button" class="chip" data-chave5d="salvar">Salvar</button><small class="sub">A chave fica só neste navegador; nunca vai para o site nem para o GitHub.</small>`}</div>
        <div class="pc-linha"><span class="sub">Alerta</span><button type="button" class="chip" data-propc="som" aria-pressed="${!!opc.som}">🔔 Som quando um time pressionar forte</button></div>
        <p class="sub">"Só o minuto": cada barra mostra só o que aconteceu naquele minuto. "Tendência": cada barra carrega um pouco dos minutos anteriores. "Só o saldo": em cada minuto aparece só o time que dominou (barra = a diferença entre os dois); minuto equilibrado vira um tracinho cinza.</p>
      </div>` : "";
    return `<div class="pressao">
      ${blocoAlerta(p)}${avisoReserva(p)}
      <div class="pressao-cab"><h3>Pressão</h3><span class="sub">${subPressao(p)}</span>
        <button type="button" class="pressao-engr" data-prconfig aria-expanded="${!!estado.prConfig}" title="Escolher o que aparece no gráfico">
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.5 7.5 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.5 7.5 0 0 0 1.7-1l2.4 1 2-3.4zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/></svg>Exibir</button></div>
      ${config}
      <div class="pressao-area">${svg}${marcas}</div>
      <div class="pressao-eixo" aria-hidden="true">${eixo}</div>
      ${blocoPressao5(p)}
      <div class="pressao-leg"><span><i class="marcador c"></i>${h(nomeTime(p.h))} <small class="sub">${resumo("h")}</small></span><span><small class="sub">${resumo("a")}</small> ${h(nomeTime(p.a))}<i class="marcador f"></i></span></div>
      <div class="pressao-simb">${simb}</div>
      <p class="pressao-info" aria-live="polite">${infoPressao ? h(infoPressao) : "Toque numa marca para ver o lance."}</p>
      ${notaPressao(p)}
    </div>`;
  }
  document.addEventListener("click", (e) => {
    const t = e.target.closest && e.target.closest(".pressao .mk, [data-propc], [data-prmodo], [data-prconfig], [data-chave5d], [data-prdev], [data-estper]");
    if (!t) return;
    if (t.dataset.estper) { estado.estPer = t.dataset.estper; aoVivoAtualizado(); return; }
    if (t.dataset.chave5d) {
      try {
        if (t.dataset.chave5d === "salvar") { const v = ((document.getElementById("chave5d") || {}).value || "").trim(); if (v) localStorage.setItem("sb_5d_chave", v); }
        else localStorage.removeItem("sb_5d_chave");
      } catch (err) {}
      aoVivoAtualizado();
      return;
    }
    if (t.classList.contains("mk")) {
      infoPressao = t.dataset.info || "";
      const caixa = t.closest(".pressao").querySelector(".pressao-info");
      if (caixa) caixa.textContent = infoPressao;
      if (t.closest(".painel-vivo-card")) e.stopPropagation();
      return;
    }
    if (t.hasAttribute("data-prdev")) { estado.prDev = !estado.prDev; aoVivoAtualizado(); return; }
    if (t.hasAttribute("data-prconfig")) estado.prConfig = !estado.prConfig;
    else if (t.dataset.prmodo) estado.prOpc.modo = t.dataset.prmodo;
    else if (t.dataset.propc === "padrao") estado.prOpc = Object.assign({}, OPC_PADRAO);
    else estado.prOpc[t.dataset.propc] = !estado.prOpc[t.dataset.propc];
    guardar("pr_opc", estado.prOpc);
    aoVivoAtualizado();
  });

  // ---------- escalações: campinho com a formação + números de cada jogador na temporada
  // posição da ESPN -> linha (0 goleiro ... 5 ataque) e lado (0 esquerda ... 4 direita)
  const PROF = (pos) => {
    const p = String(pos || "").toUpperCase();
    if (p === "G" || p === "GK") return 0;
    if (/^(RB|LB|RWB|LWB|CD|CB|SW|D)(-|$)/.test(p)) return 1;
    if (/^DM/.test(p)) return 2;
    if (/^(CM|RM|LM|M)(-|$)/.test(p)) return 3;
    if (/^AM/.test(p)) return 4;
    return 5;
  };
  const LADO = (pos) => { const p = String(pos || "").toUpperCase(); return /^L/.test(p) ? 0 : /-L$/.test(p) ? 1 : /^R/.test(p) ? 4 : /-R$/.test(p) ? 3 : 2; };
  function linhasDaFormacao(t) {
    const tit = t.jog.filter((j) => j.tit);
    const gol = tit.filter((j) => PROF(j.pos) === 0);
    const linha = tit.filter((j) => PROF(j.pos) !== 0).sort((a, b) => PROF(a.pos) - PROF(b.pos) || LADO(a.pos) - LADO(b.pos) || a.ordem - b.ordem);
    const nums = String(t.form || "").split("-").map(Number).filter((x) => x > 0);
    let linhas = [];
    if (nums.length && nums.reduce((a, b) => a + b, 0) === linha.length) {
      let k = 0;
      for (const q of nums) { linhas.push(linha.slice(k, k + q)); k += q; }
    } else {
      const porProf = {};
      for (const j of linha) (porProf[PROF(j.pos)] = porProf[PROF(j.pos)] || []).push(j);
      linhas = Object.keys(porProf).sort().map((k) => porProf[k]);
    }
    linhas = linhas.map((l) => l.slice().sort((a, b) => LADO(a.pos) - LADO(b.pos) || a.ordem - b.ordem));
    return gol.length || linhas.length ? [gol.slice(0, 1), ...linhas] : null;
  }
  const temporadaDe = (p, l, j) => { const e = p.vv && p.vv.elenco && p.vv.elenco[l]; return (e && j.id && e.jog[j.id]) || null; };
  function destaquesElenco(p, l) {
    const e = p.vv && p.vv.elenco && p.vv.elenco[l];
    if (!e) return { art: null, gar: null };
    const lista = Object.entries(e.jog);
    // empate: desempata pelo outro número (gols/assistências) e depois por menos jogos
    const melhor = (k, k2) => { let m = null; for (const [id, s] of lista) if (s[k] > 0 && (!m || s[k] > m[1][k] || (s[k] === m[1][k] && (s[k2] > m[1][k2] || (s[k2] === m[1][k2] && s.jg < m[1].jg))))) m = [id, s]; return m ? m[0] : null; };
    return { art: melhor("g", "a"), gar: melhor("a", "g") };
  }
  function campinho(p, e) {
    const lados = {};
    for (const l of ["h", "a"]) lados[l] = e[l] ? linhasDaFormacao(e[l]) : null;
    if (!lados.h && !lados.a) return "";
    const jogador = (l, j, top) => {
      const s = temporadaDe(p, l, j);
      const nome = j.nc || j.n.split(" ").slice(-1)[0];
      const noJogo = `${j.g ? `<i class="cj-g" title="Gols neste jogo">${"⚽".repeat(Math.min(j.g, 3))}</i>` : ""}${j.vm ? '<i class="ic vermelho"></i>' : j.am ? '<i class="ic amarelo"></i>' : ""}${j.sai ? '<i class="cj-sai" title="Substituído">▼</i>' : ""}`;
      const sel = top.art === String(j.id) ? " art" : top.gar === String(j.id) ? " gar" : "";
      const ambos = top.art === String(j.id) && top.gar === String(j.id);
      const nums = s ? `<span class="cj-num${sel}${ambos ? " ambos" : ""}">${s.g ? `<b>${s.g}</b>G` : ""}${s.a ? ` <b>${s.a}</b>A` : ""}${!s.g && !s.a ? `${s.jg}J` : ""}</span>` : "";
      return `<div class="cj ${l === "h" ? "c" : "f"}" title="${h(j.n)}${s ? ` · temporada: ${s.jg} jogos, ${s.g} gols, ${s.a} assist.` : ""}">
        <span class="cj-bola">${h(j.num)}${noJogo ? `<span class="cj-ic">${noJogo}</span>` : ""}</span><span class="cj-nome">${h(nome)}</span>${nums}</div>`;
    };
    const metade = (l) => {
      const ls = lados[l];
      if (!ls) return `<div class="campo-metade ${l}"><p class="sub">Sem escalação.</p></div>`;
      const top = destaquesElenco(p, l);
      // mandante ataca para cima (goleiro embaixo); visitante ataca para baixo e fica espelhado
      const ordem = l === "h" ? ls.slice().reverse() : ls;
      return `<div class="campo-metade ${l}">${ordem.map((linha) => `<div class="campo-linha">${(l === "a" ? linha.slice().reverse() : linha).map((j) => jogador(l, j, top)).join("")}</div>`).join("")}</div>`;
    };
    const cab = (l, tid) => `<div class="campo-cab ${l === "h" ? "c" : "f"}">${escudo(tid)}<b>${h(nomeTime(tid))}</b><span class="sub">${h((e[l] && e[l].form) || "")}</span></div>`;
    return `<div class="campo-bloco">${cab("a", p.a)}<div class="campo">${metade("a")}<div class="campo-meio"></div>${metade("h")}</div>${cab("h", p.h)}
      <p class="sub nota">Números de cada jogador na temporada desta competição: <b>G</b> gols · <b>A</b> assistências · <b>J</b> jogos. <span class="cj-num art">dourado</span> = artilheiro do time, <span class="cj-num gar">azul</span> = líder de assistências.</p></div>`;
  }
  // colunas da lista de jogadores (números na temporada); clicar no título ordena pela coluna
  const COLS_ESC = [
    ["jg", "J", "Jogos na temporada"], ["min", "Min", "Minutos jogados na temporada"], ["g", "G", "Gols"], ["a", "A", "Assistências"],
    ["cg", "CG", "Chutes no gol"], ["cart", "Cart.", "Cartões amarelos / vermelhos"],
  ];
  const ORD_ESC = [["pos", "Posição"], ["jg", "Jogos"], ["min", "Minutos"], ["g", "Gols"], ["a", "Assistências"], ["cg", "Chutes no gol"], ["cart", "Cartões"]];
  estado.escOrd = ler("esc_ord", "pos");
  const valorEsc = (s, k) => (!s ? -1 : k === "cart" ? s.am * 1 + s.vm * 3 : k === "min" ? (s.min == null ? -1 : s.min) : s[k] || 0);
  const fMin = (m) => (m == null ? "…" : m >= 1000 ? Math.floor(m / 1000) + "." + String(m % 1000).padStart(3, "0") : String(m));
  function tabelaJogadores(p, l, tid) {
    const e = p.vv.esc && p.vv.esc[l];
    const ele = p.vv.elenco && p.vv.elenco[l];
    const top = destaquesElenco(p, l);
    const ord = estado.escOrd;
    const linha = (j, cls) => {
      const s = temporadaDe(p, l, j);
      const noJogo = `${"⚽".repeat(j.g || 0)}${j.a ? `<span class="esc-a" title="Assistências neste jogo">A${j.a > 1 ? j.a : ""}</span>` : ""}${j.am ? '<i class="ic amarelo" title="Cartão amarelo"></i>' : ""}${j.vm ? '<i class="ic vermelho" title="Cartão vermelho"></i>' : ""}${j.ent ? '<span class="esc-ent" title="Entrou">▲</span>' : ""}${j.sai ? '<span class="esc-sai" title="Saiu">▼</span>' : ""}`;
      const marca = (top.art === String(j.id) ? ' <span class="selo-art" title="Artilheiro do time na temporada">artilheiro</span>' : "") + (top.gar === String(j.id) ? ' <span class="selo-gar" title="Líder de assistências do time na temporada">garçom</span>' : "");
      const res = ord !== "pos" && e && !j.tit ? ' <span class="esc-res" title="Começou no banco">reserva</span>' : "";
      const cel = (k) => {
        const v = !s ? "–" : k === "cart" ? (s.am + s.vm ? `${s.am}/${s.vm}` : "0") : k === "min" ? fMin(s.min) : s[k];
        return `<td class="${k === ord ? "ord" : ""}">${v}</td>`;
      };
      return `<tr class="${cls}"><td>${h(j.num)}</td><td class="esq">${h(j.n)}${marca}${res}<span class="esc-ic">${noJogo}</span></td><td class="esc-pos">${h(j.pos === "SUB" ? "" : j.pos)}</td>${COLS_ESC.map(([k]) => cel(k)).join("")}</tr>`;
    };
    const cabT = (rot) => `<thead><tr><th>#</th><th class="esq">${rot}</th><th></th>${COLS_ESC.map(([k, r, t]) =>
      `<th><button type="button" class="esc-ord" data-escord="${k}" aria-pressed="${ord === k}" title="${t}: ordenar">${r}${ord === k ? "▾" : ""}</button></th>`).join("")}</tr></thead>`;
    const porValor = (lista) => lista.slice().sort((x, y) => valorEsc(temporadaDe(p, l, y), ord) - valorEsc(temporadaDe(p, l, x), ord) || PROF(x.pos) - PROF(y.pos));
    let corpo;
    if (e) {
      if (ord === "pos") {
        const tit = e.jog.filter((j) => j.tit).sort((a, b) => PROF(a.pos) - PROF(b.pos) || LADO(a.pos) - LADO(b.pos));
        const res = e.jog.filter((j) => !j.tit).sort((a, b) => (b.ent ? 1 : 0) - (a.ent ? 1 : 0));
        corpo = `<table class="dados esc-tab">${cabT("Titulares")}<tbody>${tit.map((j) => linha(j, "")).join("")}</tbody></table>
          ${res.length ? `<table class="dados esc-tab">${cabT("Reservas")}<tbody>${res.map((j) => linha(j, j.ent ? "" : "apagado")).join("")}</tbody></table>` : ""}`;
      } else {
        corpo = `<table class="dados esc-tab">${cabT("Relacionados")}<tbody>${porValor(e.jog).map((j) => linha(j, "")).join("")}</tbody></table>`;
      }
    } else if (ele && Object.keys(ele.jog).length) {
      // escalação ainda não saiu: mostra os destaques do elenco (ou o elenco inteiro ordenado pela coluna escolhida)
      let lista = Object.entries(ele.jog).map(([id, s]) => ({ id, n: s.n, num: s.num, pos: s.pos, g: 0, a: 0 }));
      lista = ord === "pos"
        ? lista.sort((a, b) => { const sa = ele.jog[a.id], sb = ele.jog[b.id]; return sb.g + sb.a * 0.6 - (sa.g + sa.a * 0.6) || sb.jg - sa.jg; })
        : porValor(lista);
      corpo = `<table class="dados esc-tab">${cabT("Destaques do elenco")}<tbody>${lista.slice(0, 10).map((j) => linha(j, "")).join("")}</tbody></table>`;
    } else corpo = `<p class="sub">Sem escalação.</p>`;
    return `<div class="esc-lado"><div class="esc-cab ${l === "h" ? "c" : "f"}">${escudo(tid)}<b>${h(nomeTime(tid))}</b><span class="sub">${h((e && e.form) || "")}</span></div>${corpo}</div>`;
  }
  const barraOrdemEsc = () => `<div class="esc-ordem" role="group" aria-label="Ordenar jogadores"><span class="sub">Ordenar por</span>${ORD_ESC.map(([k, r]) =>
    `<button type="button" class="chip" data-escord="${k}" aria-pressed="${estado.escOrd === k}">${r}</button>`).join("")}</div>`;
  document.addEventListener("click", (e) => {
    const t = e.target.closest && e.target.closest("[data-escord]");
    if (!t) return;
    estado.escOrd = t.dataset.escord;
    guardar("esc_ord", estado.escOrd);
    aoVivoAtualizado();
  });
  function abaEscalacoes(p) {
    const e = p.vv && p.vv.esc;
    const ele = p.vv && p.vv.elenco;
    const temporada = ele && (ele.h || ele.a) && (ele.h || ele.a).temporada;
    if (!e || (!e.h && !e.a)) {
      const temElenco = ele && ((ele.h && Object.keys(ele.h.jog).length) || (ele.a && Object.keys(ele.a.jog).length));
      return `<div class="painel-corpo">${avisoFonte()}<div class="vazio vazio-curto"><strong>Escalações ainda não divulgadas</strong>Elas costumam sair cerca de 1 hora antes do jogo.${temElenco ? " Enquanto isso, veja os destaques de cada elenco." : ""}</div>
        ${temElenco ? `${barraOrdemEsc()}<div class="esc-grade">${tabelaJogadores(p, "h", p.h)}${tabelaJogadores(p, "a", p.a)}</div><p class="sub nota">Temporada: ${h(temporada || "")}. Fonte: ESPN.</p>` : ""}</div>`;
    }
    return `<div class="painel-corpo">${avisoFonte()}${campinho(p, e)}
      ${barraOrdemEsc()}<div class="esc-grade">${tabelaJogadores(p, "h", p.h)}${tabelaJogadores(p, "a", p.a)}</div>
      <p class="sub nota">J, Min, G, A, CG e Cart.: números na temporada${temporada ? " (" + h(temporada) + ")" : ""}${ele ? "" : " (carregando…)"}. Ícones ao lado do nome: o que fez neste jogo (⚽ gol · A assistência · ▲ entrou · ▼ saiu). Fonte: ESPN.</p></div>`;
  }
  // ---------- radar: minicampo com onde foi o último lance + faixa dos últimos lances (narração da ESPN)
  const vistoRadar = {}; // jogo -> maior lance já mostrado (pisca só o que chegou agora)
  function textoLance(p, e) {
    if (e.k === "marco") return h(e.txt);
    const t = h(nomeTime(e.l === "h" ? p.h : p.a)), j = h(e.j || ""), quem = j ? `${j} (${t})` : t;
    switch (e.k) {
      case "gol": return `<b>GOL! ${t}</b>${j ? ` · ${j}` : ""}${e.own ? " (contra)" : e.pen ? " (pênalti)" : ""}`;
      case "alvo": return `${e.pen ? "Pênalti defendido" : "Chute no gol, defendido"}: ${quem}`;
      case "fora": return `${e.pen ? "Pênalti perdido" : "Chute para fora"}: ${quem}`;
      case "bloq": return `Chute bloqueado: ${quem}`;
      case "trave": return `<b>Na trave!</b> ${quem}`;
      case "esc": return `Escanteio · ${t}`;
      case "imped": return `Impedimento · ${t}`;
      case "falta": return `${e.onde === "ataque" ? "Falta no ataque" : e.onde === "ponta" ? "Falta pela ponta" : e.onde === "defesa" ? "Falta na defesa" : "Falta"} · ${t}${j ? ` <span class="sub">(sofrida por ${j})</span>` : ""}`;
      case "amarelo": return `Cartão amarelo: ${quem}`;
      case "vermelho": return `<b>Cartão vermelho:</b> ${quem}`;
      case "2amarelo": return `<b>Expulso (2º amarelo):</b> ${quem}`;
      case "sub": return `Substituição · ${t}: entra ${j}${e.j2 ? `, sai ${h(e.j2)}` : ""}`;
      default: return quem;
    }
  }
  const ICONE_LANCE = { gol: "⚽", alvo: "◉", fora: "○", bloq: "◌", trave: "⊓", esc: "⚑", imped: "⚐", falta: "✕", amarelo: '<i class="ic amarelo"></i>', vermelho: '<i class="ic vermelho"></i>', "2amarelo": '<i class="ic vermelho"></i>', sub: "⇄", marco: "⏱" };
  // novos desde a última vez: pisca; na primeira vez que abre o jogo, nada pisca
  function novosDoRadar(p) {
    const ch = p.vv.espn ? p.vv.espn.code + ":" + p.vv.espn.id : String(p.i);
    const lista = p.vv.lances || [];
    const maior = lista.length ? lista[lista.length - 1].seq : 0;
    const antes = vistoRadar[ch];
    setTimeout(() => { vistoRadar[ch] = Math.max(vistoRadar[ch] || 0, maior); }, 0);
    return antes == null ? Infinity : antes;
  }
  function radarLances(p, compacto) {
    const lista = (p.vv && p.vv.lances) || [];
    if (!lista.length) return compacto ? "" : `<div class="radar vazio-p"><p class="sub">${p.vv && p.vv.st === "pre" ? "O radar começa quando a bola rolar." : "Ainda sem lances no radar."}</p></div>`;
    const visto = novosDoRadar(p);
    const ult = lista[lista.length - 1];
    if (compacto) {
      return `<div class="radar-linha ${ult.seq > visto ? "novo" : ""} ${ult.l === "a" ? "f" : "c"}"><span class="m">${h(ult.min)}</span><span class="ic-l">${ICONE_LANCE[ult.k] || ""}</span><span class="t">${textoLance(p, ult)}</span></div>`;
    }
    // posição na tela: mandante ataca para a direita; lances do visitante são espelhados
    const W = 105, H = 68;
    const pos = (e, x, y) => (e.ref === "h" ? [x * W / 100, y * H / 100] : [(100 - x) * W / 100, (100 - y) * H / 100]);
    const comPos = lista.filter((e) => e.x != null && e.y != null).slice(-6);
    const ultPos = comPos[comPos.length - 1];
    let marcas = "";
    comPos.forEach((e, i) => {
      const [x, y] = pos(e, e.x, e.y), ultimo = e === ultPos, op = ultimo ? 1 : 0.25 + (i / comPos.length) * 0.45;
      const cls = e.l === "h" ? "c" : "f";
      if (ultimo && e.x2 != null && e.y2 != null && ["gol", "alvo", "fora", "bloq", "trave"].includes(e.k)) {
        const [x2, y2] = pos(e, e.x2, e.y2);
        marcas += `<line class="r-chute ${cls}" x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
      }
      marcas += ultimo
        ? `<circle class="r-onda ${cls}${e.seq > visto ? " novo" : ""}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2"/><circle class="r-ponto ${cls}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${e.k === "gol" ? 2.4 : 1.8}"/>`
        : `<circle class="r-ponto ${cls}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.1" opacity="${op.toFixed(2)}"/>`;
    });
    // último lance no terço final: sombreia a área de ataque daquele time
    let zona = "";
    if (ultPos && ["gol", "alvo", "fora", "bloq", "trave", "esc", "falta", "imped"].includes(ultPos.k)) {
      const ataque = ultPos.ref === ultPos.l ? ultPos.x : 100 - ultPos.x; // do ponto de vista de quem fez o lance
      if (ataque >= 66) zona = ultPos.l === "h" ? `<rect class="r-zona c" x="${W * 0.66}" y="0" width="${W * 0.34}" height="${H}"/>` : `<rect class="r-zona f" x="0" y="0" width="${W * 0.34}" height="${H}"/>`;
    }
    const campo = `<rect class="r-gramado" x="0" y="0" width="${W}" height="${H}"/>${zona}
      <g class="r-linhas"><rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}"/><line x1="${W / 2}" y1="0.5" x2="${W / 2}" y2="${H - 0.5}"/><circle cx="${W / 2}" cy="${H / 2}" r="9.15"/>
      <rect x="0.5" y="${H / 2 - 20.15}" width="16.5" height="40.3"/><rect x="${W - 17}" y="${H / 2 - 20.15}" width="16.5" height="40.3"/>
      <rect x="0.5" y="${H / 2 - 9.15}" width="5.5" height="18.3"/><rect x="${W - 6}" y="${H / 2 - 9.15}" width="5.5" height="18.3"/></g>`;
    const itens = lista.slice(-7).reverse().map((e, i) => `<li class="${e.seq > visto ? "novo" : ""} ${e.k === "marco" ? "marco" : e.l === "a" ? "f" : "c"}${i === 0 ? " atual" : ""}">
        <span class="m">${h(e.min)}</span><span class="ic-l">${ICONE_LANCE[e.k] || ""}</span><span class="t">${textoLance(p, e)}</span></li>`).join("");
    return `<div class="radar">
      <div class="pressao-cab"><h3>Radar</h3><span class="sub">onde foi o último lance</span></div>
      <div class="radar-grade">
        <div class="radar-campo"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Campo com a posição do último lance">${campo}${marcas}</svg>
          <div class="radar-times"><span class="c">${h(nomeTime(p.h))} ➜</span><span class="f">⬅ ${h(nomeTime(p.a))}</span></div></div>
        <ul class="radar-lista" aria-live="polite">${itens}</ul>
      </div>
      <p class="sub nota">Lances da narração da ESPN e do 365Scores (chegam cerca de 1 a 2 min depois). Não inclui ataques perigosos, laterais e posse lance a lance.</p>
    </div>`;
  }
  const botaoJanela = (code, p, cls = "") => `<button type="button" class="botao-janela ${cls}" data-janela="${h(code)}/${h(p.i)}" title="Abrir este jogo numa janela pequena" aria-label="Abrir este jogo numa janela pequena">
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>${cls === "so-icone" ? "" : "Janela"}</button>`;
  function abrirJanela(rota) {
    const url = location.pathname + "?janela=1#jogo/" + rota;
    const w = window.open(url, "sb_" + rota.replace(/\W/g, "_"), "popup=yes,width=470,height=860");
    if (!w) location.href = url; // bloqueador de pop-up: abre na mesma aba
  }
  // fase de captura: o botão dentro do cartão do painel não pode abrir o jogo por baixo
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-janela]");
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    abrirJanela(b.dataset.janela);
  }, true);

  function abaAoVivo(p, code) {
    return `<div class="painel-corpo">${avisoFonte()}${code && !MODO_JANELA ? `<div class="vivo-acoes">${botaoJanela(code, p)}</div>` : ""}${graficoPressao(p)}${blocoAoVivo(p) || '<p class="sub">Estatísticas e lances aparecem quando o jogo começar.</p>'}</div>`;
  }

  // ---------- janela pequena de um jogo (?janela=1#jogo/...): placar, gráfico, radar e estatísticas
  const MODO_JANELA = /[?&]janela=1/.test(location.search);
  if (MODO_JANELA) document.documentElement.classList.add("modo-janela");
  function telaJanela(code, id) {
    const p = acharPartida(code, id);
    estado.sel = null; estado.abaVista = "aovivo";
    if (!p) { app.innerHTML = `<div class="painel"><div class="vazio"><strong>Jogo não encontrado</strong></div></div>`; return; }
    document.title = `${nomeTime(p.h)} × ${nomeTime(p.a)} · ScanBall`;
    const vivo = aoVivo(p), fim = encerrada(p);
    const situacao = vivo ? (p.s === "PAUSED" ? '<span class="vivo">Intervalo</span>' : p.vv && p.vv.min ? `<span class="vivo-min">${h(p.vv.min)}</span>` : '<span class="vivo">Ao vivo</span>') : fim ? "Encerrado" : `${DIA_CURTO(p.d)} · ${hora(p.d)}`;
    pintarApp("janela/" + code + "/" + p.i, `<section class="janela-jogo">
      <div class="pv-topo">${seloComp(code)}<span class="sub">${h(nomeComp(code))}</span><span class="pv-min">${situacao}</span></div>
      <div class="pv-placar"><span class="pv-time c">${escudo(p.h)}<b>${h(nomeTime(p.h))}</b></span><span class="pv-gols">${vivo || fim ? `${p.fh ?? "–"}<i>x</i>${p.fa ?? "–"}` : "<i>×</i>"}</span><span class="pv-time f"><b>${h(nomeTime(p.a))}</b>${escudo(p.a)}</span></div>
      ${p.hh != null && (vivo || fim) ? `<p class="sub janela-1t">(${p.hh}x${p.ha}) no 1º tempo</p>` : ""}
      ${temAoVivo(p) ? abaAoVivo(p) : `<div class="painel-corpo"><div class="vazio vazio-curto">${p.semEspn ? "Este jogo não foi encontrado na ESPN." : "Os dados ao vivo aparecem quando o jogo estiver perto de começar."}</div></div>`}
      <p class="janela-rodape"><a href="${location.pathname}#jogo/${h(code)}/${h(p.i)}" target="_blank" rel="noopener">Abrir no ScanBall</a></p>
    </section>`);
  }

  // ---------- aba "Ao vivo" do topo: todos os jogos rolando, para quem não consegue assistir
  function telaPainelVivo() {
    estado.sel = null;
    const todos = todasPartidas();
    const vivos = todos.filter((x) => aoVivo(x.p));
    const pesoFav = (x) => (favoritos.has(chaveFav(x.code, x.p)) ? 4 : 0) + (favTimes.has(String(x.p.h)) || favTimes.has(String(x.p.a)) ? 2 : 0) + (favLigas.has(x.code) ? 1 : 0);
    vivos.sort((a, b) => pesoFav(b) - pesoFav(a) || comps.indexOf(a.code) - comps.indexOf(b.code) || (a.p.d < b.p.d ? -1 : 1));
    const agora = Date.now();
    const proximos = todos.filter((x) => !aoVivo(x.p) && !encerrada(x.p) && Date.parse(x.p.d) > agora - 15 * 60e3 && Date.parse(x.p.d) < agora + 18 * 3600e3 && x.p.h && x.p.a).slice(0, 8);
    const encerradosHoje = todos.filter((x) => encerrada(x.p) && x.p.vv && x.p.vv.fonte && agora - Date.parse(x.p.d) < 5 * 3600e3);
    const num = (es, k, i) => (es && es[k] && es[k][i] != null ? es[k][i] : "–");
    const card = (x) => {
      const p = x.p, v = p.vv || {}, es = v.es;
      const ultimos = (v.ev || []).slice().reverse().filter((e) => ["gol", "vermelho", "amarelo"].includes(e.t)).slice(0, 2)
        .map((e) => `<li><span class="m">${h(e.m)}'</span>${e.t === "gol" ? "⚽" : `<i class="ic ${e.t}"></i>`} ${h(e.j)} <span class="sub">(${h(nomeTime(e.l === "h" ? p.h : p.a))})</span></li>`).join("");
      const est = es ? `<div class="pv-est">
          <span><small>Chutes</small>${num(es, "chutes", 0)}<i>×</i>${num(es, "chutes", 1)}</span>
          <span><small>No gol</small>${num(es, "alvo", 0)}<i>×</i>${num(es, "alvo", 1)}</span>
          <span><small>Escanteios</small>${num(es, "esc", 0)}<i>×</i>${num(es, "esc", 1)}</span>
          <span><small>Posse</small>${num(es, "posse", 0)}<i>×</i>${num(es, "posse", 1)}</span></div>` : "";
      const fav = favoritos.has(chaveFav(x.code, p));
      return `<article class="painel painel-vivo-card" role="link" tabindex="0" data-ir="jogo/${x.code}/${p.i}">
        <div class="pv-topo">${seloComp(x.code)}<span class="sub">${h(nomeComp(x.code))}</span>${fav ? `<i class="fav-time">${ESTRELA_SVG(12)}</i>` : ""}<span class="pv-min">${p.s === "PAUSED" ? '<span class="vivo">Intervalo</span>' : v.min ? `<span class="vivo-min">${h(v.min)}</span>` : '<span class="vivo">Ao vivo</span>'}</span>${botaoJanela(x.code, p, "so-icone")}</div>
        <div class="pv-placar"><span class="pv-time c">${escudo(p.h)}<b>${h(nomeTime(p.h))}</b></span><span class="pv-gols">${p.fh ?? "–"}<i>x</i>${p.fa ?? "–"}</span><span class="pv-time f"><b>${h(nomeTime(p.a))}</b>${escudo(p.a)}</span></div>
        ${graficoPressao(p, true) || (temAoVivo(p) ? '<p class="sub pv-carregando">Carregando lances…</p>' : '<p class="sub pv-carregando">Sem dados ao vivo para este jogo.</p>')}
        ${est}${radarLances(p, true)}${ultimos ? `<ul class="pv-ev">${ultimos}</ul>` : ""}
      </article>`;
    };
    const linhaProx = (x) => `<li><button type="button" data-ir="jogo/${x.code}/${x.p.i}"><span class="data">${hora(x.p.d)}</span>${seloComp(x.code)}${h(nomeTime(x.p.h))} × ${h(nomeTime(x.p.a))}</button></li>`;
    const linhaFim = (x) => `<li><button type="button" data-ir="jogo/${x.code}/${x.p.i}"><span class="data">Fim</span>${seloComp(x.code)}${h(nomeTime(x.p.h))} <b>${x.p.fh}×${x.p.fa}</b> ${h(nomeTime(x.p.a))}</button></li>`;
    pintarApp("aovivo", `<section class="painel-vivo">
      ${avisoFonte()}<div class="pv-cab"><h2>Ao vivo agora</h2><span class="sub">${vivos.length ? `${vivos.length} ${vivos.length === 1 ? "jogo" : "jogos"} · atualiza sozinho a cada 20 s` : ""}</span></div>
      ${vivos.length ? `<div class="pv-grade">${vivos.map(card).join("")}</div>` : `<div class="painel"><div class="vazio"><strong>Nenhum jogo rolando agora</strong>Os jogos aparecem aqui assim que a bola rolar, com placar, minuto, gráfico de pressão e estatísticas.</div></div>`}
      ${proximos.length || encerradosHoje.length ? `<div class="pv-listas">
        ${proximos.length ? `<div class="painel"><div class="painel-cab"><h3>Próximos jogos</h3></div><ul class="lista-simples pv-lista">${proximos.map(linhaProx).join("")}</ul></div>` : ""}
        ${encerradosHoje.length ? `<div class="painel"><div class="painel-cab"><h3>Terminaram há pouco</h3></div><ul class="lista-simples pv-lista">${encerradosHoje.map(linhaFim).join("")}</ul></div>` : ""}
      </div>` : ""}
      <p class="sub nota">Placar e minuto: ESPN (a cada 20 s). Gráfico e lances: ataques e narração do 365Scores (quando a liga tem) junto com a narração da ESPN. Toque num jogo para ver tudo.</p>
    </section>`);
  }
  // estatísticas do painel ao vivo por período (Jogo todo / 1º tempo / 2º tempo). Os períodos usam os números
  // da 5Dollar: 1º tempo vem pronto; 2º tempo = jogo todo − 1º tempo
  function estatPeriodo(v) {
    const fonte = fonteDe(v), d = v.d5 && v.d5.fx, st = d && d.st;
    const par = (x) => (x && x.home != null && x.away != null ? [Number(x.home) || 0, Number(x.away) || 0] : null);
    const do5 = (s, gols, esc) => {
      const o = {};
      if (s) { o.da = par(s.dangerous_attacks); o.atk = par(s.attacks); o.alvo = par(s.shots_on_target); o.fora5 = par(s.shots_off_target); o.posse = par(s.possession); }
      if (esc) o.esc = esc;
      for (const k in o) if (!o[k]) delete o[k];
      return o;
    };
    const com5 = fonte !== "365" && st;
    const cartoes = d && d.cards && d.cards.home && d.cards.away ? { amarelos: [Number(d.cards.home.yellow) || 0, Number(d.cards.away.yellow) || 0], vermelhos: [Number(d.cards.home.red) || 0, Number(d.cards.away.red) || 0] } : {};
    const todo = Object.assign({}, v.es || {}, fonte === "365" ? v.es365 || {} : {}, com5 ? Object.assign(do5(st, null, par(d.corners)), cartoes) : {});
    if (v.es365 && v.es365.xg) todo.xg = v.es365.xg;
    const temTempos = com5 && st.first_half;
    const escolha = temTempos ? estado.estPer || "todo" : "todo";
    const chips = temTempos ? `<div class="est-per" role="group" aria-label="Período">${[["todo", "Jogo todo"], ["1", "1º tempo"], ["2", "2º tempo"]].map(([k, rot]) => `<button type="button" class="chip" data-estper="${k}" aria-pressed="${escolha === k}">${rot}</button>`).join("")}</div>` : "";
    if (escolha === "todo") return { es: Object.keys(todo).length ? todo : null, chips, nota: "" };
    const c = d.corners || {}, esc1 = c.half_home != null && c.half_away != null ? [Number(c.half_home) || 0, Number(c.half_away) || 0] : null;
    const um = do5(st.first_half, null, esc1);
    if (escolha === "1") return { es: Object.keys(um).length ? um : null, chips, nota: '<p class="sub nota">1º tempo: números da 5DollarFootballAPI.</p>', vazio: "Sem números do 1º tempo ainda." };
    // 2º tempo: jogo todo menos o 1º tempo (só depois do intervalo)
    if (!(v.per >= 2)) return { es: null, chips, nota: "", vazio: "O 2º tempo ainda não começou." };
    const tudo = do5(st, null, par(d.corners)), dois = {};
    for (const k in tudo) {
      if (k === "posse") continue;
      if (um[k]) dois[k] = [Math.max(0, tudo[k][0] - um[k][0]), Math.max(0, tudo[k][1] - um[k][1])];
    }
    // posse do 2º tempo: aproximada pela posse do jogo todo e a do 1º tempo
    const mins = Math.max(46, parseInt(String(v.clk || v.min || "").replace(/\D.*$/, ""), 10) || 46);
    if (tudo.posse && um.posse) {
      const h2 = (tudo.posse[0] * mins - um.posse[0] * 45) / (mins - 45);
      if (isFinite(h2)) { const x = Math.max(0, Math.min(100, Math.round(h2))); dois.posse = [x, 100 - x]; }
    }
    return { es: Object.keys(dois).length ? dois : null, chips, nota: '<p class="sub nota">2º tempo: jogo todo menos o 1º tempo (5DollarFootballAPI); posse aproximada.</p>', vazio: "Sem números do 2º tempo ainda." };
  }
  function blocoAoVivo(p) {
    const v = p.vv;
    if (!v || (!(v.ev && v.ev.length) && !v.es && !v.es365 && !(v.d5 && v.d5.fx) && !(v.lances && v.lances.length) && !(v.prov && v.prov.length))) return "";
    // estatísticas: ESPN, por cima o 365Scores (xG; e tudo na reserva) e, com a 5Dollar em dia, os números dela
    const per = estatPeriodo(v);
    const esTodas = per.es;
    const icone = (t) => (t === "gol" ? "⚽" : t === "amarelo" ? '<i class="ic amarelo"></i>' : t === "vermelho" ? '<i class="ic vermelho"></i>' : t === "sub" ? "⇄" : t === "var" ? "VAR" : "");
    const txt = (e) => `<span class="${e.t === "gol" ? "gol" : ""}">${e.l === "h" ? "" : icone(e.t) + " "}${h(e.j || "")}${e.x ? ` <small>${h(e.x)}</small>` : ""}${e.l === "h" ? " " + icone(e.t) : ""}</span>`;
    const minNum = (m) => { const [a, b] = String(m).split("+"); return Number(a) + (Number(b) || 0) / 100; };
    const evs = (v.ev || []).slice().sort((a, b) => minNum(b.m) - minNum(a.m)).map((e) => `<li><span class="c">${e.l === "h" ? txt(e) : ""}</span><span class="m">${h(e.m)}'</span><span>${e.l === "a" ? txt(e) : ""}</span></li>`).join("");
    const num = (x) => (x == null ? null : Number(String(x).replace("%", "")));
    const est = esTodas ? EST_VIVO.filter(([k]) => esTodas[k] && (num(esTodas[k][0]) != null || num(esTodas[k][1]) != null)).map(([k, rot, suf = ""]) => {
      const a = num(esTodas[k][0]) || 0, b = num(esTodas[k][1]) || 0, t = a + b || 1;
      const f = (x) => (k === "xg" ? fNum(x, 2) : Math.round(x)) + suf;
      return `<div class="est-linha"><span class="v">${f(a)}</span><span class="rot">${rot}</span><span class="v">${f(b)}</span>
        <span class="est-trilho"><span style="width:${(a / t) * 100}%"></span><span style="width:${(b / t) * 100}%"></span></span></div>`;
    }).join("") : "";
    const em = v.emDet || v.em ? new Date(v.emDet || v.em) : null;
    const atual = em ? `<span class="atual">· atualizado ${pad(em.getHours())}:${pad(em.getMinutes())}:${pad(em.getSeconds())}</span>` : "";
    // lance a lance (narração da ESPN) ao lado das estatísticas; sem narração, ficam os lances principais
    // lances que o contador/eventos já registraram e a narração ainda não trouxe: entram iguais aos outros
    // (a narração da ESPN, quando chega, completa com o nome do jogador)
    const minVal = (m) => { const x = String(m || "").match(/(\d+)'?\s*(?:\+\s*(\d+))?/); return x ? Number(x[1]) + (Number(x[2]) || 0) / 100 : 0; };
    const doContador = (v.prov || []).map((e) => ({ k: e.k, l: e.l, j: e.j || "", j2: e.x ? e.x.replace(/^sai /, "") : "", min: e.min, t: e.t, cont: true }));
    const todos = (v.lances || []).map((e, i) => ({ e, ord: minVal(e.min), seq: i + 1 })).concat(doContador.map((e) => ({ e, ord: minVal(e.min), seq: 1e9 + (e.t || 0) / 1e4 })));
    todos.sort((a, b) => b.ord - a.ord || b.seq - a.seq);
    const narr = todos.length ? (() => {
      const visto = novosDoRadar(p);
      return `<ul class="radar-lista narracao" aria-live="polite">${todos.map(({ e }, i) => `<li class="${!e.cont && e.seq > visto ? "novo" : ""} ${e.k === "marco" ? "marco" : e.l === "a" ? "f" : "c"}${i === 0 ? " atual" : ""}">
        <span class="m">${h(e.min)}</span><span class="ic-l">${ICONE_LANCE[e.k] || ""}</span><span class="t">${textoLance(p, e)}</span></li>`).join("")}</ul>`;
    })() : "";
    return `<div class="vivo-painel">
      <div><h3>${narr ? "Lance a lance" : "Lances"} ${atual}</h3>${narr || (evs ? `<ul class="ev-lista">${evs}</ul>` : '<p class="sub">Nenhum lance registrado ainda.</p>')}</div>
      <div><h3>Estatísticas</h3>${per.chips}${est ? `<div class="est-lista">${est}</div>${per.nota}` : `<p class="sub">${per.vazio || "Estatísticas ainda não disponíveis."}</p>`}</div>
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
    if (rec) { const t = recolhidas.size ? "Expandir jogos" : "Recolher jogos"; rec.title = t; rec.setAttribute("aria-label", t); morfar(rec, iconeRecolher()); }
    const filtrando = lista.length !== totalDia;
    const tbc = document.getElementById("tb-contagem");
    if (tbc) morfar(tbc, totalDia ? `${filtrando ? `${lista.length} de ${totalDia} jogos` : `${totalDia} jogo${totalDia > 1 ? "s" : ""}`}${nFiltros(estado.filtro) ? ` · <button class="link" type="button" id="l-limpar2">limpar filtros</button>` : ""}` : "");
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
      morfar(corpo, `${contagem}<div class="vazio"><strong>${totalDia ? "Nenhum jogo com esses filtros" : "Nenhum jogo neste dia"}</strong>${dica}</div>`);
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
      morfar(corpo, `${contagem}<div class="tabela-jogos ${TEM_ODDS ? "com-odds" : ""}">${CAB_COLUNAS}${html}</div>${NOTA_ODD}`);
    }
    const l2 = document.getElementById("l-limpar2");
    if (l2) l2.onclick = () => { estado.filtro = copiaFiltro(FILTRO_VAZIO); salvarFiltro(); telaJogos(); };
    const dest = document.getElementById("destaques");
    if (dest) {
      if (estado.sel) atualizarPainelJogo();
      else morfar(dest, destaquesDoDia(todasPartidas().filter((x) => x.dia === estado.dia)));
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
      <span class="quando">${vivo && p.vv && p.vv.min ? `<span>${hora(p.d)}</span><b class="vivo-min">${h(p.vv.min)}</b>${(() => { const al = alertaPressao(p); return al ? `<i class="alerta-lista n${al.nivel} ${al.l === "h" ? "c" : "f"}" title="${h(nomeTime(al.tid))} pressionando forte">${al.nivel === 2 ? "🔥" : "⚡"}</i>` : ""; })()}` : `<span>${DIA_CURTO(p.d)}</span><b>${hora(p.d)}</b>`}</span>
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
  // beta 5: abas com tipos de gol, períodos e extras (só quando a fonte tem minuto dos gols e estatísticas)
  const ABAS_JOGO = B5 ? [
    ["inteiro", "Jogo inteiro"], ["tempos", "1º/2º tempo"], ["gtipos", "Tipos de gols"], ["periodos", "Períodos"], ["overs", "Overs"],
    ["extras", "Extras"], ["proj", "Projeções"], ["tabela", "Classificação e artilharia"], ["rank", "Power Ranking"],
  ] : [
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
    // primeiro gol (exato com o minuto dos gols)
    mpx: ["Marcou primeiro", (b) => b.mp, (b) => b.j - b.pdes, 1], spx: ["Sofreu primeiro", (b) => b.sp, (b) => b.j - b.pdes, -1],
    mpV: ["Marcou 1º e venceu", (b) => b.mpV, (b) => b.mpV + b.mpE + b.mpD, 1],
    mpNP: ["Marcou 1º e não perdeu", (b) => b.mpV + b.mpE, (b) => b.mpV + b.mpE + b.mpD, 1],
    spNP: ["Sofreu 1º e não perdeu", (b) => b.spV + b.spE, (b) => b.spV + b.spE + b.spD, 1],
    spV: ["Sofreu 1º e virou", (b) => b.spV, (b) => b.spV + b.spE + b.spD, 1],
    pgMin: ["Minuto médio do 1º gol do jogo", (b) => b.pgMin, (b) => b.pgN, 0, "med"],
    // extras (estatísticas de cada jogo)
    jex: ["Jogos com estatísticas", (b) => b.je, null, 0, "num"],
    escF: ["Escanteios a favor", (b) => b.escF, (b) => b.je, 1, "med"], escC: ["Escanteios contra", (b) => b.escC, (b) => b.je, -1, "med"],
    escT: ["Escanteios no jogo", (b) => b.escF + b.escC, (b) => b.je, 0, "med"],
    esc85: ["Mais de 8,5 escanteios", (b) => b.esc85, (b) => b.je, 0], esc95: ["Mais de 9,5 escanteios", (b) => b.esc95, (b) => b.je, 0],
    esc105: ["Mais de 10,5 escanteios", (b) => b.esc105, (b) => b.je, 0], escMais: ["Teve mais escanteios", (b) => b.escMais, (b) => b.je, 1],
    amF: ["Cartões amarelos", (b) => b.amF, (b) => b.je, -1, "med"], amC: ["Amarelos do adversário", (b) => b.amC, (b) => b.je, 0, "med"],
    cartT: ["Cartões no jogo", (b) => b.amF + b.amC + b.vmF + b.vmC, (b) => b.je, 0, "med"],
    cart35: ["Mais de 3,5 cartões", (b) => b.cart35, (b) => b.je, 0], cart45: ["Mais de 4,5 cartões", (b) => b.cart45, (b) => b.je, 0],
    vmF: ["Cartões vermelhos", (b) => b.vmF, null, -1, "num"],
    chF: ["Chutes", (b) => b.chF, (b) => b.je, 1, "med"], chC: ["Chutes sofridos", (b) => b.chC, (b) => b.je, -1, "med"],
    cgF: ["Chutes no gol", (b) => b.cgF, (b) => b.je, 1, "med"], cgC: ["Chutes no gol sofridos", (b) => b.cgC, (b) => b.je, -1, "med"],
    poF: ["Posse de bola (%)", (b) => b.poF, (b) => b.je, 0, "med"], faF: ["Faltas cometidas", (b) => b.faF, (b) => b.je, 0, "med"],
  };
  // tipos de gol e períodos: % sobre os gols marcados (ou sofridos) nos jogos com a lista de gols
  const TIPOS_GOL = [["c", "De cabeça"], ["e", "Após escanteio"], ["b", "Outras bolas paradas"], ["f", "De falta direta"], ["p", "De pênalti"],
    ["k", "De contra-ataque"], ["x", "De fora da área"], ["r", "Após cruzamento"], ["o", "Gol contra (a favor)"]];
  const PERIODOS = ["0–15'", "16–30'", "31–45+'", "46–60'", "61–75'", "76–90+'"];
  for (const [k, rot] of TIPOS_GOL) {
    L["tm" + k] = [rot, (b) => b.tm[k], (b) => b.tm.n, 0, "pgol"];
    L["ts" + k] = [k === "o" ? "Gol contra (do próprio time)" : rot, (b) => b.ts[k], (b) => b.ts.n, 0, "pgol"];
  }
  PERIODOS.forEach((rot, i) => {
    L["pm" + i] = [rot, (b) => b.pm[i], (b) => b.pm.reduce((s, x) => s + x, 0), 0, "pgol"];
    L["ps" + i] = [rot, (b) => b.ps[i], (b) => b.ps.reduce((s, x) => s + x, 0), 0, "pgol"];
  });
  L.tmn = ["Gols marcados (com tipo)", (b) => b.tm.n, null, 0, "num"];
  L.tsn = ["Gols sofridos (com tipo)", (b) => b.ts.n, null, 0, "num"];
  const TABELAS_JOGO = {
    inteiro: B5 ? ["jogos", "vit", "emp", "der", "marcou", "sofreu", "btts", "cs", "sm", "|", "gm", "gs", "gt", "pts",
      "#Primeiro gol", "mpx", "spx", "mpV", "mpNP", "spNP", "spV", "pgMin"]
      : ["jogos", "vit", "emp", "der", "marcou", "sofreu", "btts", "cs", "sm", "|", "gm", "gs", "gt", "pts"],
    gtipos: ["#Gols marcados", "tmn", ...TIPOS_GOL.map(([k]) => "tm" + k), "#Gols sofridos", "tsn", ...TIPOS_GOL.map(([k]) => "ts" + k)],
    periodos: ["#Gols marcados por período", ...PERIODOS.map((_, i) => "pm" + i), "#Gols sofridos por período", ...PERIODOS.map((_, i) => "ps" + i)],
    extras: ["jex", "#Escanteios", "escF", "escC", "escT", "esc85", "esc95", "esc105", "escMais", "#Cartões", "amF", "amC", "cartT", "cart35", "cart45", "vmF",
      "#Finalizações e posse", "chF", "chC", "cgF", "cgC", "poF", "faF"],
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
        if (tipo === "med") return [k === "poF" || k === "pgMin" ? "–" : n, d ? fNum(n / d, k === "poF" || k === "pgMin" ? 1 : 2) : "–", ""];
        if (tipo === "pgol") return [n, d ? fPct((100 * n) / d) : "–", ""];
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
    const pg = M.primeiroDoJogo ? M.primeiroDoJogo(p, casa) : casa ? M.primeiroGol(p.fh, p.fa, p.hh, p.ha) : M.primeiroGol(p.fa, p.fh, p.ha, p.hh);
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

  // ---------- painéis laterais com gráfico (no estilo do painel de Overs)
  const tituloLado = (lado, tid, txt) => `${txt} ${lado === "casa" ? "do mandante (casa)" : lado === "fora" ? "do visitante (fora)" : "de " + nomeTime(tid)}`;
  // barras duplas: marcados (cor do time) e sofridos (cinza)
  function barrasDuplas(rotulos, marc, sofr, cls) {
    const max = Math.max(1, ...marc, ...sofr);
    return `<div class="dist dist-dupla">${rotulos.map((rot, i) => `<div class="dist-linha">
        <span class="dist-rot">${rot}</span>
        <div class="dist-par"><div class="dist-trilho ${cls}"><span style="width:${(marc[i] / max) * 100}%"></span></div><div class="dist-trilho sofr"><span style="width:${(sofr[i] / max) * 100}%"></span></div></div>
        <span class="dist-val"><b>${marc[i]}</b> <span class="sub">${sofr[i]}</span></span></div>`).join("")}</div>`;
  }
  const legendaDupla = (cls, extra) => `<p class="legenda-bolas legenda-dupla"><span><i class="marcador ${cls}"></i>marcados</span><span><i class="marcador sofr"></i>sofridos</span>${extra ? `<span>${extra}</span>` : ""}</p>`;
  function painelPeriodos(tid, jogos, lado, cls) {
    const b = M.bucketDeJogos(jogos, tid);
    const corpo = b.jg ? (() => {
      const iM = b.pm.indexOf(Math.max(...b.pm)), iS = b.ps.indexOf(Math.max(...b.ps));
      return barrasDuplas(PERIODOS, b.pm, b.ps, cls) + legendaDupla(cls, `mais marca: <b>${PERIODOS[iM]}</b> · mais sofre: <b>${PERIODOS[iS]}</b>`);
    })() : `<p class="sub">Ainda sem o minuto dos gols destes jogos.</p>`;
    return `<div class="lateral"><div class="lateral-cab"><h3>${h(tituloLado(lado, tid, "Gols por período"))}</h3>${controleUltimos()}</div>${corpo}</div>`;
  }
  function painelTipos(tid, jogos, lado, cls) {
    const b = M.bucketDeJogos(jogos, tid);
    const tipos = TIPOS_GOL.filter(([k]) => k !== "o");
    const CURTO = { c: "Cabeça", e: "Escanteio", b: "Bola parada", f: "Falta direta", p: "Pênalti", k: "Contra-ataque", x: "Fora da área", r: "Cruzamento" };
    const corpo = b.jg ? barrasDuplas(tipos.map(([k]) => CURTO[k]), tipos.map(([k]) => b.tm[k]), tipos.map(([k]) => b.ts[k]), cls)
      + legendaDupla(cls, `${b.tm.n} gols marcados e ${b.ts.n} sofridos nesses jogos`) : `<p class="sub">Ainda sem o detalhe dos gols destes jogos.</p>`;
    return `<div class="lateral lateral-tipos"><div class="lateral-cab"><h3>${h(tituloLado(lado, tid, "Tipos de gol"))}</h3>${controleUltimos()}</div>${corpo}</div>`;
  }
  // Extras: gráfico jogo a jogo (a favor para cima, contra para baixo) com a estatística escolhida
  const EX_LAT = [["esc", "Escanteios", 0], ["cart", "Cartões", 1], ["ch", "Chutes", 3], ["cg", "No gol", 4]];
  estado.exLat = ler("ex_lat", "esc");
  function painelExtras(code, tid, jogos, lado, cls) {
    const [chave, rot, k] = EX_LAT.find((x) => x[0] === estado.exLat) || EX_LAT[0];
    const fim = jogos.filter(encerrada);
    const val = (p, casa) => {
      const e = p.es;
      if (!e || e[0] == null || e[1] == null) return null;
      const i = casa ? 0 : 1, o = 1 - i;
      if (chave === "cart") return [(e[2 + i] || 0) + (e[4 + i] || 0), (e[2 + o] || 0) + (e[4 + o] || 0)];
      return [e[k * 2 + i] || 0, e[k * 2 + o] || 0];
    };
    const itens = fim.map((p) => { const casa = String(p.h) === String(tid); return { p, casa, v: val(p, casa) }; });
    const com = itens.filter((x) => x.v);
    const max = Math.max(1, ...com.map((x) => Math.max(x.v[0], x.v[1])));
    const colunas = itens.map(({ p, casa, v }) => {
      const adv = nomeTime(casa ? p.a : p.h), gm = casa ? p.fh : p.fa, gs = casa ? p.fa : p.fh;
      const dica = `${dataCurta(p.d)} ${casa ? "x" : "@"} ${adv} (${gm}-${gs})${v ? ` · ${rot.toLowerCase()}: ${v[0]} a favor, ${v[1]} contra` : " · sem estatísticas"}`;
      return `<button type="button" class="ex-col${v ? "" : " vazio"}" data-ir="jogo/${code}/${p.i}" title="${h(dica)}" aria-label="${h(dica)}">
        <span class="ex-cima"><span class="ex-barra ${cls}" style="height:${v ? (v[0] / max) * 82 : 0}%"></span>${v ? `<i>${v[0]}</i>` : ""}</span>
        <span class="ex-baixo"><span class="ex-barra sofr" style="height:${v ? (v[1] / max) * 82 : 0}%"></span>${v ? `<i>${v[1]}</i>` : ""}</span></button>`;
    }).join("");
    const med = (i) => (com.length ? fNum(com.reduce((s2, x) => s2 + x.v[i], 0) / com.length, 1) : "–");
    const medT = com.length ? fNum(com.reduce((s2, x) => s2 + x.v[0] + x.v[1], 0) / com.length, 1) : "–";
    const chips = `<div class="ex-chips" role="group" aria-label="Estatística do gráfico">${EX_LAT.map(([c, r]) => `<button type="button" class="chip" data-exlat="${c}" aria-pressed="${c === chave}">${r}</button>`).join("")}</div>`;
    return `<div class="lateral"><div class="lateral-cab"><h3>${h(tituloLado(lado, tid, rot))}</h3>${controleUltimos()}</div>
      ${chips}
      ${fim.length ? `<div class="ex-grafico" style="--n:${Math.max(itens.length, 5)}">${colunas}</div>
        <div class="ex-medias"><span><small>A favor</small><b class="${cls}">${med(0)}</b></span><span><small>Contra</small><b>${med(1)}</b></span><span><small>No jogo</small><b>${medT}</b></span></div>
        ${legendaDupla(cls, `média por jogo · ${com.length} de ${fim.length} jogos com estatísticas · toque numa barra para abrir o jogo`).replace("marcados", "a favor").replace("sofridos", "contra")}`
        : `<p class="sub">Sem jogos encerrados antes desta partida.</p>`}
    </div>`;
  }
  document.addEventListener("click", (e) => {
    const t = e.target.closest && e.target.closest("[data-exlat]");
    if (!t) return;
    estado.exLat = t.dataset.exlat;
    guardar("ex_lat", estado.exLat);
    aoVivoAtualizado();
  });

  // aba Extras: escanteios e cartões de cada jogo (a favor x contra), para ver a tendência jogo a jogo
  function extrasPorJogo(code, tid, jogos, lado) {
    const base = lado === "casa" ? "do mandante (casa)" : lado === "fora" ? "do visitante (fora)" : "de " + nomeTime(tid);
    const fim = jogos.filter(encerrada).slice().reverse();
    const linhas = fim.map((p) => {
      const casa = String(p.h) === String(tid), adv = casa ? p.a : p.h, e = p.es;
      const i = casa ? 0 : 1, o = 1 - i;
      const tem = e && e[0] != null && e[1] != null;
      const par = (k) => (tem ? `<b>${e[k * 2 + i] ?? 0}</b><span>${e[k * 2 + o] ?? 0}</span>` : "<b>–</b><span>–</span>");
      const cart = tem ? `<b>${(e[2 + i] || 0) + (e[4 + i] || 0)}${e[4 + i] ? '<i class="ic vermelho" title="Teve vermelho"></i>' : ""}</b><span>${(e[2 + o] || 0) + (e[4 + o] || 0)}</span>` : "<b>–</b><span>–</span>";
      const gm = casa ? p.fh : p.fa, gs = casa ? p.fa : p.fh, r = gm > gs ? "V" : gm === gs ? "E" : "D";
      return `<li class="clicavel" data-ir="jogo/${code}/${p.i}" role="link" tabindex="0">
        <span class="data">${dataCurta(p.d)}</span>
        <span class="conf"><span class="sub">${casa ? "x" : "@"}</span> ${h(nomeTime(adv))} <b>${gm}-${gs}</b></span>
        <span class="ex-par" title="Escanteios: a favor · contra">${par(0)}</span>
        <span class="ex-par" title="Cartões: a favor · contra">${cart}</span>
        <span class="r ${r}">${r}</span></li>`;
    }).join("");
    const com = fim.filter((p) => p.es && p.es[0] != null);
    const soma = (f) => com.reduce((s2, p) => s2 + f(p), 0);
    const mEsc = com.length ? fNum(soma((p) => (p.es[0] || 0) + (p.es[1] || 0)) / com.length, 1) : "–";
    const mCart = com.length ? fNum(soma((p) => (p.es[2] || 0) + (p.es[3] || 0) + (p.es[4] || 0) + (p.es[5] || 0)) / com.length, 1) : "–";
    return `<div class="lateral">
      <div class="lateral-cab"><h3>Escanteios e cartões ${h(base)}</h3>${controleUltimos()}</div>
      ${linhas ? `<div class="ex-cab" aria-hidden="true"><span></span><span></span><span>Escanteios</span><span>Cartões</span><span></span></div>
        <ul class="lista-lateral ex-lista">${linhas}</ul>
        <p class="legenda-bolas"><span>Número da esquerda: a favor · da direita: contra. Média por jogo: ${mEsc} escanteios e ${mCart} cartões.</span></p>`
        : `<p class="sub">Sem jogos encerrados antes desta partida.</p>`}
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
      // jogo aberto ao lado da lista: atualiza as duas partes (antes só o painel, e a lista ficava com placar velho)
      if (mesmaTela) renderListaJogos(); else telaJogos(); // a lista já atualiza o painel do jogo
      return;
    }
    estado.sel = null;
    estado.dia = dia;
    const r = htmlJogo(code, p);
    const voltar = `<button class="botao-q texto voltar-v2" type="button" data-voltar>‹ Jogos de ${dataCurta(p.d)}</button>`;
    pintarApp("jogo/" + code + "/" + p.i, `${voltar}<section class="painel jogo-pagina">${r}</section>`);
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
      morfar(aside, `<button class="fechar-jogo" type="button" data-voltar title="Fechar o jogo e voltar aos destaques" aria-label="Fechar o jogo">✕</button>${htmlJogo(estado.sel.code, sel)}`);
    } else {
      aside.className = "destaques";
      aside.setAttribute("aria-label", "Destaques do dia");
      morfar(aside, destaquesDoDia(todasPartidas().filter((x) => x.dia === estado.dia)));
    }
  }

  // fase do jogo como a ESPN escreve ("Quarterfinals - Leg 1") em português
  function traduzFase(t) {
    if (!t) return "";
    const D = [[/League Phase/i, "Fase de liga"], [/Group Stage|Group/i, "Fase de grupos"], [/Knockout Round Playoffs?|Play-?offs?/i, "Playoffs"],
      [/Round of 32/i, "16 avos de final"], [/Round of 16/i, "Oitavas de final"], [/Quarter-?finals?/i, "Quartas de final"], [/Semi-?finals?/i, "Semifinal"],
      [/Third Place/i, "Disputa de 3º"], [/Matchday\s*(\d+)/i, "Rodada $1"], [/1st Leg|Leg 1/i, "ida"], [/2nd Leg|Leg 2/i, "volta"]];
    let r = t;
    for (const [re, pt] of D) r = r.replace(re, pt);
    return r.replace(/\s*-\s*/g, " · ");
  }
  // xG da temporada (FotMob): por jogo, feito e sofrido, e pontos esperados
  function blocoXg(code, p) {
    const xg = (DADOS.competicoes[code] || {}).xg;
    if (!xg) return "";
    const lin = (tid) => xg[tid] || xg[String(tid)];
    const a = lin(p.h), b = lin(p.a);
    if (!a && !b) return "";
    const por = (x, i) => (x && x[2] ? fNum(x[i] / x[2], 2) : "–");
    const linha = (rot, i, dir) => `<tr><td class="n"></td><td class="p">${por(a, i)}</td><td class="rot">${rot}</td><td class="p">${por(b, i)}</td><td class="n"></td></tr>`;
    return `<table class="stats-central xg-tab"><tbody><tr class="secao"><td colspan="5">xG na temporada (FotMob)</td></tr>
      ${linha("xG feito por jogo", 0)}${linha("xG sofrido por jogo", 1)}
      <tr><td class="n"></td><td class="p">${a ? fNum(a[0] - a[1], 1) : "–"}</td><td class="rot">Saldo de xG na temporada</td><td class="p">${b ? fNum(b[0] - b[1], 1) : "–"}</td><td class="n"></td></tr>
      <tr><td class="n"></td><td class="p">${a ? fNum(a[3], 1) : "–"}</td><td class="rot">Pontos esperados</td><td class="p">${b ? fNum(b[3], 1) : "–"}</td><td class="n"></td></tr>
      </tbody></table><p class="sub nota">xG: gols esperados pela qualidade das chances. Temporada inteira na competição, sem separar casa e fora.</p>`;
  }

  // ataques e ataques perigosos na temporada (5DollarFootballAPI, montado pelo robô do GitHub em extra5d.js)
  function blocoAtaques5d(code, p) {
    const X = window.EXTRA5D, comp = X && X.comps && X.comps[code];
    if (!comp) return "";
    const C = X.campos, ix = (k) => C.indexOf(k);
    // mandante: jogos em casa; visitante: jogos fora (se tiver menos de 3, usa todos)
    const parte = (tid, lado) => { const t = comp[tid] || comp[String(tid)]; if (!t) return null; const v = t[lado][0] >= 3 ? t[lado] : t.g; return v[0] ? v : null; };
    const a = parte(p.h, "c"), b = parte(p.a, "f");
    if (!a && !b) return "";
    const med = (v, k, dec) => (v && v[ix(k)] ? fNum(v[ix(k)] / v[0], dec == null ? 1 : dec) : "–");
    const linha = (rot, k, dec) => `<tr><td class="n"></td><td class="p">${med(a, k, dec)}</td><td class="rot">${rot}</td><td class="p">${med(b, k, dec)}</td><td class="n"></td></tr>`;
    const pos = (v) => (v && v[ix("pos")] ? Math.round(v[ix("pos")] / v[0]) + "%" : "–");
    return `<table class="stats-central xg-tab"><tbody><tr class="secao"><td colspan="5">Ataques na temporada (por jogo)</td></tr>
      ${linha("Ataques perigosos feitos", "da")}${linha("Ataques perigosos sofridos", "dac")}
      ${linha("Ataques feitos", "at", 0)}${linha("Ataques sofridos", "atc", 0)}
      ${linha("Ataques perigosos no 1º tempo", "da1")}${linha("Sofridos no 1º tempo", "da1c")}
      ${linha("Chutes no gol", "ch")}${linha("Chutes para fora", "cf")}
      <tr><td class="n"></td><td class="p">${pos(a)}</td><td class="rot">Posse média</td><td class="p">${pos(b)}</td><td class="n"></td></tr>
      </tbody></table><p class="sub nota">Fonte: 5DollarFootballAPI. ${h(nomeTime(p.h))} nos jogos em casa (${a ? a[0] : 0}) e ${h(nomeTime(p.a))} nos jogos fora (${b ? b[0] : 0}).</p>`;
  }

  function htmlJogo(code, p) {
    const comp = DADOS.competicoes[code];
    const fim = encerrada(p), vivo = aoVivo(p), temTimes = p.h && p.a;
    const rodada = p.r ? `Rodada ${p.r}` : FASES[p.f] || traduzFase(p.fn) || "";
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
    const semPar = p.semEspn && !temAoVivo(p) ? `<div class="aviso-fonte">Este jogo não foi encontrado na ESPN, então ele fica sem placar ao vivo, lances e escalações. O placar vem da football-data, que atrasa alguns minutos.</div>` : "";

    const listaAbas = temAoVivo(p) ? [...ABAS_JOGO, ["escalacoes", "Escalações"], ["aovivo", vivo ? '<span class="vivo-min">Ao vivo</span>' : "Ao vivo"]] : ABAS_JOGO;
    const chaveJogo = code + ":" + p.i;
    if (estado.abaDoJogo !== chaveJogo) { estado.abaDoJogo = chaveJogo; estado.abaManual = false; }
    let aba = listaAbas.some((a) => a[0] === estado.abaJogo) ? estado.abaJogo : "inteiro";
    if (!estado.abaManual && vivo && temAoVivo(p)) aba = "aovivo";
    estado.abaVista = aba;
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
      const titulos = { inteiro: "Jogo inteiro", tempos: `${tempo}º tempo`, overs: "Overs", gtipos: "Tipos de gols", periodos: "Períodos dos gols", extras: "Extras" };
      const semDetalhe = (aba === "gtipos" || aba === "periodos") ? !(bH.jg + bA.jg) : aba === "extras" ? !(bH.je + bA.je) : false;
      const lateral = (tid, jogos, ladoX, cls) => (aba === "overs" ? distribuicaoGols(jogos, tid, ladoX, cls)
        : aba === "extras" ? painelExtras(code, tid, jogos, ladoX, cls)
        : aba === "periodos" ? painelPeriodos(tid, jogos, ladoX, cls)
        : aba === "gtipos" ? painelTipos(tid, jogos, ladoX, cls)
        : listaLateral(code, tid, jogos, ladoX, tempo));
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
          ${semDetalhe ? `<div class="vazio vazio-curto">Ainda sem ${aba === "extras" ? "estatísticas" : "detalhe dos gols"} destes jogos. ${B5 ? "Elas vão sendo baixadas aos poucos nas atualizações." : "Disponível com a fonte principal de dados."}</div>` : tabelaCentral(tempo ? "tempo" : aba, bH, bA)}
          ${aba === "extras" ? blocoXg(code, p) + blocoAtaques5d(code, p) : ""}
          ${botoesTempo}
          <p class="sub nota">${aba === "gtipos" ? "Porcentagem sobre os gols com a narração do lance; um gol pode ter mais de um tipo (ex.: de cabeça após escanteio). " : aba === "periodos" ? "Porcentagem sobre os gols de cada time; acréscimos contam no fim de cada tempo. " : ""}${tempo ? `Cada jogo conta só pelo placar do ${tempo}º tempo. ` : ""}${fim ? "Números de antes desta partida. " : ""}${estado.ultimos ? "Considerando os últimos 5 jogos" : "Considerando todos os jogos"} ${lado ? "no total" : "do mandante em casa e do visitante fora"}.</p>
        </div>
        ${lateral(p.a, ja, ladoA, "f")}
      </div>`;
    } else if (aba === "aovivo") {
      conteudo = abaAoVivo(p, code);
    } else if (aba === "escalacoes") {
      conteudo = abaEscalacoes(p);
    } else if (aba === "proj") {
      conteudo = abaProjecoes(code, p, pj);
    } else if (aba === "tabela") {
      conteudo = abaClassificacao(code, p);
    } else {
      conteudo = abaRanking(code, p);
    }
    return `${cab}${semPar}${abas}<div class="aba-conteudo">${conteudo}</div>`;
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
      case "jogo": if (MODO_JANELA) telaJanela(partes[1], partes[2]); else telaJogo(partes[1], partes[2]); break;
      case "jogos": case "": estado.sel = null; telaJogos(); break;
      case "aovivo": telaPainelVivo(); break;
      case "classificacao": telaClassificacao(partes[1]); break;
      case "times": telaTimes(partes[1]); break;
      case "time": telaTime(partes[1], partes[2]); break;
      case "ranking": telaRanking(partes[1]); break;
      case "artilharia": telaArtilharia(partes[1]); break;
      case "filtros": estado.painelFiltro = true; telaJogos(); break; // backtest desligado por enquanto
      default: telaJogos();
    }
    contadorVivo();
    const chave = aba + "/" + (partes[1] || "") + "/" + (partes[2] || "");
    const noPainel = aba === "jogo" && estado.sel;
    if (ultimaAba !== chave && !noPainel && !(aba === "jogos" && /^jogo\//.test(ultimaAba || "") && ladoALado())) window.scrollTo(0, 0);
    ultimaAba = chave;
    document.querySelectorAll("tr[data-ir]").forEach((tr) => tr.setAttribute("tabindex", "0"));
  }
  window.addEventListener("hashchange", render);
  // número de jogos rolando na aba "Ao vivo" do topo
  function contadorVivo() {
    const el = document.getElementById("qtd-vivo");
    if (!el) return;
    const n = comps.length ? todasPartidas().filter((x) => aoVivo(x.p)).length : 0;
    el.textContent = n ? String(n) : "";
    el.hidden = !n;
  }

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
  window.App = { dados: DADOS, jogoAberto, abaAberta: () => (jogoAberto() ? estado.abaVista : null), recarregarPreferencias, render: () => render(), aoVivoAtualizado };
  function jogoAberto() {
    if (estado.sel) return { code: estado.sel.code, id: estado.sel.id };
    const m = location.hash.match(/^#jogo\/([^/]+)\/([^/]+)/);
    return m ? { code: decodeURIComponent(m[1]), id: decodeURIComponent(m[2]) } : null;
  }
  // barra viva: com um jogo rolando na tela, redesenha a cada 2 s para a barra do minuto atual "esfriar" suave
  setInterval(() => {
    if (document.hidden || !document.querySelector(".pressao #pv-c")) return;
    aoVivoAtualizado();
  }, 2000);

  // atualização ao vivo (placar a cada 20 s, lances e estatísticas a cada poucos segundos)
  const ROLAVEIS = "#lista-jogos-corpo, .detalhe-lado, .radar-lista, .ev-lista, .tabela-rolagem, .esc-lado, .abas-jogo, .chips";
  function aoVivoAtualizado() {
    todasPartidas.cache = null;
    // guarda só a rolagem de quem rola de verdade (antes varria todos os elementos do painel: ~40 ms por atualização)
    const rol = [...document.querySelectorAll(ROLAVEIS)].map((el, i) => (el.scrollTop || el.scrollLeft ? [i, el.scrollTop, el.scrollLeft] : null)).filter(Boolean);
    const y = window.scrollY;
    const aba = decodeURIComponent(location.hash.slice(1)).split("/")[0] || "jogos";
    // na lista de jogos só a lista e o painel ao lado mudam: a barra de ferramentas (busca, filtros, data) fica como está
    if (aba === "jogos" && !MODO_JANELA && document.getElementById("lista-jogos-corpo")) { renderListaJogos(); contadorVivo(); }
    else render();
    if (rol.length) {
      const els = document.querySelectorAll(ROLAVEIS);
      for (const [i, t, l] of rol) { const el = els[i]; if (el && (el.scrollTop !== t || el.scrollLeft !== l)) { el.scrollTop = t; el.scrollLeft = l; } }
    }
    if (window.scrollY !== y) window.scrollTo(0, y);
  }

  montarTopo();
  render();
  if (window.Contas) window.Contas.iniciar();
  if (window.AoVivo) window.AoVivo.iniciar();
})();
