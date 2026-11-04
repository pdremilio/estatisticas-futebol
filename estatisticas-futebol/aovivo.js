/* ScanBall — modo ao vivo.
 * Lê a tabela "ao_vivo" do Supabase (preenchida a cada 15 s pela função "ao-vivo" com dados da API-Football)
 * e sobrepõe minuto, placar, eventos e estatísticas nas partidas do site.
 * Só liga com SB_CONFIG.aoVivo = true. Sem jogo na janela, não faz nenhuma requisição.
 */
(function () {
  "use strict";
  const C = window.SB_CONFIG || {};
  const LIGADO = !!(C.url && C.anonKey && C.aoVivo);
  const LIGAS = { 71: "BSA", 39: "PL", 140: "PD", 135: "SA", 78: "BL1", 61: "FL1", 94: "PPL", 88: "DED", 40: "ELC", 2: "CL" };
  const STATUS = { "1H": "IN_PLAY", "2H": "IN_PLAY", ET: "IN_PLAY", P: "IN_PLAY", LIVE: "IN_PLAY", BT: "PAUSED", HT: "PAUSED",
    FT: "FINISHED", AET: "FINISHED", PEN: "FINISHED", SUSP: "SUSPENDED", INT: "SUSPENDED", ABD: "SUSPENDED", PST: "POSTPONED", CANC: "CANCELLED" };
  const INTERVALO_VIVO = 15000, INTERVALO_CALMO = 60000;

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

  let dados = null, ultimo = null, timer = null, buscando = false;
  const casados = new Map(); // id da API-Football -> partida do site
  const tocadas = new Set(); // partidas que receberam sobreposição

  function acharPartida(j) {
    if (casados.has(j.id)) return casados.get(j.id);
    const code = LIGAS[j.lg];
    const comp = code && dados.competicoes[code];
    if (!comp) return null;
    const quando = Date.parse(j.d);
    const th = tokens(j.h && j.h.n), ta = tokens(j.a && j.a.n);
    let melhor = null, nota = 0;
    for (const p of comp.partidas) {
      if (!p.h || !p.a) continue;
      const dif = Math.abs(Date.parse(p.d) - quando);
      if (dif > 3 * 3600e3) continue;
      const T = dados.times || {};
      const nh = tokens((T[p.h] || {}).n + " " + (T[p.h] || {}).c), na = tokens((T[p.a] || {}).n + " " + (T[p.a] || {}).c);
      const sh = parecido(th, nh), sa = parecido(ta, na);
      if (sh + sa === 0) continue;
      if ((sh === 0 || sa === 0) && dif > 20 * 60e3) continue; // só um nome bateu: exige horário quase igual
      const n = sh + sa - dif / 86400e3;
      if (n > nota) { melhor = p; nota = n; }
    }
    if (melhor) casados.set(j.id, melhor);
    return melhor;
  }

  function minuto(j) {
    if (j.st === "HT") return "Intervalo";
    if (j.st === "BT") return "Pausa";
    if (j.st === "P") return "Pênaltis";
    if (j.el == null) return "";
    return j.el + (j.ex ? "+" + j.ex : "") + "'";
  }

  function aplicar(snap) {
    if (!snap || !Array.isArray(snap.jogos)) return false;
    let mudou = false;
    const vistas = new Set();
    for (const j of snap.jogos) {
      const p = acharPartida(j);
      if (!p) continue;
      const s = STATUS[j.st];
      if (!s) continue;
      vistas.add(p);
      if (!p._orig) p._orig = { s: p.s, fh: p.fh, fa: p.fa, hh: p.hh, ha: p.ha };
      const antes = JSON.stringify([p.s, p.fh, p.fa, p.hh, p.ha, p.vv && p.vv.min, p.vv && p.vv.ev && p.vv.ev.length, p.vv && p.vv.es]);
      p.s = s;
      if (j.g) { p.fh = j.g[0]; p.fa = j.g[1]; }
      if (j.ht && j.ht[0] != null) { p.hh = j.ht[0]; p.ha = j.ht[1]; }
      p.vv = { min: minuto(j), st: j.st, ev: j.ev || (p.vv && p.vv.ev) || [], es: j.es || (p.vv && p.vv.es) || null, em: snap.em };
      tocadas.add(p);
      if (JSON.stringify([p.s, p.fh, p.fa, p.hh, p.ha, p.vv.min, p.vv.ev.length, p.vv.es]) !== antes) mudou = true;
    }
    // partida que saiu do feed sem terminar: volta ao que o site tinha
    for (const p of tocadas) {
      if (vistas.has(p) || p.s === "FINISHED") continue;
      Object.assign(p, p._orig); delete p.vv; delete p._orig; tocadas.delete(p); mudou = true;
    }
    return mudou;
  }

  function haJanela() {
    const agora = Date.now();
    if (ultimo && ultimo.jogos && ultimo.jogos.some((j) => STATUS[j.st] === "IN_PLAY" || STATUS[j.st] === "PAUSED")) return true;
    for (const code in dados.competicoes) {
      for (const p of dados.competicoes[code].partidas || []) {
        const t = Date.parse(p.d);
        if (agora >= t - 15 * 60e3 && agora <= t + 3 * 3600e3 && !["FINISHED", "POSTPONED", "CANCELLED"].includes(p.s)) return true;
      }
    }
    return false;
  }

  async function buscar() {
    if (buscando || document.hidden) return;
    buscando = true;
    try {
      const r = await fetch(C.url.replace(/\/$/, "") + "/rest/v1/ao_vivo?id=eq.1&select=dados,atualizado_em", { headers: { apikey: C.anonKey }, cache: "no-store" });
      if (r.ok) {
        const linhas = await r.json();
        const snap = linhas && linhas[0] && linhas[0].dados;
        if (snap) {
          ultimo = snap;
          if (aplicar(snap)) redesenhar();
        }
      }
    } catch (e) { /* sem rede: tenta no próximo ciclo */ }
    buscando = false;
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

  function ciclo() {
    clearTimeout(timer);
    const vivo = haJanela();
    if (vivo) buscar();
    timer = setTimeout(ciclo, vivo ? INTERVALO_VIVO : INTERVALO_CALMO);
  }

  function iniciar() {
    if (!LIGADO) return;
    dados = (window.App && window.App.dados) || window.DADOS;
    if (!dados || !dados.competicoes) return;
    document.addEventListener("visibilitychange", () => { if (!document.hidden) ciclo(); });
    ciclo();
  }

  window.AoVivo = { ligado: LIGADO, iniciar, _aplicar: (snap, d) => { dados = d || dados; return aplicar(snap); } };
})();
