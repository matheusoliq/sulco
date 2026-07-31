/**
 * utils.js
 * ---------------------------------------------------------------------------
 * Conjunto de funções auxiliares, sem dependências, usadas por todos os
 * outros módulos do app (player.js, library.js, settings.js, theme.js,
 * script.js).
 *
 * Nada neste arquivo mexe diretamente no DOM e nada aqui é específico do
 * "Sulco" - se você reaproveitar este template em outro projeto, pode copiar
 * este arquivo sem alterações.
 *
 * MELHORIAS FUTURAS:
 *  - Poderia ser dividido em utils/format.js, utils/color.js, utils/dom.js
 *    se o arquivo crescer muito mais. Por enquanto ficou como um único
 *    arquivo porque o pedido original deste projeto pediu uma lista de
 *    arquivos simples e fácil de navegar.
 */

/**
 * Formata uma duração em segundos como "m:ss" (ou "h:mm:ss" quando passa de
 * uma hora, útil para sets de DJ / audiobooks longos que acabem parando na
 * biblioteca).
 *
 * @param {number} totalSeconds - duração em segundos. Valores NaN/Infinity/
 *        negativos são tratados como 0, para a interface nunca mostrar
 *        "NaN:NaN".
 * @returns {string} tempo legível, ex: "3:07" ou "1:02:45"
 *
 * CUIDADO: isso sempre arredonda os segundos para baixo (nunca para cima),
 * para o tempo exibido nunca "pular" para o próximo segundo antes da hora.
 */
export function formatTime(totalSeconds) {
  if (!isFinite(totalSeconds) || totalSeconds < 0) totalSeconds = 0;
  const s = Math.floor(totalSeconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const paddedSeconds = String(seconds).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${paddedSeconds}`;
  }
  return `${minutes}:${paddedSeconds}`;
}

/**
 * Debounce clássico: devolve uma versão "embrulhada" de `fn` que só executa
 * de fato depois que `wait` milissegundos se passarem sem que ela seja
 * chamada de novo. Usado no campo de busca instantânea, para não refiltrar
 * a biblioteca inteira a cada tecla digitada.
 *
 * @param {Function} fn - função a ser "debounced"
 * @param {number} wait - milissegundos a esperar após a última chamada
 * @returns {Function} função com debounce (mesmos argumentos de fn)
 */
export function debounce(fn, wait = 200) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/**
 * Limita um número entre um mínimo e um máximo.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number} valor forçado dentro do intervalo [min, max]
 */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Gera um id razoavelmente único para faixas/playlists criadas em tempo de
 * execução (ids de playlist, itens da fila, etc). Não precisa ser
 * criptograficamente seguro - é usado só como chave primária local.
 * @returns {string}
 */
export function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Escapa uma string para inserção segura via innerHTML, evitando que uma
 * faixa com "<" ou "&" no título (coisa que acontece com tags vindas de
 * apps de download variados) quebre o layout.
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escolhe a primeira string não vazia de uma lista de candidatas, caindo
 * para um valor padrão. Útil para casos como "Artista desconhecido" quando
 * as tags ID3 estão ausentes ou vêm como string vazia em vez de ausentes.
 * @param {...(string|undefined|null)} candidates
 * @returns {string}
 */
export function firstNonEmpty(...candidates) {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c.trim();
  }
  return candidates[candidates.length - 1] || '';
}

/**
 * Extrai uma pequena paleta (cor dominante + cor de destaque) de um elemento
 * <img> ou algo desenhável em <canvas>, reduzindo a imagem para uma
 * resolução minúscula e calculando a média de blocos de pixels. É isso que
 * gera o gradiente atrás da tela "Tocando agora" e a cor de destaque usada
 * nos controles dessa tela.
 *
 * COMO FUNCIONA: desenhamos a imagem numa resolução minúscula (32x32) - bem
 * mais rápido que varrer a imagem em tamanho real - depois agrupamos os
 * pixels em uma grade grosseira e devolvemos os dois grupos mais
 * frequentes/saturados como strings CSS rgb().
 *
 * CUIDADO: isso exige que a imagem seja da mesma origem ou servida com
 * cabeçalhos CORS corretos, porque ler dados de pixel "contamina" o canvas
 * segundo as regras do navegador. Arquivos locais carregados via
 * URL.createObjectURL() são considerados da mesma origem do ponto de vista
 * da página, então isso funciona bem para o caso de uso do app (capa de
 * álbum extraída de arquivos no aparelho do usuário), mas lançaria um
 * SecurityError para uma <img> remota qualquer sem crossorigin configurado.
 *
 * @param {HTMLImageElement} img - um elemento de imagem já carregado (complete)
 * @returns {{primary: string, secondary: string}} duas strings rgb()
 */
export function extractPalette(img) {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const fallback = { primary: 'rgb(22,21,27)', secondary: 'rgb(124,111,203)' };
  try {
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);
    const buckets = new Map(); // chave: cor quantizada, valor: {count, r,g,b, saturation}
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 128) continue; // ignora pixels transparentes
      // Quantiza para reduzir o espaço de cores em grupos com significado
      const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const saturation = max === 0 ? 0 : (max - min) / max;
      const lightness = (max + min) / 2 / 255;
      // Ignora pixels quase pretos / quase brancos - raramente viram um bom destaque
      if (lightness < 0.08 || lightness > 0.92) continue;
      const entry = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0, saturation: 0 };
      entry.count++;
      entry.r += r; entry.g += g; entry.b += b;
      entry.saturation = Math.max(entry.saturation, saturation);
      buckets.set(key, entry);
    }
    const sorted = [...buckets.values()]
      .map((e) => ({ r: Math.round(e.r / e.count), g: Math.round(e.g / e.count), b: Math.round(e.b / e.count), score: e.count * (0.4 + e.saturation) }))
      .sort((a, b) => b.score - a.score);
    if (sorted.length === 0) return fallback;
    const primary = sorted[0];
    const secondary = sorted.find((c) => Math.abs(c.r - primary.r) + Math.abs(c.g - primary.g) + Math.abs(c.b - primary.b) > 90) || sorted[Math.min(1, sorted.length - 1)];
    return {
      primary: `rgb(${primary.r},${primary.g},${primary.b})`,
      secondary: `rgb(${secondary.r},${secondary.g},${secondary.b})`,
    };
  } catch (err) {
    // Qualquer erro de canvas/segurança cai para a paleta padrão da marca
    console.warn('[utils] extractPalette falhou, usando paleta padrão:', err);
    return fallback;
  }
}

/**
 * Comparador simples (não é uma busca fuzzy completa) usado na tela de
 * busca: retorna true se cada "palavra" digitada pelo usuário aparece em
 * algum lugar da string alvo (sem diferenciar maiúsculas/minúsculas ou
 * acentos). Isso é intencionalmente simples em vez de uma biblioteca de
 * busca fuzzy completa, já que o tamanho das bibliotecas envolvidas (a
 * pasta de músicas de um celular pessoal) torna uma varredura linear rápida
 * o suficiente.
 * @param {string} target - ex: o título de uma faixa
 * @param {string} query - texto digitado pelo usuário
 * @returns {boolean}
 */
export function matchesQuery(target, query) {
  if (!query) return true;
  const normalize = (s) => s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // remove acentos para "café" bater com "cafe"
  const t = normalize(target || '');
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  return words.every((w) => t.includes(w));
}

/**
 * Lê a duração de áudio de um File/Blob sem decodificá-lo por completo,
 * carregando-o num elemento <audio> descartável e esperando o evento
 * `loadedmetadata`. Usado como alternativa quando as tags ID3 não trazem
 * informação de duração.
 * @param {File} file
 * @returns {Promise<number>} duração em segundos (0 se falhar)
 */
export function readAudioDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const cleanup = () => URL.revokeObjectURL(url);
    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', () => {
      resolve(isFinite(audio.duration) ? audio.duration : 0);
      cleanup();
    });
    audio.addEventListener('error', () => {
      resolve(0);
      cleanup();
    });
    audio.src = url;
  });
}

/**
 * Formata uma contagem de faixas para rótulos pequenos, ex: "12 faixas" vs "1 faixa".
 * @param {number} count
 * @returns {string}
 */
export function pluralTracks(count) {
  return `${count} ${count === 1 ? 'faixa' : 'faixas'}`;
}

/**
 * @returns {boolean} true quando este código roda dentro do wrapper nativo
 * Android (projeto sulco-android/), detectado pela presença do objeto
 * `window.AndroidBridge` que o MainActivity.kt injeta via
 * `@JavascriptInterface`. Em qualquer navegador comum isso é sempre false,
 * e o app se comporta exatamente como a versão web/PWA - veja
 * android-bridge.js para onde isso é usado.
 */
export function isAndroidNative() {
  return typeof window !== 'undefined' && typeof window.AndroidBridge === 'object' && window.AndroidBridge !== null;
}
