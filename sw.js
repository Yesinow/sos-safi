
const CACHE_NAME = 'sos-safi-cache-v1';
const CORE = [
  './',
  './agent.html',
  './admin.html',
  './db.js',
  './manifest.webmanifest',
  './icons/192.png',
  './icons/512.png'
];
self.addEventListener('install', (e)=>{
  e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(CORE)));
  self.skipWaiting();
});
self.addEventListener('activate', (e)=>{
  e.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', (event)=>{
  const { request } = event;
  // réseau d'abord pour HTML, cache d'abord pour le reste
  if(request.mode === 'navigate'){
    event.respondWith(fetch(request).catch(()=>caches.match('./agent.html')));
    return;
  }
  event.respondWith(
    caches.match(request).then((cached)=>{
      const fetchPromise = fetch(request).then((networkResponse)=>{
        // mettre en cache les réponses GET
        if(request.method==='GET' && networkResponse && networkResponse.ok){
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache=>cache.put(request, copy));
        }
        return networkResponse;
      }).catch(()=>cached || Promise.reject('no-match'));
      return cached || fetchPromise;
    })
  );
});
