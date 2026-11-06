/* Estatísticas de Futebol — motor de estatísticas
 * Tudo aqui é calculado a partir dos placares (final e 1º tempo) que o plano grátis entrega.
 * Funciona no navegador (window.Motor) e no Node (module.exports) para testes.
 */
(function (raiz) {
  "use strict";

  const LINHAS = [0.5, 1.5, 2.5, 3.5, 4.5];
  const ELO_INICIAL = 1500, ELO_K = 22, ELO_MANDO = 65;

  // ------------------------------------------------------------ acumuladores
  function bucketVazio() {
    return {
      j: 0, v: 0, e: 0, d: 0, pts: 0,
      gm: 0, gs: 0, gm1: 0, gs1: 0,           // gols marcados/sofridos (total e 1º tempo)
      ov: [0, 0, 0, 0, 0],                     // jogos com total de gols acima de 0.5..4.5
      btts: 0, cs: 0, sm: 0,                   // ambas marcam, sem sofrer, sem marcar
      ht05: 0, ht15: 0, st05: 0, st15: 0,      // 1º tempo / 2º tempo com gols
      v1: 0, e1: 0, d1: 0,                     // resultado no intervalo
      vir: 0, ced: 0,                          // viradas a favor / contra (do intervalo para o final)
      j1: 0,                                    // jogos com placar de 1º tempo conhecido
      m1: 0, s1: 0, m2: 0, s2: 0,               // marcou/sofreu no 1º e no 2º tempo
      gm2: 0, gs2: 0,                           // gols marcados/sofridos no 2º tempo
      btts25: 0,                                // ambas marcam e mais de 2,5
      mp: 0, sp: 0, pdes: 0,                    // marcou primeiro / sofreu primeiro / não dá para saber
      forma: [],                                // últimos resultados ("V","E","D"), mais recente no fim
      // beta 5 (dados da ESPN): gols com minuto e tipo, e estatísticas de cada jogo
      jg: 0,                                    // jogos com a lista de gols (minuto e tipo)
      pm: [0, 0, 0, 0, 0, 0], ps: [0, 0, 0, 0, 0, 0], // gols marcados/sofridos por período (0-15 ... 76-90+)
      tm: novoTipos(), ts: novoTipos(),          // gols marcados/sofridos por tipo
      mpV: 0, mpE: 0, mpD: 0, spV: 0, spE: 0, spD: 0, // resultado quando marcou / sofreu primeiro
      pgMin: 0, pgN: 0,                          // minuto do 1º gol do jogo (soma e quantidade)
      je: 0,                                    // jogos com estatísticas
      escF: 0, escC: 0, amF: 0, amC: 0, vmF: 0, vmC: 0, chF: 0, chC: 0, cgF: 0, cgC: 0, poF: 0, faF: 0, faC: 0,
      esc85: 0, esc95: 0, esc105: 0, cart35: 0, cart45: 0, escMais: 0,
    };
  }
  // tipos de gol: c cabeça · e após escanteio · b bola parada · f falta direta · p pênalti · k contra-ataque ·
  // x de fora da área · r após cruzamento · o gol contra (a favor de quem foi beneficiado)
  function novoTipos() { return { n: 0, c: 0, e: 0, b: 0, f: 0, p: 0, k: 0, x: 0, r: 0, o: 0 }; }
  const PERIODO = (m) => (m <= 15 ? 0 : m <= 30 ? 1 : m <= 45 ? 2 : m <= 60 ? 3 : m <= 75 ? 4 : 5);

  // quem marcou primeiro, pela ordem real dos gols (quando a fonte tem o minuto)
  function primeiroDoJogo(p, casa) {
    if (p && p.gl) {
      if (!p.gl.length) return null;
      return (p.gl[0][1] === "h") === casa ? "eu" : "eles";
    }
    return casa ? primeiroGol(p.fh, p.fa, p.hh, p.ha) : primeiroGol(p.fa, p.fh, p.ha, p.hh);
  }

  function somarExtras(b, p, casa, gm, gs) {
    const eu = casa ? "h" : "a";
    if (p.gl) {
      b.jg++;
      for (const g of p.gl) {
        const meu = g[1] === eu, m = g[0];
        if (m <= 90) (meu ? b.pm : b.ps)[PERIODO(m)]++;
        const T = meu ? b.tm : b.ts;
        T.n++;
        for (const ch of g[2] || "") if (T[ch] != null) T[ch]++;
      }
      if (p.gl.length) {
        b.pgMin += p.gl[0][0]; b.pgN++;
        const primeiro = (p.gl[0][1] === eu);
        const r = gm > gs ? "V" : gm === gs ? "E" : "D";
        b[(primeiro ? "mp" : "sp") + r]++;
      }
    }
    const e = p.es;
    if (e && e[0] != null && e[1] != null) {
      const i = casa ? 0 : 1, o = 1 - i, v = (k) => e[k * 2 + i] || 0, w = (k) => e[k * 2 + o] || 0;
      b.je++;
      b.escF += v(0); b.escC += w(0); b.amF += v(1); b.amC += w(1); b.vmF += v(2); b.vmC += w(2);
      b.chF += v(3); b.chC += w(3); b.cgF += v(4); b.cgC += w(4); b.poF += v(5); b.faF += v(6); b.faC += w(6);
      const esc = v(0) + w(0), cart = v(1) + w(1) + v(2) + w(2);
      if (esc > 8.5) b.esc85++; if (esc > 9.5) b.esc95++; if (esc > 10.5) b.esc105++;
      if (cart > 3.5) b.cart35++; if (cart > 4.5) b.cart45++;
      if (v(0) > w(0)) b.escMais++;
    }
  }

  // Quem marcou primeiro, do ponto de vista do time (gm = gols dele).
  // O plano grátis não tem minuto dos gols, então deduz pelo placar do 1º tempo:
  // "eu", "eles", null (0 x 0) ou "?" quando não dá para saber (ex.: 1 x 1 no intervalo).
  function primeiroGol(gm, gs, gm1, gs1) {
    if (gm + gs === 0) return null;
    if (gs === 0) return "eu";
    if (gm === 0) return "eles";
    if (gm1 == null || gs1 == null) return "?";
    if (gm1 > 0 && gs1 === 0) return "eu";
    if (gs1 > 0 && gm1 === 0) return "eles";
    if (gm1 === 0 && gs1 === 0) {
      const m2 = gm - gm1, s2 = gs - gs1;
      if (m2 > 0 && s2 === 0) return "eu";
      if (s2 > 0 && m2 === 0) return "eles";
    }
    return "?";
  }

  function somarNoBucket(b, gm, gs, gm1, gs1, p, casa) {
    b.j++; b.gm += gm; b.gs += gs;
    const pg = p && p.gl ? primeiroDoJogo(p, casa) : primeiroGol(gm, gs, gm1, gs1);
    if (p) somarExtras(b, p, casa, gm, gs);
    if (pg === "eu") b.mp++; else if (pg === "eles") b.sp++; else if (pg === "?") b.pdes++;
    const tot = gm + gs;
    for (let i = 0; i < LINHAS.length; i++) if (tot > LINHAS[i]) b.ov[i]++;
    if (gm > 0 && gs > 0) { b.btts++; if (tot > 2.5) b.btts25++; }
    if (gs === 0) b.cs++;
    if (gm === 0) b.sm++;
    let r;
    if (gm > gs) { b.v++; b.pts += 3; r = "V"; }
    else if (gm === gs) { b.e++; b.pts += 1; r = "E"; }
    else { b.d++; r = "D"; }
    b.forma.push(r); if (b.forma.length > 10) b.forma.shift();
    if (gm1 != null && gs1 != null) {
      b.j1++; b.gm1 += gm1; b.gs1 += gs1;
      const t1 = gm1 + gs1, t2 = tot - t1;
      if (t1 > 0.5) b.ht05++; if (t1 > 1.5) b.ht15++;
      if (t2 > 0.5) b.st05++; if (t2 > 1.5) b.st15++;
      if (gm1 > gs1) b.v1++; else if (gm1 === gs1) b.e1++; else b.d1++;
      const gm2 = gm - gm1, gs2 = gs - gs1;
      b.gm2 += gm2; b.gs2 += gs2;
      if (gm1 > 0) b.m1++; if (gs1 > 0) b.s1++; if (gm2 > 0) b.m2++; if (gs2 > 0) b.s2++;
      if (gm1 < gs1 && gm > gs) b.vir++;
      if (gm1 > gs1 && gm < gs) b.ced++;
    }
  }

  function copiarBucket(b) {
    const c = Object.assign({}, b);
    c.ov = b.ov.slice(); c.forma = b.forma.slice();
    c.pm = b.pm.slice(); c.ps = b.ps.slice(); c.tm = Object.assign({}, b.tm); c.ts = Object.assign({}, b.ts);
    return c;
  }

  function novoTime() {
    return { geral: bucketVazio(), casa: bucketVazio(), fora: bucketVazio(), elo: ELO_INICIAL, eloHist: [ELO_INICIAL], jogos: [] };
  }

  function fotoTime(t) {
    return { geral: copiarBucket(t.geral), casa: copiarBucket(t.casa), fora: copiarBucket(t.fora), elo: t.elo };
  }

  // estatísticas de um time somando só os jogos passados (ex.: últimos 5 em casa)
  function bucketDeJogos(jogos, tid) {
    const b = bucketVazio();
    for (const p of jogos) {
      if (!encerrada(p)) continue;
      const casa = String(p.h) === String(tid);
      if (casa) somarNoBucket(b, p.fh, p.fa, p.hh, p.ha, p, true);
      else somarNoBucket(b, p.fa, p.fh, p.ha, p.hh, p, false);
    }
    return b;
  }

  // ------------------------------------------------------------ métricas legíveis
  const pct = (a, b) => (b > 0 ? (100 * a) / b : null);
  const med = (a, b) => (b > 0 ? a / b : null);

  function metricas(b) {
    return {
      jogos: b.j,
      vit: pct(b.v, b.j), emp: pct(b.e, b.j), der: pct(b.d, b.j),
      ppj: med(b.pts, b.j),
      gm: med(b.gm, b.j), gs: med(b.gs, b.j), gt: med(b.gm + b.gs, b.j),
      ov05: pct(b.ov[0], b.j), ov15: pct(b.ov[1], b.j), ov25: pct(b.ov[2], b.j),
      ov35: pct(b.ov[3], b.j), ov45: pct(b.ov[4], b.j),
      btts: pct(b.btts, b.j), cs: pct(b.cs, b.j), sm: pct(b.sm, b.j),
      gm1: med(b.gm1, b.j1), gs1: med(b.gs1, b.j1), gt1: med(b.gm1 + b.gs1, b.j1),
      gm2: med(b.gm2, b.j1), gs2: med(b.gs2, b.j1),
      ht05: pct(b.ht05, b.j1), ht15: pct(b.ht15, b.j1), st05: pct(b.st05, b.j1), st15: pct(b.st15, b.j1),
      v1: pct(b.v1, b.j1), e1: pct(b.e1, b.j1), d1: pct(b.d1, b.j1),
      vir: b.vir, ced: b.ced,
      forma: b.forma.slice(-5),
    };
  }
  // gols no 2º tempo exatos quando todos os jogos têm 1º tempo
  function gols2T(b) {
    if (!b.j1) return { gm2: null, gs2: null };
    return { gm2: (b.gm - b.gm1) / b.j1, gs2: (b.gs - b.gs1) / b.j1 };
  }

  // ------------------------------------------------------------ Poisson
  function fatorial(n) { let f = 1; for (let i = 2; i <= n; i++) f *= i; return f; }
  function pPoisson(l, k) { return Math.exp(-l) * Math.pow(l, k) / fatorial(k); }

  function encolher(x, n, peso) { // puxa para 1 quando há poucos jogos
    if (x == null || !isFinite(x)) return 1;
    return (x * n + 1 * peso) / (n + peso);
  }

  function forcas(fh, fa, liga) {
    const Lh = liga.mh || 1.4, La = liga.ma || 1.1, Lt = (Lh + La) / 2;
    const H = fh, A = fa;
    const mix = (lado, ladoDiv, geral, geralDiv) => {
      const a = lado != null ? lado / ladoDiv : null;
      const g = geral != null ? geral / geralDiv : null;
      if (a == null && g == null) return null;
      if (a == null) return g; if (g == null) return a;
      return 0.6 * a + 0.4 * g;
    };
    const nH = H.geral.j, nA = A.geral.j;
    const ataqueH = encolher(mix(med(H.casa.gm, H.casa.j), Lh, med(H.geral.gm, H.geral.j), Lt), nH, 6);
    const defesaH = encolher(mix(med(H.casa.gs, H.casa.j), La, med(H.geral.gs, H.geral.j), Lt), nH, 6);
    const ataqueA = encolher(mix(med(A.fora.gm, A.fora.j), La, med(A.geral.gm, A.geral.j), Lt), nA, 6);
    const defesaA = encolher(mix(med(A.fora.gs, A.fora.j), Lh, med(A.geral.gs, A.geral.j), Lt), nA, 6);
    return { lh: Lh * ataqueH * defesaA, la: La * ataqueA * defesaH, ataqueH, defesaH, ataqueA, defesaA };
  }

  function projetar(fh, fa, liga) {
    const f = forcas(fh, fa, liga);
    const lh = Math.min(Math.max(f.lh, 0.15), 5), la = Math.min(Math.max(f.la, 0.15), 5);
    const N = 10, m = [];
    for (let i = 0; i <= N; i++) { m.push([]); for (let k = 0; k <= N; k++) m[i].push(pPoisson(lh, i) * pPoisson(la, k)); }
    let p1 = 0, px = 0, p2 = 0, btts = 0; const ov = [0, 0, 0, 0, 0]; const placares = [];
    for (let i = 0; i <= N; i++) for (let k = 0; k <= N; k++) {
      const p = m[i][k];
      if (i > k) p1 += p; else if (i === k) px += p; else p2 += p;
      if (i > 0 && k > 0) btts += p;
      for (let j = 0; j < LINHAS.length; j++) if (i + k > LINHAS[j]) ov[j] += p;
      placares.push({ h: i, a: k, p });
    }
    const soma = p1 + px + p2; p1 /= soma; px /= soma; p2 /= soma;
    placares.sort((x, y) => y.p - x.p);
    // 1º tempo: ~44% dos gols saem no 1º tempo
    const l1 = (lh + la) * 0.44;
    const ht05 = 1 - Math.exp(-l1), ht15 = 1 - Math.exp(-l1) * (1 + l1);
    return { lh, la, p1, px, p2, btts, ov, ht05, ht15, placares: placares.slice(0, 6),
             casaMarca: 1 - Math.exp(-lh), foraMarca: 1 - Math.exp(-la) };
  }

  // ------------------------------------------------------------ Elo
  function atualizarElo(th, ta, gh, ga) {
    const esp = 1 / (1 + Math.pow(10, (ta.elo - (th.elo + ELO_MANDO)) / 400));
    const res = gh > ga ? 1 : gh === ga ? 0.5 : 0;
    const dif = Math.abs(gh - ga);
    const mult = dif <= 1 ? 1 : dif === 2 ? 1.5 : (11 + dif) / 8;
    const delta = ELO_K * mult * (res - esp);
    th.elo += delta; ta.elo -= delta;
    th.eloHist.push(th.elo); ta.eloHist.push(ta.elo);
    return delta;
  }

  // ------------------------------------------------------------ preparo da competição
  function encerrada(p) { return p.s === "FINISHED" && p.fh != null && p.fa != null; }

  function prepararCompeticao(comp) {
    const partidas = (comp.partidas || []).slice().sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    const times = {};
    const T = (id) => (times[id] || (times[id] = novoTime()));
    // "foto" de cada time ANTES de cada jogo (é o que o backtest e a prévia usam). Antes era copiada na hora para
    // todos os jogos (milhares de cópias ao abrir o site); agora só guarda quantos jogos o time tinha e monta a foto
    // quando alguém pede (e guarda para a próxima vez). O resultado é o mesmo.
    const marcas = new Map();
    let liga = { gh: 0, ga: 0, n: 0 };
    const ligaMed = () => ({
      mh: liga.n >= 10 ? liga.gh / liga.n : 1.4,
      ma: liga.n >= 10 ? liga.ga / liga.n : 1.1,
      n: liga.n,
    });

    for (const p of partidas) {
      if (p.h == null || p.a == null) continue;
      const th = T(p.h), ta = T(p.a);
      if (!encerrada(p)) continue;
      // foto ANTES do jogo: é isso que o backtest usa, sem olhar o resultado
      marcas.set(String(p.i), { th, ta, nh: th.jogos.length, na: ta.jogos.length, liga: ligaMed() });
      somarNoBucket(th.geral, p.fh, p.fa, p.hh, p.ha, p, true);
      somarNoBucket(th.casa, p.fh, p.fa, p.hh, p.ha, p, true);
      somarNoBucket(ta.geral, p.fa, p.fh, p.ha, p.hh, p, false);
      somarNoBucket(ta.fora, p.fa, p.fh, p.ha, p.hh, p, false);
      const delta = atualizarElo(th, ta, p.fh, p.fa);
      th.jogos.push({ p, casa: true, elo: th.elo, delta });
      ta.jogos.push({ p, casa: false, elo: ta.elo, delta: -delta });
      liga.gh += p.fh; liga.ga += p.fa; liga.n++;
    }
    const prontas = new Map();
    const fotos = new Proxy({}, {
      get(_, k) {
        if (typeof k !== "string") return undefined;
        if (prontas.has(k)) return prontas.get(k);
        const m = marcas.get(k);
        if (!m) return undefined;
        const f = { h: fotoAntes(m.th, m.nh), a: fotoAntes(m.ta, m.na), liga: m.liga };
        prontas.set(k, f);
        return f;
      },
      has(_, k) { return marcas.has(String(k)); },
    });
    return { code: comp.code, partidas, times, fotos, liga: ligaMed(), encerradas: liga.n };
  }

  // números do time somando só os n primeiros jogos dele (a "foto" de antes do jogo n+1)
  function fotoAntes(t, n) {
    const g = bucketVazio(), c = bucketVazio(), f = bucketVazio();
    for (let i = 0; i < n; i++) {
      const j = t.jogos[i], p = j.p;
      if (j.casa) { somarNoBucket(g, p.fh, p.fa, p.hh, p.ha, p, true); somarNoBucket(c, p.fh, p.fa, p.hh, p.ha, p, true); }
      else { somarNoBucket(g, p.fa, p.fh, p.ha, p.hh, p, false); somarNoBucket(f, p.fa, p.fh, p.ha, p.hh, p, false); }
    }
    return { geral: g, casa: c, fora: f, elo: t.eloHist[n] };
  }

  // estado atual do time para jogos futuros
  function fotoAtual(prep, id) {
    const t = prep.times[id];
    return t ? fotoTime(t) : fotoTime(novoTime());
  }

  // ------------------------------------------------------------ mercados
  const MERCADOS = [
    { id: "casa", nome: "Vitória do mandante", ok: (p) => p.fh > p.fa, prob: (x) => x.p1 },
    { id: "empate", nome: "Empate", ok: (p) => p.fh === p.fa, prob: (x) => x.px },
    { id: "fora", nome: "Vitória do visitante", ok: (p) => p.fa > p.fh, prob: (x) => x.p2 },
    { id: "1x", nome: "Dupla chance mandante (1X)", ok: (p) => p.fh >= p.fa, prob: (x) => x.p1 + x.px },
    { id: "x2", nome: "Dupla chance visitante (X2)", ok: (p) => p.fa >= p.fh, prob: (x) => x.p2 + x.px },
    { id: "12", nome: "Sem empate (12)", ok: (p) => p.fh !== p.fa, prob: (x) => x.p1 + x.p2 },
    { id: "ov05", nome: "Mais de 0,5 gol", ok: (p) => p.fh + p.fa > 0.5, prob: (x) => x.ov[0] },
    { id: "ov15", nome: "Mais de 1,5 gol", ok: (p) => p.fh + p.fa > 1.5, prob: (x) => x.ov[1] },
    { id: "ov25", nome: "Mais de 2,5 gols", ok: (p) => p.fh + p.fa > 2.5, prob: (x) => x.ov[2] },
    { id: "ov35", nome: "Mais de 3,5 gols", ok: (p) => p.fh + p.fa > 3.5, prob: (x) => x.ov[3] },
    { id: "un15", nome: "Menos de 1,5 gol", ok: (p) => p.fh + p.fa < 1.5, prob: (x) => 1 - x.ov[1] },
    { id: "un25", nome: "Menos de 2,5 gols", ok: (p) => p.fh + p.fa < 2.5, prob: (x) => 1 - x.ov[2] },
    { id: "un35", nome: "Menos de 3,5 gols", ok: (p) => p.fh + p.fa < 3.5, prob: (x) => 1 - x.ov[3] },
    { id: "btts", nome: "Ambas marcam: sim", ok: (p) => p.fh > 0 && p.fa > 0, prob: (x) => x.btts },
    { id: "nbtts", nome: "Ambas marcam: não", ok: (p) => !(p.fh > 0 && p.fa > 0), prob: (x) => 1 - x.btts },
    { id: "casamarca", nome: "Mandante marca", ok: (p) => p.fh > 0, prob: (x) => x.casaMarca },
    { id: "foramarca", nome: "Visitante marca", ok: (p) => p.fa > 0, prob: (x) => x.foraMarca },
    { id: "ht05", nome: "Gol no 1º tempo", ok: (p) => p.hh != null && p.hh + p.ha > 0.5, ht: true, prob: (x) => x.ht05 },
    { id: "ht15", nome: "Mais de 1,5 gol no 1º tempo", ok: (p) => p.hh != null && p.hh + p.ha > 1.5, ht: true, prob: (x) => x.ht15 },
    { id: "st05", nome: "Gol no 2º tempo", ok: (p) => p.hh != null && p.fh + p.fa - p.hh - p.ha > 0.5, ht: true },
    { id: "ht1", nome: "Mandante vence o 1º tempo", ok: (p) => p.hh != null && p.hh > p.ha, ht: true },
    { id: "htx", nome: "Empate no 1º tempo", ok: (p) => p.hh != null && p.hh === p.ha, ht: true },
  ];

  // ------------------------------------------------------------ métricas para filtros
  const SUJEITOS = [
    { id: "hc", nome: "Mandante em casa", time: "h", bucket: "casa" },
    { id: "hg", nome: "Mandante no geral", time: "h", bucket: "geral" },
    { id: "af", nome: "Visitante fora", time: "a", bucket: "fora" },
    { id: "ag", nome: "Visitante no geral", time: "a", bucket: "geral" },
    { id: "pj", nome: "Projeção do jogo" },
    { id: "cmp", nome: "Comparação dos times" },
  ];
  const METRICAS_TIME = [
    { id: "vit", nome: "% de vitórias", un: "%" }, { id: "emp", nome: "% de empates", un: "%" },
    { id: "der", nome: "% de derrotas", un: "%" }, { id: "ppj", nome: "Pontos por jogo", un: "" },
    { id: "gm", nome: "Gols marcados por jogo", un: "" }, { id: "gs", nome: "Gols sofridos por jogo", un: "" },
    { id: "gt", nome: "Gols no jogo (média)", un: "" },
    { id: "ov15", nome: "% jogos com mais de 1,5", un: "%" }, { id: "ov25", nome: "% jogos com mais de 2,5", un: "%" },
    { id: "ov35", nome: "% jogos com mais de 3,5", un: "%" },
    { id: "btts", nome: "% ambas marcam", un: "%" }, { id: "cs", nome: "% sem sofrer gol", un: "%" },
    { id: "sm", nome: "% sem marcar", un: "%" }, { id: "ht05", nome: "% gol no 1º tempo", un: "%" },
    { id: "gm1", nome: "Gols marcados no 1º tempo", un: "" }, { id: "v1", nome: "% vencendo no intervalo", un: "%" },
    { id: "jogos", nome: "Jogos disputados", un: "" }, { id: "elo", nome: "Rating Elo", un: "" },
  ];
  const METRICAS_PROJ = [
    { id: "p1", nome: "Chance do mandante", un: "%" }, { id: "px", nome: "Chance de empate", un: "%" },
    { id: "p2", nome: "Chance do visitante", un: "%" }, { id: "ov25", nome: "Chance de mais de 2,5", un: "%" },
    { id: "ov15", nome: "Chance de mais de 1,5", un: "%" }, { id: "btts", nome: "Chance de ambas marcam", un: "%" },
    { id: "xg", nome: "Gols esperados no jogo", un: "" }, { id: "lh", nome: "Gols esperados do mandante", un: "" },
    { id: "la", nome: "Gols esperados do visitante", un: "" },
  ];
  const METRICAS_CMP = [
    { id: "elodif", nome: "Diferença de Elo (mandante − visitante)", un: "" },
    { id: "ppjdif", nome: "Diferença de pontos por jogo (casa − fora)", un: "" },
  ];

  function valorMetrica(cond, foto, proj) {
    if (cond.suj === "pj") {
      const x = proj;
      switch (cond.met) {
        case "p1": return x.p1 * 100; case "px": return x.px * 100; case "p2": return x.p2 * 100;
        case "ov25": return x.ov[2] * 100; case "ov15": return x.ov[1] * 100; case "btts": return x.btts * 100;
        case "xg": return x.lh + x.la; case "lh": return x.lh; case "la": return x.la;
      }
      return null;
    }
    if (cond.suj === "cmp") {
      if (cond.met === "elodif") return foto.h.elo - foto.a.elo;
      if (cond.met === "ppjdif") {
        const a = med(foto.h.casa.pts, foto.h.casa.j), b = med(foto.a.fora.pts, foto.a.fora.j);
        return a == null || b == null ? null : a - b;
      }
      return null;
    }
    const s = SUJEITOS.find((x) => x.id === cond.suj);
    if (!s) return null;
    const t = foto[s.time];
    if (cond.met === "elo") return t.elo;
    const m = metricas(t[s.bucket]);
    return m[cond.met];
  }

  function passa(filtro, foto, proj) {
    const minJ = filtro.minJogos || 0;
    if (foto.h.geral.j < minJ || foto.a.geral.j < minJ) return false;
    for (const c of filtro.condicoes || []) {
      const v = valorMetrica(c, foto, proj);
      if (v == null || !isFinite(v)) return false;
      if (c.op === ">=" && !(v >= c.val)) return false;
      if (c.op === "<=" && !(v <= c.val)) return false;
    }
    return true;
  }

  // ------------------------------------------------------------ backtest
  function backtest(preps, filtro, odd) {
    const mercado = MERCADOS.find((m) => m.id === filtro.mercado) || MERCADOS[0];
    const entradas = [];
    for (const prep of preps) {
      for (const p of prep.partidas) {
        const foto = prep.fotos[p.i];
        if (!foto) continue;
        if (mercado.ht && p.hh == null) continue;
        const proj = projetar(foto.h, foto.a, foto.liga);
        if (!passa(filtro, foto, proj)) continue;
        entradas.push({ comp: prep.code, p, green: mercado.ok(p), proj });
      }
    }
    entradas.sort((a, b) => (a.p.d < b.p.d ? -1 : 1));
    let greens = 0, seqRed = 0, maxRed = 0, seqGreen = 0, maxGreen = 0, saldo = 0, pico = 0, rebaixa = 0;
    const curva = [];
    for (const e of entradas) {
      if (e.green) { greens++; seqGreen++; seqRed = 0; saldo += (odd || 0) - 1; }
      else { seqRed++; seqGreen = 0; saldo -= 1; }
      maxRed = Math.max(maxRed, seqRed); maxGreen = Math.max(maxGreen, seqGreen);
      pico = Math.max(pico, saldo); rebaixa = Math.max(rebaixa, pico - saldo);
      curva.push(saldo);
    }
    const n = entradas.length, taxa = n ? greens / n : null;
    return {
      mercado, entradas, n, greens, reds: n - greens, taxa,
      oddMinima: taxa ? 1 / taxa : null, maxRed, maxGreen, saldo, rebaixa, curva,
      roi: n && odd ? (saldo / n) * 100 : null,
    };
  }

  function proximosNoFiltro(preps, filtro, agoraISO) {
    const lista = [];
    for (const prep of preps) {
      for (const p of prep.partidas) {
        if (encerrada(p) || p.d < agoraISO || p.h == null || p.a == null) continue;
        if (!["SCHEDULED", "TIMED"].includes(p.s)) continue;
        const foto = { h: fotoAtual(prep, p.h), a: fotoAtual(prep, p.a) };
        const proj = projetar(foto.h, foto.a, prep.liga);
        if (passa(filtro, foto, proj)) lista.push({ comp: prep.code, p, proj });
      }
    }
    return lista.sort((a, b) => (a.p.d < b.p.d ? -1 : 1));
  }

  // ------------------------------------------------------------ tabela calculada (geral/casa/fora)
  function tabela(prep, tipo) {
    const linhas = [];
    for (const id in prep.times) {
      const t = prep.times[id];
      const b = tipo === "HOME" ? t.casa : tipo === "AWAY" ? t.fora : t.geral;
      linhas.push({ t: id, j: b.j, v: b.v, e: b.e, d: b.d, gp: b.gm, gc: b.gs, sg: b.gm - b.gs, pts: b.pts, forma: b.forma.slice(-5) });
    }
    linhas.sort((x, y) => y.pts - x.pts || y.sg - x.sg || y.gp - x.gp);
    linhas.forEach((l, i) => (l.p = i + 1));
    return linhas;
  }

  // n = quantos jogos usar para medir a evolução recente
  function ranking(prep, n = 5) {
    const lista = [];
    const L = prep.liga, Lt = ((L.mh || 1.4) + (L.ma || 1.1)) / 2;
    for (const id in prep.times) {
      const t = prep.times[id];
      if (!t.geral.j) continue;
      const h = t.eloHist, antes = h[Math.max(0, h.length - 1 - n)];
      const recentes = t.geral.forma.slice(-n);
      const ptsN = recentes.reduce((s, r) => s + (r === "V" ? 3 : r === "E" ? 1 : 0), 0);
      lista.push({
        t: id, elo: t.elo, var5: t.elo - antes, varN: t.elo - antes, nJogos: Math.min(n, h.length - 1),
        hist: h.slice(-Math.max(12, n + 1)), j: t.geral.j,
        ataque: med(t.geral.gm, t.geral.j) / Lt, defesa: med(t.geral.gs, t.geral.j) / Lt,
        forma: t.geral.forma.slice(-5), ppj: med(t.geral.pts, t.geral.j),
        ptsN, ppjN: recentes.length ? ptsN / recentes.length : null,
      });
    }
    lista.sort((a, b) => b.elo - a.elo);
    lista.forEach((x, i) => (x.pos = i + 1));
    return lista;
  }

  const Motor = {
    LINHAS, MERCADOS, SUJEITOS, METRICAS_TIME, METRICAS_PROJ, METRICAS_CMP,
    prepararCompeticao, metricas, bucketDeJogos, primeiroGol, primeiroDoJogo, gols2T, projetar, fotoAtual, encerrada,
    backtest, proximosNoFiltro, passa, valorMetrica, tabela, ranking,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = Motor;
  else raiz.Motor = Motor;
})(typeof window !== "undefined" ? window : globalThis);
