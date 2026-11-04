/* ScanBall · prévia de escanteios, cartões e xG (dados da API-Football em dados-2024.js).
 * Página independente: não usa nem altera app.js, motor.js ou os dados do site. */
(function () {
  "use strict";
  const P = window.PREVIA;
  const app = document.getElementById("app");
  const h = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v, d = 1) => (v == null || !isFinite(v) ? "–" : v.toFixed(d).replace(".", ","));
  const pct = (v) => (v == null || !isFinite(v) ? "–" : Math.round(v * 100) + "%");
  const pad = (n) => String(n).padStart(2, "0");
  const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

  if (!P || !P.jogos) {
    app.innerHTML = `<div class="painel"><div class="pv-vazio"><b>Os dados da prévia ainda não foram baixados.</b><br>No GitHub: Actions → "Baixar prévia (API-Football)" → Run workflow.</div></div>`;
    return;
  }
  document.getElementById("pv-aviso").textContent =
    `Prévia com dados do ${P.liga === "Serie A" ? "Brasileirão" : P.liga} ${P.temporada} (API-Football, plano grátis). ` +
    `Mostra como ficariam as estatísticas novas no ScanBall; com o plano Pro, os mesmos números vêm dos jogos de agora.`;

  // ------------------------------------------------------------ dados por time
  const T = P.times;
  const nome = (id) => {
    const n = (T[id] || {}).n || "?";
    return { "Sao Paulo": "São Paulo", "Gremio": "Grêmio", "Vitoria": "Vitória", "Cuiaba": "Cuiabá", "Criciuma": "Criciúma",
      "Atletico-MG": "Atlético-MG", "Atletico Paranaense": "Athletico-PR", "Atletico Goianiense": "Atlético-GO",
      "Vasco DA Gama": "Vasco", "RB Bragantino": "Bragantino" }[n] || n;
  };
  const CORES = ["#0F6E5A", "#2457A6", "#8A3FA0", "#B5532A", "#2F7F8F", "#7A6A1F", "#A33A5B", "#4D5BA8"];
  const escudo = (id, g) => {
    const t = T[id] || {};
    const sig = nome(id).replace(/[^A-Za-zÀ-ú ]/g, "").split(" ").map((p) => p[0]).join("").slice(0, 3).toUpperCase();
    const falso = `<span class="pv-esc-falso ${g ? "pv-esc-g" : ""}" style="background:${CORES[Number(id) % CORES.length]}" aria-hidden="true">${h(sig)}</span>`;
    return t.l ? `<img class="pv-esc ${g ? "pv-esc-g" : ""}" src="${h(t.l)}" alt="" loading="lazy" onerror="this.outerHTML=this.dataset.f" data-f='${falso.replace(/'/g, "&#39;")}'>` : falso;
  };
  const encerrado = (j) => ["FT", "AET", "PEN"].includes(j.s) && j.gh != null;
  const jogos = P.jogos.filter(encerrado);
  const val = (par, i) => (par && par[i] != null ? par[i] : null);

  // registros por time (um por jogo, já do ponto de vista do time)
  const reg = {};
  for (const j of jogos) {
    for (const lado of [0, 1]) {
      const tid = lado === 0 ? j.h : j.a, o = 1 - lado, e = j.e || {};
      const cart = (k) => (e.am || e.vm ? (val(e.am, k) || 0) + (val(e.vm, k) || 0) : null);
      (reg[tid] = reg[tid] || []).push({
        j, casa: lado === 0, d: j.d,
        gp: lado === 0 ? j.gh : j.ga, gc: lado === 0 ? j.ga : j.gh,
        escP: val(e.esc, lado), escC: val(e.esc, o), cartP: cart(lado), cartC: cart(o),
        xgP: val(e.xg, lado), xgC: val(e.xg, o), ch: val(e.ch, lado), al: val(e.al, lado), chC: val(e.ch, o),
      });
    }
  }
  for (const k in reg) reg[k].sort((a, b) => (a.d < b.d ? 1 : -1));

  const estado = { recorte: "geral", ultimos: 0, ordem: { times: ["escJ", -1], mercados: ["m0", -1] }, mercado: "esc", rodada: null };
  const recorte = (tid) => {
    let l = reg[tid] || [];
    if (estado.recorte === "casa") l = l.filter((r) => r.casa);
    if (estado.recorte === "fora") l = l.filter((r) => !r.casa);
    return estado.ultimos ? l.slice(0, estado.ultimos) : l;
  };
  const media = (l, f) => { const v = l.map(f).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const taxa = (l, f) => { const v = l.map(f).filter((x) => x != null); return v.length ? v.filter(Boolean).length / v.length : null; };
  const soma = (a, b) => (a == null || b == null ? null : a + b);

  // ------------------------------------------------------------ controles comuns
  const alternar = (attr, atual, opcoes) => `<div class="alternar" role="group">${opcoes.map(([v, r]) =>
    `<button type="button" ${attr}="${v}" aria-pressed="${String(v) === String(atual)}">${r}</button>`).join("")}</div>`;
  const controles = () => `${alternar("data-recorte", estado.recorte, [["geral", "Geral"], ["casa", "Casa"], ["fora", "Fora"]])}
    ${alternar("data-ultimos", estado.ultimos, [[0, "Temporada"], [10, "Últimos 10"], [5, "Últimos 5"]])}`;
  const ordenar = (linhas, chave) => {
    const [k, dir] = estado.ordem[chave];
    return linhas.sort((a, b) => ((a[k] ?? -1e9) - (b[k] ?? -1e9)) * dir || (a.nome < b.nome ? -1 : 1));
  };
  const th = (chave, k, rot, titulo) => {
    const [ok] = estado.ordem[chave];
    return `<th data-ord="${chave}:${k}" class="${ok === k ? "ordenada" : ""}" title="${h(titulo || rot)}">${rot}</th>`;
  };
  const celulaTime = (l) => `<td class="pos">${l.pos}</td><td class="time"><span>${escudo(l.tid)}${h(l.nome)}</span></td>`;

  // ------------------------------------------------------------ aba Times
  function telaTimes() {
    const linhas = Object.keys(reg).map((tid) => {
      const l = recorte(tid);
      return {
        tid, nome: nome(tid), jg: l.length,
        escP: media(l, (r) => r.escP), escC: media(l, (r) => r.escC), escJ: media(l, (r) => soma(r.escP, r.escC)),
        cartP: media(l, (r) => r.cartP), cartJ: media(l, (r) => soma(r.cartP, r.cartC)),
        xgP: media(l, (r) => r.xgP), xgC: media(l, (r) => r.xgC), gp: media(l, (r) => r.gp), gc: media(l, (r) => r.gc),
        ch: media(l, (r) => r.ch), al: media(l, (r) => r.al),
      };
    });
    ordenar(linhas, "times").forEach((l, i) => (l.pos = i + 1));
    app.innerHTML = `<div class="painel"><div class="painel-cab"><h2>Médias por jogo</h2></div><div class="painel-corpo">
      <div class="pv-barra">${controles()}<span class="sub">Clique no título de uma coluna para ordenar.</span></div>
      <div class="tabela-rolagem"><table class="dados pv-tabela"><thead>
        <tr><th></th><th></th><th></th><th colspan="3" class="grupo">Escanteios</th><th colspan="2" class="grupo">Cartões</th><th colspan="4" class="grupo">Gols e xG</th><th colspan="2" class="grupo">Finalizações</th></tr>
        <tr><th></th><th class="esq">Time</th>${th("times", "jg", "J", "Jogos")}
        ${th("times", "escP", "Pró", "Escanteios a favor")}${th("times", "escC", "Contra", "Escanteios contra")}${th("times", "escJ", "Jogo", "Escanteios no jogo (total)")}
        ${th("times", "cartP", "Pró", "Cartões recebidos pelo time")}${th("times", "cartJ", "Jogo", "Cartões no jogo (total)")}
        ${th("times", "gp", "Gols", "Gols marcados")}${th("times", "xgP", "xG", "Gols esperados a favor")}${th("times", "gc", "Sofr.", "Gols sofridos")}${th("times", "xgC", "xGA", "Gols esperados contra")}
        ${th("times", "ch", "Total", "Finalizações")}${th("times", "al", "No alvo", "Finalizações no alvo")}</tr></thead>
      <tbody>${linhas.map((l) => `<tr class="clicavel" data-time="${l.tid}">${celulaTime(l)}<td>${l.jg}</td>
        <td class="forte">${num(l.escP)}</td><td>${num(l.escC)}</td><td>${num(l.escJ)}</td>
        <td class="forte">${num(l.cartP)}</td><td>${num(l.cartJ)}</td>
        <td>${num(l.gp)}</td><td class="forte">${num(l.xgP, 2)}</td><td>${num(l.gc)}</td><td>${num(l.xgC, 2)}</td>
        <td>${num(l.ch)}</td><td>${num(l.al)}</td></tr>`).join("")}</tbody></table></div></div></div>`;
  }

  // ------------------------------------------------------------ aba Escanteios e cartões (mercados over)
  const MERCADOS = {
    esc: { rot: "Escanteios no jogo", linhas: [7.5, 8.5, 9.5, 10.5, 11.5], f: (r) => soma(r.escP, r.escC) },
    escP: { rot: "Escanteios do time", linhas: [2.5, 3.5, 4.5, 5.5, 6.5], f: (r) => r.escP },
    cart: { rot: "Cartões no jogo", linhas: [2.5, 3.5, 4.5, 5.5, 6.5], f: (r) => soma(r.cartP, r.cartC) },
    cartP: { rot: "Cartões do time", linhas: [0.5, 1.5, 2.5, 3.5], f: (r) => r.cartP },
  };
  const corPct = (v) => (v == null ? "" : `background: color-mix(in srgb, var(--casa) ${Math.round(v * 45)}%, transparent)`);
  function telaMercados() {
    const m = MERCADOS[estado.mercado];
    const linhas = Object.keys(reg).map((tid) => {
      const l = recorte(tid), o = { tid, nome: nome(tid), jg: l.length, med: media(l, m.f) };
      m.linhas.forEach((ln, i) => (o["m" + i] = taxa(l, (r) => (m.f(r) == null ? null : m.f(r) > ln))));
      return o;
    });
    if (!/^m\d$|^med$|^jg$/.test(estado.ordem.mercados[0])) estado.ordem.mercados = ["m0", -1];
    ordenar(linhas, "mercados").forEach((l, i) => (l.pos = i + 1));
    app.innerHTML = `<div class="painel"><div class="painel-cab"><h2>Over por time</h2></div><div class="painel-corpo">
      <div class="pv-barra">${alternar("data-mercado", estado.mercado, Object.entries(MERCADOS).map(([k, v]) => [k, v.rot]))}</div>
      <div class="pv-barra">${controles()}<span class="sub">% dos jogos do time em que passou da linha.</span></div>
      <div class="tabela-rolagem"><table class="dados pv-tabela"><thead><tr><th></th><th class="esq">Time</th>${th("mercados", "jg", "J", "Jogos")}${th("mercados", "med", "Média")}
        ${m.linhas.map((ln, i) => th("mercados", "m" + i, "+" + String(ln).replace(".", ","), "Mais de " + String(ln).replace(".", ","))).join("")}</tr></thead>
      <tbody>${linhas.map((l) => `<tr class="clicavel" data-time="${l.tid}">${celulaTime(l)}<td>${l.jg}</td><td class="forte">${num(l.med)}</td>
        ${m.linhas.map((_, i) => `<td class="pct" style="${corPct(l["m" + i])}">${pct(l["m" + i])}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div></div>`;
  }

  // ------------------------------------------------------------ aba Jogos (por rodada) e jogos de um time
  const rodadas = [...new Set(P.jogos.map((j) => j.r).filter(Boolean))].sort((a, b) => a - b);
  const linhaJogo = (j) => {
    const e = j.e || {}, fim = encerrado(j);
    const tot = (k) => (e[k] ? (val(e[k], 0) || 0) + (val(e[k], 1) || 0) : null);
    const cart = e.am || e.vm ? (tot("am") || 0) + (tot("vm") || 0) : null;
    const dt = new Date(j.d);
    return `<a class="pv-jogo" href="#jogo/${j.i}">
      <span class="quando">${SEMANA[dt.getDay()]} ${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}<br>${pad(dt.getHours())}:${pad(dt.getMinutes())}</span>
      <span class="pv-equipes"><span>${escudo(j.h)}<span class="nome">${h(nome(j.h))}</span><b>${fim ? j.gh : ""}</b></span>
        <span>${escudo(j.a)}<span class="nome">${h(nome(j.a))}</span><b>${fim ? j.ga : ""}</b></span></span>
      <span class="pv-numeros">${fim ? `<span><small>Escant.</small><b>${tot("esc") ?? "–"}</b></span><span><small>Cartões</small><b>${cart ?? "–"}</b></span>
        <span><small>xG</small><b>${num(val(e.xg, 0), 1)}–${num(val(e.xg, 1), 1)}</b></span>` : `<span><small>${h(j.s)}</small></span>`}</span></a>`;
  };
  function telaJogos(r) {
    if (r == null || !rodadas.includes(r)) r = estado.rodada || rodadas[rodadas.length - 1];
    estado.rodada = r;
    const lista = P.jogos.filter((j) => j.r === r);
    const i = rodadas.indexOf(r);
    app.innerHTML = `<div class="painel"><div class="painel-cab"><h2>Rodada ${r}</h2>
      <div class="pv-barra" style="margin:0"><a class="botao secundario" href="#jogos/${rodadas[Math.max(0, i - 1)]}" aria-label="Rodada anterior">‹</a>
      <select id="pv-rodada" class="campo-num" aria-label="Escolher rodada">${rodadas.map((x) => `<option value="${x}" ${x === r ? "selected" : ""}>Rodada ${x}</option>`).join("")}</select>
      <a class="botao secundario" href="#jogos/${rodadas[Math.min(rodadas.length - 1, i + 1)]}" aria-label="Próxima rodada">›</a></div></div>
      <div class="pv-jogos">${lista.map(linhaJogo).join("")}</div></div>`;
  }
  function telaTime(tid) {
    const l = (reg[tid] || []);
    app.innerHTML = `<p><a href="#times" class="botao secundario">‹ Times</a></p>
      <div class="painel"><div class="painel-cab"><h2 style="display:flex;gap:10px;align-items:center">${escudo(tid, true)}${h(nome(tid))}</h2>
      <span class="sub">${l.length} jogos · escanteios ${num(media(l, (r) => r.escP))} a favor e ${num(media(l, (r) => r.escC))} contra · cartões ${num(media(l, (r) => r.cartP))} · xG ${num(media(l, (r) => r.xgP), 2)}</span></div>
      <div class="pv-jogos">${l.map((r) => linhaJogo(r.j)).join("")}</div></div>`;
  }

  // ------------------------------------------------------------ tela do jogo
  const EST = [["po", "Posse de bola", "%"], ["xg", "Gols esperados (xG)"], ["ch", "Finalizações"], ["al", "No alvo"], ["esc", "Escanteios"],
    ["fa", "Faltas"], ["am", "Cartões amarelos"], ["vm", "Cartões vermelhos"], ["im", "Impedimentos"], ["de", "Defesas do goleiro"]];
  const ICONE = { g: "⚽", gp: "⚽", gc: "⚽", pp: "✕", a: '<i class="ic amarelo"></i>', v: '<i class="ic vermelho"></i>', s: "⇄", x: "VAR" };
  const DET = { gp: "pênalti", gc: "contra", pp: "pênalti perdido" };
  function telaJogo(id) {
    const j = P.jogos.find((x) => String(x.i) === String(id));
    if (!j) { location.hash = "#jogos"; return; }
    const e = j.e || {};
    const dt = new Date(j.d);
    const est = EST.filter(([k]) => e[k] && (e[k][0] != null || e[k][1] != null)).map(([k, rot, suf = ""]) => {
      const a = val(e[k], 0) || 0, b = val(e[k], 1) || 0, t = a + b || 1, f = (x) => (k === "xg" ? num(x, 2) : x) + suf;
      return `<div class="est-linha"><span class="v">${f(a)}</span><span class="rot">${rot}</span><span class="v">${f(b)}</span>
        <span class="est-trilho"><span style="width:${(a / t) * 100}%"></span><span style="width:${(b / t) * 100}%"></span></span></div>`;
    }).join("");
    const txt = (v) => { const ic = ICONE[v[3]] || "", x = v[5] || DET[v[3]] || "", nm = `${h(v[4])}${x ? ` <small>${h(x)}</small>` : ""}`;
      return `<span class="${/^g/.test(v[3]) ? "gol" : ""}">${v[2] === 0 ? nm + " " + ic : ic + " " + nm}</span>`; };
    const evs = (j.ev || []).slice().sort((a, b) => (a[0] + (a[1] || 0) / 100) - (b[0] + (b[1] || 0) / 100)).map((v) =>
      `<li><span class="c">${v[2] === 0 ? txt(v) : ""}</span><span class="m">${v[0]}${v[1] ? "+" + v[1] : ""}'</span><span>${v[2] === 1 ? txt(v) : ""}</span></li>`).join("");
    const antes = (tid) => (reg[tid] || []).filter((r) => r.d < j.d);
    const linhaMedia = (rot, f, d = 1) => `<tr><td>${num(media(antes(j.h), f), d)}</td><td class="esq" style="text-align:center">${rot}</td><td>${num(media(antes(j.a), f), d)}</td></tr>`;
    app.innerHTML = `<p><a href="#jogos/${j.r}" class="botao secundario">‹ Rodada ${j.r}</a></p>
      <div class="painel"><div class="painel-corpo" style="padding-top:14px">
        <p class="sub" style="text-align:center;margin:0 0 6px">${h(P.liga === "Serie A" ? "Brasileirão" : P.liga)} ${P.temporada} · Rodada ${j.r} · ${SEMANA[dt.getDay()]} ${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()}</p>
        <div class="pv-cab"><a class="lado" href="#time/${j.h}" style="color:inherit;text-decoration:none">${escudo(j.h, true)}<h2>${h(nome(j.h))}</h2></a>
          <div><div class="pv-placar">${j.gh ?? "–"}<span>x</span>${j.ga ?? "–"}</div>${j.hh != null ? `<div class="sub">(${j.hh}x${j.ha}) no 1º tempo</div>` : ""}</div>
          <a class="lado" href="#time/${j.a}" style="color:inherit;text-decoration:none">${escudo(j.a, true)}<h2>${h(nome(j.a))}</h2></a></div>
        <div class="vivo-painel">
          <div><h3>Lances</h3>${evs ? `<ul class="ev-lista" style="max-height:none">${evs}</ul>` : '<p class="sub">Sem lances registrados.</p>'}</div>
          <div><h3>Estatísticas da partida</h3>${est ? `<div class="est-lista">${est}</div>` : '<p class="sub">Sem estatísticas para este jogo.</p>'}</div>
        </div>
        <div class="pv-medias"><h3 style="font:700 16px var(--fonte-titulo);text-transform:uppercase;letter-spacing:.4px;color:var(--tinta-2);margin:0 0 6px">Médias antes deste jogo</h3>
          <table class="dados" style="max-width:520px;margin:0 auto"><thead><tr><th>${h(nome(j.h))}</th><th></th><th>${h(nome(j.a))}</th></tr></thead><tbody>
          ${linhaMedia("Escanteios a favor", (r) => r.escP)}${linhaMedia("Escanteios contra", (r) => r.escC)}${linhaMedia("Cartões", (r) => r.cartP)}
          ${linhaMedia("xG a favor", (r) => r.xgP, 2)}${linhaMedia("xG contra", (r) => r.xgC, 2)}${linhaMedia("Finalizações", (r) => r.ch)}</tbody></table></div>
      </div></div>`;
  }

  // ------------------------------------------------------------ rotas e eventos
  function render() {
    const [aba, arg] = location.hash.replace(/^#/, "").split("/");
    document.querySelectorAll("#abas a").forEach((a) => a.setAttribute("aria-current", a.dataset.aba === (aba === "jogo" ? "jogos" : aba === "time" ? "times" : aba || "times") ? "page" : "false"));
    if (aba === "mercados") telaMercados();
    else if (aba === "jogos") telaJogos(arg ? Number(arg) : null);
    else if (aba === "jogo") telaJogo(arg);
    else if (aba === "time") telaTime(arg);
    else telaTimes();
  }
  let ultimo = "";
  window.addEventListener("hashchange", () => { render(); if (location.hash !== ultimo) window.scrollTo(0, 0); ultimo = location.hash; });
  app.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-recorte],[data-ultimos],[data-mercado],[data-ord],tr[data-time]");
    if (!b) return;
    const d = b.dataset;
    if (d.recorte) estado.recorte = d.recorte;
    else if (d.ultimos != null) estado.ultimos = Number(d.ultimos);
    else if (d.mercado) { estado.mercado = d.mercado; estado.ordem.mercados = ["m0", -1]; }
    else if (d.ord) { const [ch, k] = d.ord.split(":"); const [ok, dir] = estado.ordem[ch]; estado.ordem[ch] = [k, ok === k ? -dir : -1]; }
    else if (d.time) { location.hash = "#time/" + d.time; return; }
    render();
  });
  app.addEventListener("change", (ev) => { if (ev.target.id === "pv-rodada") location.hash = "#jogos/" + ev.target.value; });
  render();
})();
