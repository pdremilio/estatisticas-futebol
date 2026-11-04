/* ScanBall — contas de usuário (Supabase Auth via REST, sem bibliotecas externas)
 * Guarda favoritos, filtros e preferências de cada conta na tabela "preferencias".
 * Sem config.js preenchido, nada aparece e o site funciona como antes (tudo no aparelho).
 */
(function () {
  "use strict";
  const C = window.SB_CONFIG || {};
  const ATIVO = !!(C.url && C.anonKey);
  const URL_SITE = location.origin + location.pathname;
  const CHAVES_SYNC = ["favoritos", "fav_times", "fav_ligas", "filtros_lista", "filtro_lista", "rk_ordem", "rk_n", "ordem", "ocultar", "tema", "comp"];
  const CONJUNTOS = ["favoritos", "fav_times", "fav_ligas"];
  const K_SESSAO = "sb_sessao";

  const lerLS = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const gravarLS = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  let sessao = lerLS(K_SESSAO);
  let avisoInicial = null; // mensagem para mostrar ao abrir (ex.: e-mail confirmado)
  let abrirNovaSenha = false;

  // ------------------------------------------------------------ retorno dos links de e-mail (#access_token=... ou #error=...)
  function decodificarJWT(t) {
    try { return JSON.parse(decodeURIComponent(escape(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))))); } catch (e) { return {}; }
  }
  function lerRetornoDoEmail() {
    const h = location.hash.slice(1);
    if (!/(^|&)(access_token|error)=/.test(h)) return false;
    const p = new URLSearchParams(h);
    if (p.get("access_token")) {
      const jwt = decodificarJWT(p.get("access_token"));
      sessao = {
        access_token: p.get("access_token"), refresh_token: p.get("refresh_token"),
        expires_at: Math.floor(Date.now() / 1000) + Number(p.get("expires_in") || 3600),
        user: { id: jwt.sub, email: jwt.email },
      };
      gravarLS(K_SESSAO, sessao);
      if (p.get("type") === "recovery") abrirNovaSenha = true;
      else avisoInicial = "E-mail confirmado. Você já está conectado.";
    } else {
      const cod = p.get("error_code") || "";
      avisoInicial = cod === "otp_expired" ? "Esse link expirou. Peça um novo link e use em até uma hora." : "Não foi possível usar esse link. Tente de novo.";
    }
    history.replaceState(null, "", location.pathname + location.search + "#jogos");
    return true;
  }
  lerRetornoDoEmail();
  // link aberto numa aba onde o site já estava carregado
  window.addEventListener("hashchange", (e) => {
    if (!lerRetornoDoEmail()) return;
    e.stopImmediatePropagation();
    if (window.App) window.App.render();
    botaoTopo();
    avisarRetorno();
    if (sessao && !abrirNovaSenha) baixarEMesclar().catch(() => {});
  }, true);

  // ------------------------------------------------------------ chamadas ao Supabase
  async function chamar(caminho, opcoes = {}, comToken = false) {
    const cab = { apikey: C.anonKey, "Content-Type": "application/json" };
    if (comToken) {
      await garantirToken();
      if (!sessao) throw new Error("sem_sessao");
      cab.Authorization = "Bearer " + sessao.access_token;
    }
    Object.assign(cab, opcoes.headers || {});
    const r = await fetch(C.url.replace(/\/$/, "") + caminho, { method: opcoes.method || "GET", headers: cab, body: opcoes.body ? JSON.stringify(opcoes.body) : undefined });
    const texto = await r.text();
    let dados = null;
    try { dados = texto ? JSON.parse(texto) : null; } catch (e) { dados = texto; }
    if (!r.ok) {
      const msg = (dados && (dados.msg || dados.error_description || dados.message || dados.error)) || "HTTP " + r.status;
      const err = new Error(msg); err.status = r.status; err.codigo = dados && (dados.error_code || dados.code); throw err;
    }
    return dados;
  }
  function guardarSessao(d) {
    if (!d || !d.access_token) return false;
    sessao = { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600), user: { id: d.user && d.user.id, email: d.user && d.user.email } };
    gravarLS(K_SESSAO, sessao);
    return true;
  }
  let renovando = null;
  async function garantirToken() {
    if (!sessao) return;
    if (sessao.expires_at - 60 > Date.now() / 1000) return;
    if (!renovando) {
      renovando = chamar("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: sessao.refresh_token } })
        .then(guardarSessao)
        .catch(() => { sessao = null; gravarLS(K_SESSAO, null); })
        .finally(() => { renovando = null; });
    }
    await renovando;
  }
  function traduzir(e) {
    const m = String((e && e.message) || "").toLowerCase();
    if (m.includes("invalid login")) return "E-mail ou senha incorretos.";
    if (m.includes("not confirmed")) return "Confirme seu e-mail pelo link que enviamos antes de entrar.";
    if (m.includes("already registered") || m.includes("already been registered")) return "Já existe uma conta com esse e-mail. Use Entrar.";
    if (m.includes("password") && (m.includes("6") || m.includes("short") || m.includes("weak"))) return "A senha precisa ter pelo menos 6 caracteres.";
    if (m.includes("rate") || (e && e.status === 429)) return "Muitas tentativas seguidas. Espere um minuto e tente de novo.";
    if (m.includes("invalid") && m.includes("email")) return "Esse e-mail não parece válido.";
    if (m.includes("failed to fetch") || m.includes("network")) return "Sem conexão com o servidor de contas. Verifique sua internet.";
    return "Não deu certo: " + ((e && e.message) || "erro desconhecido") + ".";
  }

  // ------------------------------------------------------------ sincronização das preferências
  function coletar() {
    const d = {};
    for (const k of CHAVES_SYNC) { const v = lerLS("ef_" + k); if (v != null) d[k] = v; }
    return d;
  }
  function mesclar(remoto, local) {
    const r = Object.assign({}, remoto || {});
    for (const k of CHAVES_SYNC) {
      if (CONJUNTOS.includes(k)) {
        const uniao = new Set([...(r[k] || []), ...(local[k] || [])].map(String));
        if (uniao.size) r[k] = [...uniao];
      } else if (k === "filtros_lista") {
        const lista = (r[k] || []).slice();
        for (const f of local[k] || []) if (!lista.some((x) => x.nome === f.nome)) lista.push(f);
        if (lista.length) r[k] = lista;
      } else if (r[k] == null && local[k] != null) r[k] = local[k];
    }
    return r;
  }
  function aplicar(d) {
    for (const k of CHAVES_SYNC) if (d[k] != null) gravarLS("ef_" + k, d[k]);
    if (window.App && window.App.recarregarPreferencias) window.App.recarregarPreferencias();
  }
  async function baixarEMesclar() {
    const linhas = await chamar("/rest/v1/preferencias?select=dados&user_id=eq." + encodeURIComponent(sessao.user.id), {}, true);
    const remoto = (linhas && linhas[0] && linhas[0].dados) || {};
    const final = mesclar(remoto, coletar());
    aplicar(final);
    await enviar(final);
  }
  let enviando = false, pendente = false, timer = null;
  async function enviar(dados) {
    if (!sessao) return;
    if (enviando) { pendente = true; return; }
    enviando = true;
    try {
      await chamar("/rest/v1/preferencias", {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: { user_id: sessao.user.id, dados: dados || coletar(), atualizado_em: new Date().toISOString() },
      }, true);
      estadoSync("salvo");
    } catch (e) {
      estadoSync("erro");
    } finally {
      enviando = false;
      if (pendente) { pendente = false; enviar(); }
    }
  }
  function marcarAlteracao(chave) {
    if (!ATIVO || !sessao || !CHAVES_SYNC.includes(chave)) return;
    clearTimeout(timer);
    estadoSync("salvando");
    timer = setTimeout(() => enviar(), 1200);
  }
  let ultimoSync = "salvo";
  function estadoSync(s) { ultimoSync = s; const el = document.getElementById("conta-sync"); if (el) el.textContent = textoSync(); }
  const textoSync = () => (ultimoSync === "salvando" ? "Salvando…" : ultimoSync === "erro" ? "Não foi possível salvar agora. Tentamos de novo na próxima mudança." : "Tudo salvo na sua conta.");

  // ------------------------------------------------------------ interface
  const h = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let modal = null, focoAnterior = null;

  function botaoTopo() {
    const b = document.getElementById("conta");
    if (!b) return;
    b.hidden = !ATIVO;
    if (!ATIVO) return;
    if (sessao && sessao.user) {
      const inicial = ((sessao.user.email || "?")[0] || "?").toUpperCase();
      b.innerHTML = `<span class="avatar" aria-hidden="true">${h(inicial)}</span><span class="conta-rot">Minha conta</span>`;
      b.setAttribute("aria-label", "Minha conta (" + (sessao.user.email || "") + ")");
      b.classList.add("logado");
    } else {
      b.innerHTML = `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><circle cx="12" cy="8.5" r="4" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M4.5 20c1.4-3.6 4.3-5.5 7.5-5.5s6.1 1.9 7.5 5.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg><span class="conta-rot">Entrar</span>`;
      b.setAttribute("aria-label", "Entrar ou criar conta");
      b.classList.remove("logado");
    }
  }

  function abrir(vista, msg) {
    fechar(true);
    focoAnterior = document.activeElement;
    modal = document.createElement("div");
    modal.className = "modal-fundo";
    modal.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-titulo"><button class="modal-fechar" type="button" data-fechar aria-label="Fechar">✕</button><div id="modal-corpo"></div></div>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", (e) => { if (e.target === modal || e.target.closest("[data-fechar]")) fechar(); const v = e.target.closest("[data-vista]"); if (v) desenhar(v.dataset.vista); });
    modal.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); fechar(); } });
    modal.addEventListener("submit", enviarForm);
    desenhar(vista, msg);
  }
  function fechar(silencioso) {
    if (!modal) return;
    modal.remove(); modal = null;
    if (!silencioso && focoAnterior && focoAnterior.focus) focoAnterior.focus();
  }
  window.addEventListener("keydown", (e) => { if (e.key === "Escape" && modal) { e.stopImmediatePropagation(); fechar(); } }, true);

  const campo = (id, rot, tipo, extra = "") => `<label class="m-campo" for="${id}"><span>${rot}</span><input id="${id}" name="${id}" type="${tipo}" ${extra} required></label>`;
  function desenhar(vista, msg) {
    const c = modal && modal.querySelector("#modal-corpo");
    if (!c) return;
    const aviso = msg ? `<p class="m-aviso ${msg.tipo || ""}" role="status">${h(msg.texto)}</p>` : "";
    let html = "";
    if (vista === "entrar") {
      html = `<h2 id="modal-titulo">Entrar no ScanBall</h2><p class="sub">Seus favoritos e filtros ficam salvos na conta e aparecem em qualquer aparelho.</p>${aviso}
        <form data-acao="entrar">${campo("m-email", "E-mail", "email", 'autocomplete="email"')}${campo("m-senha", "Senha", "password", 'autocomplete="current-password" minlength="6"')}
        <button class="botao m-principal" type="submit">Entrar</button></form>
        <div class="m-links"><button class="link" type="button" data-vista="esqueci">Esqueci minha senha</button><span>Não tem conta? <button class="link" type="button" data-vista="criar">Criar conta</button></span></div>`;
    } else if (vista === "criar") {
      html = `<h2 id="modal-titulo">Criar conta</h2><p class="sub">Grátis durante os testes. Usamos seu e-mail só para entrar e recuperar a senha.</p>${aviso}
        <form data-acao="criar">${campo("m-email", "E-mail", "email", 'autocomplete="email"')}${campo("m-senha", "Senha (mínimo 6 caracteres)", "password", 'autocomplete="new-password" minlength="6"')}
        <button class="botao m-principal" type="submit">Criar conta</button></form>
        <div class="m-links"><span>Já tem conta? <button class="link" type="button" data-vista="entrar">Entrar</button></span></div>`;
    } else if (vista === "esqueci") {
      html = `<h2 id="modal-titulo">Recuperar senha</h2><p class="sub">Enviamos um link para você criar uma senha nova.</p>${aviso}
        <form data-acao="esqueci">${campo("m-email", "E-mail da conta", "email", 'autocomplete="email"')}
        <button class="botao m-principal" type="submit">Enviar link</button></form>
        <div class="m-links"><button class="link" type="button" data-vista="entrar">Voltar para Entrar</button></div>`;
    } else if (vista === "nova-senha") {
      html = `<h2 id="modal-titulo">Criar senha nova</h2>${aviso}
        <form data-acao="nova-senha">${campo("m-senha", "Senha nova (mínimo 6 caracteres)", "password", 'autocomplete="new-password" minlength="6"')}
        <button class="botao m-principal" type="submit">Salvar senha</button></form>`;
    } else if (vista === "conta") {
      html = `<h2 id="modal-titulo">Minha conta</h2>${aviso}
        <div class="m-conta"><span class="avatar grande" aria-hidden="true">${h(((sessao && sessao.user && sessao.user.email) || "?")[0].toUpperCase())}</span>
          <div><b>${h(sessao && sessao.user && sessao.user.email)}</b><p class="sub" id="conta-sync">${h(textoSync())}</p></div></div>
        <p class="sub">Favoritos de jogos, times e ligas, filtros salvos e preferências da lista ficam guardados na conta.</p>
        <div class="m-acoes"><button class="botao secundario" type="button" data-vista="nova-senha">Trocar senha</button><button class="botao" type="button" id="m-sair">Sair da conta</button></div>`;
    }
    c.innerHTML = html;
    const sair = c.querySelector("#m-sair");
    if (sair) sair.addEventListener("click", sairDaConta);
    const primeiro = c.querySelector("input, button.m-principal, button");
    if (primeiro) primeiro.focus();
  }

  async function enviarForm(e) {
    e.preventDefault();
    const f = e.target, acao = f.dataset.acao;
    const btn = f.querySelector("button[type=submit]");
    const val = (id) => (f.querySelector("#" + id) || {}).value || "";
    btn.disabled = true; const rot = btn.textContent; btn.textContent = "Aguarde…";
    try {
      if (acao === "entrar") {
        const d = await chamar("/auth/v1/token?grant_type=password", { method: "POST", body: { email: val("m-email").trim(), password: val("m-senha") } });
        guardarSessao(d); botaoTopo(); fechar();
        await baixarEMesclar().catch(() => estadoSync("erro"));
        toast("Conectado. Seus favoritos agora ficam salvos na conta.");
      } else if (acao === "criar") {
        const d = await chamar("/auth/v1/signup?redirect_to=" + encodeURIComponent(URL_SITE), { method: "POST", body: { email: val("m-email").trim(), password: val("m-senha") } });
        if (d && d.access_token) { guardarSessao(d); botaoTopo(); fechar(); await baixarEMesclar().catch(() => {}); toast("Conta criada. Você já está conectado."); }
        else desenhar("entrar", { tipo: "ok", texto: "Conta criada. Enviamos um link de confirmação para " + val("m-email").trim() + ". Abra o e-mail, confirme e depois entre aqui." });
      } else if (acao === "esqueci") {
        await chamar("/auth/v1/recover?redirect_to=" + encodeURIComponent(URL_SITE), { method: "POST", body: { email: val("m-email").trim() } });
        desenhar("entrar", { tipo: "ok", texto: "Se existir uma conta com esse e-mail, enviamos o link para criar uma senha nova." });
      } else if (acao === "nova-senha") {
        await chamar("/auth/v1/user", { method: "PUT", body: { password: val("m-senha") } }, true);
        fechar(); toast("Senha alterada.");
      }
    } catch (err) {
      btn.disabled = false; btn.textContent = rot;
      let aviso = f.parentElement.querySelector(".m-aviso");
      if (!aviso) { aviso = document.createElement("p"); aviso.className = "m-aviso"; aviso.setAttribute("role", "alert"); f.before(aviso); }
      aviso.className = "m-aviso erro"; aviso.textContent = traduzir(err);
    }
  }

  async function sairDaConta() {
    try { await chamar("/auth/v1/logout", { method: "POST" }, true); } catch (e) {}
    sessao = null; gravarLS(K_SESSAO, null);
    botaoTopo(); fechar();
    toast("Você saiu da conta. Os favoritos continuam neste aparelho.");
  }

  function toast(texto) {
    let t = document.getElementById("toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = texto; t.classList.add("visivel");
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("visivel"), 4200);
  }

  function iniciar() {
    botaoTopo();
    if (!ATIVO) return;
    document.getElementById("conta").addEventListener("click", () => abrir(sessao ? "conta" : "entrar"));
    avisarRetorno();
    if (sessao) baixarEMesclar().catch(() => {});
  }
  function avisarRetorno() {
    if (abrirNovaSenha) { abrirNovaSenha = false; abrir("nova-senha", { tipo: "ok", texto: "Crie sua senha nova para continuar." }); }
    else if (avisoInicial) { toast(avisoInicial); avisoInicial = null; }
  }

  window.Contas = { ativo: ATIVO, marcarAlteracao, logado: () => !!sessao, iniciar, _mesclar: mesclar };
})();
