/* ScanBall · service worker (deixa o site ser instalado como app)
 * Sempre busca a versão nova na internet primeiro: nada fica "preso" numa versão velha.
 * Só quando está sem internet abre a última cópia guardada do site (com os últimos dados).
 * Pedidos para outros sites (ESPN, 5Dollar, servidor do ao vivo...) passam direto, sem mexer.
 */
const CACHE = "scanball-v1";
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
    fetch(req).then((r) => {
      if (r && r.ok && r.type === "basic") { const c = r.clone(); caches.open(CACHE).then((cache) => cache.put(chave, c)).catch(() => {}); }
      return r;
    }).catch(async () => {
      const cache = await caches.open(CACHE), pasta = url.origin + url.pathname.replace(/[^/]*$/, "");
      const r = (await cache.match(chave)) || (req.mode === "navigate" ? (await cache.match(pasta)) || (await cache.match(pasta + "index.html")) : null);
      return r || new Response("Sem internet", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    })
  );
});
