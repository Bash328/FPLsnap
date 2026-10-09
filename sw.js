// Network-first so fixtures are always fresh; cached copy is the offline fallback.
addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then(r => {
    const c = r.clone();
    caches.open('fplsnap').then(x => x.put(e.request, c));
    return r;
  }).catch(() => caches.match(e.request)));
});
