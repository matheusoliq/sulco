/**
 * android-bridge.js
 * ---------------------------------------------------------------------------
 * Ponte opcional entre este app web e o wrapper nativo Android (projeto
 * irmão `sulco-android/`, entregue à parte, não faz parte do site em si).
 * Quando o site roda dentro daquele WebView nativo, o próprio app Android
 * injeta um objeto global `window.AndroidBridge` com métodos Java expostos
 * via `@JavascriptInterface`. Rodando num navegador comum, esse objeto não
 * existe, e este arquivo inteiro vira um no-op silencioso - ou seja, o
 * mesmo código do site funciona idêntico dentro ou fora do app nativo, sem
 * nenhum "if" espalhado pelo resto do projeto.
 *
 * O QUE A PONTE FAZ:
 *  - Encaminha troca de faixa/estado de reprodução/posição para o Android
 *    nativo, que usa isso para manter uma notificação de mídia própria
 *    (com cor e capa sob nosso controle - diferente da notificação
 *    genérica que o Chrome desenha para a versão instalada como PWA, veja
 *    o README do projeto sulco-android para a explicação completa).
 *  - Expõe `window.SulcoNativeControls`, chamado pelo lado Kotlin quando o
 *    usuário aperta play/pause/próxima/anterior na notificação nativa ou
 *    na bolha flutuante.
 *
 * O QUE A PONTE *NÃO* FAZ:
 *  - Não participa da leitura da pasta de música. A reconexão automática da
 *    pasta (via Storage Access Framework com permissão persistente) é feita
 *    inteiramente do lado nativo, que simula um clique no mesmo
 *    `<input type="file" webkitdirectory>` que o modo alternativo do
 *    navegador já usa (veja library.js) - ou seja, nenhuma mudança nessa
 *    lógica foi necessária para o app nativo funcionar.
 *
 * MELHORIAS FUTURAS:
 *  - Repassar o estado do sleep timer / equalizador para uma futura tela
 *    nativa, se um dia fizer sentido ter controles nativos além da
 *    notificação e da bolha.
 */

import { Player } from './player.js';
import { Library } from './library.js';
import { isAndroidNative } from './utils.js';

/**
 * Converte a capa de uma faixa (Blob local, via object URL) numa string
 * base64 compacta, pronta para atravessar a ponte JS -> Kotlin (que só
 * aceita tipos simples como string/number/boolean, não Blobs). Redimensiona
 * para 256x256 num <canvas> antes, porque a notificação nativa só precisa
 * de uma imagem pequena - não faz sentido mandar a capa em resolução total.
 * @param {string} coverUrl - object URL retornado por Library.getCoverUrl()
 * @returns {Promise<string>} base64 puro (sem o prefixo "data:image/...")
 */
function coverUrlToSmallBase64(coverUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, size, size);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        resolve(dataUrl.split(',')[1] || '');
      } catch {
        resolve('');
      }
    };
    img.onerror = () => resolve('');
    img.src = coverUrl;
  });
}

/** Guarda qual foi a última faixa cuja capa começou a ser convertida, para descartar conversões antigas se o usuário pular de faixa rápido. */
let lastRequestedTrackId = null;
/** Timestamp (Date.now()) do último onPositionChanged enviado ao nativo, usado para limitar o envio a no máximo 1x/segundo. */
let lastPositionSentAt = 0;

/**
 * Liga os eventos do Player à ponte nativa e expõe os controles que a
 * notificação/bolha nativas chamam de volta. Chamado uma vez no boot do
 * app (script.js); não faz nada fora do wrapper Android.
 */
export function initAndroidBridge() {
  if (!isAndroidNative()) return;

  // Controles chamados pelo Kotlin quando o usuário interage com a
  // notificação nativa (MediaNotificationService) ou com a bolha flutuante
  // (BubbleActivity) - veja sulco-android/.
  window.SulcoNativeControls = {
    play: () => Player.play(),
    pause: () => Player.pause(),
    toggle: () => Player.togglePlayPause(),
    next: () => Player.next(),
    prev: () => Player.prev(),
    seekTo: (seconds) => Player.seek(Number(seconds) || 0),
  };

  Player.on('trackchange', async (track) => {
    if (!track) return;
    lastRequestedTrackId = track.id;
    const coverBase64 = await coverUrlToSmallBase64(Library.getCoverUrl(track));
    // Se o usuário já trocou de faixa de novo enquanto a capa convertia,
    // não sobrescreve a notificação mais nova com uma desatualizada.
    if (lastRequestedTrackId !== track.id) return;
    window.AndroidBridge.onTrackChanged(track.title, track.artist, track.album, coverBase64, track.duration || 0);
  });

  Player.on('play', () => window.AndroidBridge.onPlaybackStateChanged(true));
  Player.on('pause', () => window.AndroidBridge.onPlaybackStateChanged(false));

  Player.on('timeupdate', ({ currentTime, duration }) => {
    if (typeof window.AndroidBridge.onPositionChanged !== 'function') return;
    // O evento 'timeupdate' do <audio> dispara várias vezes por segundo -
    // encaminhar isso tudo para o lado nativo seria desperdício (o Android
    // já extrapola sozinho o avanço do tempo na tela de bloqueio a partir
    // de uma única atualização de estado). Por isso, no máximo 1x/segundo.
    const now = Date.now();
    if (now - lastPositionSentAt < 1000) return;
    lastPositionSentAt = now;
    window.AndroidBridge.onPositionChanged(currentTime || 0, duration || 0);
  });

  // Avisa o nativo que o app terminou de inicializar - é o sinal que o
  // MainActivity usa para, se já existir uma pasta com permissão
  // persistente concedida (Storage Access Framework), refazer a leitura
  // sozinho e "clicar" no input de pasta por trás dos panos, sem exigir
  // nenhum toque do usuário a cada abertura do app.
  if (typeof window.AndroidBridge.onWebAppReady === 'function') {
    window.AndroidBridge.onWebAppReady();
  }
}
