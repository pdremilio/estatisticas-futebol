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
const INTERVALO = 8000;          // ms entre uma busca e outra (com 1 página = 7,5 pedidos/min)
const MAX_PAGINAS = 3;
const ORIGENS = ["https://pdremilio.github.io", "http://localhost:8765", "http://127.0.0.1:8765"];

function cors(req) {
  const o = req.headers.get("Origin") || "";
  const h = { "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Max-Age": "86400", "Vary": "Origin" };
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
    this.env = env;
    this.txt = null;       // última resposta pronta (JSON em texto)
    this.em = 0;           // quando foi buscada
    this.pausa = 0;        // 5Dollar pediu para esperar (limite)
    this.intervalo = INTERVALO;
    this.buscando = null;
    this.erro = "";
  }

  async fetch() {
    const agora = Date.now();
    if (agora - this.em > this.intervalo && agora >= this.pausa && !this.buscando) {
      this.buscando = this.buscar().catch((e) => { this.erro = String(e && e.message || e); }).finally(() => { this.buscando = null; });
    }
    // primeira vez (ou resposta muito velha): espera a busca terminar; senão devolve a última na hora
    if (this.buscando && (!this.txt || agora - this.em > this.intervalo * 4)) await this.buscando;
    const corpo = this.txt || JSON.stringify({ ok: 0, erro: this.erro || "sem dados ainda" });
    return new Response(corpo, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  }

  async buscar() {
    const chave = this.env.FIVE_DOLLAR_KEY;
    if (!chave) { this.erro = "o Worker está sem a chave FIVE_DOLLAR_KEY"; return; }
    const jogos = [];
    let pagina = 1, paginas = 0;
    while (pagina <= MAX_PAGINAS) {
      const r = await fetch(`${this.env.API_BASE || API}fixtures?status=live&include=${this.semEventos ? "stats" : "events,stats"}&per_page=50&page=${pagina}`, {
        headers: { Authorization: "Bearer " + chave, Accept: "application/json" },
      });
      paginas++;
      if (r.status === 429) {
        const seg = Number(r.headers.get("Retry-After")) || 30;
        this.pausa = Date.now() + seg * 1000;
        this.erro = `limite da 5Dollar: esperando ${seg} s`;
        this.em = Date.now();
        return;
      }
      // a lista não aceitou os eventos junto: segue só com as estatísticas (e não tenta mais)
      if (r.status === 400 && !this.semEventos) { this.semEventos = true; continue; }
      if (!r.ok) { this.erro = `5Dollar respondeu ${r.status}`; this.em = Date.now(); return; }
      const j = await r.json();
      for (const fx of j.data || []) jogos.push(enxugar(fx));
      if (!(j.pagination && j.pagination.has_more)) break;
      pagina++;
    }
    // mais de uma página por busca: espaça as buscas para continuar abaixo de 10 pedidos/min
    this.intervalo = INTERVALO * Math.max(1, paginas);
    this.em = Date.now();
    this.erro = "";
    this.txt = JSON.stringify({ ok: 1, em: new Date(this.em).toISOString(), intervalo: this.intervalo, eventos: !this.semEventos, n: jogos.length, jogos });
  }
}

export default {
  async fetch(req, env) {
    const h = cors(req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    const url = new URL(req.url);
    if (url.pathname === "/ao-vivo") {
      const obj = env.AOVIVO.get(env.AOVIVO.idFromName("unico"));
      const r = await obj.fetch("https://interno/ao-vivo");
      return new Response(r.body, { status: r.status, headers: { ...Object.fromEntries(r.headers), ...h } });
    }
    return new Response("ScanBall · servidor do ao vivo. Use /ao-vivo.", { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", ...h } });
  },
};
