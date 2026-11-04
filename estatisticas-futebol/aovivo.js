/* ScanBall — modo ao vivo com dados públicos da ESPN (sem chave, sem servidor).
 * O navegador de quem abre o site busca:
 *   - o placar das ligas com jogo na janela (a cada 20 s): minuto, placar e situação na lista de jogos;
 *   - o detalhe do jogo aberto: estatísticas, lances, escalações e a narração lance a lance,
 *     que vira o gráfico de pressão (uma barra por minuto);
 *   - na aba "Ao vivo" do topo: o detalhe de TODOS os jogos rolando, para o painel;
 *   - na aba Escalações: os números de cada jogador na temporada (elenco do time na ESPN).
 * Medido em 04/11/2026 (66 lances da Champions): a narração da ESPN chega de 45 s a 2 min depois do lance (mediana 76 s).
 * O atraso é da fonte, não do site.
 * Para desligar: window.SB_CONFIG.espn = false (config.js).
 * Atenção: a API da ESPN não é oficial nem documentada; pode mudar sem aviso.
 */
(function () {
  "use strict";
  const C = window.SB_CONFIG || {};
  const LIGADO = C.espn !== false;
  const BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer/";
  const CORE = "https://sports.core.api.espn.com/v2/sports/soccer/leagues/"; // minutos jogados de cada atleta
  const ESPN = { BSA: "bra.1", PL: "eng.1", PD: "esp.1", SA: "ita.1", BL1: "ger.1", FL1: "fra.1", PPL: "por.1", DED: "ned.1", ELC: "eng.2", CL: "uefa.champions" };
  const CICLO_VIVO = 20000, CICLO_CALMO = 60000, DETALHE_PRE = 120000, ELENCO_VALIDADE = 6 * 3600e3;

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

  let dados = null, timer = null, rodando = false, inicioCiclo = 0, geracao = 0;
  let falhasSeguidas = 0, indisponivel = false; // ESPN fora do ar: 3 ciclos seguidos sem resposta
  const LIMITE_BUSCA = 10000, CICLO_TRAVADO = 45000, FALHAS_AVISO = 3;
  const casados = new Map(); // "code:idESPN" -> partida do site
  const ultimoDetalhe = new Map(); // "code:idESPN" -> horário da última busca do detalhe
  const elencos = new Map(); // "liga:idTime" -> { em, jog: {idAtleta: números}, temporada }

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
    // nomes + sigla (ex.: "CAP" do Athletico-PR), para casar times com nome bem diferente nas duas APIs
    const nomes = (t) => tokens([t.displayName, t.shortDisplayName, t.name, t.location, t.abbreviation].join(" "));
    const th = nomes(casa.team), ta = nomes(fora.team), quando = Date.parse(ev.date);
    const T = dados.times || {};
    let melhor = null, nota = 0;
    for (const p of dados.competicoes[code].partidas) {
      if (!p.h || !p.a) continue;
      const dif = Math.abs(Date.parse(p.d) - quando);
      if (dif > 3 * 3600e3) continue;
      const sh = parecido(th, tokens((T[p.h] || {}).n + " " + (T[p.h] || {}).c + " " + ((T[p.h] || {}).t || ""))), sa = parecido(ta, tokens((T[p.a] || {}).n + " " + (T[p.a] || {}).c + " " + ((T[p.a] || {}).t || "")));
      if (sh + sa === 0) continue;
      if ((sh === 0 || sa === 0) && dif > 20 * 60e3) continue; // só um nome bateu: exige horário quase igual
      const n = sh + sa - dif / 86400e3;
      if (n > nota) { melhor = p; nota = n; }
    }
    if (melhor) casados.set(chave, melhor);
    return melhor;
  }

  // ---------- placar do 1º tempo pelos gols do placar da ESPN (o da football-data chega atrasado)
  function primeiroTempo(c, casa, fora) {
    const gols = (c.details || []).filter((d) => d.scoringPlay);
    const fh = Number(casa.score) || 0, fa = Number(fora.score) || 0;
    const conta = (inverteContra) => {
      const t = { h: 0, a: 0, ht: { h: 0, a: 0 } };
      for (const d of gols) {
        let l = d.team && String(d.team.id) === String(casa.team.id) ? "h" : "a";
        if (inverteContra && d.ownGoal) l = l === "h" ? "a" : "h";
        t[l]++;
        const disp = String((d.clock && d.clock.displayValue) || "");
        if (/^45'?\s*\+/.test(disp) || (parseInt(disp, 10) || 99) <= 45) t.ht[l]++;
      }
      return t;
    };
    // confere com o placar; se não bater, tenta o gol contra do outro lado; se ainda não bater, não arrisca
    for (const inv of [false, true]) { const t = conta(inv); if (t.h === fh && t.a === fa) return [t.ht.h, t.ht.a]; }
    return null;
  }

  // jogo nosso rolando (ou para começar) que não foi achado na ESPN: avisa na página do jogo
  function marcarSemPar(placares) {
    const agora = Date.now();
    let mudou = false;
    for (const [code, r] of placares) {
      if (!r) continue;
      for (const p of (dados.competicoes[code] || {}).partidas || []) {
        if (p.vv && p.vv.espn) continue;
        const sem = naJanela(p, agora) && agora >= Date.parse(p.d) - 30 * 60e3 && (p._orig ? p._orig.s : p.s) !== "FINISHED";
        if (!!p.semEspn !== sem) { p.semEspn = sem; mudou = true; }
      }
    }
    return mudou;
  }

  // ---------- placar (lista de jogos)
  function aplicarPlacar(code, ev) {
    const p = acharPartida(code, ev);
    if (!p) return false;
    const c = ev.competitions[0], st = ev.status || {}, tp = st.type || {};
    const casa = c.competitors.find((x) => x.homeAway === "home"), fora = c.competitors.find((x) => x.homeAway === "away");
    const antes = JSON.stringify([p.s, p.fh, p.fa, p.du, p.hh, p.ha, p.vv && p.vv.min]);
    if (!p._orig) p._orig = { s: p.s, fh: p.fh, fa: p.fa, hh: p.hh, ha: p.ha };
    const vv = (p.vv = p.vv || {});
    vv.espn = { lg: ESPN[code], id: ev.id, code };
    vv.tid = { h: casa.team && casa.team.id, a: fora.team && fora.team.id };
    vv.st = tp.state;
    vv.clk = st.displayClock || ""; vv.per = st.period || 0;
    vv.fonte = "ESPN";
    vv.em = new Date().toISOString();
    p.semEspn = false;
    if (tp.state === "in") {
      p.s = /HALFTIME/.test(tp.name || "") ? "PAUSED" : "IN_PLAY";
      p.fh = Number(casa.score); p.fa = Number(fora.score);
      vv.min = p.s === "PAUSED" ? "Intervalo" : st.displayClock || tp.shortDetail || "";
    } else if (tp.state === "post" && tp.completed && !/POSTPONED|CANCEL|ABANDON/.test(tp.name || "")) {
      p.s = "FINISHED"; p.fh = Number(casa.score); p.fa = Number(fora.score); vv.min = "";
      if (/AET|EXTRA/.test(tp.name || "")) p.du = "EXTRA_TIME";
      if (/PEN/.test(tp.name || "")) p.du = "PENALTY_SHOOTOUT";
    } else if (/POSTPONED/.test(tp.name || "")) {
      p.s = "POSTPONED"; vv.min = "";
    } else if (/CANCEL/.test(tp.name || "")) {
      p.s = "CANCELLED"; vv.min = "";
    } else if (/SUSPENDED|ABANDON/.test(tp.name || "")) {
      p.s = "SUSPENDED"; vv.min = "";
    } else {
      vv.min = "";
    }
    // 1º tempo: no intervalo, no 2º tempo e no fim vem dos gols da ESPN; durante o 1º tempo fica vazio
    if (tp.state === "in" || p.s === "FINISHED") {
      if (p.s === "IN_PLAY" && (st.period || 1) < 2) { p.hh = null; p.ha = null; }
      else { const ht = primeiroTempo(c, casa, fora); if (ht) { p.hh = ht[0]; p.ha = ht[1]; } }
    }
    if (vv.pr) recalcularAtual(p);
    return antes !== JSON.stringify([p.s, p.fh, p.fa, p.du, p.hh, p.ha, vv.min]);
  }

  // ---------- gráfico de pressão: uma barra por minuto (acréscimos ganham barras próprias: 45+1, 45+2...)
  // peso de cada lance na barra do minuto em que aconteceu (lances de falta/cartão/substituição não pesam)
  const PESO = { gol: 5, alvo: 3, trave: 2.5, fora: 1.5, bloq: 1.5, esc: 1.5, imped: 0.5, falta: 0.5 };
  // a ESPN separa os gols por tipo (goal---header, goal---free-kick, own-goal...): todos contam como gol.
  // No gol contra, o "time" do lance já é quem foi beneficiado.
  function classificar(t, txt) {
    if (/^goal(---|$)/.test(t) || t === "own-goal" || t === "penalty---scored") return "gol";
    if (t === "shot-hit-woodwork") return "trave";
    if (t === "shot-on-target" || t === "penalty---saved") return "alvo";
    if (t === "shot-off-target" || t === "penalty---missed") return "fora";
    if (t === "shot-blocked") return "bloq";
    if (t === "corner-awarded") return "esc";
    if (t === "offside") return "imped";
    if (t === "yellow-card") return "amarelo";
    if (/red/.test(t)) return /yellow/.test(t) ? "2amarelo" : "vermelho";
    if (t === "substitution") return "sub";
    // "Fulano (Time B) wins a free kick in the attacking half / on the right wing": vale para quem sofreu a falta
    if (t === "foul" && /wins a free kick (in the attacking half|on the (left|right) wing)/i.test(txt || "")) return "falta";
    return null;
  }
  const LIM = [0, 45, 90, 105, 120], INI = [0, 1, 46, 91, 106];
  // "45'+2'" no 1º tempo -> { per: 1, b: 45, ad: 2 }
  function slotDe(disp, per) {
    const m = String(disp || "").match(/^(\d+)'?\s*(?:\+\s*(\d+))?/);
    if (!m) return null;
    let b = Number(m[1]), ad = Number(m[2] || 0);
    if (!b && !ad) return null;
    per = Number(per) || (b <= 45 ? 1 : b <= 90 ? 2 : b <= 105 ? 3 : 4);
    if (per > 4) return null; // pênaltis
    if (b > LIM[per]) { ad += b - LIM[per]; b = LIM[per]; }
    if (b < INI[per]) b = INI[per];
    return { per, b, ad };
  }
  const chaveSlot = (s) => s.per + ":" + s.b + ":" + s.ad;
  // "Attempt saved. Éder Militão (Real Madrid) right footed shot..." -> "Éder Militão"
  const jogadorDe = (txt) => { const m = String(txt || "").match(/(?:^|[.!]\s+)([^.!()]{2,40}?)\s+\([^)]+\)/); return m ? m[1].trim() : ""; };

  function montarPressao(r, ladoDe, vv) {
    const brutos = [];
    let temLance = false;
    for (const c of r.commentary || []) {
      const pl = c.play;
      if (!pl || !pl.type) continue;
      const k = classificar(pl.type.type || "", c.text);
      if (!k) continue;
      let l = ladoDe(pl.team);
      if (!l) continue;
      if (k === "falta") l = l === "h" ? "a" : "h"; // o time do lance é o que cometeu a falta
      const s = slotDe((c.time && c.time.displayValue) || (pl.clock && pl.clock.displayValue), pl.period && pl.period.number);
      if (!s) continue;
      temLance = true;
      let j = k === "sub" ? ((pl.participants || [])[0] || {}).athlete : null;
      j = j ? j.displayName : k === "falta" ? (String(c.text || "").match(/^(.+?)\s+\(/) || [])[1] || "" : jogadorDe(c.text);
      const extra = k === "sub" && pl.participants && pl.participants[1] && pl.participants[1].athlete ? "sai " + pl.participants[1].athlete.displayName
        : pl.type.type === "own-goal" ? "contra" : /penalty/.test(pl.type.type) ? "pênalti" : "";
      brutos.push({ s, l, k, j: j || "", x: extra, min: (c.time && c.time.displayValue) || "", seq: c.sequence });
    }
    const st = vv.st;
    if (!temLance && st !== "in" && st !== "post") return null;
    // acréscimos e prorrogação vistos (nos lances ou no relógio)
    const maxAd = [0, 0, 0, 0, 0];
    let maxPer = 2;
    for (const e of brutos) { maxPer = Math.max(maxPer, e.s.per); maxAd[e.s.per] = Math.max(maxAd[e.s.per], e.s.ad); }
    const sr = slotDe(vv.clk, vv.per);
    if (sr && st === "in") { maxPer = Math.max(maxPer, sr.per); maxAd[sr.per] = Math.max(maxAd[sr.per], sr.ad); }
    const slots = [], idx = {};
    for (let per = 1; per <= maxPer; per++) {
      for (let b = INI[per]; b <= LIM[per]; b++) slots.push({ per, b, ad: 0 });
      for (let ad = 1; ad <= maxAd[per]; ad++) slots.push({ per, b: LIM[per], ad });
    }
    slots.forEach((s, i) => { idx[chaveSlot(s)] = i; s.r = s.ad ? s.b + "+" + s.ad : String(s.b); });
    const pr = { slots, h: new Array(slots.length).fill(0), a: new Array(slots.length).fill(0), ev: [], ultimo: -1 };
    for (const e of brutos) {
      const i = idx[chaveSlot(e.s)];
      if (i == null) continue;
      if (PESO[e.k]) pr[e.l][i] = Math.round((pr[e.l][i] + PESO[e.k]) * 10) / 10;
      pr.ultimo = Math.max(pr.ultimo, i);
      if (e.k !== "falta" && e.k !== "imped") pr.ev.push({ i, l: e.l, k: e.k, j: e.j, x: e.x, min: e.min });
    }
    pr.idx = idx;
    return pr;
  }
  // minuto atual (relógio do placar, que corre na frente da narração)
  function recalcularAtual(p) {
    const vv = p.vv, pr = vv.pr;
    if (!pr) return;
    const ultimo = pr.slots.length - 1;
    pr.fim = p.s === "FINISHED" || vv.st === "post";
    if (pr.fim) { pr.atual = ultimo; pr.intervalo = false; return; }
    if (p.s === "PAUSED") { pr.atual = Math.max(...pr.slots.map((s, i) => (s.per === 1 ? i : -1))); pr.intervalo = true; return; }
    pr.intervalo = false;
    const s = slotDe(vv.clk, vv.per);
    const i = s ? pr.idx[chaveSlot(s)] : null;
    pr.atual = i != null ? i : Math.min(Math.max(pr.ultimo, 0), ultimo);
  }

  // ---------- detalhe do jogo
  const MAPA_EST = { possessionPct: "posse", totalShots: "chutes", shotsOnTarget: "alvo", wonCorners: "esc", foulsCommitted: "faltas",
    yellowCards: "amarelos", redCards: "vermelhos", offsides: "imped", saves: "defesas", totalPasses: "passes" };

  function lerDetalhe(r, p) {
    const comp = r.header && r.header.competitions && r.header.competitions[0];
    const lado = {}, tid = {};
    for (const c of (comp && comp.competitors) || []) {
      const l = c.homeAway === "home" ? "h" : "a";
      lado[c.team.id] = l; lado[c.team.displayName] = l; tid[l] = c.team.id;
    }
    const ladoDe = (t) => (t ? lado[t.id] || lado[t.displayName] : null);
    const vv = (p.vv = p.vv || {});
    vv.tid = tid;
    if (comp && comp.status) {
      vv.clk = comp.status.displayClock || vv.clk; vv.per = comp.status.period || vv.per;
      if (comp.status.type && comp.status.type.state) vv.st = comp.status.type.state;
    }

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
    // a ESPN manda { didSub: false } para quem não foi substituído: só conta se didSub for verdadeiro
    const trocou = (x) => x === true || !!(x && x.didSub === true);
    const est = (pl, n) => { const s = (pl.stats || []).find((x) => x.name === n); return s ? Number(s.value) || 0 : 0; };
    let esc = null;
    for (const t of r.rosters || []) {
      if (!t.roster || !t.roster.length) continue;
      const l = t.homeAway === "home" ? "h" : "a";
      esc = esc || {};
      esc[l] = {
        form: t.formation || "",
        jog: t.roster.map((pl) => ({
          id: pl.athlete && pl.athlete.id,
          n: (pl.athlete && pl.athlete.displayName) || "?", nc: (pl.athlete && (pl.athlete.shortName || pl.athlete.lastName)) || "",
          num: pl.jersey || "", pos: (pl.position && pl.position.abbreviation) || "",
          tit: !!pl.starter, ent: trocou(pl.subbedIn), sai: trocou(pl.subbedOut), ordem: Number(pl.formationPlace) || 99,
          g: est(pl, "totalGoals"), a: est(pl, "goalAssists"), am: est(pl, "yellowCards"), vm: est(pl, "redCards"), ch: est(pl, "totalShots"),
        })),
      };
    }

    const pr = montarPressao(r, ladoDe, vv);
    const antes = JSON.stringify([vv.ev, vv.es, vv.esc && Object.keys(vv.esc), vv.pr && [vv.pr.h, vv.pr.a, vv.pr.ev.length], vv.clk]);
    vv.ev = ev; vv.es = es; vv.esc = esc; vv.pr = pr; vv.emDet = new Date().toISOString();
    if (pr) recalcularAtual(p);
    if (temGol1T || (p.s === "IN_PLAY" && vv.per >= 2) || p.s === "FINISHED") { p.hh = hh; p.ha = ha; }
    return antes !== JSON.stringify([vv.ev, vv.es, vv.esc && Object.keys(vv.esc), vv.pr && [vv.pr.h, vv.pr.a, vv.pr.ev.length], vv.clk]);
  }

  // ---------- números dos jogadores na temporada (elenco do time na ESPN, na competição do jogo)
  function lerElenco(j) {
    const jog = {};
    for (const a of (j && j.athletes) || []) {
      const s = {};
      for (const c of (a.statistics && a.statistics.splits && a.statistics.splits.categories) || []) for (const x of c.stats || []) s[x.name] = Number(x.value) || 0;
      jog[a.id] = {
        n: a.displayName, nc: a.shortName || a.lastName || a.displayName, num: a.jersey || "", pos: (a.position && a.position.abbreviation) || "",
        jg: s.appearances || 0, g: s.totalGoals || 0, a: s.goalAssists || 0, cg: s.shotsOnTarget || 0, ch: s.totalShots || 0,
        am: s.yellowCards || 0, vm: s.redCards || 0, df: s.saves || 0, gs: s.goalsConceded || 0,
      };
    }
    const se = (j && j.season) || {};
    return { em: Date.now(), jog, temporada: se.displayName || "", ano: se.year, tipo: se.type };
  }
  async function atualizarElencos(p) {
    if (!p.vv || !p.vv.espn || !p.vv.tid) return false;
    const lg = p.vv.espn.lg;
    let mudou = false;
    for (const l of ["h", "a"]) {
      const id = p.vv.tid[l];
      if (!id) continue;
      const chave = lg + ":" + id;
      let e = elencos.get(chave);
      if (!e || Date.now() - e.em > ELENCO_VALIDADE) {
        if (e && e.buscando) continue;
        elencos.set(chave, Object.assign(e || {}, { buscando: true, em: Date.now() }));
        const j = await buscarJSON(`${BASE}${lg}/teams/${id}/roster`);
        // se a busca falhar, tenta de novo em 1 minuto (sem apagar o que já tinha)
        e = j ? lerElenco(j) : Object.assign(e && e.jog ? e : { jog: {}, temporada: "" }, { em: Date.now() - ELENCO_VALIDADE + 60e3, buscando: false });
        elencos.set(chave, e);
        if (!j && p.vv.elenco && p.vv.elenco[l] && Object.keys(p.vv.elenco[l].jog).length) continue;
      }
      p.vv.elenco = p.vv.elenco || {};
      const atual = p.vv.elenco[l];
      if (atual !== e && !(atual && Object.keys(atual.jog || {}).length && !Object.keys(e.jog || {}).length)) { p.vv.elenco[l] = e; mudou = true; }
    }
    return mudou;
  }

  // minutos jogados na temporada: a ESPN só dá por atleta (1 consulta cada), então só busca com a aba
  // Escalações aberta, só para os relacionados do jogo (ou o elenco, antes de sair a escalação) e uma vez por sessão
  const tiposCore = new Map(); // "liga:ano:tipo" -> número da fase na API "core" (1 = fase principal)
  function faseCore(lg, ano, tipo) {
    const k = lg + ":" + ano + ":" + tipo;
    if (!tiposCore.has(k)) tiposCore.set(k, (async () => {
      for (let n = 1; n <= 6; n++) {
        const t = await buscarJSON(`${CORE}${lg}/seasons/${ano}/types/${n}`);
        if (!t) break;
        if (String(t.type) === String(tipo)) return n;
      }
      return 1;
    })());
    return tiposCore.get(k);
  }
  async function atualizarMinutos(p) {
    const aba = window.App && window.App.abaAberta && window.App.abaAberta();
    if (aba !== "escalacoes" || !p || !p.vv || !p.vv.elenco || !p.vv.espn) return false;
    const lg = p.vv.espn.lg;
    let mudou = false;
    for (const l of ["h", "a"]) {
      const e = p.vv.elenco[l];
      if (!e || !e.ano || !e.jog) continue;
      const esc = p.vv.esc && p.vv.esc[l];
      const ids = (esc ? esc.jog.map((j) => String(j.id)) : Object.keys(e.jog)).filter((id) => e.jog[id] && e.jog[id].min === undefined);
      if (!ids.length) continue;
      for (const id of ids) e.jog[id].min = e.jog[id].jg ? null : 0; // null = carregando; quem não jogou fica com 0
      const buscar = ids.filter((id) => e.jog[id].min === null);
      if (buscar.length) {
        const n = await faseCore(lg, e.ano, e.tipo);
        for (let i = 0; i < buscar.length; i += 6) {
          await Promise.all(buscar.slice(i, i + 6).map(async (id) => {
            const j = await buscarJSON(`${CORE}${lg}/seasons/${e.ano}/types/${n}/athletes/${id}/statistics`);
            let m = 0;
            for (const c of (j && j.splits && j.splits.categories) || []) for (const x of c.stats || []) if (x.name === "minutes") m = Number(x.value) || 0;
            e.jog[id].min = m;
          }));
        }
      }
      mudou = true;
      redesenhar();
    }
    return mudou;
  }

  // toda busca tem tempo limite: uma resposta que nunca chega não pode travar a atualização automática
  function buscarJSON(url) {
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const limite = setTimeout(() => ctl && ctl.abort(), LIMITE_BUSCA);
    return fetch(url, { cache: "no-store", signal: ctl ? ctl.signal : undefined })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .finally(() => clearTimeout(limite));
  }

  function partidaDe(code, id) {
    const comp = dados.competicoes[code];
    return comp && (comp.partidas || []).find((x) => String(x.i) === String(id));
  }
  function jogoAberto() {
    const a = window.App && window.App.jogoAberto && window.App.jogoAberto();
    if (!a) return null;
    const p = partidaDe(a.code, a.id);
    return p && p.vv && p.vv.espn ? p : null;
  }
  const painelAberto = () => /^#aovivo/.test(location.hash);

  async function atualizarDetalhe(p, forcar) {
    if (!p) return false;
    const chave = p.vv.espn.code + ":" + p.vv.espn.id;
    const ultimo = ultimoDetalhe.get(chave) || 0;
    // jogo encerrado: busca mais uma vez para pegar os últimos lances e o resultado final
    const intervalo = p.vv.st === "in" ? CICLO_VIVO - 1000 : p.vv.st === "pre" ? DETALHE_PRE : p.vv.st === "post" && !p.vv.detFinal ? 0 : Infinity;
    if (!forcar && Date.now() - ultimo < intervalo) return false;
    if (forcar && Date.now() - ultimo < 5000) return false;
    ultimoDetalhe.set(chave, Date.now());
    const r = await buscarJSON(`${BASE}${p.vv.espn.lg}/summary?event=${p.vv.espn.id}`);
    if (!r) { ultimoDetalhe.set(chave, ultimo); return false; } // falhou: tenta de novo no próximo ciclo
    if (p.vv.st === "post") p.vv.detFinal = true;
    return lerDetalhe(r, p);
  }
  // painel ao vivo: detalhe de todos os jogos rolando (e dos que acabaram de terminar, uma vez)
  async function atualizarPainel(forcar) {
    if (!painelAberto()) return false;
    const lista = [];
    for (const code in ESPN) for (const p of ((dados.competicoes[code] || {}).partidas || [])) {
      if (!p.vv || !p.vv.espn) continue;
      if (p.vv.st === "in" || (p.vv.st === "post" && !p.vv.pr && naJanela(p, Date.now()))) lista.push(p);
    }
    const res = await Promise.all(lista.map((p) => atualizarDetalhe(p, forcar && !ultimoDetalhe.has(p.vv.espn.code + ":" + p.vv.espn.id))));
    return res.some(Boolean);
  }

  function agendar(ms) { clearTimeout(timer); timer = setTimeout(ciclo, ms); }
  async function ciclo() {
    // um ciclo ainda rodando: espera; se passou do limite, considera travado e começa outro
    if (rodando && Date.now() - inicioCiclo < CICLO_TRAVADO) return;
    clearTimeout(timer);
    if (document.hidden) { rodando = false; agendar(CICLO_CALMO); return; }
    const meu = ++geracao;
    rodando = true; inicioCiclo = Date.now();
    let proximo = CICLO_CALMO;
    try {
      const buscas = buscasAtivas();
      let mudou = false;
      if (buscas.length) {
        proximo = CICLO_VIVO;
        const placares = await Promise.all(buscas.map(([code, dia]) => buscarJSON(`${BASE}${ESPN[code]}/scoreboard?dates=${dia}`).then((r) => [code, r])));
        if (meu !== geracao) return;
        const ok = placares.some(([, r]) => r);
        falhasSeguidas = ok ? 0 : falhasSeguidas + 1;
        const agoraIndisp = falhasSeguidas >= FALHAS_AVISO;
        if (agoraIndisp !== indisponivel) { indisponivel = agoraIndisp; mudou = true; }
        for (const [code, r] of placares) for (const ev of (r && r.events) || []) if (aplicarPlacar(code, ev)) mudou = true;
        if (marcarSemPar(placares)) mudou = true;
      }
      const p = jogoAberto();
      if (await atualizarDetalhe(p, false)) mudou = true;
      if (p && (await atualizarElencos(p))) mudou = true;
      atualizarMinutos(p); // corre por fora (redesenha sozinho quando termina) para não segurar o ciclo
      if (await atualizarPainel(false)) mudou = true;
      if (meu === geracao && mudou) redesenhar();
    } catch (e) {
      // erro inesperado: não derruba a atualização automática
    } finally {
      if (meu === geracao) { rodando = false; agendar(proximo); }
    }
  }
  // vigia: se um ciclo travar ou o agendamento se perder, recomeça sozinho
  function vigia() {
    if (document.hidden) return;
    const parado = Date.now() - inicioCiclo;
    if ((rodando && parado > CICLO_TRAVADO) || (!rodando && parado > CICLO_CALMO + 15000)) ciclo();
  }
  // voltou para a aba, desbloqueou o celular ou a internet voltou: atualiza na hora
  function acordar() { if (!document.hidden && Date.now() - inicioCiclo > 3000) ciclo(); }

  let pendente = false;
  function redesenhar() {
    const el = document.activeElement;
    const campo = el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) ? el : null;
    // só segura o redesenho em janelas abertas, no painel de filtros ou em campos sem id (seriam perdidos)
    const ocupado = document.querySelector(".modal-fundo, dialog[open]") || (campo && (!campo.id || (campo.closest && campo.closest("#painel-filtros"))));
    if (ocupado) { pendente = true; return; }
    pendente = false;
    // nos outros campos (busca, filtros da lista, data), redesenha e devolve o foco e o cursor
    let ini = null, fim = null;
    if (campo) try { ini = campo.selectionStart; fim = campo.selectionEnd; } catch (e) {}
    if (window.App && window.App.aoVivoAtualizado) window.App.aoVivoAtualizado();
    if (campo) {
      const novo = document.getElementById(campo.id);
      if (novo && novo !== document.activeElement) {
        try { novo.focus({ preventScroll: true }); } catch (e) { novo.focus(); }
        try { if (ini != null) novo.setSelectionRange(ini, fim); } catch (e) {}
      }
    }
  }
  document.addEventListener("focusout", () => { if (pendente) setTimeout(redesenhar, 300); });

  // ao abrir um jogo (ou o painel), busca na hora
  function aoNavegar() {
    setTimeout(async () => {
      const p = jogoAberto();
      const a = await atualizarDetalhe(p, true);
      const b = p ? await atualizarElencos(p) : false;
      if (p) atualizarMinutos(p);
      const c = await atualizarPainel(true);
      if (a || b || c) redesenhar();
    }, 60);
  }

  function iniciar() {
    if (!LIGADO) return;
    dados = (window.App && window.App.dados) || window.DADOS;
    if (!dados || !dados.competicoes) return;
    document.addEventListener("visibilitychange", acordar);
    window.addEventListener("pageshow", acordar);
    window.addEventListener("online", acordar);
    window.addEventListener("focus", acordar);
    setInterval(vigia, 15000);
    window.addEventListener("hashchange", aoNavegar);
    document.addEventListener("click", (e) => { if (e.target.closest && e.target.closest('[data-ir^="jogo/"], [data-abajogo="escalacoes"]')) aoNavegar(); });
    ciclo();
  }

  window.AoVivo = {
    ligado: LIGADO, iniciar, indisponivel: () => indisponivel, _estado: () => ({ rodando, inicioCiclo, falhasSeguidas }), _ciclo: () => ciclo(), _lerDetalhe: lerDetalhe, _lerElenco: lerElenco, _slotDe: slotDe,
    _aplicarPlacar: (code, ev, d) => { dados = d || dados; return aplicarPlacar(code, ev); },
  };
})();
