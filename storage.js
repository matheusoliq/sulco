/**
 * storage.js
 * ---------------------------------------------------------------------------
 * Todo pedaço de estado que precisa sobreviver a um recarregamento de página
 * passa por este módulo. Ele encapsula o IndexedDB (para tudo que pode
 * crescer bastante ou guarda dados binários - o catálogo de faixas, as
 * imagens de capa, os handles de pasta) e o localStorage (para valores
 * pequenos e síncronos - o nome do tema ativo, a última faixa tocada) atrás
 * de uma pequena API baseada em Promises.
 *
 * POR QUE INDEXEDDB E NÃO SÓ LOCALSTORAGE:
 *  - localStorage é síncrono, só aceita strings, e tem um limite de ~5MB na
 *    maioria dos navegadores. Uma biblioteca com algumas centenas de faixas
 *    com capas embutidas estouraria isso na hora.
 *  - IndexedDB é assíncrono (não trava a thread da interface), tem uma cota
 *    de armazenamento bem maior (gerenciada pelo navegador, geralmente uma
 *    porcentagem relevante do espaço livre em disco), e consegue guardar
 *    Blobs/handles de arquivo nativamente.
 *
 * FORMATO DO BANCO (object stores):
 *  - "tracks"    keyPath "id"   -> metadados da faixa + Blob da capa (sem áudio bruto)
 *  - "folders"   keyPath "id"   -> descritores das pastas monitoradas (veja library.js)
 *  - "playlists" keyPath "id"   -> { id, name, trackIds: [...] }
 *  - "stats"     keyPath "trackId" -> { trackId, playCount, lastPlayedAt, favorite }
 *  - "handles"   keyPath "id"   -> objetos FileSystemDirectoryHandle brutos
 *                                  (só Chromium desktop - veja library.js)
 *  - "audioData" keyPath "trackId" -> { trackId, blob } cópia dos bytes do
 *                                  áudio, guardada apenas para pastas
 *                                  adicionadas pelo modo alternativo
 *                                  (<input webkitdirectory>, usado no
 *                                  Android/Firefox/Safari). É isso que
 *                                  garante tocar as faixas sem precisar
 *                                  reconectar a pasta a cada sessão - veja
 *                                  library.js e o README para o
 *                                  trade-off de espaço em disco envolvido.
 *
 * MELHORIAS FUTURAS:
 *  - Adicionar um helper de migração de schema se o formato dos stores
 *    mudar de novo.
 *  - Mover os Blobs de capa para um store dedicado "covers", indexado por um
 *    hash do conteúdo, para que capas idênticas (mesmo álbum, várias faixas)
 *    sejam guardadas uma única vez - hoje cada faixa mantém sua própria
 *    cópia, por simplicidade.
 */

const DB_NAME = 'sulco-db';
const DB_VERSION = 2;
const STORES = ['tracks', 'folders', 'playlists', 'stats', 'handles', 'audioData'];

/** @type {Promise<IDBDatabase>|null} promise da conexão aberta, em cache */
let dbPromise = null;

/**
 * Abre (ou reaproveita) a única conexão IndexedDB do app. Cria todos os
 * object stores na primeira execução / quando a versão sobe.
 * @returns {Promise<IDBDatabase>}
 */
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          const keyPath = (name === 'stats' || name === 'audioData') ? 'trackId' : 'id';
          db.createObjectStore(name, { keyPath });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

/**
 * Executa uma transação em um object store e embrulha o resultado em uma
 * Promise, para quem chamar poder simplesmente usar `await` em vez de lidar
 * com eventos do IndexedDB na mão.
 * @param {string} storeName
 * @param {'readonly'|'readwrite'} mode
 * @param {(store: IDBObjectStore) => IDBRequest} action - recebe o store,
 *        deve devolver o IDBRequest a esperar (ex: store.put(value))
 * @returns {Promise<any>}
 */
async function withStore(storeName, mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const req = action(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const Storage = {
  /** Salva (cria ou sobrescreve) um único registro. @param {string} storeName @param {object} value deve incluir o campo do keyPath do store */
  put(storeName, value) {
    return withStore(storeName, 'readwrite', (store) => store.put(value));
  },

  /** Salva vários registros em uma única transação (bem mais rápido que N chamadas a put() ao varrer uma pasta). */
  async putMany(storeName, values) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      for (const value of values) store.put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  /** Lê um único registro pela chave primária. @returns {Promise<object|undefined>} */
  get(storeName, key) {
    return withStore(storeName, 'readonly', (store) => store.get(key));
  },

  /** Lê todos os registros de um store. Tranquilo para a nossa escala (uma biblioteca pessoal, não um catálogo de streaming). */
  getAll(storeName) {
    return withStore(storeName, 'readonly', (store) => store.getAll());
  },

  /** Lê só as chaves primárias de um store, sem carregar os registros inteiros (útil para checar rapidamente "quais faixas têm áudio em cache" sem trazer todos os Blobs para a memória). @returns {Promise<Array<string>>} */
  getAllKeys(storeName) {
    return withStore(storeName, 'readonly', (store) => store.getAllKeys());
  },

  /** Apaga um único registro pela chave primária. */
  delete(storeName, key) {
    return withStore(storeName, 'readwrite', (store) => store.delete(key));
  },

  /** Apaga um object store inteiro - usado por "Limpar biblioteca" em Ajustes. */
  clear(storeName) {
    return withStore(storeName, 'readwrite', (store) => store.clear());
  },
};

/**
 * Pequeno helper síncrono de chave/valor sobre o localStorage, para
 * pedacinhos de estado que precisam ser lidos antes mesmo do IndexedDB
 * terminar de abrir (ex: o nome do tema, aplicado em <html> o mais cedo
 * possível para evitar um "flash" do tema errado ao carregar a página).
 */
export const Prefs = {
  /**
   * @param {string} key
   * @param {any} fallback - devolvido se a chave não existir ou o JSON.parse falhar
   */
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(`sulco:${key}`);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  /** @param {string} key @param {any} value - precisa ser serializável em JSON */
  set(key, value) {
    try {
      localStorage.setItem(`sulco:${key}`, JSON.stringify(value));
    } catch (err) {
      // Cota excedida ou restrições de armazenamento em modo anônimo - não é
      // fatal, o app simplesmente volta aos valores padrão na próxima carga.
      console.warn('[storage] Prefs.set falhou para', key, err);
    }
  },
  remove(key) {
    localStorage.removeItem(`sulco:${key}`);
  },
};
