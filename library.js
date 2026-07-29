/**
 * library.js
 * ---------------------------------------------------------------------------
 * Tudo relacionado a *quais pastas o app tem permissão de olhar* e *quais
 * faixas existem dentro delas* vive aqui: adicionar/remover pastas
 * monitoradas, varrer o conteúdo delas, ler as tags de metadados ID3/MP4
 * (título, artista, álbum, gênero, ano, número da faixa, capa embutida), e
 * expor os helpers de busca/ordenação/filtro sobre o catálogo resultante.
 *
 * DUAS FORMAS DE "MONITORAR" UMA PASTA
 * ---------------------------------------------------------------------------
 * 1) File System Access API (`window.showDirectoryPicker()`), disponível no
 *    Chrome/Edge/Opera de desktop. Guardamos o FileSystemDirectoryHandle
 *    devolvido no IndexedDB e pedimos a permissão de novo a cada
 *    inicialização, então a pasta continua "conectada" entre sessões sem o
 *    usuário precisar escolher de novo.
 *
 * 2) Alternativa com `<input type="file" webkitdirectory multiple>`, usada
 *    no Chrome para Android, Firefox e Safari, nenhum dos quais implementa
 *    showDirectoryPicker até o momento. Essa API não tem o conceito de um
 *    handle persistente: ela devolve uma FileList "instantânea", só daquele
 *    momento. Isso significa que, a cada abertura do app, o usuário precisa
 *    tocar em "Reconectar" e escolher a mesma pasta de novo antes da
 *    reprodução voltar a funcionar - o navegador não dá nenhuma forma de
 *    contornar isso. O que *conseguimos* fazer, e fazemos, é guardar em
 *    cache os metadados de cada faixa (título/artista/capa/etc.), indexados
 *    pelo caminho relativo + tamanho + data de modificação, para que a lista
 *    da biblioteca, a busca, as playlists e os favoritos continuem
 *    funcionando a partir do cache imediatamente ao abrir o app; só *tocar*
 *    uma faixa de fato exige o File atualizado de uma pasta reconectada.
 *    Veja o README.md -> "Limitações do navegador" para a explicação
 *    completa que o código deste arquivo implementa.
 *
 * Este módulo propositalmente NÃO guarda os bytes brutos do áudio em lugar
 * nenhum - só metadados + uma pequena imagem de capa por faixa. O áudio é
 * sempre tocado diretamente do File que o navegador nos deu (via um Blob URL
 * criado sob demanda em player.js), o que mantém o uso de armazenamento
 * mínimo e respeita os arquivos originais do usuário.
 *
 * MELHORIAS FUTURAS:
 *  - Mover a varredura recursiva de pastas + leitura de tags para um Web
 *    Worker, para a varredura de uma biblioteca enorme nunca tocar na thread
 *    principal (hoje ela cede o controle periodicamente, o que já fica
 *    suave, mas não é "custo zero").
 *  - Adicionar uma história de "observar mudanças" usando a (ainda
 *    experimental) FileSystemObserver API quando ela for suportada de forma
 *    mais ampla.
 */

import { Storage, Prefs } from './storage.js';
import { uid, firstNonEmpty, readAudioDuration, matchesQuery } from './utils.js';

const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'opus'];

/** @returns {boolean} true se este navegador consegue monitorar pastas reais de forma persistente */
export function supportsPersistentFolders() {
  return 'showDirectoryPicker' in window;
}

/** Cache em memória do catálogo completo, sincronizado com o IndexedDB. Exposto somente-leitura via Library.getAll(). */
let trackCache = [];
/** trackId -> objeto File "vivo" para a sessão atual (só existe em memória, nunca é persistido). */
const fileRefs = new Map();
/** trackId -> object URL da capa, criado sob demanda e revogado ao recarregar a biblioteca. */
const coverUrlCache = new Map();

function extensionOf(filename) {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
}

/**
 * Monta um id estável para um arquivo, para que varrer a mesma pasta de novo
 * atualize a faixa existente em vez de criar uma duplicata. Baseado em
 * caminho + tamanho + data de modificação, em vez de um hash de conteúdo
 * (fazer hash dos bytes de cada arquivo a cada varredura seria lento demais
 * para bibliotecas grandes).
 */
function stableTrackId(relativePath, size, lastModified) {
  return `t_${relativePath}_${size}_${lastModified}`.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

/**
 * Varre recursivamente um FileSystemDirectoryHandle, retornando cada
 * arquivo de áudio encontrado (em qualquer profundidade) junto com seu
 * caminho relativo à pasta raiz monitorada.
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} path - caminho relativo acumulado, usado internamente na recursão
 * @yields {{file: File, relativePath: string}}
 */
async function* walkDirectoryHandle(dirHandle, path = '') {
  for await (const [name, handle] of dirHandle.entries()) {
    const entryPath = path ? `${path}/${name}` : name;
    if (handle.kind === 'directory') {
      yield* walkDirectoryHandle(handle, entryPath);
    } else if (AUDIO_EXTENSIONS.includes(extensionOf(name))) {
      const file = await handle.getFile();
      yield { file, relativePath: entryPath };
    }
  }
}

/**
 * Lê as tags ID3/MP4 de um File usando a biblioteca jsmediatags (carregada
 * globalmente via <script> de um CDN em index.html - veja o README para o
 * motivo de usar uma <script> simples em vez de um import npm para essa
 * única dependência). Cai para extrair "Artista - Título.ext" do nome do
 * arquivo, e para uma checagem de duração via <audio> (mais lenta, porém
 * real), quando as tags estão ausentes/ilegíveis.
 *
 * @param {File} file
 * @param {string} relativePath
 * @returns {Promise<{title:string, artist:string, album:string, genre:string, year:string, track:string, coverBlob: Blob|null, duration:number}>}
 */
async function readTags(file, relativePath) {
  const nameWithoutExt = file.name.replace(/\.[^.]+$/, '');
  let guessedArtist = '';
  let guessedTitle = nameWithoutExt;
  const dashSplit = nameWithoutExt.split(' - ');
  if (dashSplit.length >= 2) {
    guessedArtist = dashSplit[0].trim();
    guessedTitle = dashSplit.slice(1).join(' - ').trim();
  }

  const tagResult = await new Promise((resolve) => {
    if (!window.jsmediatags) {
      resolve(null);
      return;
    }
    window.jsmediatags.read(file, {
      onSuccess: (result) => resolve(result.tags),
      // Uma falha de leitura (tag corrompida, container não suportado, etc)
      // é comum o bastante com arquivos vindos de apps de download
      // variados, então tratamos isso como "sem tags" em vez de um erro grave.
      onError: () => resolve(null),
    });
  });

  let coverBlob = null;
  if (tagResult && tagResult.picture) {
    const { data, format } = tagResult.picture;
    coverBlob = new Blob([new Uint8Array(data)], { type: format || 'image/jpeg' });
  }

  const duration = await readAudioDuration(file);

  return {
    title: firstNonEmpty(tagResult?.title, guessedTitle, file.name),
    artist: firstNonEmpty(tagResult?.artist, guessedArtist, 'Artista desconhecido'),
    album: firstNonEmpty(tagResult?.album, 'Álbum desconhecido'),
    genre: firstNonEmpty(tagResult?.genre, ''),
    year: firstNonEmpty(tagResult?.year, ''),
    track: firstNonEmpty(tagResult?.track, ''),
    coverBlob,
    duration,
  };
}

/**
 * Persiste (ou atualiza) um registro de faixa no IndexedDB e no cache em
 * memória. Reaproveitado tanto pelo caminho de varredura via FS Access
 * quanto pelo caminho via webkitdirectory, para a lógica de leitura de tags
 * nunca precisar ser escrita duas vezes.
 */
async function upsertTrack({ file, relativePath, folderId }) {
  const id = stableTrackId(relativePath, file.size, file.lastModified);
  fileRefs.set(id, file);

  const existing = trackCache.find((t) => t.id === id);
  if (existing) {
    // Já conhecida e sem alterações (mesmo tamanho + mtime => mesmo id
    // estável) - nada para reler, só garantimos que o vínculo com a pasta
    // está atualizado.
    existing.folderId = folderId;
    return existing;
  }

  const tags = await readTags(file, relativePath);
  const track = {
    id,
    folderId,
    relativePath,
    fileName: file.name,
    fileSize: file.size,
    lastModified: file.lastModified,
    title: tags.title,
    artist: tags.artist,
    album: tags.album,
    genre: tags.genre,
    year: tags.year,
    trackNumber: tags.track,
    duration: tags.duration,
    coverBlob: tags.coverBlob,
    dateAdded: Date.now(),
  };
  trackCache.push(track);
  await Storage.put('tracks', track);
  return track;
}

export const Library = {
  /** @returns {Array<object>} cópia rasa do catálogo completo em memória */
  getAll() {
    return trackCache.slice();
  },

  /**
   * Carrega o que foi varrido anteriormente, do IndexedDB para a memória.
   * Chame uma vez na inicialização do app, para a interface ter algo para
   * mostrar antes mesmo de qualquer (re)varredura terminar - é isso que faz
   * a biblioteca "carregar instantaneamente" mesmo no modo alternativo
   * (webkitdirectory), onde os arquivos em si ainda não foram reconectados.
   */
  async loadFromCache() {
    trackCache = await Storage.getAll('tracks');
    return trackCache;
  },

  /** @returns {Array<object>} a lista de descritores de pastas monitoradas */
  async getFolders() {
    return Storage.getAll('folders');
  },

  /**
   * Abre o seletor nativo de pastas (File System Access API) e adiciona a
   * pasta escolhida à lista de monitoradas, varrendo-a em seguida.
   * @param {(scanned:number) => void} [onProgress] - chamado após cada arquivo processado
   * @returns {Promise<object>} o novo descritor de pasta
   * @throws se o navegador não suportar showDirectoryPicker, ou o usuário cancelar o seletor
   */
  async addFolderWithPicker(onProgress) {
    if (!supportsPersistentFolders()) {
      throw new Error('UNSUPPORTED_PICKER');
    }
    const handle = await window.showDirectoryPicker({ mode: 'read' });
    const folder = { id: uid(), name: handle.name, kind: 'handle', addedAt: Date.now() };
    await Storage.put('handles', { id: folder.id, handle });
    await Storage.put('folders', folder);
    await this.scanHandleFolder(folder, handle, onProgress);
    return folder;
  },

  /**
   * Registra uma pasta escolhida via a alternativa <input webkitdirectory> e
   * varre a FileList que ela devolveu. Como essa API não pode ser "reaberta"
   * automaticamente, este mesmo método também serve como a ação de
   * "reconectar pasta": basta chamá-lo de novo com uma FileList atualizada
   * para atualizar uma pasta já existente (identificada pelo nome).
   * @param {FileList} fileList
   * @param {(scanned:number) => void} [onProgress]
   * @returns {Promise<object>} o descritor da pasta
   */
  async addFolderFromFileList(fileList, onProgress) {
    const files = Array.from(fileList).filter((f) => AUDIO_EXTENSIONS.includes(extensionOf(f.name)));
    if (files.length === 0) throw new Error('NO_AUDIO_FILES');
    const rootName = files[0].webkitRelativePath.split('/')[0];

    const folders = await Storage.getAll('folders');
    let folder = folders.find((f) => f.kind === 'manual' && f.name === rootName);
    if (!folder) {
      folder = { id: uid(), name: rootName, kind: 'manual', addedAt: Date.now() };
      await Storage.put('folders', folder);
    }

    let count = 0;
    for (const file of files) {
      await upsertTrack({ file, relativePath: file.webkitRelativePath, folderId: folder.id });
      count++;
      if (onProgress) onProgress(count);
      // Cede o controle à thread principal a cada punhado de arquivos, para
      // ler as tags de uma pasta grande nunca travar a rolagem/animações.
      if (count % 8 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    return folder;
  },

  /**
   * Varre novamente um FileSystemDirectoryHandle cuja permissão já foi
   * concedida antes. Usado tanto na varredura inicial logo após escolher uma
   * pasta quanto para uma atualização manual ("atualizar biblioteca") a
   * partir de Ajustes.
   * @param {object} folder - descritor da pasta ({id, name, ...})
   * @param {FileSystemDirectoryHandle} handle
   * @param {(scanned:number) => void} [onProgress]
   */
  async scanHandleFolder(folder, handle, onProgress) {
    let count = 0;
    for await (const { file, relativePath } of walkDirectoryHandle(handle)) {
      await upsertTrack({ file, relativePath, folderId: folder.id });
      count++;
      if (onProgress) onProgress(count);
      if (count % 8 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  },

  /**
   * Verifica (e, se necessário, pede de novo) a permissão de leitura de cada
   * pasta baseada em handle, e depois varre cada uma. Deve rodar uma vez na
   * inicialização do app, em navegadores que suportam handles persistentes.
   *
   * CUIDADO: `requestPermission()` só pode ser chamado dentro de um gesto do
   * usuário (um clique), então, ao iniciar o app "a frio", nós só
   * *verificamos* a permissão (queryPermission) e marcamos as pastas que
   * precisam do usuário tocar em "Reconectar"; só chamamos requestPermission
   * em resposta a esse toque (veja `reconnectFolder` em settings.js).
   * @returns {Promise<Array<{folder:object, needsPermission:boolean}>>}
   */
  async refreshHandleFolders() {
    const folders = await Storage.getAll('folders');
    const results = [];
    for (const folder of folders.filter((f) => f.kind === 'handle')) {
      const record = await Storage.get('handles', folder.id);
      if (!record || !record.handle) {
        results.push({ folder, needsPermission: true });
        continue;
      }
      const permission = await record.handle.queryPermission({ mode: 'read' });
      if (permission === 'granted') {
        await this.scanHandleFolder(folder, record.handle);
        results.push({ folder, needsPermission: false });
      } else {
        results.push({ folder, needsPermission: true });
      }
    }
    return results;
  },

  /**
   * Pede a permissão de novo para uma pasta baseada em handle, em resposta a
   * um clique do usuário, e depois varre. Precisa ser chamado
   * (de forma síncrona o quanto der) dentro da cadeia de um handler de
   * clique - assíncrono tudo bem, só não `await` algo demorado antes.
   * @param {string} folderId
   * @param {(scanned:number) => void} [onProgress]
   */
  async reconnectHandleFolder(folderId, onProgress) {
    const folder = await Storage.get('folders', folderId);
    const record = await Storage.get('handles', folderId);
    if (!record?.handle) throw new Error('HANDLE_MISSING');
    const permission = await record.handle.requestPermission({ mode: 'read' });
    if (permission !== 'granted') throw new Error('PERMISSION_DENIED');
    await this.scanHandleFolder(folder, record.handle, onProgress);
  },

  /**
   * Remove uma pasta monitorada e todas as faixas que vieram dela (tanto da
   * memória quanto do IndexedDB). Playlists/favoritos que referenciam essas
   * faixas simplesmente perdem um id válido - a interface filtra esses
   * casos de forma defensiva.
   * @param {string} folderId
   */
  async removeFolder(folderId) {
    const toRemove = trackCache.filter((t) => t.folderId === folderId);
    for (const track of toRemove) {
      await Storage.delete('tracks', track.id);
      fileRefs.delete(track.id);
      const url = coverUrlCache.get(track.id);
      if (url) { URL.revokeObjectURL(url); coverUrlCache.delete(track.id); }
    }
    trackCache = trackCache.filter((t) => t.folderId !== folderId);
    await Storage.delete('folders', folderId);
    await Storage.delete('handles', folderId);
  },

  /**
   * Devolve um Blob URL tocável para uma faixa, se atualmente tivermos uma
   * referência de File "viva" para ela (ou seja, a pasta da faixa está
   * conectada nesta sessão). Devolve null se a pasta precisar ser
   * reconectada primeiro - a interface deve mostrar isso como "reconecte a
   * pasta X para tocar".
   * @param {string} trackId
   * @returns {string|null}
   */
  getPlayableUrl(trackId) {
    const file = fileRefs.get(trackId);
    if (!file) return null;
    return URL.createObjectURL(file);
  },

  /** @param {string} trackId @returns {boolean} se esta faixa pode ser tocada agora sem reconectar nada */
  isPlayable(trackId) {
    return fileRefs.has(trackId);
  },

  /**
   * Devolve um object URL pronto para exibir com a capa embutida de uma
   * faixa, ou a imagem de capa padrão compartilhada, se ela não tiver
   * nenhuma. As URLs ficam em cache por faixa durante a vida da página, para
   * o mesmo src de <img> não ficar sendo regenerado a cada re-renderização.
   * @param {object} track
   * @returns {string}
   */
  getCoverUrl(track) {
    if (!track.coverBlob) return 'assets/images/default-cover.png';
    if (coverUrlCache.has(track.id)) return coverUrlCache.get(track.id);
    const url = URL.createObjectURL(track.coverBlob);
    coverUrlCache.set(track.id, url);
    return url;
  },

  // ---- Helpers de busca / ordenação / filtro -------------------------------------

  /** @param {string} query @returns {Array<object>} faixas cujo título/artista/álbum bate com a busca */
  search(query) {
    return trackCache.filter(
      (t) => matchesQuery(t.title, query) || matchesQuery(t.artist, query) || matchesQuery(t.album, query)
    );
  },

  /**
   * @param {Array<object>} tracks
   * @param {'title'|'artist'|'album'|'dateAdded'|'duration'} key
   * @returns {Array<object>} novo array ordenado (não altera o array de entrada)
   */
  sortTracks(tracks, key) {
    const copy = tracks.slice();
    copy.sort((a, b) => {
      if (key === 'dateAdded' || key === 'duration') return (b[key] || 0) - (a[key] || 0);
      return String(a[key] || '').localeCompare(String(b[key] || ''), 'pt-BR');
    });
    return copy;
  },

  // ---- Favoritos / estatísticas de reprodução (guardados no object store "stats") -------

  /** @returns {Promise<Map<string, object>>} trackId -> {trackId, favorite, playCount, lastPlayedAt} */
  async getAllStats() {
    const rows = await Storage.getAll('stats');
    return new Map(rows.map((r) => [r.trackId, r]));
  },

  /** @param {string} trackId @returns {Promise<boolean>} o novo estado de favorito */
  async toggleFavorite(trackId) {
    const stat = (await Storage.get('stats', trackId)) || { trackId, favorite: false, playCount: 0, lastPlayedAt: 0 };
    stat.favorite = !stat.favorite;
    await Storage.put('stats', stat);
    return stat.favorite;
  },

  /** Registra uma reprodução: incrementa playCount e atualiza lastPlayedAt, alimentando "Mais tocadas" e "Recentes". */
  async recordPlay(trackId) {
    const stat = (await Storage.get('stats', trackId)) || { trackId, favorite: false, playCount: 0, lastPlayedAt: 0 };
    stat.playCount += 1;
    stat.lastPlayedAt = Date.now();
    await Storage.put('stats', stat);
    return stat;
  },

  // ---- Playlists -----------------------------------------------------------

  /** @returns {Promise<Array<{id:string, name:string, trackIds:string[]}>>} */
  getPlaylists() {
    return Storage.getAll('playlists');
  },

  /** @param {string} name @returns {Promise<object>} a playlist criada */
  async createPlaylist(name) {
    const playlist = { id: uid(), name, trackIds: [], createdAt: Date.now() };
    await Storage.put('playlists', playlist);
    return playlist;
  },

  /** @param {string} playlistId */
  async deletePlaylist(playlistId) {
    await Storage.delete('playlists', playlistId);
  },

  /** @param {string} playlistId @param {string} trackId */
  async addToPlaylist(playlistId, trackId) {
    const playlist = await Storage.get('playlists', playlistId);
    if (!playlist.trackIds.includes(trackId)) playlist.trackIds.push(trackId);
    await Storage.put('playlists', playlist);
    return playlist;
  },

  /** @param {string} playlistId @param {string} trackId */
  async removeFromPlaylist(playlistId, trackId) {
    const playlist = await Storage.get('playlists', playlistId);
    playlist.trackIds = playlist.trackIds.filter((id) => id !== trackId);
    await Storage.put('playlists', playlist);
    return playlist;
  },

  /** @param {string} playlistId @param {string} newName */
  async renamePlaylist(playlistId, newName) {
    const playlist = await Storage.get('playlists', playlistId);
    playlist.name = newName;
    await Storage.put('playlists', playlist);
    return playlist;
  },
};
