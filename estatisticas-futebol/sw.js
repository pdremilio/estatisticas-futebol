/* ScanBall · service worker (deixa o site ser instalado como app)
 * Sempre busca a versão nova na internet primeiro: nada fica "preso" numa versão velha.
 * Só quando está sem internet abre a última cópia guardada do site (com os últimos dados).
 * Beta 9: a página sempre revalida com o servidor (nunca fica numa versão velha depois de uma atualização).
 * Pedidos para outros sites (ESPN, 5Dollar, servidor do ao vivo...) passam direto, sem mexer.
 */
const CACHE = "scanball-v3"; // beta 9: troca o nome para descartar as cópias antigas
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  // a chave ignora o "?v=..." (muda a cada 2 min): guarda só a última cópia de cada arquivo
  const chave = url.origin + url.pathname;
  e.respondWith(
    // a página (index.html/teste.html) sempre confere com o servidor, sem usar a cópia do navegador: senão, logo depois
    // de uma atualização, o aviso "atualizado" voltava ou a página nova demorava até 10 min para chegar
    (req.mode === "navigate" ? fetch(req.url, { cache: "no-cache", credentials: "same-origin" }) : fetch(req)).then((r) => {
      if (r && r.ok && r.type === "basic") { const c = r.clone(); caches.open(CACHE).then((cache) => cache.put(chave, c)).catch(() => {}); }
      return r;
    }).catch(async () => {
      const cache = await caches.open(CACHE), pasta = url.origin + url.pathname.replace(/[^/]*$/, "");
      const r = (await cache.match(chave)) || (req.mode === "navigate" ? (await cache.match(pasta)) || (await cache.match(pasta + "index.html")) : null);
      return r || new Response("Sem internet", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    })
  );
});

// toque numa notificação: abre (ou traz para frente) o ScanBall no jogo do aviso
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const alvo = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((lista) => {
    for (const c of lista) {
      if (new URL(c.url).origin === self.location.origin) { return c.focus().then((w) => (w && w.navigate ? w.navigate(new URL(alvo, self.location.origin).href) : w)).catch(() => {}); }
    }
    return self.clients.openWindow(alvo);
  }));
});
