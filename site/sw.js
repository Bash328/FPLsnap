// Network-first so fixtures are always fresh; cached copy is the offline fallback.
// Same-origin only: live manager data from the API worker is never cached here.
addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => {
    const c = r.clone();
    caches.open('fplsnap').then(x => x.put(e.request, c)).catch(() => {});
    return r;
  }).catch(() => caches.match(e.request)));
});
