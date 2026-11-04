/* ScanBall — modo ao vivo com dados públicos da ESPN (sem chave, sem servidor).
 * O navegador de quem abre o site busca:
 *   - o placar das ligas com jogo na janela (a cada 20 s): minuto, placar e situação na lista de jogos;
 *   - o detalhe do jogo aberto: estatísticas, lances, escalações e a narração lance a lance,
 *     que vira o gráfico de pressão.
 * Para desligar: window.SB_CONFIG.espn = false (config.js).
 * Atenção: a API da ESPN não é oficial nem documentada; pode mudar sem aviso.
 */
(function () {
  "use strict";
  const C = window.SB_CONFIG || {};
  const LIGADO = C.espn !== false;
  const BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer/";
  const ESPN = { BSA: "bra.1", PL: "eng.1", PD: "esp.1", SA: "ita.1", BL1: "ger.1", FL1: "fra.1", PPL: "por.1", DED: "ned.1", ELC: "eng.2", CL: "uefa.champions" };
  const CICLO_VIVO = 20000, CICLO_CALMO = 60000, DETALHE_PRE = 120000;

  // ---------- nomes parecidos (mesma regra do atualizador de odds)
  const GENERICOS = new Set(["fc", "afc", "cf", "sc", "ec", "ac", "as", "ss", "club", "clube", "de", "da", "do", "del", "futebol", "football", "calcio", "cd", "ud", "fk", "sv", "sad", "the", "and", "esporte"]);
  const tokens = (nome) => new Set(String(nome || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .split(/[^a-z0-9]+/).filter((t) => t.length >= 2 && !GENERICOS.has(t)));
  function parecido(a, b) {
    if (!a.size || !b.size) return 0;
    let hits = 0;
    for (const x of a) for (const y of b) if (x === y || (Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x)))) { hits++; break; }
    return hits / Math.min(a.size, b.size);
  }

  let dados = null, timer = null, rodando = false;
  const casados = new Map(); // "code:idESPN" -> partida do site
  const ultimoDetalhe = new Map(); // "code:idESPN" -> horário da última busca do detalhe

  const naJanela = (p, agora) => { const t = Date.parse(p.d); return agora >= t - 75 * 60e3 && agora <= t + 3.5 * 3600e3 && !["POSTPONED", "CANCELLED"].includes(p.s); };
  function ligasAtivas() {
    const agora = Date.now(), l = [];
    for (const code in ESPN) {
      const comp = dados.competicoes[code];
      if (comp && (comp.partidas || []).some((p) => naJanela(p, agora))) l.push(code);
    }
    return l;
  }

  function acharPartida(code, ev) {
    const chave = code + ":" + ev.id;
    if (casados.has(chave)) return casados.get(chave);
    const c = ev.competitions && ev.competitions[0];
    if (!c) return null;
    const casa = c.competitors.find((x) => x.homeAway === "home"), fora = c.competitors.find((x) => x.homeAway === "away");
    if (!casa || !fora) return null;
    const nomes = (t) => tokens([t.displayName, t.shortDisplayName, t.name, t.location].join(" "));
    const th = nomes(casa.team), ta = nomes(fora.team), quando = Date.parse(ev.date);
    const T = dados.times || {};
    let melhor = null, nota = 0;
    for (const p of dados.competicoes[code].partidas) {
      if (!p.h || !p.a) continue;
      const dif = Math.abs(Date.parse(p.d) - quando);
      if (dif > 3 * 3600e3) continue;
      const sh = parecido(th, tokens((T[p.h] || {}).n + " " + (T[p.h] || {}).c)), sa = parecido(ta, tokens((T[p.a] || {}).n + " " + (T[p.a] || {}).c));
      if (sh + sa === 0) continue;
      if ((sh === 0 || sa === 0) && dif > 20 * 60e3) continue; // só um nome bateu: exige horário quase igual
      const n = sh + sa - dif / 86400e3;
      if (n > nota) { melhor = p; nota = n; }
    }
    if (melhor) casados.set(chave, melhor);
    return melhor;
  }

  // ---------- placar (lista de jogos)
  function aplicarPlacar(code, ev) {
    const p = acharPartida(code, ev);
    if (!p) return false;
    const c = ev.competitions[0], st = ev.status || {}, tp = st.type || {};
    const casa = c.competitors.find((x) => x.homeAway === "home"), fora = c.competitors.find((x) => x.homeAway === "away");
    const antes = JSON.stringify([p.s, p.fh, p.fa, p.vv && p.vv.min]);
    if (!p._orig) p._orig = { s: p.s, fh: p.fh, fa: p.fa, hh: p.hh, ha: p.ha };
    const vv = (p.vv = p.vv || {});
    vv.espn = { lg: ESPN[code], id: ev.id, code };
    vv.st = tp.state;
    vv.fonte = "ESPN";
    vv.em = new Date().toISOString();
    if (tp.state === "in") {
      p.s = /HALFTIME/.test(tp.name || "") ? "PAUSED" : "IN_PLAY";
      p.fh = Number(casa.score); p.fa = Number(fora.score);
      vv.min = p.s === "PAUSED" ? "Intervalo" : st.displayClock || tp.shortDetail || "";
    } else if (tp.state === "post" && tp.completed && !/POSTPONED|CANCEL|ABANDON/.test(tp.name || "")) {
      p.s = "FINISHED"; p.fh = Number(casa.score); p.fa = Number(fora.score); vv.min = "";
      if (/AET|EXTRA/.test(tp.name || "")) p.du = "EXTRA_TIME";
      if (/PEN/.test(tp.name || "")) p.du = "PENALTY_SHOOTOUT";
    } else {
      vv.min = "";
    }
    return antes !== JSON.stringify([p.s, p.fh, p.fa, vv.min]);
  }

  // ---------- detalhe do jogo aberto
  const MAPA_EST = { possessionPct: "posse", totalShots: "chutes", shotsOnTarget: "alvo", wonCorners: "esc", foulsCommitted: "faltas",
    yellowCards: "amarelos", redCards: "vermelhos", offsides: "imped", saves: "defesas", totalPasses: "passes" };
  const PESO = { "goal": 5, "shot-on-target": 3, "shot-off-target": 1.5, "shot-blocked": 1.5, "shot-hit-woodwork": 2.5, "corner-awarded": 1.5, "offside": 0.5, "penalty---scored": 5, "penalty---missed": 3, "penalty---saved": 3 };
  const minutoDe = (txt) => { const m = parseInt(String(txt || ""), 10); return isNaN(m) ? null : m; };

  function lerDetalhe(r, p) {
    const comp = r.header && r.header.competitions && r.header.competitions[0];
    const lado = {};
    for (const c of (comp && comp.competitors) || []) {
      const l = c.homeAway === "home" ? "h" : "a";
      lado[c.team.id] = l; lado[c.team.displayName] = l;
    }
    const ladoDe = (t) => (t ? lado[t.id] || lado[t.displayName] : null);

    // estatísticas
    let es = null;
    for (const t of (r.boxscore && r.boxscore.teams) || []) {
      const i = (t.homeAway ? t.homeAway === "home" : ladoDe(t.team) === "h") ? 0 : 1;
      for (const s of t.statistics || []) {
        const k = MAPA_EST[s.name];
        if (!k) continue;
        es = es || {};
        es[k] = es[k] || [null, null];
        const v = Number(String(s.displayValue).replace("%", ""));
        es[k][i] = isNaN(v) ? null : v;
      }
    }

    // lances
    const ev = [];
    let hh = 0, ha = 0, temGol1T = false;
    for (const k of r.keyEvents || []) {
      const tipo = (k.type && k.type.type) || "", l = ladoDe(k.team);
      if (!l) continue;
      const m = String((k.clock && k.clock.displayValue) || "").replace(/'/g, "");
      const nomes = (k.participants || []).map((x) => x.athlete && x.athlete.displayName).filter(Boolean);
      let e = null;
      if (/goal|penalty---scored/.test(tipo) && !/disallow|kick/.test(tipo)) {
        e = { m, l, t: "gol", j: nomes[0] || "", x: /own/.test(tipo) ? "contra" : /penalty/.test(tipo) ? "pênalti" : nomes[1] ? "assist. " + nomes[1] : "" };
        if (k.period && k.period.number === 1) { temGol1T = true; if (l === "h") hh++; else ha++; }
      } else if (tipo === "yellow-card") e = { m, l, t: "amarelo", j: nomes[0] || "", x: "" };
      else if (/red-card|yellow-red/.test(tipo)) e = { m, l, t: "vermelho", j: nomes[0] || "", x: /yellow/.test(tipo) ? "2º amarelo" : "" };
      else if (tipo === "substitution") e = { m, l, t: "sub", j: nomes[0] || "", x: nomes[1] ? "sai " + nomes[1] : "" };
      else if (/var/.test(tipo)) e = { m, l, t: "var", j: "", x: (k.type && k.type.text) || "VAR" };
      if (e) ev.push(e);
    }

    // escalações
    const est = (pl, n) => { const s = (pl.stats || []).find((x) => x.name === n); return s ? Number(s.value) || 0 : 0; };
    let esc = null;
    for (const t of r.rosters || []) {
      if (!t.roster || !t.roster.length) continue;
      const l = t.homeAway === "home" ? "h" : "a";
      esc = esc || {};
      esc[l] = {
        form: t.formation || "",
        jog: t.roster.map((pl) => ({
          n: (pl.athlete && pl.athlete.displayName) || "?", num: pl.jersey || "", pos: (pl.position && pl.position.abbreviation) || "",
          tit: !!pl.starter, ent: !!pl.subbedIn, sai: !!pl.subbedOut, ordem: Number(pl.formationPlace) || 99,
          g: est(pl, "totalGoals"), a: est(pl, "goalAssists"), am: est(pl, "yellowCards"), vm: est(pl, "redCards"), ch: est(pl, "totalShots"),
        })),
      };
    }

    // pressão: chutes, escanteios e gols por minuto, suavizado
    const bruto = { h: [], a: [] }, gols = [];
    let ate = 0;
    for (const c of r.commentary || []) {
      const tipo = c.play && c.play.type && c.play.type.type, l = c.play && ladoDe(c.play.team);
      const m = minutoDe(c.time && c.time.displayValue);
      if (m == null) continue;
      ate = Math.max(ate, m);
      if (!tipo || !l || !PESO[tipo]) continue;
      bruto[l][m] = (bruto[l][m] || 0) + PESO[tipo];
      if (tipo === "goal" || tipo === "penalty---scored") gols.push({ m, l });
    }
    let pr = null;
    if (ate > 0) {
      const n = Math.max(90, ate);
      pr = { h: [], a: [], gols, n, ate };
      let sh = 0, sa = 0;
      for (let m = 1; m <= n; m++) {
        sh = 0.55 * sh + (bruto.h[m] || 0); sa = 0.55 * sa + (bruto.a[m] || 0);
        pr.h[m] = m <= ate ? Math.round(sh * 10) / 10 : null;
        pr.a[m] = m <= ate ? Math.round(sa * 10) / 10 : null;
      }
    }

    const vv = (p.vv = p.vv || {});
    const antes = JSON.stringify([vv.ev, vv.es, vv.esc && Object.keys(vv.esc), vv.pr && vv.pr.ate, vv.pr && vv.pr.gols.length]);
    vv.ev = ev; vv.es = es; vv.esc = esc; vv.pr = pr; vv.emDet = new Date().toISOString();
    if (temGol1T || (p.s === "IN_PLAY" && ate > 46) || p.s === "FINISHED") { p.hh = hh; p.ha = ha; }
    return antes !== JSON.stringify([vv.ev, vv.es, vv.esc && Object.keys(vv.esc), vv.pr && vv.pr.ate, vv.pr && vv.pr.gols.length]);
  }

  const buscarJSON = (url) => fetch(url, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

  function jogoAberto() {
    const a = window.App && window.App.jogoAberto && window.App.jogoAberto();
    if (!a) return null;
    const comp = dados.competicoes[a.code];
    const p = comp && (comp.partidas || []).find((x) => String(x.i) === String(a.id));
    return p && p.vv && p.vv.espn ? p : null;
  }

  async function atualizarDetalhe(forcar) {
    const p = jogoAberto();
    if (!p) return false;
    const chave = p.vv.espn.code + ":" + p.vv.espn.id;
    const ultimo = ultimoDetalhe.get(chave) || 0;
    const intervalo = p.vv.st === "in" ? CICLO_VIVO - 1000 : p.vv.st === "pre" ? DETALHE_PRE : Infinity;
    if (!forcar && Date.now() - ultimo < intervalo) return false;
    if (forcar && Date.now() - ultimo < 5000) return false;
    ultimoDetalhe.set(chave, Date.now());
    const r = await buscarJSON(`${BASE}${p.vv.espn.lg}/summary?event=${p.vv.espn.id}`);
    return r ? lerDetalhe(r, p) : false;
  }

  async function ciclo() {
    clearTimeout(timer);
    let proximo = CICLO_CALMO;
    if (!document.hidden && !rodando) {
      rodando = true;
      try {
        const ligas = ligasAtivas();
        let mudou = false;
        if (ligas.length) {
          proximo = CICLO_VIVO;
          const placares = await Promise.all(ligas.map((code) => buscarJSON(`${BASE}${ESPN[code]}/scoreboard`).then((r) => [code, r])));
          for (const [code, r] of placares) for (const ev of (r && r.events) || []) if (aplicarPlacar(code, ev)) mudou = true;
        }
        if (await atualizarDetalhe(false)) mudou = true;
        if (mudou) redesenhar();
      } finally { rodando = false; }
    }
    timer = setTimeout(ciclo, proximo);
  }

  let pendente = false;
  function redesenhar() {
    const el = document.activeElement;
    const ocupado = (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) || document.querySelector(".modal-fundo");
    if (ocupado) { pendente = true; return; }
    pendente = false;
    if (window.App && window.App.aoVivoAtualizado) window.App.aoVivoAtualizado();
  }
  document.addEventListener("focusout", () => { if (pendente) setTimeout(redesenhar, 300); });

  // ao abrir um jogo, busca o detalhe na hora
  function aoAbrirJogo() { setTimeout(async () => { if (await atualizarDetalhe(true)) redesenhar(); }, 60); }

  function iniciar() {
    if (!LIGADO) return;
    dados = (window.App && window.App.dados) || window.DADOS;
    if (!dados || !dados.competicoes) return;
    document.addEventListener("visibilitychange", () => { if (!document.hidden) ciclo(); });
    window.addEventListener("hashchange", aoAbrirJogo);
    document.addEventListener("click", (e) => { if (e.target.closest && e.target.closest('[data-ir^="jogo/"]')) aoAbrirJogo(); });
    ciclo();
  }

  window.AoVivo = { ligado: LIGADO, iniciar, _lerDetalhe: lerDetalhe, _aplicarPlacar: (code, ev, d) => { dados = d || dados; return aplicarPlacar(code, ev); } };
})();
