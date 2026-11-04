/* ScanBall — placar ao vivo com dados públicos da ESPN (sem chave, sem servidor).
 * A lista de jogos, tabelas e projeções continuam vindo da football-data.org (atualizada a cada ~30 min);
 * o placar, o minuto e a situação dos jogos do dia passam a vir da ESPN, buscados pelo navegador a cada 20 s.
 * Só busca as ligas que têm jogo na janela (de 75 min antes do início até o jogo terminar).
 * Para desligar: window.SB_CONFIG.espn = false (config.js).
 * Atenção: a API da ESPN não é oficial nem documentada; pode mudar sem aviso.
 */
(function () {
  "use strict";
  const C = window.SB_CONFIG || {};
  const LIGADO = C.espn !== false;
  const BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer/";
  const ESPN = { BSA: "bra.1", PL: "eng.1", PD: "esp.1", SA: "ita.1", BL1: "ger.1", FL1: "fra.1", PPL: "por.1", DED: "ned.1", ELC: "eng.2", CL: "uefa.champions" };
  const CICLO_VIVO = 20000, CICLO_CALMO = 60000;

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

  // a ESPN organiza o placar pelo dia no horário dos EUA (Nova York): jogo às 21h30 de Brasília ainda é "hoje" lá
  const diaESPN = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(iso)).replace(/-/g, "");

  // jogo na janela: de 75 min antes até 3h30 depois do início; se a football-data ainda não deu o jogo como
  // encerrado, continua acompanhando por até 12 h (até o placar final chegar)
  function naJanela(p, agora) {
    const t = Date.parse(p.d), s = p._orig ? p._orig.s : p.s;
    if (["POSTPONED", "CANCELLED"].includes(s) || agora < t - 75 * 60e3) return false;
    return agora <= t + 3.5 * 3600e3 || (s !== "FINISHED" && agora <= t + 12 * 3600e3);
  }
  function buscasAtivas() {
    const agora = Date.now(), lista = new Map(); // "liga|dia" -> [code, dia]
    for (const code in ESPN) {
      const comp = dados.competicoes[code];
      for (const p of (comp && comp.partidas) || []) {
        if (!naJanela(p, agora)) continue;
        const dia = diaESPN(p.d);
        lista.set(code + "|" + dia, [code, dia]);
      }
    }
    return [...lista.values()];
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

  // ---------- placar, minuto e situação
  function aplicarPlacar(code, ev) {
    const p = acharPartida(code, ev);
    if (!p) return false;
    const c = ev.competitions[0], st = ev.status || {}, tp = st.type || {};
    const casa = c.competitors.find((x) => x.homeAway === "home"), fora = c.competitors.find((x) => x.homeAway === "away");
    const antes = JSON.stringify([p.s, p.fh, p.fa, p.du, p.vv && p.vv.min]);
    if (!p._orig) p._orig = { s: p.s, fh: p.fh, fa: p.fa, hh: p.hh, ha: p.ha };
    const vv = (p.vv = p.vv || {});
    vv.fonte = "ESPN";
    vv.st = tp.state;
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
    return antes !== JSON.stringify([p.s, p.fh, p.fa, p.du, vv.min]);
  }

  const buscarJSON = (url) => fetch(url, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

  async function ciclo() {
    clearTimeout(timer);
    let proximo = CICLO_CALMO;
    if (!document.hidden && !rodando) {
      rodando = true;
      try {
        const buscas = buscasAtivas();
        let mudou = false;
        if (buscas.length) {
          proximo = CICLO_VIVO;
          const placares = await Promise.all(buscas.map(([code, dia]) => buscarJSON(`${BASE}${ESPN[code]}/scoreboard?dates=${dia}`).then((r) => [code, r])));
          for (const [code, r] of placares) for (const ev of (r && r.events) || []) if (aplicarPlacar(code, ev)) mudou = true;
        }
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

  function iniciar() {
    if (!LIGADO) return;
    dados = (window.App && window.App.dados) || window.DADOS;
    if (!dados || !dados.competicoes) return;
    document.addEventListener("visibilitychange", () => { if (!document.hidden) ciclo(); });
    ciclo();
  }

  window.AoVivo = { ligado: LIGADO, iniciar, _aplicarPlacar: (code, ev, d) => { dados = d || dados; return aplicarPlacar(code, ev); } };
})();
