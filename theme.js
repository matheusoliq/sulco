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
 *  - O tema "personalizado" surge naturalmente do mesmo mecanismo: é só o
 *    usuário escolhendo seus próprios valores para as mesmas variáveis que
 *    tudo o mais já usa.
 *
 * TEMAS:
 *  - "dark"    tema escuro premium padrão (grafite + destaques cobre/violeta)
 *  - "light"   fundo claro tipo papel, texto tinta, mesmos tons de destaque
 *  - "amoled"  fundo #000000 puro para telas OLED (economiza bateria e dá o
 *              preto mais profundo possível atrás da capa desfocada)
 *  - "custom"  cada cor abaixo é controlada pelo usuário, persistida por campo
 *
 * MELHORIAS FUTURAS:
 *  - Suportar importar/exportar um tema como uma string JSON compartilhável,
 *    para o usuário poder passar um tema personalizado para um amigo.
 *  - Ler prefers-color-scheme no primeiro acesso para escolher entre escuro
 *    e claro como padrão inicial.
 */

import { Prefs } from './storage.js';

/** Valores base de cada tema pronto. "custom" nasce a partir dos últimos valores personalizados salvos, em vez desta tabela. */
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

/** Configurações de aparência que não são cor, também persistidas e aplicadas como variáveis CSS. */
const DEFAULT_APPEARANCE = {
  font: 'Sora',            // chave da fonte de destaque/corpo, veja o mapeamento --font-display em style.css
  radius: 18,               // px, border-radius usado em cartões/botões
  cardSize: 'medium',       // 'compact' | 'medium' | 'large' - tamanho dos itens em grade
  animationSpeed: 1,        // multiplicador aplicado em --anim-speed (0.5 = mais devagar, 1.5 = mais rápido)
};

export const ThemeManager = {
  /** @returns {string} o nome do tema atualmente ativo */
  getActiveThemeName() {
    return Prefs.get('theme', 'dark');
  },

  /** @returns {object} os valores de cor personalizados salvos (cai para o preset "dark" na primeira vez) */
  getCustomColors() {
    return Prefs.get('customColors', { ...PRESETS.dark });
  },

  /** @returns {object} aparência salva (fonte/raio/tamanho de cartão/velocidade de animação) */
  getAppearance() {
    return { ...DEFAULT_APPEARANCE, ...Prefs.get('appearance', {}) };
  },

  /**
   * Aplica um tema pelo nome, escrevendo cada variável de cor em
   * document.documentElement, o que faz o app inteiro repintar
   * instantaneamente.
   * @param {'dark'|'light'|'amoled'|'custom'} name
   */
  applyTheme(name) {
    const vars = name === 'custom' ? this.getCustomColors() : PRESETS[name] || PRESETS.dark;
    const root = document.documentElement;
    for (const [key, value] of Object.entries(vars)) {
      root.style.setProperty(key, value);
    }
    root.dataset.theme = name;
    Prefs.set('theme', name);

    // Mantém a cor do "chrome" do navegador (barra de status / seletor de
    // apps recentes) sincronizada - essa é a única parte da "cor da
    // notificação" que um web app realmente tem permissão de influenciar,
    // veja a seção "Limitações" do README para o motivo de não podermos
    // recolorir a notificação de mídia do Android em si.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', vars['--bg']);
  },

  /**
   * Persiste um conjunto de cores personalizadas (total ou parcial) e, se o
   * tema "custom" estiver ativo no momento, reaplica na hora, para as
   * edições em Ajustes gerarem uma pré-visualização ao vivo.
   * @param {Partial<typeof PRESETS.dark>} partialColors
   */
  setCustomColors(partialColors) {
    const merged = { ...this.getCustomColors(), ...partialColors };
    Prefs.set('customColors', merged);
    if (this.getActiveThemeName() === 'custom') this.applyTheme('custom');
  },

  /**
   * Persiste uma mudança de aparência (total ou parcial - fonte/raio/tamanho
   * de cartão/velocidade de animação) e aplica as variáveis CSS que não
   * dependem de um tema de cor específico.
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
   * de qual tema de cor está ativo.
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
