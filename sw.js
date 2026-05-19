const CACHE = 'outline-v19'
const PRECACHE = [
  './',
  './index.html',
  './documentation.html',
  './libs/deps.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
]

// Hosts whose responses must always go to the network — never cache.
// Firebase SDK + API endpoints stay live so we don't pin to a stale version
// or accidentally cache user data fetched from Firestore/Storage.
const NETWORK_ONLY_HOSTS = [
  'gstatic.com',
  'googleapis.com',
  'firebaseio.com',
  'firebaseapp.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
]

function isNetworkOnly(url) {
  try {
    const host = new URL(url).host
    return NETWORK_ONLY_HOSTS.some(h => host === h || host.endsWith('.' + h))
  } catch { return false }
}

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)))
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ))
  self.clients.claim()
})

self.addEventListener('fetch', e => {
  if (isNetworkOnly(e.request.url)) return  // let the browser handle it
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached
      return fetch(e.request).then(resp => {
        // Cache CDN resources (KaTeX) on first fetch
        if (e.request.url.includes('jsdelivr.net')) {
          const clone = resp.clone()
          caches.open(CACHE).then(c => c.put(e.request, clone))
        }
        return resp
      })
    })
  )
})
