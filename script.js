/**
 * script.js
 * ---------------------------------------------------------------------------
 * O ponto de entrada e o controlador de interface do app. Carregado como
 * `<script type="module">` a partir do index.html, o que é o que permite ele
 * fazer `import` de todos os outros arquivos como módulos ES de verdade, em
 * vez de depender de variáveis globais.
 *
 * Responsabilidades:
 *   - Sequência de inicialização (splash screen, carregar a biblioteca em
 *     cache, aplicar o tema, registrar o service worker, reconectar pastas).
 *   - Navegação entre as 5 abas da barra inferior + a tela de detalhe de playlist.
 *   - Renderizar cada lista/grade (linhas do Início, resultados de Busca,
 *     lista da Biblioteca, grade/detalhe de Playlists, a Fila de reprodução)
 *     a partir dos dados de library.js.
 *   - Conectar o mini player, a tela cheia "Tocando agora" (incluindo o giro
 *     do vinil + o fundo com cor dominante), e as sheets (fila / mais opções
 *     / ações da faixa).
 *   - Assinar o barramento de eventos de player.js para manter tudo isso
 *     sincronizado com o estado real de reprodução.
 *
 * Nada aqui contém lógica de negócio que deveria estar nos outros módulos -
 * se você está procurando como as tags são lidas, como as pastas são
 * monitoradas, como o grafo de áudio funciona, ou como as cores do tema são
 * calculadas, veja library.js, player.js e theme.js respectivamente. Este
 * arquivo é "só" a cola + o DOM.
 *
 * MELHORIAS FUTURAS:
 *  - Trocar a navegação manual de mostrar/esconder `.view` pela History API,
 *    para o gesto/botão de voltar do Android poder fechar o "Tocando agora"
 *    / voltar uma tela.
 *  - Virtualizar listas de faixas longas (windowing) caso alguém aponte o
 *    app para uma pasta com vários milhares de arquivos.
 */

import { Library, supportsPersistentFolders } from './library.js';
import { Player } from './player.js';
import { ThemeManager } from './theme.js';
import { Settings } from './settings.js';
import { Icons } from './icons.js';
import { formatTime, escapeHtml, pluralTracks, extractPalette, debounce } from './utils.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** A faixa atualmente carregada no player, guardada para acesso rápido pela interface de favoritos/fila. */
let currentTrack = null;
/** Estatísticas em cache (favoritos/contagem de reproduções), atualizadas sempre que Início/Biblioteca renderizam. */
let statsMap = new Map();
/** Qual playlist está aberta na tela de detalhe, se houver. */
let openPlaylistId = null;

// =====================================================================
// Sequência de inicialização
// =====================================================================

async function boot() {
  // Aplica o tema/aparência salvos o quanto antes, para não haver nenhum
  // "flash" das cores erradas enquanto o resto do app inicializa.
  ThemeManager.init();

  await Library.loadFromCache();
  statsMap = await Library.getAllStats();

  wireNavigation();
  wireHome();
  wireSearch();
  wireLibraryView();
  wirePlaylists();
  wireMiniPlayerAndNowPlaying();
  wireSheets();
  wirePlayerEvents();
  wireInstallPrompt();

  await Settings.init({ onLibraryChanged: onLibraryChanged });

  await renderEverythingFromLibrary();

  // Reconecta automaticamente qualquer pasta baseada em handle (Chromium de
  // desktop); pastas manuais (webkitdirectory) precisam de um toque
  // explícito do usuário, tratado em settings.js, já que reescolher uma
  // pasta exige um gesto do usuário de qualquer forma.
  if (supportsPersistentFolders()) {
    Library.refreshHandleFolders().then(async (results) => {
      if (results.some((r) => !r.needsPermission)) {
        await onLibraryChanged();
      }
    });
  }

  registerServiceWorker();
  dismissSplash();
}

function dismissSplash() {
  const splash = $('#splash-screen');
  const app = $('#app');
  const MIN_SPLASH_MS = 900; // tempo suficiente para realmente ver a animação do braço do toca-discos
  setTimeout(() => {
    app.hidden = false;
    splash.classList.add('fade-out');
    setTimeout(() => { splash.hidden = true; }, 550);
  }, MIN_SPLASH_MS);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch((err) => {
      console.warn('[script] registro do service worker falhou:', err);
    });
  });
}

/** Chamado após qualquer mudança na biblioteca (pasta adicionada/removida/revarrida). */
async function onLibraryChanged() {
  statsMap = await Library.getAllStats();
  await renderEverythingFromLibrary();
}

async function renderEverythingFromLibrary() {
  await renderHome();
  await renderLibraryList();
  await renderPlaylistsGrid();
  const searchInput = $('#search-input');
  if (searchInput.value.trim()) renderSearchResults(searchInput.value);
}

// =====================================================================
// Navegação entre as 5 abas da barra inferior + detalhe de playlist
// =====================================================================

function showView(name) {
  $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === name));
  if (['home', 'search', 'library', 'playlists', 'settings'].includes(name)) {
    $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  }
}

function wireNavigation() {
  $$('.nav-btn').forEach((btn) => btn.addEventListener('click', () => showView(btn.dataset.view)));
  $('#btn-open-settings').addEventListener('click', () => showView('settings'));
  $('#btn-empty-goto-settings').addEventListener('click', () => showView('settings'));
  $('#btn-goto-search').addEventListener('click', () => { showView('search'); $('#search-input').focus(); });
  showView('home');
}

// =====================================================================
// Renderização de lista de faixas, compartilhada (Busca / Biblioteca / Detalhe de playlist / Fila)
// =====================================================================

/** Monta o HTML de uma linha de faixa. */
function trackRowHTML(track) {
  const stat = statsMap.get(track.id);
  const playable = Library.isPlayable(track.id);
  return `
    <div class="track-row${playable ? '' : ' unplayable'}" data-track-id="${track.id}">
      <img class="track-cover" src="${Library.getCoverUrl(track)}" alt="" loading="lazy" />
      <div class="track-info">
        <span class="track-title">${escapeHtml(track.title)}</span>
        <span class="track-sub">${escapeHtml(track.artist)} · ${escapeHtml(track.album)}</span>
      </div>
      ${stat?.favorite ? `<span class="track-fav-mark">${Icons.heartFilled}</span>` : ''}
      <span class="track-duration">${formatTime(track.duration)}</span>
      <button class="track-kebab" data-action="menu" aria-label="Mais opções">${Icons.kebab}</button>
    </div>`;
}

/** Mesma linha, mas com um botão de remoção direto no lugar do menu de opções (usado na tela de detalhe de playlist). */
function trackRowHTMLWithRemove(track) {
  return `
    <div class="track-row" data-track-id="${track.id}">
      <img class="track-cover" src="${Library.getCoverUrl(track)}" alt="" loading="lazy" />
      <div class="track-info">
        <span class="track-title">${escapeHtml(track.title)}</span>
        <span class="track-sub">${escapeHtml(track.artist)} · ${escapeHtml(track.album)}</span>
      </div>
      <span class="track-duration">${formatTime(track.duration)}</span>
      <button class="track-remove-btn" data-action="remove" aria-label="Remover da playlist">${Icons.close}</button>
    </div>`;
}

/**
 * Renderiza uma lista de faixas dentro de `container` e conecta um único
 * handler de clique delegado, que toca a faixa tocada (definindo a lista
 * inteira como a nova fila) ou abre a sheet de ações da faixa quando o botão
 * de menu é tocado.
 * @param {HTMLElement} container
 * @param {Array<object>} tracks
 * @param {{emptyMessage?: string, playlistId?: string}} [opts]
 */
function renderTrackList(container, tracks, opts = {}) {
  const { emptyMessage = 'Nenhuma faixa aqui ainda.', playlistId = null } = opts;
  if (tracks.length === 0) {
    container.innerHTML = `<p class="empty-hint">${escapeHtml(emptyMessage)}</p>`;
    container.onclick = null;
    return;
  }
  container.innerHTML = tracks.map((t) => (playlistId ? trackRowHTMLWithRemove(t) : trackRowHTML(t))).join('');
  markCurrentRow(container);
  container.onclick = async (e) => {
    const row = e.target.closest('.track-row');
    if (!row) return;
    const trackId = row.dataset.trackId;

    if (e.target.closest('[data-action="menu"]')) {
      openTrackActionSheet(trackId);
      return;
    }
    if (e.target.closest('[data-action="remove"]') && playlistId) {
      await Library.removeFromPlaylist(playlistId, trackId);
      await renderPlaylistDetail(playlistId);
      return;
    }
    const ids = tracks.map((t) => t.id);
    await Player.setQueue(ids, ids.indexOf(trackId));
  };
}

/** Adiciona/remove o destaque `.is-current` na linha que corresponde à faixa carregada atualmente no player. */
function markCurrentRow(container) {
  if (!currentTrack) return;
  $$('.track-row', container).forEach((row) => {
    row.classList.toggle('is-current', row.dataset.trackId === currentTrack.id);
  });
}

function refreshAllCurrentRowHighlights() {
  $$('.track-list').forEach(markCurrentRow);
}

// =====================================================================
// Tela Início
// =====================================================================

function hcardTrackHTML(track) {
  return `
    <div class="hcard" data-track-id="${track.id}">
      <div class="hcard-cover-wrap"><img src="${Library.getCoverUrl(track)}" alt="" loading="lazy" /></div>
      <div class="hcard-title">${escapeHtml(track.title)}</div>
      <div class="hcard-sub">${escapeHtml(track.artist)}</div>
    </div>`;
}

function renderHCardTrackRow(elId, tracks) {
  const el = $(`#${elId}`);
  el.innerHTML = tracks.map(hcardTrackHTML).join('');
  el.onclick = async (e) => {
    const card = e.target.closest('.hcard');
    if (!card) return;
    const ids = tracks.map((t) => t.id);
    await Player.setQueue(ids, ids.indexOf(card.dataset.trackId));
  };
}

function playlistCardCoverHTML(playlist, allTracks) {
  const covers = playlist.trackIds
    .slice(0, 4)
    .map((id) => allTracks.find((t) => t.id === id))
    .filter(Boolean)
    .map((t) => `<img src="${Library.getCoverUrl(t)}" alt="" loading="lazy" />`);
  while (covers.length < 4) covers.push('<img src="assets/images/default-cover.png" alt="" />');
  return covers.join('');
}

function renderHomePlaylistsRow(playlists, allTracks) {
  const el = $('#home-playlists-row');
  el.innerHTML = playlists.map((p) => `
    <div class="hcard hcard-playlist" data-playlist-id="${p.id}">
      <div class="hcard-cover-wrap">${playlistCardCoverHTML(p, allTracks)}</div>
      <div class="hcard-title">${escapeHtml(p.name)}</div>
      <div class="hcard-sub">${pluralTracks(p.trackIds.length)}</div>
    </div>`).join('');
  el.onclick = (e) => {
    const card = e.target.closest('.hcard-playlist');
    if (!card) return;
    openPlaylistDetail(card.dataset.playlistId);
  };
}

async function renderHome() {
  const tracks = Library.getAll();
  const emptyState = $('#home-empty-state');
  const homeContent = $('#home-content');

  if (tracks.length === 0) {
    emptyState.hidden = false;
    homeContent.hidden = true;
    return;
  }
  emptyState.hidden = true;
  homeContent.hidden = false;

  const stats = [...statsMap.values()];
  const byId = (id) => tracks.find((t) => t.id === id);

  const recents = stats.filter((s) => s.lastPlayedAt).sort((a, b) => b.lastPlayedAt - a.lastPlayedAt).slice(0, 12).map((s) => byId(s.trackId)).filter(Boolean);
  const favorites = stats.filter((s) => s.favorite).map((s) => byId(s.trackId)).filter(Boolean);
  const mostPlayed = stats.filter((s) => s.playCount > 0).sort((a, b) => b.playCount - a.playCount).slice(0, 12).map((s) => byId(s.trackId)).filter(Boolean);
  const playlists = await Library.getPlaylists();

  $('#row-recents').hidden = recents.length === 0;
  $('#row-favorites').hidden = favorites.length === 0;
  $('#row-mostplayed').hidden = mostPlayed.length === 0;
  $('#row-playlists').hidden = playlists.length === 0;

  renderHCardTrackRow('home-recents-row', recents);
  renderHCardTrackRow('home-favorites-row', favorites);
  renderHCardTrackRow('home-mostplayed-row', mostPlayed);
  renderHomePlaylistsRow(playlists, tracks);
}

function wireHome() {
  $('#home-see-all-playlists').addEventListener('click', () => showView('playlists'));
  $('#home-hero-playpause').addEventListener('click', (e) => { e.stopPropagation(); Player.togglePlayPause(); });
  $('#home-hero').addEventListener('click', () => openNowPlaying());
}

function updateHomeHero(track) {
  const hero = $('#home-hero');
  if (!track) { hero.hidden = true; return; }
  hero.hidden = false;
  $('#home-hero-cover').src = Library.getCoverUrl(track);
  $('#home-hero-title').textContent = track.title;
  $('#home-hero-artist').textContent = track.artist;
}

// =====================================================================
// Tela Buscar
// =====================================================================

function renderSearchResults(query) {
  const results = query.trim() ? Library.search(query) : [];
  $('#search-empty').hidden = query.trim().length > 0;
  renderTrackList($('#search-results'), results, { emptyMessage: 'Nenhum resultado encontrado.' });
}

function wireSearch() {
  const input = $('#search-input');
  input.addEventListener('input', debounce(() => renderSearchResults(input.value), 150));
}

// =====================================================================
// Tela Biblioteca (catálogo completo, ordenação + chips de filtro)
// =====================================================================

let librarySort = 'title';
let libraryFilter = 'all';

async function renderLibraryList() {
  let tracks = Library.getAll();
  if (libraryFilter === 'favorites') {
    tracks = tracks.filter((t) => statsMap.get(t.id)?.favorite);
  } else if (libraryFilter === 'mostplayed') {
    tracks = tracks.filter((t) => (statsMap.get(t.id)?.playCount || 0) > 0)
      .sort((a, b) => (statsMap.get(b.id)?.playCount || 0) - (statsMap.get(a.id)?.playCount || 0));
  }
  if (libraryFilter !== 'mostplayed') tracks = Library.sortTracks(tracks, librarySort);
  renderTrackList($('#library-list'), tracks, { emptyMessage: 'Nenhuma faixa encontrada. Adicione uma pasta em Ajustes.' });
}

function wireLibraryView() {
  $('#library-sort').addEventListener('change', (e) => { librarySort = e.target.value; renderLibraryList(); });
  $$('#library-filter-chips .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      $$('#library-filter-chips .chip').forEach((c) => c.classList.toggle('active', c === chip));
      libraryFilter = chip.dataset.filter;
      renderLibraryList();
    });
  });
}

// =====================================================================
// Playlists (grade + detalhe)
// =====================================================================

async function renderPlaylistsGrid() {
  const playlists = await Library.getPlaylists();
  const tracks = Library.getAll();
  const grid = $('#playlists-grid');
  if (playlists.length === 0) {
    grid.innerHTML = `<p class="empty-hint">Nenhuma playlist ainda. Toque em "+" para criar a primeira.</p>`;
    return;
  }
  grid.innerHTML = playlists.map((p) => `
    <div class="playlist-card" data-playlist-id="${p.id}">
      <div class="playlist-card-cover">${playlistCardCoverHTML(p, tracks)}</div>
      <div class="playlist-card-title">${escapeHtml(p.name)}</div>
      <div class="playlist-card-sub">${pluralTracks(p.trackIds.length)}</div>
    </div>`).join('');
  grid.onclick = (e) => {
    const card = e.target.closest('.playlist-card');
    if (card) openPlaylistDetail(card.dataset.playlistId);
  };
}

async function openPlaylistDetail(playlistId) {
  openPlaylistId = playlistId;
  await renderPlaylistDetail(playlistId);
  showView('playlist-detail');
}

async function renderPlaylistDetail(playlistId) {
  const playlists = await Library.getPlaylists();
  const playlist = playlists.find((p) => p.id === playlistId);
  if (!playlist) { showView('playlists'); return; }
  const allTracks = Library.getAll();
  const tracks = playlist.trackIds.map((id) => allTracks.find((t) => t.id === id)).filter(Boolean);

  $('#playlist-detail-title').textContent = playlist.name;
  renderTrackList($('#playlist-detail-list'), tracks, { emptyMessage: 'Playlist vazia. Adicione faixas pelo menu de opções de qualquer música.', playlistId });
}

function wirePlaylists() {
  $('#btn-create-playlist').addEventListener('click', async () => {
    const name = prompt('Nome da nova playlist:');
    if (!name || !name.trim()) return;
    await Library.createPlaylist(name.trim());
    await renderPlaylistsGrid();
    await renderHome();
  });

  $('#btn-back-from-playlist').addEventListener('click', () => showView('playlists'));

  $('#btn-rename-playlist').addEventListener('click', async () => {
    const newName = prompt('Novo nome da playlist:');
    if (!newName || !newName.trim() || !openPlaylistId) return;
    await Library.renamePlaylist(openPlaylistId, newName.trim());
    await renderPlaylistDetail(openPlaylistId);
    await renderPlaylistsGrid();
  });

  $('#btn-delete-playlist').addEventListener('click', async () => {
    if (!openPlaylistId) return;
    if (!confirm('Excluir esta playlist? As faixas continuam na sua biblioteca.')) return;
    await Library.deletePlaylist(openPlaylistId);
    showView('playlists');
    await renderPlaylistsGrid();
    await renderHome();
  });

  $('#btn-play-playlist').addEventListener('click', async () => {
    const playlists = await Library.getPlaylists();
    const playlist = playlists.find((p) => p.id === openPlaylistId);
    if (playlist && playlist.trackIds.length) await Player.setQueue(playlist.trackIds, 0);
  });

  $('#btn-shuffle-playlist').addEventListener('click', async () => {
    const playlists = await Library.getPlaylists();
    const playlist = playlists.find((p) => p.id === openPlaylistId);
    if (!playlist || !playlist.trackIds.length) return;
    if (!Player.isShuffleOn()) Player.setShuffle(true);
    await Player.setQueue(playlist.trackIds, Math.floor(Math.random() * playlist.trackIds.length));
  });
}

// =====================================================================
// Mini player + Tocando agora (tela cheia)
// =====================================================================

function wireMiniPlayerAndNowPlaying() {
  $('#mini-player').addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    openNowPlaying();
  });
  $('#mini-playpause').addEventListener('click', (e) => { e.stopPropagation(); Player.togglePlayPause(); });
  $('#mini-next').addEventListener('click', (e) => { e.stopPropagation(); Player.next(); });

  $('#btn-collapse-now-playing').addEventListener('click', collapseNowPlaying);

  $('#np-playpause').addEventListener('click', () => Player.togglePlayPause());
  $('#np-prev').addEventListener('click', () => Player.prev());
  $('#np-next').addEventListener('click', () => Player.next());

  $('#np-shuffle').addEventListener('click', () => {
    Player.setShuffle(!Player.isShuffleOn());
    $('#np-shuffle').classList.toggle('active', Player.isShuffleOn());
  });

  $('#np-repeat').addEventListener('click', () => {
    const order = ['off', 'all', 'one'];
    const next = order[(order.indexOf(Player.getRepeatMode()) + 1) % order.length];
    Player.setRepeatMode(next);
    updateRepeatButton(next);
  });

  $('#np-favorite').addEventListener('click', async () => {
    if (!currentTrack) return;
    const isFav = await Library.toggleFavorite(currentTrack.id);
    statsMap = await Library.getAllStats();
    updateFavoriteButton(isFav);
    refreshAllCurrentRowHighlights();
    await renderHome();
  });

  let isSeeking = false;
  const npProgress = $('#np-progress');
  npProgress.addEventListener('input', () => {
    isSeeking = true;
    const duration = Player.getDuration();
    const t = (npProgress.value / 1000) * duration;
    $('#np-current-time').textContent = formatTime(t);
    $('#np-remaining-time').textContent = `-${formatTime(duration - t)}`;
  });
  npProgress.addEventListener('change', () => {
    const duration = Player.getDuration();
    Player.seek((npProgress.value / 1000) * duration);
    isSeeking = false;
  });
  npProgress._isSeeking = () => isSeeking;

  const npVolume = $('#np-volume');
  npVolume.value = Player.getVolume();
  npVolume.addEventListener('input', () => Player.setVolume(Number(npVolume.value)));

  $('#np-queue-btn').addEventListener('click', () => { renderQueueList(); openSheet($('#queue-sheet')); });
  $('#btn-now-playing-more').addEventListener('click', () => { refreshMoreSheetStatus(); openSheet($('#more-sheet')); });
}

function openNowPlaying() {
  $('#now-playing').classList.add('open');
  $('#now-playing').setAttribute('aria-hidden', 'false');
}
function collapseNowPlaying() {
  $('#now-playing').classList.remove('open');
  $('#now-playing').setAttribute('aria-hidden', 'true');
}

function updateRepeatButton(mode) {
  const btn = $('#np-repeat');
  btn.classList.toggle('active', mode !== 'off');
  btn.innerHTML = mode === 'one' ? Icons.repeatOne : Icons.repeat;
  btn.title = mode === 'off' ? 'Repetir: desligado' : mode === 'all' ? 'Repetir: tudo' : 'Repetir: uma faixa';
}
function updateFavoriteButton(isFav) {
  const btn = $('#np-favorite');
  btn.classList.toggle('active', isFav);
  btn.innerHTML = isFav ? Icons.heartFilled : Icons.heartOutline;
}

/** Atualiza o mini player, a capa/meta do "Tocando agora" e a cor de destaque do app inteiro para uma faixa recém-carregada. */
function renderNowPlayingTrack(track) {
  currentTrack = track;
  $('#mini-player').hidden = false;

  $('#mini-cover').src = Library.getCoverUrl(track);
  $('#mini-title').textContent = track.title;
  $('#mini-artist').textContent = track.artist;

  $('#np-title').textContent = track.title;
  $('#np-artist').textContent = track.artist;

  const coverUrl = Library.getCoverUrl(track);
  const coverImg = $('#now-playing-cover');
  coverImg.src = coverUrl;
  const bg = $('#now-playing-bg');
  bg.style.backgroundImage = `url("${coverUrl}")`;

  // Reinicia a pequena animação de entrada da capa a cada troca de faixa
  // (o CSS já define a animação na classe; isso só força o navegador a
  // "reiniciar" o relógio dela via um reflow forçado).
  const coverFrame = $('.cover-frame');
  if (coverFrame) {
    coverFrame.style.animation = 'none';
    void coverFrame.offsetWidth;
    coverFrame.style.animation = '';
  }

  // Extrai as cores dominante/destaque assim que a capa realmente carregar e
  // aplica em duas frentes: o gradiente de fundo do "Tocando agora" (efeito
  // visual local dessa tela) e a cor de destaque do app inteiro via
  // ThemeManager (botões, realces, barra de progresso etc.) - é assim que a
  // cor do app "segue a música" automaticamente, sem o usuário escolher
  // nada em Ajustes.
  const applyPalette = () => {
    const palette = extractPalette(coverImg);
    bg.style.setProperty('--np-color-1', palette.primary);
    bg.style.setProperty('--np-color-2', palette.secondary);
    ThemeManager.applyAccentFromPalette(palette);
  };
  if (coverImg.complete) applyPalette(); else coverImg.onload = applyPalette;

  const isFav = statsMap.get(track.id)?.favorite;
  updateFavoriteButton(isFav);
  updateHomeHero(track);
  refreshAllCurrentRowHighlights();

  if (!Library.isPlayable(track.id)) {
    showToast('Não foi possível tocar esta faixa - reconecte a pasta em Ajustes.');
  }
}

function renderQueueList() {
  const ids = Player.getQueue();
  const allTracks = Library.getAll();
  const tracks = ids.map((id) => allTracks.find((t) => t.id === id)).filter(Boolean);
  const container = $('#queue-list');
  const pos = Player.getQueuePosition();
  if (tracks.length === 0) {
    container.innerHTML = '<p class="empty-hint">Fila vazia.</p>';
    return;
  }
  container.innerHTML = tracks.map(trackRowHTML).join('');
  $$('.track-row', container).forEach((row, i) => row.classList.toggle('is-current', i === pos));
  container.onclick = async (e) => {
    const row = e.target.closest('.track-row');
    if (!row) return;
    if (e.target.closest('[data-action="menu"]')) { openTrackActionSheet(row.dataset.trackId); return; }
    const idx = $$('.track-row', container).indexOf(row);
    await Player.playTrackAtIndex(idx);
    closeSheets();
  };
}

// =====================================================================
// Sheets: fila / mais opções / ações da faixa
// =====================================================================

function openSheet(sheetEl) {
  $$('.sheet').forEach((s) => { s.hidden = s !== sheetEl; });
  $('#sheet-backdrop').hidden = false;
}
function closeSheets() {
  $$('.sheet').forEach((s) => { s.hidden = true; });
  $('#sheet-backdrop').hidden = true;
}

function refreshMoreSheetStatus() {
  const sleep = Player.getSleepTimerState();
  const statusEl = $('#sleep-timer-status');
  if (sleep.stopAfterTrack) statusEl.textContent = 'Vai pausar ao fim da faixa atual.';
  else if (sleep.endsAt) statusEl.textContent = `Pausa em ${Math.max(0, Math.round((sleep.endsAt - Date.now()) / 60000))} min.`;
  else statusEl.textContent = 'Nenhum sleep timer ativo.';

  const ab = Player.getABRepeat();
  const abEl = $('#ab-repeat-status');
  if (ab.a != null && ab.b != null) abEl.textContent = `Repetindo entre ${formatTime(ab.a)} e ${formatTime(ab.b)}.`;
  else if (ab.a != null) abEl.textContent = `Ponto A marcado em ${formatTime(ab.a)} - marque o ponto B.`;
  else abEl.textContent = 'Nenhuma repetição A-B ativa.';
}

function wireSheets() {
  $('#sheet-backdrop').addEventListener('click', closeSheets);

  $$('#sleep-timer-options .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const val = chip.dataset.min;
      if (val === 'cancel') Player.cancelSleepTimer();
      else Player.startSleepTimer(val === 'track' ? 'track' : Number(val));
      refreshMoreSheetStatus();
    });
  });

  $('#btn-set-a').addEventListener('click', () => { Player.setPointA(); refreshMoreSheetStatus(); });
  $('#btn-set-b').addEventListener('click', () => { Player.setPointB(); refreshMoreSheetStatus(); });
  $('#btn-clear-ab').addEventListener('click', () => { Player.clearABRepeat(); refreshMoreSheetStatus(); });

  // ---- Sheet de ações da faixa ----
  $('#action-play-now').addEventListener('click', async () => {
    const trackId = $('#track-action-sheet').dataset.trackId;
    await Player.setQueue([trackId], 0);
    closeSheets();
  });
  $('#action-play-next').addEventListener('click', () => {
    const trackId = $('#track-action-sheet').dataset.trackId;
    Player.playNext(trackId);
    closeSheets();
    showToast('Adicionada para tocar a seguir.');
  });
  $('#action-toggle-favorite').addEventListener('click', async () => {
    const trackId = $('#track-action-sheet').dataset.trackId;
    const isFav = await Library.toggleFavorite(trackId);
    statsMap = await Library.getAllStats();
    $('#action-toggle-favorite').innerHTML = favoriteActionHTML(isFav);
    if (currentTrack?.id === trackId) updateFavoriteButton(isFav);
    refreshAllCurrentRowHighlights();
    await renderHome();
  });
  $('#action-new-playlist').addEventListener('click', async () => {
    const trackId = $('#track-action-sheet').dataset.trackId;
    const name = prompt('Nome da nova playlist:');
    if (!name || !name.trim()) return;
    const playlist = await Library.createPlaylist(name.trim());
    await Library.addToPlaylist(playlist.id, trackId);
    closeSheets();
    await renderPlaylistsGrid();
    await renderHome();
    showToast(`Adicionada a "${playlist.name}".`);
  });
}

/** Monta o rótulo com ícone do botão "Favoritar" na sheet de ações, de acordo com o estado atual. */
function favoriteActionHTML(isFav) {
  return isFav
    ? `${Icons.heartFilled}<span>Remover dos favoritos</span>`
    : `${Icons.heartOutline}<span>Favoritar</span>`;
}

async function openTrackActionSheet(trackId) {
  const track = Library.getAll().find((t) => t.id === trackId);
  if (!track) return;
  const sheet = $('#track-action-sheet');
  sheet.dataset.trackId = trackId;
  $('#track-action-title').textContent = `${track.title} · ${track.artist}`;

  const isFav = statsMap.get(trackId)?.favorite;
  $('#action-toggle-favorite').innerHTML = favoriteActionHTML(isFav);

  const playlists = await Library.getPlaylists();
  const listEl = $('#action-playlist-list');
  listEl.innerHTML = playlists.map((p) => {
    const inPlaylist = p.trackIds.includes(trackId);
    return `<button class="sheet-action btn-with-icon" data-playlist-id="${p.id}">${inPlaylist ? Icons.check : Icons.plus}<span>${escapeHtml(p.name)}</span></button>`;
  }).join('') || '<p class="empty-hint">Nenhuma playlist criada ainda.</p>';
  listEl.onclick = async (e) => {
    const btn = e.target.closest('[data-playlist-id]');
    if (!btn) return;
    const playlistId = btn.dataset.playlistId;
    const playlist = playlists.find((p) => p.id === playlistId);
    if (playlist.trackIds.includes(trackId)) await Library.removeFromPlaylist(playlistId, trackId);
    else await Library.addToPlaylist(playlistId, trackId);
    await openTrackActionSheet(trackId); // renderiza de novo com as marcações atualizadas
    await renderPlaylistsGrid();
    await renderHome();
  };

  openSheet(sheet);
}

// =====================================================================
// Assinaturas do barramento de eventos do Player - mantêm a interface
// sincronizada com o estado real de reprodução
// =====================================================================

function wirePlayerEvents() {
  Player.on('trackchange', (track) => { if (track) renderNowPlayingTrack(track); });

  Player.on('play', () => {
    $('#mini-playpause').innerHTML = Icons.pause;
    $('#np-playpause').innerHTML = Icons.pause;
    $('#home-hero-playpause').innerHTML = Icons.pause;
  });
  Player.on('pause', () => {
    $('#mini-playpause').innerHTML = Icons.play;
    $('#np-playpause').innerHTML = Icons.play;
    $('#home-hero-playpause').innerHTML = Icons.play;
  });

  Player.on('timeupdate', ({ currentTime, duration }) => {
    if (!isFinite(duration) || duration <= 0) return;
    const pct = (currentTime / duration) * 100;
    $('#mini-progress-fill').style.width = `${pct}%`;
    const npProgress = $('#np-progress');
    if (!npProgress._isSeeking()) {
      npProgress.value = String((currentTime / duration) * 1000);
      $('#np-current-time').textContent = formatTime(currentTime);
      $('#np-remaining-time').textContent = `-${formatTime(duration - currentTime)}`;
    }
  });

  Player.on('queuechange', () => { if (!$('#queue-sheet').hidden) renderQueueList(); });
  Player.on('volumechange', (v) => { $('#np-volume').value = v; });
  Player.on('ratechange', () => {});
  Player.on('unplayable', (track) => {
    if (track) showToast(`Não foi possível tocar "${track.title}" - reconecte a pasta em Ajustes.`);
  });

  updateRepeatButton(Player.getRepeatMode());
  $('#np-shuffle').classList.toggle('active', Player.isShuffleOn());
}

// =====================================================================
// Prompt de instalação (Adicionar à tela inicial)
// =====================================================================

function wireInstallPrompt() {
  let deferredPrompt = null;
  const btn = $('#btn-install-app');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    btn.hidden = false;
  });
  btn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    btn.hidden = true;
  });
  window.addEventListener('appinstalled', () => { btn.hidden = true; });
}

// =====================================================================
// Helper de toast
// =====================================================================

let toastTimer = null;
function showToast(message) {
  let toast = $('#toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  requestAnimationFrame(() => toast.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

// =====================================================================
// Início de tudo
// =====================================================================

document.addEventListener('DOMContentLoaded', boot);
