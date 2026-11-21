/* ScanBall · servidor do ao vivo (Cloudflare Worker + Durable Object)
 *
 * O site pede  GET /ao-vivo  e recebe todos os jogos rolando, com placar, escanteios, cartões e
 * estatísticas (ataques, ataques perigosos, chutes, posse), vindos da 5DollarFootballAPI.
 *
 * - A chave da 5Dollar fica no segredo FIVE_DOLLAR_KEY do Worker: nunca chega ao navegador.
 * - Um único "Durable Object" no mundo inteiro guarda a última resposta e só vai à 5Dollar
 *   no máximo a cada INTERVALO ms. Por isso o limite da conta (10 pedidos/min) nunca estoura,
 *   não importa quantas pessoas estejam com o site aberto.
 * - Ninguém olhando = nenhum pedido à 5Dollar.
 */
const API = "https://api.5dollarfootballapi.com/v1/";
const INTERVALO = 8000;          // ms entre uma busca e outra, por página (1 página = 7,5 pedidos/min; limite da conta: 10,
                                 // e o robô do GitHub ainda usa ~1,7/min com jogo ao vivo para as odds)
const ATIVO_MS = 90000;
const TEMPO_LIMITE = 5000;       // a 5Dollar não respondeu em 5 s: desiste daquele pedido e tenta de novo nela mesma
const NOVA_TENTATIVA = 1000;     // espera antes de tentar de novo depois de uma falha
const MAX_POR_MIN = 9;           // trava: nunca mais de 9 pedidos em 60 s (o limite da conta é 10)          // alguém pediu nos últimos 90 s: o servidor se adianta e busca sozinho no intervalo certo
const MAX_PAGINAS = 3;
// página grande: no ao vivo a 5Dollar aceita até 500 jogos por página (1 pedido só, mesmo com 80 jogos rolando).
// Se ela recusar ou cortar em 50, o servidor volta sozinho para 50 por página (mais páginas, buscas mais espaçadas).
const POR_PAGINA = 500;
const ORIGENS = ["https://pdremilio.github.io", "http://localhost:8765", "http://127.0.0.1:8765"];

function cors(req) {
  const o = req.headers.get("Origin") || "";
  const h = { "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Max-Age": "86400", "Vary": "Origin", "Access-Control-Expose-Headers": "X-Agora" };
  if (ORIGENS.includes(o)) h["Access-Control-Allow-Origin"] = o;
  return h;
}

const par = (x) => (x && x.home != null && x.away != null ? { home: Number(x.home) || 0, away: Number(x.away) || 0 } : undefined);
const numeros = (st) => (st ? {
  attacks: par(st.attacks), dangerous_attacks: par(st.dangerous_attacks),
  shots_on_target: par(st.shots_on_target), shots_off_target: par(st.shots_off_target), possession: par(st.possession),
} : undefined);
// eventos que o site usa (gol, escanteio, cartões, substituição com nomes, pênalti perdido, placar do 1º tempo)
const EVENTOS = { goal: 1, corner: 1, yellow_card: 1, red_card: 1, substitution: 1, missed_penalty: 1, period_score: 1 };
const eventos = (lista) => (Array.isArray(lista) ? lista.filter((e) => e && EVENTOS[e.type]).map((e) => ({
  type: e.type, minute: e.minute, team: e.team, count: e.count, period: e.period, score: e.score, player_in: e.player_in, player_out: e.player_out,
})) : undefined);

function enxugar(fx) {
  const st = fx.statistics || fx.stats || {};
  const t = fx.teams || {};
  return {
    id: fx.id,
    league: fx.league ? { id: fx.league.id, name: fx.league.name } : undefined,
    teams: { home: { name: (t.home || {}).name }, away: { name: (t.away || {}).name } },
    kickoff_utc: fx.kickoff_utc,
    status_code: fx.status_code,
    goals: fx.goals,
    corners: fx.corners,
    cards: fx.cards,
    statistics: Object.assign(numeros(st), { first_half: numeros(st.first_half) }),
    events: eventos(fx.events),
  };
}

export class AoVivo {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.hist = new Map();   // id -> minuto a minuto do jogo (também salvo no armazenamento do servidor)
    this.ht = new Set();     // jogos que já passaram do intervalo
    this.dadosTxt = null;  // última lista de jogos pronta (JSON em texto)
    this.em = 0;           // quando chegou a última lista boa
    this.proxTentativa = 0; // a partir de quando pode buscar de novo
    this.pausa = 0;        // 5Dollar pediu para esperar (limite)
    this.intervalo = INTERVALO;
    this.buscando = null;
    this.erro = "";
    this.porPagina = POR_PAGINA;
    this.feitos = [];      // hora de cada pedido à 5Dollar no último minuto (trava dos 9 por minuto)
    this.diag = [];        // últimos pedidos: hora, duração e resultado (GET /ao-vivo?diag=1)
  }

  // pode pedir agora sem passar de MAX_POR_MIN em 60 s? Se não, devolve a partir de quando pode
  livreEm() {
    const agora = Date.now();
    this.feitos = this.feitos.filter((t) => agora - t < 60000);
    return this.feitos.length < MAX_POR_MIN ? agora : this.feitos[0] + 60000 + 200;
  }

  disparar() {
    const agora = Date.now();
    if (!this.buscando && agora >= this.proxTentativa && agora >= this.pausa && this.livreEm() <= agora) {
      this.buscando = this.buscar().catch((e) => { this.erro = String(e && e.message || e); this.proxTentativa = Date.now() + NOVA_TENTATIVA; })
        .finally(() => { this.buscando = null; });
    }
    return this.buscando;
  }

  // quando sai a próxima busca (o site pede logo depois dela)
  proxima() { return Math.max(this.proxTentativa, this.pausa, this.livreEm(), Date.now() + 500); }

  corpo() {
    if (!this.dadosTxt) return JSON.stringify({ ok: 0, erro: this.erro || "sem dados ainda", prox: this.proxima() });
    const cab = { ok: 1, em: new Date(this.em).toISOString(), prox: this.proxima(), intervalo: this.intervalo, erro: this.erro || undefined };
    return JSON.stringify(cab).slice(0, -1) + "," + this.dadosTxt.slice(1);
  }

  async fetch(req) {
    const url = new URL(typeof req === "string" ? req : (req && req.url) || "https://interno/ao-vivo");
    if (url.pathname === "/historico") return this.historico(url);
    const agora = Date.now(), despertador = url.searchParams.has("despertador");
    if (!despertador) {
      this.pedidoEm = agora;
      // alguém olhando: o servidor passa a buscar sozinho no ritmo certo (alarme), sem esperar o próximo pedido
      if (!this.alarmeLigado) {
        this.alarmeLigado = true;
        try { Promise.resolve(this.state.storage.setAlarm(agora + 50)).catch(() => { this.alarmeLigado = false; }); } catch (e) { this.alarmeLigado = false; }
      }
    }
    const busca = this.disparar();
    // resposta velha e uma busca andando: espera ela (até 3 s) para já mandar o dado novo
    if (busca && (!this.dadosTxt || despertador || agora - this.em > this.intervalo)) {
      await Promise.race([busca, new Promise((r) => setTimeout(r, despertador || !this.dadosTxt ? 25000 : 3000))]);
    }
    const corpo = url.searchParams.has("diag")
      ? JSON.stringify({ agora: new Date().toISOString(), erro: this.erro, pedidosNoUltimoMinuto: this.feitos.length, em: new Date(this.em).toISOString(), prox: new Date(this.proxima()).toISOString(), diag: this.diag })
      : this.corpo();
    return new Response(corpo, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  }

  // alarme: enquanto alguém pediu nos últimos 90 s, busca a cada intervalo (o dado está sempre fresco quando o site pede)
  async alarm() {
    if (Date.now() - (this.pedidoEm || 0) > ATIVO_MS) { this.alarmeLigado = false; return; }
    try { await this.disparar(); } catch (e) {}
    const prox = Math.max(this.proxima(), Date.now() + 500);
    try { await this.state.storage.setAlarm(prox); } catch (e) { this.alarmeLigado = false; }
  }

  async buscar() {
    const chave = this.env.FIVE_DOLLAR_KEY;
    if (!chave) { this.erro = "o Worker está sem a chave FIVE_DOLLAR_KEY"; return; }
    const jogos = [];
    let pagina = 1, paginas = 0;
    const falhou = (msg, espera) => { this.erro = msg; this.proxTentativa = Date.now() + espera; };
    while (pagina <= MAX_PAGINAS) {
      if (this.livreEm() > Date.now()) { falhou("trava dos 9 pedidos por minuto: esperando", 0); return; }
      this.feitos.push(Date.now());
      const t0 = Date.now(), ctl = new AbortController(), limite = setTimeout(() => ctl.abort(), TEMPO_LIMITE);
      let r, j;
      try {
        r = await fetch(`${this.env.API_BASE || API}fixtures?status=live&include=${this.semEventos ? "stats" : "events,stats"}&per_page=${this.porPagina}&page=${pagina}`, {
          headers: { Authorization: "Bearer " + chave, Accept: "application/json" }, signal: ctl.signal,
        });
        if (r.ok) j = await r.json(); // a leitura também entra no tempo limite
      } catch (e) {
        clearTimeout(limite);
        const tempo = ctl.signal.aborted;
        this.anotar(t0, tempo ? "tempo" : "falha");
        if (tempo && this.porPagina > 50) this.porPagina = 50; // página grande demorando demais: volta para 50
        // não respondeu a tempo (ou a conexão caiu): tenta de novo na 5Dollar daqui a pouco
        falhou(tempo ? `a 5Dollar não respondeu em ${TEMPO_LIMITE / 1000} s: tentando de novo` : `falha ao falar com a 5Dollar: ${e && e.message || e}`, NOVA_TENTATIVA);
        return;
      }
      clearTimeout(limite);
      this.anotar(t0, r.status);
      paginas++;
      if (r.status === 429) {
        const seg = Number(r.headers.get("Retry-After")) || 30;
        this.pausa = Date.now() + seg * 1000;
        falhou(`limite da 5Dollar: esperando ${seg} s`, 0);
        return;
      }
      // a lista não aceitou os eventos junto: segue só com as estatísticas (e não tenta mais)
      // recusou a página grande: volta para 50 por página (e só depois, se ainda recusar, tira os eventos)
      if ((r.status === 400 || r.status === 422) && this.porPagina > 50) { this.porPagina = 50; paginas--; continue; }
      if (r.status === 400 && !this.semEventos) { this.semEventos = true; paginas--; continue; }
      if (!r.ok || !j) { falhou(`5Dollar respondeu ${r.status}`, 3000); return; }
      for (const fx of j.data || []) jogos.push(enxugar(fx));
      // a 5Dollar cortou a página (ex.: em 50): segue no tamanho que ela usou, para as páginas seguintes baterem
      const pp = Number(j.pagination && j.pagination.per_page);
      if (pp && pp < this.porPagina) this.porPagina = pp;
      if (!(j.pagination && j.pagination.has_more)) break;
      pagina++;
    }
    // mais de uma página por busca: espaça as buscas para continuar abaixo de 10 pedidos/min
    this.intervalo = INTERVALO * Math.max(1, paginas);
    this.em = Date.now();
    this.proxTentativa = this.em + this.intervalo - 300;
    this.erro = "";
    this.dadosTxt = JSON.stringify({ eventos: !this.semEventos, paginas, porPagina: this.porPagina, n: jogos.length, jogos });
    await this.registrar(jogos).catch(() => {});
  }

  anotar(t0, res) {
    this.diag.push({ h: new Date(t0).toISOString().slice(11, 19), ms: Date.now() - t0, r: res });
    if (this.diag.length > 40) this.diag.shift();
  }

  // guarda uma "foto" por minuto (ataques e ataques perigosos acumulados) de cada jogo ao vivo, para o site
  // desenhar o gráfico completo dos jogos passados. Grava só quando o minuto muda (1 gravação/min por jogo).
  async registrar(jogos) {
    this.vivos = jogos.map((j) => j.id);
    const parH = (x) => (x && x.home != null && x.away != null ? [Number(x.home) || 0, Number(x.away) || 0] : null);
    for (const j of jogos) {
      const st = j.statistics || {}, at = st.attacks, da = st.dangerous_attacks;
      if (!at && !da && !j.goals) continue;
      const cod = String(j.status_code || "").toLowerCase();
      if (/half|ht|break/.test(cod)) { this.ht.add(j.id); const hh = this.hist.get(j.id); if (hh && !hh.ht) { hh.ht = 1; await this.state.storage.put("j:" + j.id, hh); } continue; }
      const m = parseInt(cod, 10);
      if (!(m >= 1 && m <= 130)) continue;
      let h = this.hist.get(j.id);
      if (!h) {
        h = (await this.state.storage.get("j:" + j.id)) || { id: j.id, h: j.teams.home.name, a: j.teams.away.name, ko: j.kickoff_utc, m: {} };
        this.hist.set(j.id, h);
        const dia = "d:" + String(j.kickoff_utc || new Date().toISOString()).slice(0, 10);
        const ind = (await this.state.storage.get(dia)) || [];
        if (!ind.some((x) => x.id === j.id)) { ind.push({ id: j.id, h: h.h, a: h.a, ko: h.ko }); await this.state.storage.put(dia, ind); }
      }
      // a 5Dollar manda o minuto corrido: "47" pode ser acréscimo do 1º tempo. Só é 2º tempo depois do intervalo
      // (visto aqui ou já guardado), passados os 60' ou se a 5Dollar já fechou o placar do 1º tempo
      const evs = Array.isArray(j.events) ? j.events : [];
      const per = m <= 45 ? 1
        : this.ht.has(j.id) || h.ht || m > 60 || evs.some((e) => e && (e.type === "period_score" || /second|^2/.test(String(e.period || "")))) ? 2 : 1;
      if (per === 2 && !h.ht) { this.ht.add(j.id); h.ht = 1; }
      const chave = per + ":" + m, novo = !h.m[chave];
      // foto acumulada do minuto: ataques, ataques perigosos e os contadores (gols, chutes no gol e para fora,
      // escanteios, cartões) — com ela o site refaz o gráfico e os lances em qualquer computador
      const c = j.cards || {}, cart = (k) => (c.home && c.away ? [Number(c.home[k]) || 0, Number(c.away[k]) || 0] : null);
      const foto = { at: parH(at), da: parH(da), g: parH(j.goals), ch: parH(st.shots_on_target), cf: parH(st.shots_off_target), esc: parH(j.corners), am: cart("yellow"), vm: cart("red") };
      for (const k in foto) if (!foto[k]) delete foto[k]; // sem o número: nem guarda (economiza espaço)
      h.m[chave] = foto;
      if (novo) await this.state.storage.put("j:" + j.id, h);
    }
    if (this.hist.size > 300) this.hist.clear();
  }

  async historico(url) {
    const json = (o) => new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=60" } });
    const dia = url.searchParams.get("dia"), id = url.searchParams.get("id");
    // todos os jogos rolando num pacote só (o painel "Ao vivo" usa); montado no máximo 1 vez por minuto
    if (url.searchParams.has("vivos")) {
      if (!this.vivosTxt || Date.now() - this.vivosEm > 60000) {
        const jogos = (this.vivos || []).map((i) => this.hist.get(i)).filter(Boolean);
        this.vivosTxt = JSON.stringify({ ok: 1, em: new Date().toISOString(), jogos });
        this.vivosEm = Date.now();
      }
      return new Response(this.vivosTxt, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=60" } });
    }
    if (dia && /^\d{4}-\d{2}-\d{2}$/.test(dia)) return json({ ok: 1, jogos: (await this.state.storage.get("d:" + dia)) || [] });
    if (id && /^\d+$/.test(id)) {
      const h = this.hist.get(Number(id)) || (await this.state.storage.get("j:" + id));
      return json(h ? Object.assign({ ok: 1 }, h) : { ok: 0 });
    }
    return json({ ok: 0, erro: "use ?dia=AAAA-MM-DD ou ?id=N" });
  }
}

export default {
  async fetch(req, env) {
    const h = cors(req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    const url = new URL(req.url);
    if (url.pathname === "/ao-vivo" || url.pathname === "/historico") {
      const obj = env.AOVIVO.get(env.AOVIVO.idFromName("unico"));
      const r = await obj.fetch("https://interno" + url.pathname + url.search);
      // X-Agora: a hora do servidor, para o site calcular quando sai o próximo dado (sem depender do relógio do aparelho)
      return new Response(r.body, { status: r.status, headers: { ...Object.fromEntries(r.headers), ...h, "X-Agora": String(Date.now()) } });
    }
    return new Response("ScanBall · servidor do ao vivo. Use /ao-vivo.", { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", ...h } });
  },
  // despertador (a cada minuto, mesmo sem ninguém no site): mantém o minuto a minuto de todos os jogos salvo
  // do começo ao fim. Com visitantes, a busca de 8 em 8 s já está em dia e o despertador não gasta nada a mais.
  async scheduled(evento, env, ctx) {
    const obj = env.AOVIVO.get(env.AOVIVO.idFromName("unico"));
    ctx.waitUntil(obj.fetch("https://interno/ao-vivo?despertador=1").then((r) => r.text()).catch(() => {}));
  },
};
