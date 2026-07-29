/**
 * service-worker.js
 * ---------------------------------------------------------------------------
 * Faz o "app shell" (HTML/CSS/JS/ícones) funcionar totalmente offline depois
 * da primeira visita, e permite que as fontes + o script do CDN do
 * jsmediatags continuem funcionando offline depois de já terem sido
 * buscados uma vez.
 *
 * O QUE ISTO *NÃO* GUARDA EM CACHE: os arquivos de música do usuário. Eles
 * nunca são buscados pela rede, para começo de conversa - são lidos direto
 * do disco via File System Access API / <input webkitdirectory> e tocados
 * através de Blob URLs (veja library.js/player.js), então não há nada de
 * música para o service worker interceptar ou guardar. Isso mantém o cache
 * pequeno (algumas centenas de KB do app shell), independente do tamanho da
 * biblioteca de músicas do usuário.
 *
 * ESTRATÉGIAS DE CACHE USADAS
 *  - App shell (arquivos do próprio app): cache-first, caindo para a rede se
 *    faltar. Aumente CACHE_VERSION sempre que mudar um desses arquivos, para
 *    quem já tinha instalado o app receber a atualização em vez de uma
 *    cópia antiga em cache.
 *  - Requisições de navegação (HTML): network-first (para uma atualização
 *    publicada aparecer na hora quando online), caindo para o shell em
 *    cache quando offline.
 *  - Recursos de outra origem (Google Fonts, o script do CDN do
 *    jsmediatags): stale-while-revalidate - serve a cópia em cache na hora,
 *    se tivermos uma, e atualiza o cache silenciosamente em segundo plano
 *    para a próxima vez.
 *
 * MELHORIAS FUTURAS:
 *  - Adicionar um aviso do tipo "nova versão disponível, toque para
 *    atualizar" mandando uma mensagem para a página a partir do handler de
 *    `activate`, em vez de assumir o controle silenciosamente.
 */

const CACHE_VERSION = 'sulco-v1';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const SHELL_URLS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './player.js',
  './library.js',
  './settings.js',
  './theme.js',
  './storage.js',
  './utils.js',
  './manifest.json',
  './assets/icons/icon-72.png',
  './assets/icons/icon-96.png',
  './assets/icons/icon-128.png',
  './assets/icons/icon-144.png',
  './assets/icons/icon-152.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-384.png',
  './assets/icons/icon-512.png',
  './assets/icons/maskable-192.png',
  './assets/icons/maskable-512.png',
  './assets/vinyl/vinyl-disc.png',
  './assets/images/default-cover.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith('sulco-') && key !== SHELL_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

/** Network-first: tenta a rede, cai para o que estiver em cache; usado para navegações de HTML. */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(SHELL_CACHE);
    cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || caches.match('./index.html');
  }
}

/** Cache-first: serve do cache na hora, atualiza a cópia da rede em segundo plano para a próxima vez. */
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  const networkFetch = fetch(request).then((response) => {
    if (response && response.status === 200) {
      caches.open(cacheName).then((cache) => cache.put(request, response.clone()));
    }
    return response;
  }).catch(() => null);
  return cached || networkFetch;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // não intercepta nada além de GET

  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  // Origem cruzada (CSS/arquivos do Google Fonts, pacote do CDN do
  // jsmediatags): cache de forma opaca, para o app continuar iniciando
  // offline depois da primeira carga bem-sucedida.
  if (url.hostname.includes('googleapis.com') || url.hostname.includes('gstatic.com') || url.hostname.includes('jsdelivr.net')) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
  }
});
