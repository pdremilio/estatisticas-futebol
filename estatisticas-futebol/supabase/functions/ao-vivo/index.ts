// ScanBall · função "ao-vivo" (Supabase Edge Function, Deno)
// Chamada a cada minuto pelo pg_cron. Quando há jogo na janela (agenda.json do site), faz 4 rodadas de 15 s:
//   - toda rodada: /fixtures?live=<ligas>   (placar, minuto, status)
//   - rodadas 0 e 2: /fixtures?ids=...      (lances e estatísticas, até 20 jogos por chamada)
// e grava o resumo na tabela public.ao_vivo, que o site lê.
// Gasto: ~6 requisições por minuto com jogo rolando, zero sem jogo. Plano Pro da API-Football: 7.500/dia.
//
// Segredos (Edge Functions → Secrets): API_FOOTBALL_KEY, CRON_SEGREDO, AGENDA_URL
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem automaticamente.

const API = Deno.env.get("API_FOOTBALL_BASE") || "https://v3.football.api-sports.io";
const LIGAS = [71, 39, 140, 135, 78, 61, 94, 88, 40, 2];
const FINAIS = new Set(["FT", "AET", "PEN", "PST", "CANC", "ABD", "AWD", "WO"]);
const RODADAS = 4, PASSO = 15000;
const MANTER_FINAL_MS = 2 * 3600e3; // jogo encerrado continua no feed por 2 h

const env = (k) => Deno.env.get(k) || "";
const dormir = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
let restantes = null;

async function api(caminho) {
  const r = await fetch(API + caminho, { headers: { "x-apisports-key": env("API_FOOTBALL_KEY") } });
  restantes = r.headers.get("x-ratelimit-requests-remaining") ?? restantes;
  const j = await r.json().catch(() => ({}));
  const erros = j && j.errors && (Array.isArray(j.errors) ? j.errors.length : Object.keys(j.errors).length);
  if (!r.ok || erros) throw new Error("API-Football " + r.status + " " + JSON.stringify(j.errors || {}));
  return j.response || [];
}

async function banco(caminho, opcoes = {}) {
  const chave = env("SUPABASE_SERVICE_ROLE_KEY");
  const r = await fetch(env("SUPABASE_URL") + "/rest/v1/" + caminho, {
    method: opcoes.method || "GET",
    headers: { apikey: chave, Authorization: "Bearer " + chave, "Content-Type": "application/json", ...(opcoes.headers || {}) },
    body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
  });
  if (!r.ok) throw new Error("Supabase " + r.status + " " + (await r.text()));
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
const lerEstado = async () => ((await banco("ao_vivo?id=eq.1&select=dados"))[0] || {}).dados || { jogos: [] };
const gravarEstado = (dados) => banco("ao_vivo", {
  method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
  body: { id: 1, dados, atualizado_em: new Date().toISOString() },
});

async function temJogoNaJanela(anterior) {
  if ((anterior.jogos || []).some((j) => !FINAIS.has(j.st))) return true;
  const url = env("AGENDA_URL");
  if (!url) return true;
  try {
    const r = await fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now());
    const ag = await r.json();
    const agora = Date.now();
    return (ag.jogos || []).some((j) => { const t = Date.parse(j.d); return agora >= t - 10 * 60e3 && agora <= t + 150 * 60e3; });
  } catch (_) {
    return true; // sem agenda: melhor gastar 1 requisição do que perder o jogo
  }
}

// ---------- conversão para o formato compacto que o site lê
const ESTATS = { "Ball Possession": "posse", expected_goals: "xg", "Total Shots": "chutes", "Shots on Goal": "alvo", "Corner Kicks": "esc",
  Fouls: "faltas", "Yellow Cards": "amarelos", "Red Cards": "vermelhos", Offsides: "imped", "Goalkeeper Saves": "defesas" };

function evento(e, idCasa) {
  const tipo = String(e.type || "").toLowerCase(), det = String(e.detail || "");
  const m = (e.time && e.time.elapsed != null ? e.time.elapsed : "") + (e.time && e.time.extra ? "+" + e.time.extra : "");
  const l = e.team && e.team.id === idCasa ? "h" : "a";
  const j = (e.player && e.player.name) || "";
  if (tipo === "goal") {
    if (/missed/i.test(det)) return { m, l, t: "outro", j, x: "pênalti perdido" };
    return { m, l, t: "gol", j, x: /own/i.test(det) ? "contra" : /penalty/i.test(det) ? "pênalti" : e.assist && e.assist.name ? "assist. " + e.assist.name : "" };
  }
  if (tipo === "card") return { m, l, t: /yellow/i.test(det) && !/second/i.test(det) ? "amarelo" : "vermelho", j, x: /second/i.test(det) ? "2º amarelo" : "" };
  if (tipo === "subst") return { m, l, t: "sub", j: (e.assist && e.assist.name) || "", x: j ? "sai " + j : "" };
  if (tipo === "var") return { m, l, t: "var", j, x: det };
  return null;
}
function estatisticas(lista, idCasa) {
  if (!Array.isArray(lista) || !lista.length) return null;
  const es = {};
  for (const bloco of lista) {
    const lado = bloco.team && bloco.team.id === idCasa ? 0 : 1;
    for (const s of bloco.statistics || []) {
      const k = ESTATS[s.type];
      if (!k) continue;
      es[k] = es[k] || [null, null];
      es[k][lado] = s.value == null ? null : typeof s.value === "string" ? Number(s.value.replace("%", "")) : s.value;
    }
  }
  return Object.keys(es).length ? es : null;
}
function compactar(f, anterior) {
  const idCasa = f.teams.home.id;
  const ev = Array.isArray(f.events) && f.events.length ? f.events.map((e) => evento(e, idCasa)).filter(Boolean) : anterior ? anterior.ev : [];
  const es = estatisticas(f.statistics, idCasa) || (anterior ? anterior.es : null);
  const st = f.fixture.status.short;
  return {
    id: f.fixture.id, lg: f.league.id, d: f.fixture.date, st, el: f.fixture.status.elapsed, ex: f.fixture.status.extra ?? null,
    h: { id: idCasa, n: f.teams.home.name }, a: { id: f.teams.away.id, n: f.teams.away.name },
    g: [f.goals.home, f.goals.away], ht: f.score && f.score.halftime ? [f.score.halftime.home, f.score.halftime.away] : null,
    ev: ev || [], es, fim: FINAIS.has(st) ? (anterior && anterior.fim) || Date.now() : null,
  };
}

async function rodada(n, mapa) {
  const vivos = await api("/fixtures?live=" + LIGAS.join("-"));
  const idsVivos = new Set();
  for (const f of vivos) {
    if (!LIGAS.includes(f.league.id)) continue;
    idsVivos.add(f.fixture.id);
    mapa.set(f.fixture.id, compactar(f, mapa.get(f.fixture.id)));
  }
  // jogos que sumiram do "live" sem status final: provavelmente acabaram → buscar pelo id
  const sumiram = [...mapa.values()].filter((j) => !idsVivos.has(j.id) && !FINAIS.has(j.st)).map((j) => j.id);
  const detalhar = n % 2 === 0 ? [...idsVivos, ...sumiram] : sumiram;
  for (let i = 0; i < detalhar.length; i += 20) {
    const lote = detalhar.slice(i, i + 20);
    for (const f of await api("/fixtures?ids=" + lote.join("-"))) mapa.set(f.fixture.id, compactar(f, mapa.get(f.fixture.id)));
  }
  const agora = Date.now();
  for (const [id, j] of mapa) if (j.fim && agora - j.fim > MANTER_FINAL_MS) mapa.delete(id);
  return { em: new Date().toISOString(), restantes, jogos: [...mapa.values()].sort((a, b) => (a.d < b.d ? -1 : 1)) };
}

Deno.serve(async (req) => {
  if (!env("CRON_SEGREDO") || req.headers.get("x-cron-segredo") !== env("CRON_SEGREDO")) return new Response("não autorizado", { status: 401 });
  const inicio = Date.now();
  const log = [];
  try {
    const anterior = await lerEstado();
    const mapa = new Map((anterior.jogos || []).map((j) => [j.id, j]));
    if (!(await temJogoNaJanela(anterior))) {
      const limpo = [...mapa.values()].filter((j) => !(j.fim && Date.now() - j.fim > MANTER_FINAL_MS));
      if (limpo.length !== mapa.size) await gravarEstado({ em: new Date().toISOString(), jogos: limpo });
      return Response.json({ ok: true, pulou: "sem jogo na janela" });
    }
    for (let n = 0; n < RODADAS; n++) {
      await dormir(inicio + n * PASSO - Date.now());
      try {
        const dados = await rodada(n, mapa);
        await gravarEstado(dados);
        log.push(`rodada ${n}: ${dados.jogos.length} jogo(s), restam ${restantes ?? "?"} req.`);
      } catch (e) {
        log.push(`rodada ${n}: ${e.message}`);
        if (/rate|limit|requests|token|key/i.test(e.message)) break; // limite ou chave: para até o próximo minuto
      }
    }
    return Response.json({ ok: true, log });
  } catch (e) {
    return Response.json({ ok: false, erro: e.message, log }, { status: 500 });
  }
});
