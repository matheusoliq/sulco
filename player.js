/**
 * player.js
 * ---------------------------------------------------------------------------
 * O motor de áudio. Controla a fila, o estado de transporte (tocando/
 * pausado, aleatório, repetição, volume, velocidade de reprodução), o grafo
 * de Web Audio (usado para o equalizador e para o crossfade entre faixas), o
 * sleep timer, a repetição A-B, e a integração com a Media Session API que
 * alimenta a tela de bloqueio / notificação / controles Bluetooth / Android
 * Auto.
 *
 * Este módulo nunca mexe no DOM. Ele se comunica para fora só através de um
 * pequeno pub/sub (`Player.on(event, handler)`), para o script.js poder
 * renderizar o que quiser em resposta, sem que player.js precise saber que a
 * interface existe.
 *
 * REPRODUÇÃO COM DUPLO BUFFER (como crossfade e gapless funcionam)
 * ---------------------------------------------------------------------------
 * Dois elementos <audio> ("slots" A e B) são mantidos vivos durante toda a
 * sessão, cada um roteado pela sua própria cadeia de Web Audio:
 *
 *   <audio> -> MediaElementSourceNode -> [filtros do equalizador] -> GainNode -> destination
 *
 * Só um slot fica "ativo" (audível) por vez. Quando estamos a menos de
 * `crossfadeSeconds` do fim da faixa ativa:
 *   - crossfadeSeconds > 0: o *outro* slot é carregado com a próxima faixa e
 *     o ganho (GainNode) dos dois slots é ajustado gradualmente (o atual
 *     descendo, o próximo subindo) ao longo dessa janela usando
 *     linearRampToValueAtTime, produzindo um crossfade suave inteiramente no
 *     grafo de áudio (preciso à amostra, não um truque de volume via
 *     CSS/JS).
 *   - crossfadeSeconds === 0 (modo "gapless"): o outro slot é pré-carregado e
 *     iniciado no ganho máximo no instante em que o atual termina, que é o
 *     melhor que um elemento <audio> simples consegue fazer - veja a seção
 *     "Limitações" do README para o motivo de isso não poder ser
 *     *garantidamente* preciso à amostra, como seria com uma abordagem de
 *     AudioBuffer totalmente pré-decodificado, e por que optamos pela
 *     abordagem via elemento <audio> mesmo assim (ela faz streaming direto
 *     do disco em vez de carregar arquivos inteiros na memória, o que
 *     importa para faixas longas).
 *
 * MELHORIAS FUTURAS:
 *  - Gapless preciso à amostra via `decodeAudioData` + `AudioBufferSourceNode`
 *    agendados, com um limite de tamanho/duração que volta para a
 *    abordagem atual em arquivos longos (podcasts, sets de DJ) onde
 *    decodificar tudo antecipadamente seria lento/pesado para a memória.
 *  - Adicionar um nó analisador em tempo real + um visualizador de forma de onda.
 */

import { Library } from './library.js';
import { Prefs } from './storage.js';
import { clamp } from './utils.js';

/** Frequências centrais das bandas do equalizador (Hz), uma distribuição de 8 bandas bem padrão. */
const EQ_BANDS_HZ = [60, 150, 400, 1000, 2400, 6000, 12000, 16000];

const EQ_PRESETS = {
  Padrão: [0, 0, 0, 0, 0, 0, 0, 0],
  'Grave reforçado': [6, 5, 3, 1, 0, 0, 0, 0],
  'Agudo reforçado': [0, 0, 0, 1, 2, 4, 5, 6],
  Vocal: [-2, -1, 2, 4, 4, 2, 0, -1],
  Eletrônica: [4, 3, 0, -1, 1, 2, 3, 4],
  Rock: [4, 2, -1, -2, 1, 3, 4, 3],
};

function createEventBus() {
  const listeners = new Map();
  return {
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
      return () => listeners.get(event)?.delete(handler);
    },
    emit(event, payload) {
      listeners.get(event)?.forEach((h) => h(payload));
    },
  };
}

const bus = createEventBus();

/** @type {AudioContext} */
let audioCtx = null;
/** Estado por slot: elemento de áudio, nó de origem, cadeia de filtros, nó de ganho. */
const slots = {
  A: { audio: new Audio(), source: null, filters: [], gain: null },
  B: { audio: new Audio(), source: null, filters: [], gain: null },
};
let activeSlotName = 'A';
let crossfadeInProgress = false;

// Estado de transporte / fila -----------------------------------------------------
let order = [];          // array de trackIds na ordem de reprodução (reembaralhado quando o aleatório é ligado)
let currentPos = -1;      // índice dentro de `order`
let shuffleOn = Prefs.get('shuffle', false);
let repeatMode = Prefs.get('repeatMode', 'off'); // 'off' | 'all' | 'one'
let volume = Prefs.get('volume', 0.9);
let crossfadeSeconds = Prefs.get('crossfadeSeconds', 0);
let playbackRate = 1;
let abRepeat = { a: null, b: null, active: false };
let sleepTimer = { endsAt: null, timeoutId: null, stopAfterTrack: false };
let eqGainsDb = Prefs.get('eqGains', EQ_PRESETS['Padrão'].slice());
let eqEnabled = Prefs.get('eqEnabled', false);

function activeSlot() { return slots[activeSlotName]; }
function inactiveSlotName() { return activeSlotName === 'A' ? 'B' : 'A'; }

/**
 * Cria de forma preguiçosa o AudioContext compartilhado e conecta os dois
 * elementos <audio> a ele. Precisa acontecer depois de um gesto do usuário
 * (navegadores bloqueiam autoplay de AudioContext caso contrário) - por
 * isso é chamado no primeiro play(), e não ao carregar o módulo.
 */
function ensureAudioGraph() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  for (const name of ['A', 'B']) {
    const slot = slots[name];
    slot.source = audioCtx.createMediaElementSource(slot.audio);
    slot.filters = EQ_BANDS_HZ.map((freq) => {
      const f = audioCtx.createBiquadFilter();
      f.type = 'peaking';
      f.frequency.value = freq;
      f.Q.value = 1;
      f.gain.value = 0;
      return f;
    });
    slot.gain = audioCtx.createGain();
    slot.gain.gain.value = 0;
    // Cadeia: source -> filtro0 -> filtro1 -> ... -> gain -> destination
    let node = slot.source;
    for (const filter of slot.filters) { node.connect(filter); node = filter; }
    node.connect(slot.gain);
    slot.gain.connect(audioCtx.destination);
  }
  applyEqualizerToGraph();
  slots[activeSlotName].gain.gain.value = volume;
}

function applyEqualizerToGraph() {
  for (const name of ['A', 'B']) {
    const slot = slots[name];
    if (!slot.filters.length) continue;
    slot.filters.forEach((filter, i) => {
      filter.gain.value = eqEnabled ? eqGainsDb[i] : 0;
    });
  }
}

function currentTrackId() { return order[currentPos] ?? null; }

async function loadTrackIntoSlot(slotName, trackId) {
  const slot = slots[slotName];
  const url = Library.getPlayableUrl(trackId);
  if (!url) return false; // pasta não conectada nesta sessão - veja os comentários em library.js
  slot.audio.src = url;
  slot.audio.playbackRate = playbackRate;
  return true;
}

/** Atualiza os metadados + handlers de ação da Media Session para a faixa atual. Barato de chamar repetidamente. */
function updateMediaSession(track) {
  if (!('mediaSession' in navigator) || !track) return;
  const coverUrl = Library.getCoverUrl(track);
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album,
    artwork: [
      { src: coverUrl, sizes: '96x96', type: 'image/png' },
      { src: coverUrl, sizes: '256x256', type: 'image/png' },
      { src: coverUrl, sizes: '512x512', type: 'image/png' },
    ],
  });
  navigator.mediaSession.setActionHandler('play', () => Player.play());
  navigator.mediaSession.setActionHandler('pause', () => Player.pause());
  navigator.mediaSession.setActionHandler('previoustrack', () => Player.prev());
  navigator.mediaSession.setActionHandler('nexttrack', () => Player.next());
  navigator.mediaSession.setActionHandler('seekto', (details) => {
    if (details.seekTime != null) Player.seek(details.seekTime);
  });
  navigator.mediaSession.setActionHandler('seekbackward', (details) => {
    Player.seek(clamp(Player.getCurrentTime() - (details.seekOffset || 10), 0, Player.getDuration()));
  });
  navigator.mediaSession.setActionHandler('seekforward', (details) => {
    Player.seek(clamp(Player.getCurrentTime() + (details.seekOffset || 10), 0, Player.getDuration()));
  });
  // OBSERVAÇÃO: a cor *visual* do chrome da notificação/tela de bloqueio do
  // sistema é calculada pelo próprio SO/navegador a partir da capa (a
  // extração parecida com "Palette" do próprio Android 13+) - uma página web
  // não tem nenhuma API para sobrescrever essa cor diretamente. Fazemos
  // nossa própria extração (utils.extractPalette) só para colorir a tela
  // "Tocando agora" dentro do app. Veja "Limitações" no README.
}

function updatePositionState() {
  if (!('mediaSession' in navigator) || !('setPositionState' in navigator.mediaSession)) return;
  const duration = Player.getDuration();
  if (!isFinite(duration) || duration <= 0) return;
  try {
    navigator.mediaSession.setPositionState({
      duration,
      playbackRate: activeSlot().audio.playbackRate,
      position: clamp(Player.getCurrentTime(), 0, duration),
    });
  } catch {
    /* setPositionState lança erro se chamado com valores inconsistentes durante a troca de faixa - seguro ignorar, vai funcionar no próximo ciclo */
  }
}

/** Monta o array `order` a partir de uma lista nova de trackIds, aplicando o embaralhamento se estiver ligado. */
function buildOrder(trackIds, keepId) {
  let arr = trackIds.slice();
  if (shuffleOn) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    if (keepId) {
      // Fixa a faixa atualmente tocando no início, para ligar o aleatório no
      // meio da reprodução não puxar o usuário para longe do que está ouvindo.
      arr = [keepId, ...arr.filter((id) => id !== keepId)];
    }
  }
  return arr;
}

async function startCrossfadeOrGaplessTo(nextTrackId) {
  if (crossfadeInProgress) return;
  crossfadeInProgress = true;
  ensureAudioGraph();
  const fromSlotName = activeSlotName;
  const toSlotName = inactiveSlotName();
  const loaded = await loadTrackIntoSlot(toSlotName, nextTrackId);
  if (!loaded) { crossfadeInProgress = false; return; }

  const toSlot = slots[toSlotName];
  const fromSlot = slots[fromSlotName];
  try { await toSlot.audio.play(); } catch { /* restrições de autoplay não deveriam se aplicar em meio à sessão, mas ignoramos se acontecer */ }

  const now = audioCtx.currentTime;
  if (crossfadeSeconds > 0) {
    fromSlot.gain.gain.cancelScheduledValues(now);
    toSlot.gain.gain.cancelScheduledValues(now);
    fromSlot.gain.gain.setValueAtTime(fromSlot.gain.gain.value, now);
    toSlot.gain.gain.setValueAtTime(0, now);
    fromSlot.gain.gain.linearRampToValueAtTime(0, now + crossfadeSeconds);
    toSlot.gain.gain.linearRampToValueAtTime(volume, now + crossfadeSeconds);
  } else {
    // Gapless "melhor esforço": corte seco no ganho, sem transição gradual.
    fromSlot.gain.gain.setValueAtTime(0, now);
    toSlot.gain.gain.setValueAtTime(volume, now);
  }

  activeSlotName = toSlotName;
  currentPos = order.indexOf(nextTrackId, 0);
  const track = await getTrackById(nextTrackId);
  updateMediaSession(track);
  bus.emit('trackchange', track);
  await Library.recordPlay(nextTrackId);

  setTimeout(() => {
    fromSlot.audio.pause();
    fromSlot.audio.currentTime = 0;
    crossfadeInProgress = false;
  }, Math.max(crossfadeSeconds, 0.15) * 1000);
}

async function getTrackById(id) {
  return Library.getAll().find((t) => t.id === id) || null;
}

function scheduleTransitionWatcher() {
  const slot = activeSlot();
  slot.audio.ontimeupdate = () => {
    bus.emit('timeupdate', { currentTime: slot.audio.currentTime, duration: slot.audio.duration });
    updatePositionState();

    // Repetição A-B: volta para o ponto A assim que chega no ponto B.
    if (abRepeat.active && abRepeat.b != null && slot.audio.currentTime >= abRepeat.b) {
      slot.audio.currentTime = abRepeat.a || 0;
      return;
    }

    const duration = slot.audio.duration;
    if (!isFinite(duration) || duration <= 0 || crossfadeInProgress) return;
    const remaining = duration - slot.audio.currentTime;
    const window = crossfadeSeconds > 0 ? crossfadeSeconds : 0.25;
    if (remaining <= window && repeatMode !== 'one') {
      const next = peekNextTrackId();
      if (next) startCrossfadeOrGaplessTo(next);
    }
  };
  slot.audio.onended = () => {
    if (repeatMode === 'one') {
      slot.audio.currentTime = 0;
      slot.audio.play();
      return;
    }
    if (!crossfadeInProgress) Player.next();
  };
}

/** Espia a próxima faixa em `order` (respeitando o modo de repetição) sem alterar a posição de reprodução. */
function peekNextTrackId() {
  if (currentPos + 1 < order.length) return order[currentPos + 1];
  if (repeatMode === 'all' && order.length > 0) return order[0];
  return null;
}

export const Player = {
  on: bus.on,

  /**
   * Substitui a fila e inicia a reprodução em `startIndex`.
   * @param {string[]} trackIds
   * @param {number} [startIndex]
   */
  async setQueue(trackIds, startIndex = 0) {
    const keepId = trackIds[startIndex];
    order = buildOrder(trackIds, shuffleOn ? keepId : null);
    currentPos = order.indexOf(keepId);
    await this.playTrackAtIndex(currentPos);
  },

  /** Adiciona uma faixa para tocar logo após a atual ("tocar a seguir"). @param {string} trackId */
  playNext(trackId) {
    if (currentPos === -1) { order = [trackId]; currentPos = 0; return; }
    order.splice(currentPos + 1, 0, trackId);
    bus.emit('queuechange', order);
  },

  /** @returns {string[]} a ordem de reprodução atual (para renderizar uma lista "a seguir") */
  getQueue() { return order.slice(); },
  getQueuePosition() { return currentPos; },

  async playTrackAtIndex(index) {
    if (index < 0 || index >= order.length) return;
    ensureAudioGraph();
    currentPos = index;
    const trackId = order[index];
    const loaded = await loadTrackIntoSlot(activeSlotName, trackId);
    bus.emit('queuechange', order);
    if (!loaded) {
      bus.emit('unplayable', await getTrackById(trackId));
      return;
    }
    scheduleTransitionWatcher();
    slots[activeSlotName].gain && (slots[activeSlotName].gain.gain.value = volume);
    await this.play();
    const track = await getTrackById(trackId);
    updateMediaSession(track);
    bus.emit('trackchange', track);
    await Library.recordPlay(trackId);
  },

  async play() {
    ensureAudioGraph();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    try {
      await activeSlot().audio.play();
    } catch (err) {
      console.warn('[player] play() bloqueado:', err);
    }
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
    bus.emit('play');
  },

  pause() {
    activeSlot().audio.pause();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    bus.emit('pause');
  },

  async togglePlayPause() {
    if (activeSlot().audio.paused) await this.play();
    else this.pause();
  },

  isPlaying() { return !activeSlot().audio.paused; },
  getCurrentTime() { return activeSlot().audio.currentTime || 0; },
  getDuration() { return activeSlot().audio.duration || 0; },

  seek(seconds) {
    activeSlot().audio.currentTime = clamp(seconds, 0, this.getDuration() || seconds);
    updatePositionState();
  },

  async next() {
    if (sleepTimer.stopAfterTrack) { this.pause(); this.cancelSleepTimer(); return; }
    const next = peekNextTrackId();
    if (next == null) { this.pause(); return; }
    await this.playTrackAtIndex(order.indexOf(next, currentPos));
  },

  async prev() {
    // Comportamento padrão: se já passou de 3s da faixa, "anterior" reinicia
    // a faixa atual; senão, volta de fato uma faixa.
    if (this.getCurrentTime() > 3 || currentPos <= 0) {
      this.seek(0);
      return;
    }
    await this.playTrackAtIndex(currentPos - 1);
  },

  setVolume(v) {
    volume = clamp(v, 0, 1);
    Prefs.set('volume', volume);
    if (activeSlot().gain) activeSlot().gain.gain.value = volume;
    bus.emit('volumechange', volume);
  },
  getVolume() { return volume; },

  setShuffle(on) {
    shuffleOn = on;
    Prefs.set('shuffle', on);
    const keepId = currentTrackId();
    order = buildOrder(order, keepId);
    currentPos = keepId ? order.indexOf(keepId) : -1;
    bus.emit('queuechange', order);
  },
  isShuffleOn() { return shuffleOn; },

  setRepeatMode(mode) {
    repeatMode = mode;
    Prefs.set('repeatMode', mode);
    bus.emit('repeatchange', mode);
  },
  getRepeatMode() { return repeatMode; },

  setCrossfadeSeconds(seconds) {
    crossfadeSeconds = clamp(seconds, 0, 12);
    Prefs.set('crossfadeSeconds', crossfadeSeconds);
  },
  getCrossfadeSeconds() { return crossfadeSeconds; },

  setPlaybackRate(rate) {
    playbackRate = clamp(rate, 0.5, 2);
    slots.A.audio.playbackRate = playbackRate;
    slots.B.audio.playbackRate = playbackRate;
    bus.emit('ratechange', playbackRate);
  },
  getPlaybackRate() { return playbackRate; },

  // ---- Equalizador -----------------------------------------------------------
  getEqBandFrequencies() { return EQ_BANDS_HZ.slice(); },
  getEqPresetNames() { return Object.keys(EQ_PRESETS); },
  getEqGains() { return eqGainsDb.slice(); },
  isEqEnabled() { return eqEnabled; },
  setEqEnabled(on) {
    eqEnabled = on;
    Prefs.set('eqEnabled', on);
    applyEqualizerToGraph();
  },
  setEqBandGain(index, db) {
    eqGainsDb[index] = clamp(db, -12, 12);
    Prefs.set('eqGains', eqGainsDb);
    applyEqualizerToGraph();
  },
  applyEqPreset(name) {
    if (!EQ_PRESETS[name]) return;
    eqGainsDb = EQ_PRESETS[name].slice();
    Prefs.set('eqGains', eqGainsDb);
    applyEqualizerToGraph();
  },

  // ---- Repetição A-B ------------------------------------------------------------
  setPointA() { abRepeat.a = this.getCurrentTime(); bus.emit('abrepeatchange', abRepeat); },
  setPointB() { abRepeat.b = this.getCurrentTime(); abRepeat.active = abRepeat.a != null; bus.emit('abrepeatchange', abRepeat); },
  clearABRepeat() { abRepeat = { a: null, b: null, active: false }; bus.emit('abrepeatchange', abRepeat); },
  getABRepeat() { return { ...abRepeat }; },

  // ---- Sleep timer -----------------------------------------------------------
  /**
   * Inicia um sleep timer. Se `minutes` for o valor especial "track", a
   * reprodução simplesmente pausa ao fim da faixa atual, em vez de num
   * horário marcado.
   * @param {number|'track'} minutes
   */
  startSleepTimer(minutes) {
    this.cancelSleepTimer();
    if (minutes === 'track') {
      sleepTimer.stopAfterTrack = true;
      bus.emit('sleeptimerchange', this.getSleepTimerState());
      return;
    }
    const ms = minutes * 60 * 1000;
    sleepTimer.endsAt = Date.now() + ms;
    sleepTimer.timeoutId = setTimeout(() => {
      this.pause();
      sleepTimer.endsAt = null;
      bus.emit('sleeptimerchange', this.getSleepTimerState());
    }, ms);
    bus.emit('sleeptimerchange', this.getSleepTimerState());
  },
  cancelSleepTimer() {
    if (sleepTimer.timeoutId) clearTimeout(sleepTimer.timeoutId);
    sleepTimer = { endsAt: null, timeoutId: null, stopAfterTrack: false };
    bus.emit('sleeptimerchange', this.getSleepTimerState());
  },
  getSleepTimerState() {
    return { endsAt: sleepTimer.endsAt, stopAfterTrack: sleepTimer.stopAfterTrack };
  },
};
