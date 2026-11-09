/* ScanBall — modo ao vivo com dados públicos da ESPN (sem chave, sem servidor). PÁGINA DE TESTE.
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
  // liga da ESPN de cada competição: a beta 5 grava no próprio dado ("espn"); a football-data usa a tabela acima
  const lgDe = (code) => ((dados && dados.competicoes[code]) || {}).espn || ESPN[code];
  const codigos = () => Object.keys((dados && dados.competicoes) || {}).filter((c) => lgDe(c));
  const CICLO_VIVO = 20000, CICLO_CALMO = 60000, DETALHE_PRE = 120000, ELENCO_VALIDADE = 6 * 3600e3;
  // jogo aberto rolando: a narração da ESPN é buscada a cada 10 s (a lista e o painel seguem a cada 20 s)
  const DETALHE_VIVO = 10000;

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
  // (o formatador é criado uma vez só: criar um por jogo a cada 20 s pesava no celular)
  const FMT_NY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
  const diaESPN = (iso) => FMT_NY.format(new Date(iso)).replace(/-/g, "");

  // jogo na janela: de 75 min antes até 3h30 depois do início; se a football-data ainda não deu o jogo como
  // encerrado, continua acompanhando por até 12 h (até o placar final chegar)
  function naJanela(p, agora) {
    const t = Date.parse(p.d), s = p._orig ? p._orig.s : p.s;
    if (["POSTPONED", "CANCELLED"].includes(s) || agora < t - 75 * 60e3) return false;
    return agora <= t + 3.5 * 3600e3 || (s !== "FINISHED" && agora <= t + 12 * 3600e3);
  }
  function buscasAtivas() {
    const agora = Date.now(), lista = new Map(); // "liga|dia" -> [code, dia]
    for (const code of codigos()) {
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
    if (dados.fonte === "espn") {
      // beta 5: o jogo do site já é o jogo da ESPN (mesmo código)
      const p = (dados.competicoes[code].partidas || []).find((x) => String(x.i) === String(ev.id)) || null;
      if (p) casados.set(chave, p);
      return p;
    }
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
    vv.espn = { lg: lgDe(code), id: ev.id, code };
    vv.tid = { h: casa.team && casa.team.id, a: fora.team && fora.team.id };
    vv.st = tp.state;
    vv.clk = st.displayClock || ""; vv.per = st.period || 0;
    vv.fonte = "ESPN";
    vv.em = new Date().toISOString();
    p.semEspn = false;
    if (tp.state === "in") {
      p.s = /HALFTIME/.test(tp.name || "") ? "PAUSED" : "IN_PLAY";
      p.fh = Number(casa.score); p.fa = Number(fora.score);
      // a 5Dollar atualiza o placar a cada 8 s (a ESPN, a cada 20 s): enquanto ela estiver em dia, o placar é o dela
      const d5p = vv.d5Placar;
      if (d5p && Date.now() - d5p.em < 45000) { p.fh = d5p.h; p.fa = d5p.a; }
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
      // falta sofrida perto da área (último quarto do campo) pesa o dobro: é bola parada perigosa
      // (a posição da ESPN vem do ponto de vista de quem cometeu a falta)
      let w = 0;
      if (k === "falta") { const fx = Number(pl.fieldPositionX); if (pl.fieldPositionX != null && !isNaN(fx) && 100 - fx >= 75) w = 1; }
      brutos.push({ s, l, k, w, j: j || "", x: extra, min: (c.time && c.time.displayValue) || "", seq: c.sequence });
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
      if (PESO[e.k]) pr[e.l][i] = Math.round((pr[e.l][i] + (e.w || PESO[e.k])) * 10) / 10;
      pr.ultimo = Math.max(pr.ultimo, i);
      if (e.k !== "falta" && e.k !== "imped") pr.ev.push({ i, l: e.l, k: e.k, j: e.j, x: e.x, min: e.min });
    }
    pr.idx = idx;
    return pr;
  }
  // ---------- radar: os últimos lances da narração, com a posição no campo
  // A ESPN dá a posição (0–100) do ponto de vista de quem fez o lance (sempre atacando para a direita);
  // o site espelha os do visitante para desenhar os dois times no mesmo campo.
  const TIPOS_RADAR = { gol: 1, alvo: 1, fora: 1, bloq: 1, trave: 1, esc: 1, imped: 1, amarelo: 1, vermelho: 1, "2amarelo": 1, sub: 1 };
  function montarLances(r, ladoDe) {
    const lista = [];
    for (const c of r.commentary || []) {
      const pl = c.play;
      if (!pl || !pl.type) continue;
      const t = pl.type.type || "", min = (c.time && c.time.displayValue) || "";
      const l = ladoDe(pl.team);
      if (!l) {
        // marcos do jogo, sem time
        const marco = { kickoff: "Começa o jogo", halftime: "Fim do 1º tempo", "start-2nd-half": "Começa o 2º tempo", "end-regular-time": "Fim do tempo normal", "full-time": "Fim de jogo" }[t];
        if (marco) lista.push({ seq: Number(c.sequence) || 0, k: "marco", min, txt: marco });
        continue;
      }
      let k = classificar(t, c.text);
      if (t === "foul" && !k) {
        // só usamos a linha "Fulano (Time) wins a free kick ...": diz quem sofreu e onde
        if (!/wins a free kick/i.test(c.text || "")) continue;
        k = "faltaDef";
      }
      if (!k || !(TIPOS_RADAR[k] || k === "falta" || k === "faltaDef")) continue;
      const lado = k === "falta" || k === "faltaDef" ? (l === "h" ? "a" : "h") : l;
      const part = (pl.participants || []).map((x) => x.athlete && x.athlete.displayName).filter(Boolean);
      const j = k === "sub" ? part[0] || "" : k === "falta" || k === "faltaDef" ? (String(c.text || "").match(/^(.+?)\s+\(/) || [])[1] || "" : jogadorDe(c.text);
      const onde = /attacking half/i.test(c.text || "") ? "ataque" : /wing/i.test(c.text || "") ? "ponta" : /defensive half/i.test(c.text || "") ? "defesa" : "";
      const num = (v) => (v == null || isNaN(Number(v)) ? null : Number(v));
      lista.push({
        seq: Number(c.sequence) || 0, k: k === "faltaDef" ? "falta" : k, l: lado, j, j2: k === "sub" ? part[1] || "" : "", min, onde,
        own: t === "own-goal", pen: /penalty/.test(t),
        // posição: a falta vem do ponto de vista de quem cometeu; o site guarda do ponto de vista de quem fez o lance
        x: num(pl.fieldPositionX), y: num(pl.fieldPositionY), x2: num(pl.fieldPosition2X), y2: num(pl.fieldPosition2Y), ref: l,
      });
    }
    lista.sort((a, b) => a.seq - b.seq);
    return lista.slice(-40);
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

  // ---------- narração do 365Scores no gráfico e na lista
  // O 365Scores publica a MESMA narração da ESPN (mesmo texto, em inglês com lang=1), uns 30–60 s antes.
  // Medido em 05/11/2026 (Cruzeiro x Bahia): escanteio registrado 00:51:30 → 365 +68 s, ESPN +107 s.
  // O site junta as duas: o que a ESPN já tem fica da ESPN (minuto exato dos acréscimos); o que só o 365
  // tem entra na hora. Quando a ESPN publica o mesmo lance, ele é trocado sem duplicar. Se o 365 falhar, fica só a ESPN.
  const resumos = new Map(); // "code:idESPN" -> { com: narração da ESPN, ladoDe }
  const pbp365 = new Map();  // "code:idESPN" -> { msgs, assin }
  const chaveJogo = (p) => p.vv.espn.code + ":" + p.vv.espn.id;
  const textoChave = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const outro = (l) => (l === "h" ? "a" : l === "a" ? "h" : null);
  // tipo do lance (nomes do 365Scores) -> tipo da ESPN, para usar as mesmas regras
  function tipo365(nome) {
    const n = String(nome || "").toLowerCase().trim();
    if (n === "goal") return "goal";
    if (n === "own goal") return "own-goal";
    if (/penalty/.test(n)) return /goal|scored/.test(n) ? "penalty---scored" : /saved/.test(n) ? "penalty---saved" : /miss/.test(n) ? "penalty---missed" : null;
    if (n === "attempt saved") return "shot-on-target";
    if (n === "attempt blocked") return "shot-blocked";
    if (n === "miss") return "shot-off-target";
    if (/post|woodwork|crossbar/.test(n)) return "shot-hit-woodwork";
    if (n === "corner") return "corner-awarded";
    if (n === "offside") return "offside";
    if (/second ?yellow/.test(n)) return "yellow-red-card";
    if (n === "yellow card") return "yellow-card";
    if (n === "red card") return "red-card";
    if (n === "substitution") return "substitution";
    if (n === "free kick won" || n === "free kick lost") return "foul";
    return null;
  }
  // de que time é o lance, pelo texto ("Corner, Bahia. Conceded by..." / "Fulano (Bahia) ...")
  function ladoDoTexto(txt, p) {
    let m = txt.match(/^(?:Corner|Offside),\s*(.+?)\.\s+(?:Conceded by|.+ is caught offside)/i) || txt.match(/^Substitution,\s*(.+?)\.\s+.+ replaces /i);
    let nome = m && m[1], contra = false;
    if (!nome && (m = txt.match(/^Own Goal by .+?,\s*(.+?)\.\s/i))) { nome = m[1]; contra = true; }
    if (!nome && (m = txt.match(/\(([^()]+)\)/))) nome = m[1];
    if (!nome) return null;
    const T = dados.times || {}, n365 = p.vv.n365 || [];
    const tk = tokens(nome);
    const sh = parecido(tk, tokens([(T[p.h] || {}).n, (T[p.h] || {}).c, (T[p.h] || {}).t, n365[0]].join(" ")));
    const sa = parecido(tk, tokens([(T[p.a] || {}).n, (T[p.a] || {}).c, (T[p.a] || {}).t, n365[1]].join(" ")));
    const l = sh > sa ? "h" : sa > sh ? "a" : null;
    return l ? { l, contra } : null;
  }
  // mensagem do 365Scores -> item no formato da narração da ESPN
  function converter365(m, p) {
    const txt = String(m.Comment || "");
    const t = tipo365(m.TypeName);
    if (!t || !txt || m.Timeline == null || m.Timeline === "") return null;
    const per = Number(m.Period) || null;
    const ad = String(m.TimeLineSecondaryText || "").match(/\d+/);
    const tempo = String(m.Timeline).replace(/'/g, "") + "'" + (ad ? "+" + ad[0] + "'" : "");
    const dt = ladoDoTexto(txt, p);
    let l = dt ? dt.l : m.CompetitorNum === 1 ? "h" : m.CompetitorNum === 2 ? "a" : null;
    if (!l) return null;
    // mesmas convenções da ESPN: gol contra é do time beneficiado; "Fulano (Time) wins a free kick" é do time que fez a falta
    if (t === "own-goal" && (!dt || dt.contra)) l = outro(l);
    if (t === "foul" && /wins a free kick/i.test(txt)) l = outro(l);
    let participants;
    if (t === "substitution") {
      const s = txt.match(/\.\s+(.+?) replaces (.+?)\.?\s*$/);
      const pl = m.Players || [];
      const ent = s ? s[1] : (pl[0] || {}).PlayerName, sai = s ? s[2] : (pl[1] || {}).PlayerName;
      participants = [ent, sai].filter(Boolean).map((n) => ({ athlete: { displayName: n } }));
    }
    return {
      _id: Number(m.Id) || 0, _365: true, text: txt, sequence: Number(m.Id) || 0, time: { displayValue: tempo },
      play: { type: { type: t }, team: { lado: l }, period: { number: per }, clock: { displayValue: tempo }, participants },
    };
  }
  // identidade do lance para achar o mesmo nas duas fontes: texto, e (se o texto mudou um pouco) tipo + lado + jogador.
  // O minuto pode diferir em 1 (ex.: 365 "26", ESPN "27'"), então ele é comparado com folga.
  function identidade(c, ladoDe) {
    const pl = c.play || {};
    let t = (pl.type && pl.type.type) || "";
    if (/^goal(---|$)|^own-goal$|^penalty---scored$/.test(t)) t = "gol";
    const m = String((c.time && c.time.displayValue) || "").match(/\d+/);
    return {
      tx: textoChave(c.text), min: m ? Number(m[0]) : null, per: (pl.period && pl.period.number) || null,
      k: t ? [t, ladoDe(pl.team) || "", textoChave(jogadorDe(c.text))].join("|") : "",
    };
  }
  const mesmoTempo = (a, b) => (a.per == null || b.per == null || a.per === b.per) && (a.min == null || b.min == null || Math.abs(a.min - b.min) <= 1);
  // lances do 365Scores que a ESPN ainda não publicou
  function soNo365(p, msgs, res) {
    const ladoE = res ? res.ladoDe : (t) => (t && t.lado) || null;
    const ladoC = (t) => (t && t.lado) || null;
    let maxSeq = 0;
    const espn = ((res && res.com) || []).map((c) => {
      const s = Number(c.sequence) || 0;
      maxSeq = Math.max(maxSeq, s);
      return Object.assign(identidade(c, ladoE), { s, usado: false });
    });
    const conv = msgs.map((m) => converter365(m, p)).filter(Boolean).sort((a, b) => a._id - b._id)
      .map((c) => ({ c, id: identidade(c, ladoC) }));
    const achar = (x, campo) => espn.find((e) => !e.usado && e[campo] && e[campo] === x[campo] && mesmoTempo(e, x));
    // 1º: mesmo texto (o caso normal); 2º: mesmo tipo + lado + jogador
    let desloc = null;
    const sobra = [];
    for (const o of conv) {
      const e = achar(o.id, "tx");
      if (e) { e.usado = true; desloc = e.s - o.c._id; } else sobra.push(o);
    }
    const novos = [];
    for (const o of sobra) {
      const e = achar(o.id, "k");
      if (e) { e.usado = true; continue; }
      o.c.sequence = desloc != null ? o.c._id + desloc : maxSeq + o.c._id;
      novos.push(o.c);
    }
    return novos;
  }
  function montarMisturado(p) {
    const ch = chaveJogo(p), res = resumos.get(ch), pb = modoDe(p) === "365" ? pbp365.get(ch) : null;
    const extra = pb ? soNo365(p, pb.msgs, res) : [];
    const r = { commentary: ((res && res.com) || []).concat(extra) };
    const ladoDe = res ? res.ladoDe : (t) => (t && t.lado) || null;
    p.vv.lances365 = extra.length;
    return { pr: montarPressao(r, ladoDe, p.vv), lances: montarLances(r, ladoDe) };
  }
  // chegou narração nova do 365Scores: refaz gráfico e lista sem esperar a ESPN
  function aplicarMistura(p) {
    const vv = p.vv;
    const sig = () => JSON.stringify([vv.pr && [vv.pr.h, vv.pr.a, vv.pr.ev.length], vv.lances && vv.lances.length && vv.lances[vv.lances.length - 1].seq]);
    const antes = sig();
    const { pr, lances } = montarMisturado(p);
    if (!pr && !vv.pr) return false;
    vv.pr = pr; vv.lances = lances;
    if (pr) recalcularAtual(p);
    conferirRapidos(p);
    return antes !== sig();
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
    // t.lado: lances convertidos da narração do 365Scores já vêm com o lado
    const ladoDe = (t) => (t ? t.lado || lado[t.id] || lado[t.displayName] : null);
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

    // gráfico e lista: narração da ESPN + lances que o 365Scores já publicou e a ESPN ainda não
    resumos.set(chaveJogo(p), { com: r.commentary || [], ladoDe });
    const { pr, lances } = montarMisturado(p);
    const antes =JSON.stringify([vv.ev, vv.es, vv.esc && Object.keys(vv.esc), vv.pr && [vv.pr.h, vv.pr.a, vv.pr.ev.length], vv.clk, vv.lances && vv.lances.length && vv.lances[vv.lances.length - 1].seq]);
    vv.ev = ev; vv.es = es; vv.esc = esc; vv.pr = pr; vv.lances = lances; vv.emDet = new Date().toISOString();
    if (pr) recalcularAtual(p);
    conferirRapidos(p);
    if (temGol1T || (p.s === "IN_PLAY" && vv.per >= 2) || p.s === "FINISHED") { p.hh = hh; p.ha = ha; }
    return antes !== JSON.stringify([vv.ev, vv.es, vv.esc && Object.keys(vv.esc), vv.pr && [vv.pr.h, vv.pr.a, vv.pr.ev.length], vv.clk, vv.lances && vv.lances.length && vv.lances[vv.lances.length - 1].seq]);
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
        if (!j && p.vv.elenco && p.vv.elenco[l] && Object.keys(p.vv.elenco[l].jog || {}).length) continue;
      }
      // outra busca deste elenco ainda está no meio do caminho: espera ela terminar
      if (!e || !e.jog) continue;
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
    const intervalo = p.vv.st === "in" ? DETALHE_VIVO - 1000 : p.vv.st === "pre" ? DETALHE_PRE : p.vv.st === "post" && !p.vv.detFinal ? 0 : Infinity;
    if (!forcar && Date.now() - ultimo < intervalo) return false;
    if (forcar && Date.now() - ultimo < 5000) return false;
    ultimoDetalhe.set(chave, Date.now());
    const r = await buscarJSON(`${BASE}${p.vv.espn.lg}/summary?event=${p.vv.espn.id}`);
    if (!r) { ultimoDetalhe.set(chave, Date.now() - Math.max(0, intervalo - 5000)); return false; } // falhou: tenta de novo em ~5 s
    if (p.vv.st === "post") p.vv.detFinal = true;
    return lerDetalhe(r, p);
  }
  // painel ao vivo: detalhe de todos os jogos rolando (e dos que acabaram de terminar, uma vez)
  // ---------- 365Scores: ataques, xG e estatísticas ao vivo (atualiza a cada ~6 s)
  // API pública do app 365Scores (sem chave, em português). Testada em 05/11/2026: o contador de ataques
  // muda em segundos. Ela dá o TOTAL de ataques; o site registra quantos entraram em cada minuto enquanto
  // o jogo está aberto (e guarda na sessão, para não perder ao recarregar). Se falhar, fica tudo como antes (ESPN).
  const S365 = "https://webws.365scores.com/web/";
  const Q365 = "appTypeId=5&langId=31&timezoneName=America/Sao_Paulo&userCountryId=21";
  const CICLO_365 = 6000;
  let lista365 = null, lista365Em = 0;
  const par365 = new Map(); // "code:idESPN" -> id do jogo no 365Scores (0 = não achou)
  async function jogos365() {
    if (lista365 && Date.now() - lista365Em < 90000) return lista365;
    const r = await buscarJSON(`${S365}games/current/?${Q365}&sports=1`);
    if (r && r.games) { lista365 = r.games; lista365Em = Date.now(); }
    return lista365;
  }
  async function idDo365(p) {
    const ch = p.vv.espn.code + ":" + p.vv.espn.id;
    if (par365.has(ch)) return par365.get(ch);
    const lista = await jogos365();
    if (!lista) return 0;
    const T = dados.times || {}, nome = (id) => [(T[id] || {}).n, (T[id] || {}).c, (T[id] || {}).t].join(" ");
    const th = tokens(nome(p.h)), ta = tokens(nome(p.a)), quando = Date.parse(p.d);
    let melhor = 0, nota = 0;
    for (const g of lista) {
      const dif = Math.abs(Date.parse(g.startTime) - quando);
      if (!(dif <= 3 * 3600e3)) continue;
      const hc = g.homeCompetitor || {}, ac = g.awayCompetitor || {};
      const sh = parecido(th, tokens(hc.name + " " + (hc.shortName || "") + " " + (hc.symbolicName || "")));
      const sa = parecido(ta, tokens(ac.name + " " + (ac.shortName || "") + " " + (ac.symbolicName || "")));
      if (!sh || !sa) continue;
      const n = sh + sa - dif / 86400e3;
      if (n > nota) { melhor = g.id; nota = n; }
    }
    // só guarda "não achou" quando a lista já tem jogos daquele horário (evita desistir cedo demais)
    if (melhor || Date.now() > quando + 30 * 60e3) par365.set(ch, melhor);
    return melhor;
  }
  const num365 = (v) => { const m = String(v == null ? "" : v).replace(",", ".").match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
  const EST_365 = { "Gols esperados (xG)": "xg", "Ataque": "atk", "Chances perigosas criadas": "cp", "Posse de Bola": "posse", "Total de chutes": "chutes",
    "Chutes no gol": "alvo", "Escanteios": "esc", "Trave": "trave", "Faltas": "faltas", "Cartões amarelos": "amarelos", "Cartões vermelhos": "vermelhos",
    "Impedimentos": "imped", "Defesas do goleiro": "defesas", "Total de passes": "passes" };
  function chaveSessao(gid, tipo) { return "sb365" + (tipo || "") + "_" + gid; }
  function lerSessao(gid, tipo) { try { return JSON.parse(sessionStorage.getItem(chaveSessao(gid, tipo)) || "null"); } catch (e) { return null; } }
  function gravarSessao(gid, obj, tipo) { try { sessionStorage.setItem(chaveSessao(gid, tipo), JSON.stringify(obj)); } catch (e) {} }
  const ultimo365 = new Map();
  async function atualizar365(p, forcar) {
    if (!p || !p.vv || !p.vv.espn || p.vv.st !== "in") return false;
    const ch = p.vv.espn.code + ":" + p.vv.espn.id;
    const modo = modoDe(p), reserva = modo === "365";
    // com a 5Dollar como principal, o 365Scores só entra com o xG: a cada 30 s basta
    if (!forcar && Date.now() - (ultimo365.get(ch) || 0) < (reserva ? CICLO_365 : 30000) - 500) return false;
    ultimo365.set(ch, Date.now());
    const gid = await idDo365(p);
    if (!gid) return false;
    const r = await buscarJSON(`${S365}game/stats/?${Q365}&games=${gid}`);
    if (!r || !r.statistics) return false;
    const g = (r.games || [])[0] || {};
    const idCasa = (g.homeCompetitor || {}).id;
    const es = {};
    for (const x of r.statistics) {
      const k = EST_365[x.name];
      if (!k) continue;
      const v = num365(x.value);
      if (v == null) continue;
      es[k] = es[k] || [null, null];
      es[k][x.competitorId === idCasa ? 0 : 1] = v;
    }
    const vv = p.vv;
    const antes = JSON.stringify([vv.es365, vv.atk && vv.atk.ult, vv.pas && vv.pas.ult]);
    vv.es365 = es;
    vv.id365 = gid;
    vv.temAtk = !!es.atk; // algumas ligas (ex.: Brasileirão) não têm o contador de ataques no 365Scores
    vv.n365 = [(g.homeCompetitor || {}).name || "", (g.awayCompetitor || {}).name || ""];
    vv.em365 = new Date().toISOString();
    // ataques por minuto: a diferença entre uma leitura e outra entra no minuto atual
    const atk = (vv.atk = vv.atk || lerSessao(gid) || { h: {}, a: {}, ult: null, desde: new Date().toISOString() });
    const tot = es.atk ? [es.atk[0] || 0, es.atk[1] || 0] : null;
    const s = slotDe(g.gameTimeDisplay || vv.clk, vv.per);
    if (tot && s) {
      const k = chaveSlot(s);
      if (atk.ult && reserva) {
        for (const [i, l] of [[0, "h"], [1, "a"]]) {
          const d = tot[i] - atk.ult[i];
          if (d > 0 && d < 20) atk[l][k] = (atk[l][k] || 0) + d;
        }
      }
      atk.ult = tot;
      gravarSessao(gid, atk);
    }
    // passes por minuto (quem está com a bola agora): a diferença entre uma leitura e outra entra no minuto atual
    const tp = es.passes && es.passes[0] != null && es.passes[1] != null ? [es.passes[0], es.passes[1]] : null;
    vv.temPas = !!tp;
    if (tp && s) {
      const pas = (vv.pas = vv.pas || lerSessao(gid, "p") || { h: {}, a: {}, ult: null });
      const k = chaveSlot(s);
      if (pas.ult && reserva) {
        for (const [i, l] of [[0, "h"], [1, "a"]]) {
          const d = tp[i] - pas.ult[i];
          if (d > 0 && d < 120) pas[l][k] = (pas[l][k] || 0) + d;
        }
      }
      if (!pas.ult || String(pas.ult) !== String(tp)) { pas.ult = tp; gravarSessao(gid, pas, "p"); }
    }
    const num = (x) => (x == null || x === "" || isNaN(Number(x)) || Number(x) < 0 ? null : Number(x));
    const gh = num((g.homeCompetitor || {}).score), ga = num((g.awayCompetitor || {}).score);
    const rapMudou = contarFonte(p, "365", { gol: gh != null && ga != null ? [gh, ga] : null, alvo: es.alvo, chutes: es.chutes, trave: es.trave, esc: es.esc }, s, !reserva);
    return rapMudou || antes !== JSON.stringify([vv.es365, vv.atk && vv.atk.ult, vv.pas && vv.pas.ult]);
  }

  // ---------- lances rápidos: os CONTADORES do 365Scores (chutes, chutes no gol, trave, escanteios, placar)
  // mudam antes da narração chegar. Quando um contador sobe, entra na hora uma marca "provisória" no minuto
  // atual do gráfico; quando a narração (ESPN ou 365Scores) traz o mesmo lance, a provisória sai e fica o lance
  // de verdade (com jogador e minuto exato). O site também mede quantos segundos o contador chegou antes.
  const COMPAT_CHUTE = { alvo: 1, trave: 1, fora: 1, bloq: 1 };
  const combina = (kp, kn) => kp === kn || (kp === "fora" && kn === "bloq") || (COMPAT_CHUTE[kp] && COMPAT_CHUTE[kn]) || (kp === "vermelho" && kn === "2amarelo");
  // lances da narração que "baixam" um lance do contador (chutes, escanteios, gols, cartões, substituições)
  const CONTAVEIS = { gol: 1, alvo: 1, trave: 1, fora: 1, bloq: 1, esc: 1, amarelo: 1, vermelho: 1, "2amarelo": 1, sub: 1 };
  const minutoDe = (sl) => (sl ? { per: sl.per, m: sl.b + sl.ad } : null);
  const perto = (a, b) => a && b && Math.abs(a.m - b.m) <= 3 && (a.per === b.per || Math.abs(a.m - b.m) <= 1);
  function lerRap(ch) { try { return JSON.parse(sessionStorage.getItem("sbrap_" + ch) || "null"); } catch (e) { return null; } }
  function gravarRap(ch, rap) { try { sessionStorage.setItem("sbrap_" + ch, JSON.stringify(rap)); } catch (e) {} }
  function registrarMedida(rap, k, seg) {
    rap.med.push({ k, seg: Math.round(seg) });
    if (rap.med.length > 80) rap.med.shift();
  }
  // contadores de uma FONTE (365Scores ou 5DollarFootballAPI): quando sobem, viram lance provisório.
  // cur = { gol: placar, alvo: chutes no gol, chutes: total de chutes OU fora: chutes para fora, trave, esc }
  // Se as duas fontes registram o mesmo lance, ele vale uma vez só, e o site anota qual chegou primeiro.
  const NOME_FONTE = { "365": "365Scores", "5d": "5Dollar" };
  function contarFonte(p, fonte, cur, sl, soBase) {
    const vv = p.vv, ch = chaveJogo(p);
    const rap = (vv.rap = vv.rap || lerRap(ch) || { ult: {}, pend: [], med: [], vistos: {}, semPar: [], corrida: [], ok: false, id: 0, ini: Date.now() });
    if (!rap.ult || Array.isArray(rap.ult) || rap.ult.gol !== undefined) rap.ult = {}; // formato antigo
    rap.corrida = rap.corrida || [];
    const ult = rap.ult[fonte];
    if (!ult || soBase) { rap.ult[fonte] = Object.assign({}, ult || {}, cur); if (!ult) conferirRapidos(p); gravarRap(ch, rap); return false; } // 1ª leitura (ou fonte de reserva parada): só o ponto de partida
    const agora = Date.now(), mm = minutoDe(sl);
    rap.semPar = rap.semPar.filter((x) => agora - x.t < 5 * 60e3);
    let mudou = false;
    const nova = (l, k) => rap.pend.push({ id: ++rap.id, l, k, per: mm.per, m: mm.m, r: sl.ad ? sl.b + "+" + sl.ad : String(sl.b), t: agora, src: { [fonte]: agora } });
    [["h", 0], ["a", 1]].forEach(([l, i]) => {
      const d = (k) => (cur[k] && ult[k] && cur[k][i] != null && ult[k][i] != null ? cur[k][i] - ult[k][i] : 0);
      const dg = d("gol"), da = d("alvo"), dc = d("chutes"), df = d("fora"), dt = d("trave"), de = d("esc"), dam = d("amarelo"), dvm = d("vermelho");
      if ([dg, da, dc, df, dt, de, dam, dvm].some((x) => Math.abs(x) > 6)) return; // salto estranho (troca de jogo, correção grande)
      // contador voltou (correção): tira a provisória mais nova daquele tipo que só esta fonte tinha
      for (const [dx, ks] of [[dg, ["gol"]], [da, ["alvo"]], [dt, ["trave"]], [de, ["esc"]], [dam, ["amarelo"]], [dvm, ["vermelho"]]]) {
        for (let n = dx; n < 0; n++) {
          const j = rap.pend.map((x) => x.l === l && ks.includes(x.k) && x.src && x.src[fonte] && Object.keys(x.src).length === 1).lastIndexOf(true);
          if (j >= 0) { rap.pend.splice(j, 1); mudou = true; }
        }
      }
      if (!mm) return;
      const g0 = Math.max(dg, 0), a0 = Math.max(da, 0), t0 = Math.max(dt, 0);
      const novos = [];
      for (let n = 0; n < g0; n++) novos.push("gol");
      for (let n = 0; n < Math.max(a0 - g0, 0); n++) novos.push("alvo");
      for (let n = 0; n < t0; n++) novos.push("trave");
      const nFora = cur.fora ? Math.max(df, 0) : Math.max(dc - Math.max(a0, g0) - t0, 0);
      for (let n = 0; n < nFora; n++) novos.push("fora"); // chute para fora ou bloqueado
      for (let n = 0; n < Math.max(de, 0); n++) novos.push("esc");
      for (let n = 0; n < Math.max(dam, 0); n++) novos.push("amarelo");
      for (let n = 0; n < Math.max(dvm, 0); n++) novos.push("vermelho");
      const golsNarr = vv.pr ? vv.pr.ev.filter((e) => e.l === l && e.k === "gol").length : 0;
      for (const k of novos) {
        // a outra fonte já registrou esse lance? então é o mesmo: só anota quem chegou primeiro
        const outra = rap.pend.find((x) => x.l === l && (k === "gol" ? x.k === "gol" : combina(x.k, k)) && x.src && !x.src[fonte] && agora - x.t < 4 * 60e3);
        if (outra) {
          outra.src[fonte] = agora;
          const prim = Object.keys(outra.src).sort((a, b) => outra.src[a] - outra.src[b])[0];
          rap.corrida.push({ prim, seg: Math.round((agora - outra.t) / 1000) });
          if (rap.corrida.length > 60) rap.corrida.shift();
          mudou = true; continue;
        }
        // gol: o placar manda. Se a narração já tem todos os gols do placar, não precisa de marca
        if (k === "gol") { if (golsNarr < cur.gol[i]) { nova(l, k); mudou = true; } continue; }
        // a narração chegou ANTES do contador? então não cria marca: só anota a medida (negativa)
        const j = rap.semPar.findIndex((x) => x.l === l && combina(k, x.k) && perto(x, mm));
        if (j >= 0) {
          const sp = rap.semPar[j];
          if (sp.jm) { rap.corrida.push({ prim: sp.prim, seg: Math.round((agora - sp.t0) / 1000) }); if (rap.corrida.length > 60) rap.corrida.shift(); }
          else registrarMedida(rap, k, -(agora - sp.t) / 1000);
          rap.semPar.splice(j, 1); mudou = true; continue;
        }
        nova(l, k); mudou = true;
      }
    });
    rap.ult[fonte] = Object.assign({}, ult);
    for (const k in cur) if (cur[k]) rap.ult[fonte][k] = cur[k];
    if (rap.pend.length > 40) rap.pend.splice(0, rap.pend.length - 40);
    if (mudou) conferirRapidos(p);
    gravarRap(ch, rap);
    return mudou;
  }
  // confere a narração: cada lance novo (chute, escanteio, gol) "baixa" a provisória correspondente
  function conferirRapidos(p) {
    const vv = p.vv, pr = vv && vv.pr, rap = vv && vv.rap;
    if (!rap) { if (vv) vv.prov = null; return; }
    if (pr) {
      // conta os lances da narração por time e tipo: quando a conta sobe, chegou lance novo (os mais recentes)
      // (contar em vez de comparar nome/minuto evita "lance novo" falso quando a ESPN substitui a versão do 365Scores)
      const agora = Date.now(), grupos = {};
      for (const e of pr.ev) if (CONTAVEIS[e.k]) (grupos[e.l + e.k] = grupos[e.l + e.k] || []).push(e);
      const vistos = rap.vistos && !Array.isArray(rap.vistos) ? rap.vistos : {};
      for (const g in grupos) {
        const lista = grupos[g].slice().sort((a, b) => a.i - b.i), antes = vistos[g] || 0;
        vistos[g] = lista.length;
        if (!rap.ok) continue;
        for (const e of lista.slice(antes)) {
          const me = minutoDe(pr.slots[e.i]);
          // procura a provisória mais antiga do mesmo time e tipo (ou outro chute) perto desse minuto
          let j = rap.pend.findIndex((x) => x.l === e.l && x.k === e.k && perto(x, me));
          if (j < 0) j = rap.pend.findIndex((x) => x.l === e.l && combina(x.k, e.k) && perto(x, me));
          if (j >= 0) {
            const x = rap.pend[j];
            registrarMedida(rap, x.k, (agora - x.t) / 1000);
            rap.pend.splice(j, 1);
            // a outra fonte ainda não contou esse lance: deixa avisado para ela não criar uma marca repetida
            const prim = x.src ? Object.keys(x.src)[0] : null;
            for (const f of Object.keys(rap.ult || {})) if (x.src && !x.src[f]) rap.semPar.push({ l: e.l, k: x.k, per: me.per, m: me.m, t: agora, jm: true, prim, t0: x.t });
          }
          // lance sem provisória: guarda por 5 min (o contador pode subir depois). Nos primeiros 30 s depois de
          // abrir o jogo a narração ainda está "chegando de uma vez": esses só são contados
          else if (e.k !== "gol" && agora - (rap.ini || 0) > 30000) rap.semPar.push({ l: e.l, k: e.k, per: me.per, m: me.m, t: agora });
        }
      }
      for (const g in vistos) if (!grupos[g]) vistos[g] = 0;
      rap.vistos = vistos;
      rap.ok = true;
    }
    // gol é único: se a narração já tem todos os gols que o placar mostra, o gol do contador sai (mesmo que o
    // minuto da narração e o do contador não batam)
    if (pr && p.fh != null) {
      for (const [l, placar] of [["h", Number(p.fh)], ["a", Number(p.fa)]]) {
        const narr = pr.ev.filter((e) => e.l === l && e.k === "gol").length;
        let sobra = narr + rap.pend.filter((x) => x.l === l && x.k === "gol").length - placar;
        for (let j = rap.pend.length - 1; j >= 0 && sobra > 0; j--) if (rap.pend[j].l === l && rap.pend[j].k === "gol") { rap.pend.splice(j, 1); sobra--; }
      }
    }
    // provisórias que ainda esperam a narração, já na posição do gráfico
    const atual = pr ? (pr.atual == null ? pr.ultimo : pr.atual) : -1;
    vv.prov = pr ? rap.pend.map((x) => {
      let i = pr.idx[x.per + ":" + (x.m > LIM[x.per] ? LIM[x.per] : x.m) + ":" + (x.m > LIM[x.per] ? x.m - LIM[x.per] : 0)];
      // o gráfico ainda não tem aquele minuto (ex.: 45+3, quando a narração não abriu os acréscimos): vai para o
      // minuto mais perto do mesmo tempo — nunca para o minuto atual, senão o lance "anda" junto com o relógio
      if (i == null) {
        let melhor = -1, dif = 1e9;
        pr.slots.forEach((s, j) => { if (s.per !== x.per) return; const d = Math.abs(s.b + s.ad - x.m); if (d < dif) { dif = d; melhor = j; } });
        i = melhor >= 0 ? melhor : Math.max(atual, 0);
      }
      return { i, l: x.l, k: x.k, j: x.j || "", x: x.x || "", min: x.r + "'", prov: true, t: x.t };
    }) : null;
    // medidor: quanto o contador chegou antes da narração (positivo = contador primeiro)
    const cor = rap.corrida || [];
    vv.corrida = cor.length ? { n: cor.length, d5: cor.filter((x) => x.prim === "5d").length, media: Math.round(cor.reduce((a, x) => a + x.seg, 0) / cor.length) } : null;
    const seg = rap.med.map((x) => x.seg);
    vv.medRap = seg.length ? { n: seg.length, media: Math.round(seg.reduce((a, b) => a + b, 0) / seg.length), min: Math.min(...seg), max: Math.max(...seg),
      antes: seg.filter((x) => x > 0).length } : null;
  }
  // narração do 365Scores (lances), a cada 10 s com o jogo aberto
  const CICLO_PBP = 10000;
  const feed365 = new Map(); // id 365 -> { url, em } (url null = jogo sem narração; tenta de novo em 5 min)
  const ultimoPbp = new Map();
  async function atualizarPbp(p, forcar) {
    if (!p || !p.vv || !p.vv.espn || p.vv.st !== "in") return false;
    if (modoDe(p) !== "365") return false; // com a 5Dollar em dia, os nomes vêm da ESPN
    const ch = chaveJogo(p);
    if (!forcar && Date.now() - (ultimoPbp.get(ch) || 0) < CICLO_PBP - 1500) return false;
    ultimoPbp.set(ch, Date.now());
    const gid = await idDo365(p);
    if (!gid) return false;
    let f = feed365.get(gid);
    if (!f || (!f.url && Date.now() - f.em > 5 * 60e3)) {
      const g = await buscarJSON(`${S365}game/?${Q365}&gameId=${gid}`);
      if (!g) return false;
      const u = g.game && g.game.playByPlay && g.game.playByPlay.feedURL;
      // lang=1: a narração em inglês tem o mesmo texto da ESPN (é assim que o site acha o mesmo lance nas duas)
      f = { url: u ? String(u).replace(/^http:/, "https:").replace(/([?&]lang=)\d+/, (x, a) => a + "1") : null, em: Date.now() };
      feed365.set(gid, f);
    }
    if (!f.url) return false;
    const r = await buscarJSON(f.url + "&_=" + Math.floor(Date.now() / 5000));
    if (!r || !Array.isArray(r.Messages)) return false;
    const assin = r.Messages.map((m) => m.Id + "@" + m.LastModified).join(",");
    const ant = pbp365.get(ch);
    p.vv.emPbp = new Date().toISOString();
    if (ant && ant.assin === assin) return false;
    pbp365.set(ch, { msgs: r.Messages, assin });
    p.vv.pbp365 = true;
    return aplicarMistura(p);
  }

  // ---------- 5DollarFootballAPI (teste pessoal): ataques e ataques perigosos do jogo aberto.
  // Só funciona com a chave salva NESTE navegador (nunca vai para o código do site). Plano Pro: 10 pedidos/min
  // por conta -> estatísticas a cada ~8 s (7,5/min) + lista de jogos ao vivo a cada 2 min para achar o jogo.
  const D5 = "https://api.5dollarfootballapi.com/v1/";
  const chave5d = () => { try { return localStorage.getItem("sb_5d_chave") || ""; } catch (e) { return ""; } };
  // servidor do ScanBall na Cloudflare (config.js -> aoVivo5d): busca TODOS os jogos ao vivo de uma vez para
  // todos os visitantes, com a chave escondida. Com ele ligado, a chave pessoal não é usada.
  const WORKER5D = String(((window.SB_CONFIG || {}).aoVivo5d) || "").replace(/\/+$/, "");
  const fonte5d = () => !!WORKER5D || !!chave5d();
  let lista5W = null, lista5WEm = 0, lista5WBusca = null;
  async function listaDoWorker() {
    if (lista5W && Date.now() - lista5WEm < 7000) return lista5W;
    if (!lista5WBusca) lista5WBusca = (async () => {
      try {
        const r = await fetch(WORKER5D + "/ao-vivo", { cache: "no-store" });
        const j = r.ok ? await r.json() : null;
        if (j && j.ok) { lista5W = j.jogos || []; lista5WEm = Date.now(); d5Status.msg = "ok"; d5Status.em = Date.now(); d5Status.servidor = true; }
        else d5Status.msg = "servidor do ao vivo: " + ((j && j.erro) || "erro " + r.status);
      } catch (e) { d5Status.msg = "não consegui falar com o servidor do ao vivo"; }
      lista5WBusca = null;
      return lista5W;
    })();
    return lista5WBusca;
  }
  const d5Status = { msg: "", em: 0 };
  let d5Lista = null, d5ListaEm = 0, d5Pausa = 0;
  const d5Par = new Map(), d5Ult = new Map();
  async function buscar5d(caminho) {
    const k = chave5d();
    if (!k || Date.now() < d5Pausa) return null;
    try {
      const r = await fetch(D5 + caminho, { headers: { Authorization: "Bearer " + k }, cache: "no-store" });
      if (r.status === 429) { const seg = Number(r.headers.get("Retry-After")) || 30; d5Pausa = Date.now() + seg * 1000; d5Status.msg = `limite de pedidos atingido: esperando ${seg} s (tem outra aba do site aberta?)`; return null; }
      if (r.status === 401 || r.status === 403) { d5Pausa = Date.now() + 5 * 60e3; d5Status.msg = `chave recusada (erro ${r.status}); confira a chave`; return null; }
      if (!r.ok) { d5Status.msg = `erro ${r.status} na API`; return null; }
      const j = await r.json();
      d5Status.msg = "ok"; d5Status.em = Date.now();
      return j && j.success ? j : null;
    } catch (e) {
      d5Pausa = Date.now() + 60e3;
      d5Status.msg = "o navegador bloqueou o pedido (a API não aceita chamadas direto do site) ou sem conexão";
      return null;
    }
  }
  // quem manda no ao vivo deste jogo: "5d" (5Dollar em dia), "365" (reserva: 5Dollar sem dados há 2 min,
  // ou sem 5Dollar ligada) ou "espera" (acabou de abrir, esperando a 1ª resposta da 5Dollar)
  const RESERVA_MS = 120000;
  function modoDe(p) {
    const vv = p && p.vv;
    if (vv && vv.passado) return vv.d5 ? "5d" : "365";
    if (!vv || !fonte5d()) return "365";
    const d = vv.d5, agora = Date.now();
    if (d && d.em && agora - d.em < RESERVA_MS) return "5d";
    // servidor/API com erro e nenhum dado deste jogo: não adianta esperar, o 365Scores entra já
    if (!(d && d.em) && d5Status.msg && d5Status.msg !== "ok") return "365";
    if (vv.d5Tentou && agora - vv.d5Tentou > RESERVA_MS) return "365";
    return d && d.em ? "365" : "espera";
  }
  async function idDo5d(p) {
    const ch = chaveJogo(p);
    if (d5Par.get(ch)) return d5Par.get(ch);
    if (WORKER5D) { d5Lista = await listaDoWorker(); if (!d5Lista) return 0; }
    else if (!d5Lista || Date.now() - d5ListaEm > 120000) {
      d5ListaEm = Date.now();
      const r = await buscar5d("fixtures?status=live&per_page=500");
      if (!r) return 0;
      d5Lista = r.data || [];
    }
    const T = dados.times || {}, nome = (id) => [(T[id] || {}).n, (T[id] || {}).c, (T[id] || {}).t].join(" ");
    const th = tokens(nome(p.h)), ta = tokens(nome(p.a)), quando = Date.parse(p.d);
    let melhor = 0, nota = 0;
    for (const g of d5Lista) {
      const dif = Math.abs(Date.parse(g.kickoff_utc) - quando);
      if (!(dif <= 3 * 3600e3)) continue;
      const t = g.teams || {}, sh = parecido(th, tokens((t.home || {}).name)), sa = parecido(ta, tokens((t.away || {}).name));
      if (!sh || !sa) continue;
      const n = sh + sa - dif / 86400e3;
      if (n > nota) { melhor = g.id; nota = n; }
    }
    if (melhor) d5Par.set(ch, melhor);
    return melhor;
  }
  async function atualizar5d(p) {
    if (!fonte5d() || !p || !p.vv || !p.vv.espn || p.vv.st !== "in") return false;
    const ch = chaveJogo(p), vv = p.vv;
    if (!vv.d5Tentou) vv.d5Tentou = Date.now();
    if (Date.now() - (d5Ult.get(ch) || 0) < (WORKER5D ? 5000 : 7500)) return false;
    d5Ult.set(ch, Date.now());
    const id = await idDo5d(p);
    if (!id) { const antes = vv.d5 && vv.d5.semJogo; vv.d5 = vv.d5 && vv.d5.id ? vv.d5 : { semJogo: true }; return !antes; }
    let fx;
    if (WORKER5D) { const lista = await listaDoWorker(); fx = (lista || []).find((x) => x.id === id) || null; if (!fx) d5Par.delete(ch); }
    else { const r = await buscar5d(`fixtures/${id}?include=events,stats`); fx = r && r.data; }
    if (!fx) return false;
    const mudou = lerFx5d(p, id, fx);
    const doHist = p === jogoAberto() ? await completarComHistorico(p, p.vv.d5).catch(() => false) : false;
    return mudou || doHist;
  }
  const par5 = (x) => (x && x.home != null && x.away != null ? [Number(x.home) || 0, Number(x.away) || 0] : null);
  // lê um jogo da 5Dollar: placar, lances (contadores + eventos), ataques por minuto e números do painel
  function lerFx5d(p, id, fx) {
    const vv = p.vv, st = fx.statistics || fx.stats || null, agora = Date.now();
    const d5 = (vv.d5 = vv.d5 && vv.d5.id === id ? vv.d5 : lerSessao(id, "d5") || { id, at: { h: {}, a: {} }, da: { h: {}, a: {} }, ult: null, desde: new Date().toISOString() });
    d5.log = d5.log || []; d5.subs = d5.subs || [];
    let mudou = false;
    // placar: a 5Dollar é a principal (a ESPN não sobrescreve enquanto ela estiver em dia)
    const g = par5(fx.goals);
    if (g) {
      vv.d5Placar = { h: g[0], a: g[1], em: agora };
      if ((p.s === "IN_PLAY" || p.s === "PAUSED") && (p.fh !== g[0] || p.fa !== g[1])) { p.fh = g[0]; p.fa = g[1]; mudou = true; }
    }
    // números completos para o painel de estatísticas (jogo todo / 1º tempo / 2º tempo)
    const fxSig = JSON.stringify([fx.goals, fx.corners, fx.cards, st]);
    if (fxSig !== d5.fxSig) { d5.fxSig = fxSig; d5.fx = { goals: fx.goals, corners: fx.corners, cards: fx.cards, st }; mudou = true; }
    // lances pelos contadores: gol, chute no gol, chute para fora, escanteio, cartões. O minuto é o da própria
    // 5Dollar (o relógio da ESPN às vezes atrasa em ligas menores); sem ele, usa o da ESPN
    const m5 = parseInt(String(fx.status_code || ""), 10);
    const sl = m5 >= 1 && m5 <= 130 ? slotDe(m5 + "'", m5 > 45 || (vv.per || 1) >= 2 ? 2 : 1) || slotDe(vv.clk, vv.per) : slotDe(vv.clk, vv.per);
    const ca = fx.cards || {}, cartao = (k) => (ca.home && ca.away ? [Number(ca.home[k]) || 0, Number(ca.away[k]) || 0] : null);
    if (sl) mudou = contarFonte(p, "5d", { gol: g, alvo: st && par5(st.shots_on_target), fora: st && par5(st.shots_off_target), esc: par5(fx.corners),
      amarelo: cartao("yellow"), vermelho: cartao("red") }, sl) || mudou;
    // substituições (com quem entra e quem sai), pelos eventos
    mudou = subs5d(p, d5, fx.events) || mudou;
    // ataques e ataques perigosos por minuto (+ registro com a hora, para a barra "viva" do minuto atual)
    if (st) {
      const cur = { at: par5(st.attacks), da: par5(st.dangerous_attacks) };
      if (d5.ult && sl) {
        const k = chaveSlot(sl);
        for (const q of ["at", "da"]) {
          if (!cur[q] || !d5.ult[q]) continue;
          for (const [i, l] of [[0, "h"], [1, "a"]]) {
            const d = cur[q][i] - d5.ult[q][i];
            if (d > 0 && d < 40) { d5[q][l][k] = (d5[q][l][k] || 0) + d; d5.log.push({ t: agora, l, q, n: d, k }); mudou = true; if (q === "da") d5.mudDa = agora; }
          }
        }
      }
      d5.ult = { at: cur.at || (d5.ult && d5.ult.at), da: cur.da || (d5.ult && d5.ult.da) };
    }
    d5.log = d5.log.filter((x) => agora - x.t < 180000);
    d5.em = agora;
    gravarSessao(id, d5, "d5");
    return mudou || !vv.d5Ok ? ((vv.d5Ok = true), true) : false;
  }
  // substituição da 5Dollar: entra na lista na hora, já com os nomes (a narração da ESPN só confirma)
  function subs5d(p, d5, eventos) {
    if (!Array.isArray(eventos)) return false;
    const vv = p.vv, ch = chaveJogo(p);
    const rap = (vv.rap = vv.rap || lerRap(ch) || { ult: {}, pend: [], med: [], vistos: {}, semPar: [], corrida: [], ok: false, id: 0, ini: Date.now() });
    const primeira = !d5.subsOk, atual = minutoDe(slotDe(vv.clk, vv.per));
    let mudou = false;
    for (const e of eventos) {
      if (e.type !== "substitution" || (e.team !== "home" && e.team !== "away")) continue;
      const chave = [e.minute, e.team, e.player_in, e.player_out].join("|");
      if (d5.subs.includes(chave)) continue;
      d5.subs.push(chave);
      const m = Number(e.minute) || 0, sl = slotDe(m + "'", m > 45 ? (m > 90 ? 3 : 2) : 1);
      // na 1ª leitura, as trocas antigas a narração já tem: só entram as dos últimos 3 minutos
      if (!sl || (primeira && atual && atual.m - m > 3)) continue;
      const l = e.team === "home" ? "h" : "a", mm = minutoDe(sl);
      const ja = (vv.pr ? vv.pr.ev : []).some((x) => x.k === "sub" && x.l === l && x.j && e.player_in && semAcento(x.j) === semAcento(e.player_in));
      if (ja) continue;
      rap.pend.push({ id: ++rap.id, l, k: "sub", j: e.player_in || "", x: e.player_out ? "sai " + e.player_out : "", per: mm.per, m: mm.m, r: sl.ad ? sl.b + "+" + sl.ad : String(sl.b), t: Date.now(), src: { "5d": Date.now() } });
      mudou = true;
    }
    d5.subsOk = true;
    if (mudou) { conferirRapidos(p); gravarRap(ch, rap); }
    return mudou;
  }
  const semAcento = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");

  // ---------- gráfico de um jogo que já acabou: narração da ESPN (buscada só quando alguém pede) + ataques e
  // ataques perigosos por minuto que o servidor do ScanBall registrou enquanto o jogo estava ao vivo
  const passados = new Map();
  async function graficoPassado(code, p) {
    const comp = dados.competicoes[code] || {};
    const lg = comp.espn || ESPN[code];
    const k = code + ":" + p.i;
    if (passados.has(k)) return passados.get(k);
    const pp = { i: p.i, d: p.d, h: p.h, a: p.a, fh: p.fh, fa: p.fa, hh: p.hh, ha: p.ha, s: "FINISHED",
      vv: { espn: { code: code + "-passado", id: String(p.i), lg }, st: "post", passado: true } };
    const [r, hist] = await Promise.all([lg ? buscarJSON(`${BASE}${lg}/summary?event=${p.i}`) : null, historico5d(p).catch(() => null)]);
    if (r) lerDetalhe(r, pp);
    if (hist) pp.vv.d5 = hist;
    pp.vv.st = "post";
    pp.ok = !!(r || hist);
    if (pp.ok) passados.set(k, pp);
    return pp;
  }
  // minuto a minuto guardado pelo servidor: transforma as "fotos" acumuladas em ataques por minuto do gráfico
  async function historico5d(p) {
    if (!WORKER5D) return null;
    const dia = new Date(p.d).toISOString().slice(0, 10);
    const ind = await buscarJSON(`${WORKER5D}/historico?dia=${dia}`);
    if (!ind || !Array.isArray(ind.jogos) || !ind.jogos.length) return null;
    const T = dados.times || {}, nome = (id) => [(T[id] || {}).n, (T[id] || {}).c, (T[id] || {}).t].join(" ");
    const th = tokens(nome(p.h)), ta = tokens(nome(p.a));
    let melhor = null, nota = 0;
    for (const g of ind.jogos) {
      const sh = parecido(th, tokens(g.h)), sa = parecido(ta, tokens(g.a));
      if (sh && sa && sh + sa > nota) { melhor = g; nota = sh + sa; }
    }
    if (!melhor) return null;
    const j = await buscarJSON(`${WORKER5D}/historico?id=${melhor.id}`);
    if (!j || !j.m) return null;
    const m = fotosParaMinutos(j.m);
    return { id: melhor.id, at: m.at, da: m.da, ult: m.ult, passado: true };
  }
  // "fotos" acumuladas por minuto (servidor) -> ataques e ataques perigosos de cada minuto do gráfico
  function fotosParaMinutos(mapa) {
    const chave = (per, m) => (per === 1 ? (m > 45 ? `1:45:${m - 45}` : `1:${m}:0`) : m > 90 ? `2:90:${m - 90}` : `2:${m}:0`);
    const fotos = Object.entries(mapa).map(([k, v]) => { const [per, m] = k.split(":").map(Number); return { per, m, v }; })
      .sort((a, b) => a.per - b.per || a.m - b.m);
    const out = { at: { h: {}, a: {} }, da: { h: {}, a: {} }, ult: null };
    let ant = null;
    for (const f of fotos) {
      if (ant) for (const q of ["at", "da"]) {
        if (!f.v[q] || !ant[q]) continue;
        [["h", 0], ["a", 1]].forEach(([l, i]) => { const d = f.v[q][i] - ant[q][i]; if (d > 0 && d < 60) out[q][l][chave(f.per, f.m)] = (out[q][l][chave(f.per, f.m)] || 0) + d; });
      }
      ant = f.v;
    }
    out.ult = ant;
    return out;
  }
  // jogo ao vivo aberto depois do começo: completa os minutos anteriores com o que o servidor guardou
  // (só os minutos que este navegador ainda não tem; sem nenhum pedido a mais à 5Dollar)
  const histUlt = new Map();
  async function completarComHistorico(p, d5) {
    if (!WORKER5D || !d5 || !d5.id || Date.now() - (histUlt.get(d5.id) || 0) < 60000) return false;
    histUlt.set(d5.id, Date.now());
    const j = await buscarJSON(`${WORKER5D}/historico?id=${d5.id}`);
    if (!j || !j.m) return false;
    const m = fotosParaMinutos(j.m);
    let mudou = false;
    for (const q of ["at", "da"]) for (const l of ["h", "a"]) for (const k in m[q][l]) {
      const temLocal = (d5.at.h[k] || d5.at.a[k] || d5.da.h[k] || d5.da.a[k]) && !(d5.hist && d5.hist[k]);
      if (temLocal) continue;
      if (d5[q][l][k] !== m[q][l][k]) { d5[q][l][k] = m[q][l][k]; (d5.hist = d5.hist || {})[k] = 1; mudou = true; }
    }
    return mudou;
  }

  let timer365 = null;
  function ciclo365() {
    clearTimeout(timer365);
    const seguir = () => { timer365 = setTimeout(ciclo365, 3000); }; // cada busca respeita o próprio intervalo
    if (document.hidden) return seguir();
    const p = jogoAberto();
    // com o servidor do ScanBall, a 5Dollar atualiza o placar de TODOS os jogos rolando (uma lista só, sem custo a mais)
    const outros = WORKER5D ? jogosRolando().filter((x) => x !== p).map((x) => atualizar5d(x).catch(() => false)) : [];
    const doAberto = p && p.vv.st === "in"
      ? [atualizarDetalhe(p, false).catch(() => false), atualizar365(p, false).catch(() => false), atualizarPbp(p, false).catch(() => false), atualizar5d(p).catch(() => false)]
      : [];
    if (!outros.length && !doAberto.length) return seguir();
    Promise.all(doAberto.concat(outros)).then((m) => { if (m.some(Boolean)) redesenhar(); }).catch(() => {}).finally(seguir);
  }

  function jogosRolando() {
    const lista = [];
    for (const code of codigos()) for (const p of ((dados.competicoes[code] || {}).partidas || [])) if (p.vv && p.vv.espn && p.vv.st === "in") lista.push(p);
    return lista;
  }

  async function atualizarPainel(forcar) {
    if (!painelAberto()) return false;
    const lista = [];
    for (const code of codigos()) for (const p of ((dados.competicoes[code] || {}).partidas || [])) {
      if (!p.vv || !p.vv.espn) continue;
      if (p.vv.st === "in" || (p.vv.st === "post" && !p.vv.pr && naJanela(p, Date.now()))) lista.push(p);
    }
    const res = await Promise.all(lista.map((p) => atualizarDetalhe(p, forcar && !ultimoDetalhe.has(p.vv.espn.code + ":" + p.vv.espn.id))));
    // painel: ataques do 365Scores de todos os jogos rolando (no ritmo do painel, a cada 20 s)
    const r365 = await Promise.all(lista.filter((p) => p.vv.st === "in").map((p) => Promise.all([atualizar365(p, true).catch(() => false), atualizarPbp(p, true).catch(() => false), WORKER5D ? atualizar5d(p).catch(() => false) : false]).then((x) => x.some(Boolean))));
    return res.some(Boolean) || r365.some(Boolean);
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
        const placares = await Promise.all(buscas.map(([code, dia]) => buscarJSON(`${BASE}${lgDe(code)}/scoreboard?dates=${dia}`).then((r) => [code, r])));
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
  function acordar() {
    if (document.hidden) return;
    if (oculto) redesenhar();
    if (Date.now() - inicioCiclo > 3000) ciclo();
  }

  let pendente = false;
  let oculto = false;
  function redesenhar() {
    // aba escondida (outra aba aberta, celular bloqueado): não desenha nada; desenha uma vez ao voltar
    if (document.hidden) { oculto = true; return; }
    oculto = false;
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
      const d = p && p.vv.st === "in" ? (await Promise.all([atualizar365(p, true).catch(() => false), atualizarPbp(p, true).catch(() => false)])).some(Boolean) : false;
      const c = await atualizarPainel(true);
      if (a || b || c || d) redesenhar();
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
    ciclo365();
    window.addEventListener("hashchange", aoNavegar);
    document.addEventListener("click", (e) => { if (e.target.closest && e.target.closest('[data-ir^="jogo/"], [data-abajogo="escalacoes"]')) aoNavegar(); });
    ciclo();
  }

  window.AoVivo = {
    ligado: LIGADO, iniciar, indisponivel: () => indisponivel, _slotKey: (s) => chaveSlot(s), _estado: () => ({ rodando, inicioCiclo, falhasSeguidas }), _ciclo: () => ciclo(), _lerDetalhe: lerDetalhe, _lerElenco: lerElenco, _slotDe: slotDe, d5Status, servidor5d: !!WORKER5D, modoDe, graficoPassado,
    _aplicarPlacar: (code, ev, d) => { dados = d || dados; return aplicarPlacar(code, ev); },
  };
})();
