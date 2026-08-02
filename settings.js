/**
 * settings.js
 * ---------------------------------------------------------------------------
 * Toda a montagem de DOM da tela de Ajustes vive aqui: gerenciar pastas
 * monitoradas (adicionar / remover / atualizar), os controles de aparência
 * (tema de fundo escuro/claro/AMOLED, fonte, raio das bordas, tamanho dos
 * cartões, velocidade das animações), preferências de reprodução
 * (crossfade/gapless, equalizador, velocidade de reprodução) e o pequeno
 * painel "Sobre", que documenta as limitações de navegador enfrentadas por
 * este app.
 *
 * De propósito, NÃO existe nenhum controle de cor manual aqui - a cor de
 * destaque do app é sempre calculada automaticamente a partir da capa da
 * faixa que está tocando (veja theme.js -> applyAccentFromPalette). A pessoa
 * não precisa pensar em cores; o app reflete a música.
 *
 * Este é o único módulo que tem permissão de mexer diretamente em
 * library.js/theme.js/player.js *e* no DOM ao mesmo tempo - script.js trata
 * este arquivo como um "controlador da página de Ajustes" autocontido e só
 * chama Settings.init() uma vez, na inicialização.
 *
 * MELHORIAS FUTURAS:
 *  - Mostrar uma estimativa de uso de armazenamento (navigator.storage.estimate())
 *    para a pessoa acompanhar quanto espaço o cache de áudio das pastas
 *    "manuais" está ocupando.
 */

import { Library, supportsPersistentFolders } from './library.js';
import { ThemeManager } from './theme.js';
import { Player } from './player.js';
import { Icons } from './icons.js';
import { escapeHtml, pluralTracks, isAndroidNative } from './utils.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Renderiza de novo a lista de pastas monitoradas. Chamado depois de qualquer adição/remoção/atualização. */
async function renderFolderList() {
  const container = $('#folder-list');
  if (!container) return;
  const folders = await Library.getFolders();
  const tracks = Library.getAll();

  if (folders.length === 0) {
    container.innerHTML = `<p class="empty-hint">Nenhuma pasta adicionada ainda. Use o botão acima para escolher onde suas músicas estão salvas.</p>`;
    return;
  }

  container.innerHTML = folders.map((folder) => {
    const count = tracks.filter((t) => t.folderId === folder.id).length;
    return `
      <div class="folder-row" data-folder-id="${folder.id}">
        <div class="folder-row-icon" aria-hidden="true">${Icons.folder}</div>
        <div class="folder-row-info">
          <div class="folder-row-name">${escapeHtml(folder.name)}</div>
          <div class="folder-row-meta">${pluralTracks(count)}</div>
        </div>
        <div class="folder-row-actions">
          <button class="btn-icon btn-reconnect-folder" data-id="${folder.id}" title="Atualizar pasta (buscar faixas novas)">${Icons.refresh}</button>
          <button class="btn-icon btn-remove-folder" data-id="${folder.id}" title="Remover pasta">${Icons.close}</button>
        </div>
      </div>`;
  }).join('');
}

/** Conecta o botão "adicionar pasta", escolhendo a estratégia certa para este navegador. */
function initFolderControls(onLibraryChanged) {
  const addBtn = $('#btn-add-folder');
  const fallbackInput = $('#input-folder-fallback');
  const supportNote = $('#folder-support-note');
  const progressEl = $('#folder-scan-progress');

  if (supportNote) {
    if (supportsPersistentFolders()) {
      supportNote.textContent = 'Este navegador mantém a pasta conectada automaticamente entre sessões.';
    } else if (isAndroidNative()) {
      supportNote.textContent = 'A pasta escolhida fica conectada automaticamente entre sessões, com permissão concedida pelo sistema Android - sem precisar escolher de novo. Use "Atualizar" quando quiser detectar músicas novas que tenham sido adicionadas à pasta depois.';
    } else {
      supportNote.textContent = 'Este navegador não permite manter uma pasta "conectada" entre sessões (limitação do sistema, não do app) - por isso, ao adicionar a pasta, o app guarda uma cópia do áudio no armazenamento interno dele. Assim, a reprodução continua funcionando normalmente sempre, sem pedir a pasta de novo; use "Atualizar" só quando quiser detectar músicas novas que tenham sido adicionadas à pasta depois.';
    }
  }

  addBtn?.addEventListener('click', async () => {
    if (supportsPersistentFolders()) {
      try {
        progressEl.textContent = 'Selecionando pasta…';
        await Library.addFolderWithPicker((n) => { progressEl.textContent = `Lendo metadados… ${n} arquivos`; });
        progressEl.textContent = '';
        await renderFolderList();
        onLibraryChanged();
      } catch (err) {
        if (err?.name !== 'AbortError') console.warn('[settings] addFolderWithPicker falhou', err);
        progressEl.textContent = '';
      }
    } else {
      fallbackInput.click();
    }
  });

  fallbackInput?.addEventListener('change', async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    progressEl.textContent = 'Lendo metadados…';
    try {
      await Library.addFolderFromFileList(files, (n) => { progressEl.textContent = `Lendo metadados… ${n} arquivos`; });
    } catch (err) {
      console.warn('[settings] addFolderFromFileList falhou', err);
    }
    progressEl.textContent = '';
    fallbackInput.value = '';
    await renderFolderList();
    onLibraryChanged();
  });

  $('#folder-list')?.addEventListener('click', async (e) => {
    const removeBtn = e.target.closest('.btn-remove-folder');
    const reconnectBtn = e.target.closest('.btn-reconnect-folder');
    if (removeBtn) {
      const id = removeBtn.dataset.id;
      if (confirm('Remover esta pasta e todas as suas faixas da biblioteca?')) {
        await Library.removeFolder(id);
        await renderFolderList();
        onLibraryChanged();
      }
    } else if (reconnectBtn) {
      const id = reconnectBtn.dataset.id;
      const folders = await Library.getFolders();
      const folder = folders.find((f) => f.id === id);
      const progressEl2 = $('#folder-scan-progress');
      try {
        if (folder.kind === 'handle') {
          progressEl2.textContent = 'Atualizando…';
          await Library.reconnectHandleFolder(id, (n) => { progressEl2.textContent = `Atualizando… ${n} arquivos`; });
        } else {
          // Pastas manuais (webkitdirectory) atualizam pelo mesmo fluxo do seletor -
          // isso só é necessário para detectar faixas novas, a reprodução das que já
          // foram varridas antes continua funcionando sem isso.
          fallbackInput.click();
        }
        progressEl2.textContent = '';
        await renderFolderList();
        onLibraryChanged();
      } catch (err) {
        console.warn('[settings] atualização falhou', err);
        progressEl2.textContent = 'Não foi possível atualizar. Tente novamente.';
      }
    }
  });
}

/** Conecta os controles de tema de fundo + aparência (fonte, raio, tamanho de cartão, velocidade de animação). A cor de destaque NÃO é configurável aqui de propósito - ela vem automaticamente da capa da faixa tocando (veja theme.js). */
function initAppearanceControls() {
  const themeButtons = $$('.theme-option');
  const activeTheme = ThemeManager.getActiveThemeName();

  const syncThemeButtons = (name) => {
    themeButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.theme === name));
  };
  syncThemeButtons(activeTheme);

  themeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      ThemeManager.applyTheme(btn.dataset.theme);
      syncThemeButtons(btn.dataset.theme);
    });
  });

  const appearance = ThemeManager.getAppearance();
  const fontSelect = $('#select-font');
  const radiusRange = $('#range-radius');
  const cardSizeSelect = $('#select-card-size');
  const animRange = $('#range-anim-speed');

  if (fontSelect) { fontSelect.value = appearance.font; fontSelect.addEventListener('change', () => ThemeManager.setAppearance({ font: fontSelect.value })); }
  if (radiusRange) { radiusRange.value = appearance.radius; radiusRange.addEventListener('input', () => ThemeManager.setAppearance({ radius: Number(radiusRange.value) })); }
  if (cardSizeSelect) { cardSizeSelect.value = appearance.cardSize; cardSizeSelect.addEventListener('change', () => ThemeManager.setAppearance({ cardSize: cardSizeSelect.value })); }
  if (animRange) { animRange.value = appearance.animationSpeed; animRange.addEventListener('input', () => ThemeManager.setAppearance({ animationSpeed: Number(animRange.value) })); }
}

/** Conecta o crossfade/gapless, a velocidade de reprodução e os sliders do equalizador. */
function initPlaybackControls() {
  const crossfadeRange = $('#range-crossfade');
  const crossfadeLabel = $('#crossfade-label');
  const updateCrossfadeLabel = () => {
    const v = Player.getCrossfadeSeconds();
    crossfadeLabel.textContent = v === 0 ? 'Sem intervalo (gapless quando possível)' : `${v.toFixed(1)}s de fade entre faixas`;
  };
  if (crossfadeRange) {
    crossfadeRange.value = Player.getCrossfadeSeconds();
    updateCrossfadeLabel();
    crossfadeRange.addEventListener('input', () => {
      Player.setCrossfadeSeconds(Number(crossfadeRange.value));
      updateCrossfadeLabel();
    });
  }

  const rateRange = $('#range-playback-rate');
  const rateLabel = $('#rate-label');
  if (rateRange) {
    rateRange.value = Player.getPlaybackRate();
    rateLabel.textContent = `${Player.getPlaybackRate().toFixed(2)}x`;
    rateRange.addEventListener('input', () => {
      Player.setPlaybackRate(Number(rateRange.value));
      rateLabel.textContent = `${Number(rateRange.value).toFixed(2)}x`;
    });
  }

  // Equalizador -----------------------------------------------------------
  const eqToggle = $('#eq-toggle');
  const eqPresetSelect = $('#eq-preset-select');
  const eqBandsContainer = $('#eq-bands-container');

  if (eqPresetSelect) {
    eqPresetSelect.innerHTML = Player.getEqPresetNames().map((n) => `<option value="${n}">${n}</option>`).join('');
    eqPresetSelect.addEventListener('change', () => {
      Player.applyEqPreset(eqPresetSelect.value);
      renderEqBands();
    });
  }
  if (eqToggle) {
    eqToggle.checked = Player.isEqEnabled();
    eqToggle.addEventListener('change', () => Player.setEqEnabled(eqToggle.checked));
  }

  function renderEqBands() {
    if (!eqBandsContainer) return;
    const freqs = Player.getEqBandFrequencies();
    const gains = Player.getEqGains();
    eqBandsContainer.innerHTML = freqs.map((freq, i) => `
      <div class="eq-band">
        <input type="range" min="-12" max="12" step="1" value="${gains[i]}" data-band="${i}" orient="vertical" class="eq-slider" />
        <span class="eq-freq-label">${freq >= 1000 ? `${freq / 1000}k` : freq}</span>
      </div>`).join('');
    $$('.eq-slider', eqBandsContainer).forEach((slider) => {
      slider.addEventListener('input', () => Player.setEqBandGain(Number(slider.dataset.band), Number(slider.value)));
    });
  }
  renderEqBands();
}

export const Settings = {
  /**
   * Inicializa todos os controles da tela de Ajustes. Chame uma vez na
   * inicialização do app.
   * @param {{onLibraryChanged: () => void}} hooks - onLibraryChanged é
   *        chamado sempre que pastas são adicionadas/removidas/revarridas,
   *        para script.js poder renderizar de novo Início/Biblioteca/Busca
   *        com dados atualizados.
   */
  async init({ onLibraryChanged }) {
    initFolderControls(onLibraryChanged);
    initAppearanceControls();
    initPlaybackControls();
    await renderFolderList();
  },
  renderFolderList,
};
