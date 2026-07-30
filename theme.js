/**
 * theme.js
 * ---------------------------------------------------------------------------
 * Tudo relacionado a "qual é a aparência do Sulco" é uma variável CSS
 * definida no elemento <html> (veja o bloco :root no topo do style.css para
 * a lista completa e seus valores padrão). O único trabalho deste módulo é
 * escolher os valores certos para essas variáveis e escrevê-los no
 * documento, além de persistir a escolha para que ela sobreviva a um
 * recarregamento de página.
 *
 * POR QUE VARIÁVEIS CSS EM VEZ DE TROCAR FOLHAS DE ESTILO:
 *  - Troca instantânea, sem piscar (não precisa buscar/interpretar um novo
 *    <link>).
 *
 * TEMAS DE FUNDO (o usuário escolhe um destes três em Ajustes):
 *  - "dark"    tema escuro premium padrão (grafite)
 *  - "light"   fundo claro tipo papel, texto tinta
 *  - "amoled"  fundo #000000 puro para telas OLED (economiza bateria e dá o
 *              preto mais profundo possível atrás da capa desfocada)
 *
 * COR DE DESTAQUE (--accent / --accent-2): propositalmente NÃO é uma escolha
 * manual do usuário. Ela é calculada automaticamente a partir da capa da
 * faixa que está tocando (veja extractPalette em utils.js e a chamada a
 * `applyAccentFromPalette` em script.js, feita toda vez que uma nova faixa
 * carrega). A ideia é a pessoa nunca precisar "configurar uma cor" - o app
 * simplesmente reflete a música. Enquanto nada está tocando, cada tema usa
 * uma cor de destaque padrão própria (definida em PRESETS abaixo).
 *
 * MELHORIAS FUTURAS:
 *  - Ler prefers-color-scheme no primeiro acesso para escolher entre escuro
 *    e claro como padrão inicial.
 *  - Suavizar a transição da cor de destaque entre faixas com uma animação
 *    de crossfade da própria variável CSS (hoje a troca é instantânea).
 */

import { Prefs } from './storage.js';

/** Valores de cada tema de fundo pronto, incluindo a cor de destaque padrão usada antes de qualquer faixa tocar. */
const PRESETS = {
  dark: {
    '--bg': '#0b0b0e',
    '--bg-elevated': '#16151b',
    '--surface': '#1c1b22',
    '--text': '#f2f0eb',
    '--text-muted': '#9b98a5',
    '--accent': '#e3a857',
    '--accent-2': '#7c6fcb',
    '--border': 'rgba(255,255,255,0.08)',
  },
  light: {
    '--bg': '#f7f4ee',
    '--bg-elevated': '#ffffff',
    '--surface': '#efece4',
    '--text': '#201f24',
    '--text-muted': '#6b6875',
    '--accent': '#c98a3e',
    '--accent-2': '#6a5cc2',
    '--border': 'rgba(0,0,0,0.08)',
  },
  amoled: {
    '--bg': '#000000',
    '--bg-elevated': '#0a0a0a',
    '--surface': '#121212',
    '--text': '#f2f0eb',
    '--text-muted': '#8d8a97',
    '--accent': '#e3a857',
    '--accent-2': '#7c6fcb',
    '--border': 'rgba(255,255,255,0.07)',
  },
};

/** Configurações de aparência que não são cor, persistidas e aplicadas como variáveis CSS. */
const DEFAULT_APPEARANCE = {
  font: 'Sora',            // chave da fonte de destaque/corpo, veja o mapeamento --font-display em style.css
  radius: 18,               // px, border-radius usado em cartões/botões
  cardSize: 'medium',       // 'compact' | 'medium' | 'large' - tamanho dos itens em grade
  animationSpeed: 1,        // multiplicador aplicado em --anim-speed (0.5 = mais devagar, 1.5 = mais rápido)
};

/** Última paleta extraída de uma capa (sessão atual, nunca persistida - é sempre recalculada a partir da faixa tocando). */
let currentAccent = null;

export const ThemeManager = {
  /** @returns {string} o nome do tema de fundo atualmente ativo */
  getActiveThemeName() {
    return Prefs.get('theme', 'dark');
  },

  /** @returns {object} aparência salva (fonte/raio/tamanho de cartão/velocidade de animação) */
  getAppearance() {
    return { ...DEFAULT_APPEARANCE, ...Prefs.get('appearance', {}) };
  },

  /**
   * Aplica um tema de fundo pelo nome, escrevendo cada variável de cor em
   * document.documentElement. Se já existir uma cor de destaque calculada a
   * partir da faixa atual, ela é reaplicada por cima do padrão do tema, para
   * trocar entre escuro/claro/AMOLED nunca "apagar" a cor vinda da música.
   * @param {'dark'|'light'|'amoled'} name
   */
  applyTheme(name) {
    const vars = PRESETS[name] || PRESETS.dark;
    const root = document.documentElement;
    for (const [key, value] of Object.entries(vars)) {
      root.style.setProperty(key, value);
    }
    root.dataset.theme = name;
    Prefs.set('theme', name);

    if (currentAccent) {
      root.style.setProperty('--accent', currentAccent.primary);
      root.style.setProperty('--accent-2', currentAccent.secondary);
    }

    // Mantém a cor do "chrome" do navegador (barra de status / seletor de
    // apps recentes) sincronizada - essa é a única parte da "cor da
    // notificação" que um web app realmente tem permissão de influenciar,
    // veja a seção "Limitações" do README para o motivo de não podermos
    // recolorir a notificação de mídia do Android em si.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', vars['--bg']);
  },

  /**
   * Aplica a cor de destaque (--accent/--accent-2) extraída da capa da
   * faixa que acabou de começar a tocar. Chamado por script.js toda vez que
   * uma nova faixa carrega (veja utils.js -> extractPalette). Não persiste
   * nada - é sempre recalculada a partir da faixa atual, nunca uma escolha
   * manual do usuário.
   * @param {{primary: string, secondary: string}} palette
   */
  applyAccentFromPalette({ primary, secondary }) {
    currentAccent = { primary, secondary };
    const root = document.documentElement;
    root.style.setProperty('--accent', primary);
    root.style.setProperty('--accent-2', secondary);
  },

  /** Volta a cor de destaque para o padrão do tema ativo (usado quando a reprodução para e não há mais uma "faixa atual" para tirar cor dela). */
  resetAccentToDefault() {
    currentAccent = null;
    const preset = PRESETS[this.getActiveThemeName()] || PRESETS.dark;
    const root = document.documentElement;
    root.style.setProperty('--accent', preset['--accent']);
    root.style.setProperty('--accent-2', preset['--accent-2']);
  },

  /**
   * Persiste uma mudança de aparência (total ou parcial - fonte/raio/tamanho
   * de cartão/velocidade de animação) e aplica as variáveis CSS que não
   * dependem de cor.
   * @param {Partial<typeof DEFAULT_APPEARANCE>} partial
   */
  setAppearance(partial) {
    const merged = { ...this.getAppearance(), ...partial };
    Prefs.set('appearance', merged);
    this.applyAppearance(merged);
  },

  /**
   * Escreve as variáveis de aparência que não são cor. Separado de
   * applyTheme para poder rodar uma vez na inicialização independentemente
   * de qual tema de fundo está ativo.
   * @param {typeof DEFAULT_APPEARANCE} [appearance]
   */
  applyAppearance(appearance = this.getAppearance()) {
    const root = document.documentElement;
    root.style.setProperty('--radius', `${appearance.radius}px`);
    root.style.setProperty('--anim-speed', String(appearance.animationSpeed));
    root.style.setProperty(
      '--font-display',
      appearance.font === 'system' ? '-apple-system, sans-serif' : `'${appearance.font}', sans-serif`
    );
    root.dataset.cardSize = appearance.cardSize;
  },

  /** Aplica o último tema + aparência salvos. Chame uma vez na inicialização do app. */
  init() {
    this.applyTheme(this.getActiveThemeName());
    this.applyAppearance();
  },
};
