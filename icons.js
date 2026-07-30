/**
 * icons.js
 * ---------------------------------------------------------------------------
 * Um pequeno conjunto de ícones SVG usado em todo o app, no lugar de emojis/
 * caracteres Unicode (▶ ⏸ ⏭ ♡ etc.) que renderizam de forma inconsistente
 * (e, em muitas fontes de sistema, esteticamente ruim) entre aparelhos.
 *
 * Cada ícone é uma string SVG pronta para ser inserida via innerHTML, com
 * `stroke="currentColor"` ou `fill="currentColor"` - ou seja, eles herdam a
 * cor de texto do elemento pai automaticamente (inclusive a cor de destaque
 * dinâmica calculada a partir da capa do álbum, veja theme.js).
 *
 * Convenção usada: ícones de transporte (play/pause/próxima/anterior) são
 * "preenchidos" (fill), como é comum em players de música; o restante segue
 * um estilo de traço fino e consistente (stroke-width 2, cantos
 * arredondados), próximo do padrão usado por praticamente todo conjunto de
 * ícones de interface moderno.
 *
 * MELHORIAS FUTURAS:
 *  - Se o conjunto crescer muito, considerar um `<symbol>`/`<use>` com um
 *    único sprite SVG em vez de strings repetidas.
 */

const stroke = (inner) =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const filled = (inner) => `<svg class="icon" viewBox="0 0 24 24" fill="currentColor">${inner}</svg>`;

const HEART_PATH = 'M12 20.9c-.3 0-.6-.1-.8-.3C7.1 17.5 2 13.4 2 8.8 2 5.6 4.4 3 7.6 3c1.7 0 3.3.8 4.4 2.2C13.1 3.8 14.7 3 16.4 3 19.6 3 22 5.6 22 8.8c0 4.6-5.1 8.7-9.2 11.8-.2.2-.5.3-.8.3z';

export const Icons = {
  play: filled('<path d="M8 5v14l11-7z"/>'),
  pause: filled('<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>'),
  next: filled('<path d="M6 5l10 7-10 7V5z"/><rect x="17" y="5" width="2" height="14" rx="1"/>'),
  prev: filled('<path d="M18 5L8 12l10 7V5z"/><rect x="5" y="5" width="2" height="14" rx="1"/>'),

  shuffle: stroke('<path d="M4 6h3.5c1.2 0 2.3.6 3 1.6l4 5.6c.7 1 1.8 1.6 3 1.6H21"/><path d="M17 4l4 3-4 3"/><path d="M4 18h3.5c1.2 0 2.3-.6 3-1.6l1-1.4"/><path d="M17 20l4-3-4-3"/>'),
  playNext: stroke('<polyline points="5 6 12 12 5 18"/><polyline points="13 6 20 12 13 18"/>'),
  repeat: stroke('<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>'),
  repeatOne: stroke('<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><text x="12" y="15" font-size="7" stroke="none" fill="currentColor" text-anchor="middle" font-family="sans-serif">1</text>'),

  heartOutline: stroke(`<path d="${HEART_PATH}"/>`),
  heartFilled: filled(`<path d="${HEART_PATH}"/>`),

  search: stroke('<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
  home: stroke('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>'),
  library: stroke('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
  playlists: stroke('<line x1="3" y1="6" x2="15" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="10" y2="18"/><circle cx="19" cy="17" r="2"/><line x1="21" y1="17" x2="21" y2="7"/><line x1="21" y1="7" x2="17" y2="8"/>'),
  settings: stroke('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),

  queue: stroke('<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="14" y2="17"/>'),
  volume: stroke('<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9a4 4 0 0 1 0 6"/><path d="M18.5 7a7.5 7.5 0 0 1 0 10"/>'),

  close: stroke('<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>'),
  refresh: stroke('<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 4v5h-5"/>'),
  folder: stroke('<path d="M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7z"/>'),

  kebab: filled('<circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/>'),
  kebabHorizontal: filled('<circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/>'),

  edit: stroke('<path d="M4 20l4-1 11-11-3-3L5 16l-1 4z"/>'),
  trash: stroke('<line x1="4" y1="7" x2="20" y2="7"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>'),
  download: stroke('<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 19h16"/>'),
  plus: stroke('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
  check: stroke('<polyline points="5 13 10 18 19 6"/>'),
  chevronDown: stroke('<polyline points="6 9 12 15 18 9"/>'),
  chevronLeft: stroke('<polyline points="15 18 9 12 15 6"/>'),
};
