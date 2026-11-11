/**
 * Cellular Automaton
 * Modern, clean implementation with custom colors and localStorage persistence.
 * Pure Vanilla JavaScript (No jQuery).
 */

// ============================================================================
// Color Manager
// ============================================================================

class ColorManager {
  constructor() {
    /** @type {Record<number, string>} */
    this.customColors = {};
  }

  /**
   * Convert HSL color values to a 7-character hex color string (#rrggbb).
   * @param {number} h Hue in degrees [0, 360)
   * @param {number} s Saturation in percent [0, 100]
   * @param {number} l Lightness in percent [0, 100]
   * @returns {string} Hex color string
   */
  static hslToHex(h, s, l) {
    const sNorm = s / 100;
    const lNorm = l / 100;
    const k = n => (n + h / 30) % 12;
    const a = sNorm * Math.min(lNorm, 1 - lNorm);
    const f = n => lNorm - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const toHex = x => Math.round(x * 255).toString(16).padStart(2, '0');
    return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
  }

  /**
   * Determine if the user/browser is currently in dark mode.
   * @returns {boolean}
   */
  static isDarkMode() {
    if (document.documentElement.getAttribute('data-theme') === 'dark') return true;
    if (document.documentElement.getAttribute('data-theme') === 'light') return false;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  /**
   * Get the default color for a given state index.
   * State 0 defaults to the theme background color.
   * States 1+ use an algorithmic golden-ratio hue distribution.
   * @param {number} index State index
   * @returns {string} Hex color string
   */
  getDefaultColor(index) {
    if (index === 0) {
      return ColorManager.isDarkMode() ? '#262624' : '#ecece6';
    }
    const hue = ((index - 1) * 137.5 + 210) % 360;
    const lightness = 46 + ((index % 3) * 4);
    return ColorManager.hslToHex(hue, 62, lightness);
  }

  /**
   * Get the effective color for a state (custom if set, otherwise default).
   * @param {number} index State index
   * @returns {string} Hex color string
   */
  getColor(index) {
    if (this.customColors[index]) {
      return this.customColors[index];
    }
    return this.getDefaultColor(index);
  }

  /**
   * Set a custom color for a state.
   * @param {number} index State index
   * @param {string} hex Hex color string
   */
  setColor(index, hex) {
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
      this.customColors[index] = hex.toLowerCase();
    }
  }

  /**
   * Reset custom color for a single state.
   * @param {number} index State index
   */
  resetColor(index) {
    delete this.customColors[index];
  }

  /**
   * Clear all custom colors.
   */
  resetAllColors() {
    this.customColors = {};
  }

  /**
   * Export custom colors object.
   * @returns {Record<number, string>}
   */
  exportCustomColors() {
    return { ...this.customColors };
  }

  /**
   * Import custom colors.
   * @param {Record<number, string> | string[]} colors
   */
  importCustomColors(colors) {
    this.customColors = {};
    if (Array.isArray(colors)) {
      colors.forEach((c, i) => {
        if (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)) {
          this.customColors[i] = c.toLowerCase();
        }
      });
    } else if (colors && typeof colors === 'object') {
      for (const [key, val] of Object.entries(colors)) {
        const idx = parseInt(key, 10);
        if (!isNaN(idx) && typeof val === 'string' && /^#[0-9a-fA-F]{6}$/.test(val)) {
          this.customColors[idx] = val.toLowerCase();
        }
      }
    }
  }
}

// ============================================================================
// Storage Manager
// ============================================================================

class StorageManager {
  static STORAGE_KEY = 'cellular_automaton_saved_state_v1';

  /**
   * Save configuration and state to localStorage with debounce.
   * @param {object} data
   */
  static save(data) {
    try {
      localStorage.setItem(StorageManager.STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Could not save state to localStorage:', e);
      // If saving failed due to quota (e.g., large grid), try saving without grid data
      if (data.grid) {
        try {
          const fallback = { ...data };
          delete fallback.grid;
          delete fallback.initialGrid;
          localStorage.setItem(StorageManager.STORAGE_KEY, JSON.stringify(fallback));
        } catch (_) {}
      }
    }
  }

  /**
   * Load saved state from localStorage.
   * @returns {object | null}
   */
  static load() {
    try {
      const raw = localStorage.getItem(StorageManager.STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('Failed to parse localStorage data:', e);
      return null;
    }
  }

  /**
   * Clear saved state in localStorage.
   */
  static clear() {
    try {
      localStorage.removeItem(StorageManager.STORAGE_KEY);
    } catch (_) {}
  }
}

// ============================================================================
// Rule Engine
// ============================================================================

class RuleEngine {
  /**
   * Rotate a 1D representation of a k x k square grid 90 degrees clockwise.
   * @param {number[]} q Pattern array
   * @param {number} k Kernel size (2*R + 1)
   * @returns {number[]}
   */
  static rotate(q, k) {
    const res = new Array(k * k);
    for (let y = 0; y < k; y++) {
      for (let x = 0; x < k; x++) {
        res[y * k + x] = q[(k - 1 - x) * k + y];
      }
    }
    return res;
  }

  /**
   * Reflect a 1D representation of a k x k square grid horizontally.
   * @param {number[]} q Pattern array
   * @param {number} k Kernel size (2*R + 1)
   * @returns {number[]}
   */
  static flip(q, k) {
    const res = new Array(k * k);
    for (let y = 0; y < k; y++) {
      for (let x = 0; x < k; x++) {
        res[y * k + x] = q[y * k + (k - 1 - x)];
      }
    }
    return res;
  }

  /**
   * Resize a pattern when neighborhood radius R changes, preserving centered values.
   * @param {number[]} oldPattern
   * @param {number} oldRadius
   * @param {number} newRadius
   * @returns {number[]}
   */
  static resizePattern(oldPattern, oldRadius, newRadius) {
    const kOld = 2 * oldRadius + 1;
    const kNew = 2 * newRadius + 1;
    if (kOld === kNew) return oldPattern.slice();

    const newPattern = new Array(kNew * kNew).fill(-1);
    const offsetOld = (kOld - 1) / 2;
    const offsetNew = (kNew - 1) / 2;

    for (let y = 0; y < kOld; y++) {
      for (let x = 0; x < kOld; x++) {
        const newY = y - offsetOld + offsetNew;
        const newX = x - offsetOld + offsetNew;
        if (newY >= 0 && newY < kNew && newX >= 0 && newX < kNew) {
          newPattern[newY * kNew + newX] = oldPattern[y * kOld + x];
        }
      }
    }
    return newPattern;
  }

  /**
   * Precompile rules for high-speed simulation matching.
   * Pattern rules with symmetry expand into all unique rotations and reflections.
   * @param {Array<object>} rules
   * @param {number} radius
   * @returns {Array<object>}
   */
  static compile(rules, radius) {
    const k = 2 * radius + 1;
    return rules.map(rule => {
      if (rule.t === 'c') {
        return rule;
      }
      const basePattern = rule.pat.length === k * k ? rule.pat : new Array(k * k).fill(-1);
      const variants = [basePattern];

      if (rule.sym) {
        const seen = new Set([basePattern.join(',')]);
        let cur = basePattern;
        for (let f = 0; f < 2; f++) {
          for (let r = 0; r < 4; r++) {
            cur = RuleEngine.rotate(cur, k);
            const key = cur.join(',');
            if (!seen.has(key)) {
              seen.add(key);
              variants.push(cur);
            }
          }
          cur = RuleEngine.flip(cur, k);
          const key = cur.join(',');
          if (!seen.has(key)) {
            seen.add(key);
            variants.push(cur);
          }
        }
      }

      return {
        t: 'p',
        variants,
        output: rule.o
      };
    });
  }

  /**
   * Check if a pattern matches neighborhood centered at (x, y).
   * @param {number[]} pattern Pattern array of length k*k
   * @param {number} x Center x
   * @param {number} y Center y
   * @param {boolean} wrap
   * @param {Uint8Array} grid
   * @param {number} width
   * @param {number} height
   * @param {number} radius
   * @param {number} k
   * @returns {boolean}
   */
  static matchPattern(pattern, x, y, wrap, grid, width, height, radius, k) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const targetVal = pattern[(dy + radius) * k + (dx + radius)];
        if (targetVal < 0) continue; // -1 matches any state

        let sampleX = x + dx;
        let sampleY = y + dy;

        if (wrap) {
          sampleX = (sampleX + width) % width;
          sampleY = (sampleY + height) % height;
        } else if (sampleX < 0 || sampleY < 0 || sampleX >= width || sampleY >= height) {
          // Out of bounds cell only matches wildcard (-1)
          return false;
        }

        if (grid[sampleY * width + sampleX] !== targetVal) {
          return false;
        }
      }
    }
    return true;
  }
}

// ============================================================================
// LaTeX Exporter
// ============================================================================

class LatexExporter {
  /**
   * Determine whether text on a given background color should be white or black.
   * Uses perceived luminance (ITU-R BT.601 formula).
   * @param {string} hexColor #rrggbb or #rgb
   * @returns {'white' | 'black'}
   */
  static getContrastColor(hexColor) {
    if (!hexColor || typeof hexColor !== 'string') return 'black';
    const hex = hexColor.replace('#', '').trim();
    if (hex.length !== 6 && hex.length !== 3) return 'black';
    let r, g, b;
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else {
      r = parseInt(hex.substring(0, 2), 16);
      g = parseInt(hex.substring(2, 4), 16);
      b = parseInt(hex.substring(4, 6), 16);
    }
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    return luminance < 140 ? 'white' : 'black';
  }

  /**
   * Format a cell color macro according to syntax preference.
   * @param {string} hexColor e.g. '#ffbdbd'
   * @param {'hex' | 'html'} syntax 'hex' -> \cellcolor{#ffbdbd}, 'html' -> \cellcolor[HTML]{ffbdbd}
   * @returns {string}
   */
  static formatCellColor(hexColor, syntax = 'hex') {
    const raw = hexColor.replace('#', '').toLowerCase();
    if (syntax === 'html') {
      return `\\cellcolor[HTML]{${raw}}`;
    }
    return `\\cellcolor{#${raw}}`;
  }

  /**
   * Format a colored boxed cell macro (\fcolorbox) according to syntax preference.
   * @param {string} hexColor e.g. '#0080ff'
   * @param {string} textColor e.g. 'white' or 'black'
   * @param {number | string} val e.g. 1
   * @param {'hex' | 'html'} syntax 'hex' -> \fcolorbox{#0080ff}{#0080ff}{\color{white}1}, 'html' -> \fcolorbox[HTML]{0080ff}{0080ff}{\color{white}1}
   * @returns {string}
   */
  static formatFColorBox(hexColor, textColor, val, syntax = 'hex') {
    const raw = hexColor.replace('#', '').toLowerCase();
    if (syntax === 'html') {
      return `\\fcolorbox[HTML]{${raw}}{${raw}}{\\color{${textColor}}${val}}`;
    }
    return `\\fcolorbox{#${raw}}{#${raw}}{\\color{${textColor}}${val}}`;
  }

  /**
   * Format a single pattern rule as LaTeX math.
   * @param {object} rule
   * @param {number} radius
   * @param {ColorManager} colors
   * @param {'all' | 'center' | 'none'} [colorMode='all']
   * @param {'hex' | 'html'} [syntax='hex']
   * @returns {string} LaTeX math string (without outer $$ or $)
   */
  static formatPatternRule(rule, radius, colors, colorMode = 'all', syntax = 'hex') {
    const k = 2 * radius + 1;
    const centerIdx = (k * k - 1) / 2;
    const colSpec = '|' + 'c|'.repeat(k);
    const pat = Array.isArray(rule.pat) && rule.pat.length === k * k
      ? rule.pat
      : new Array(k * k).fill(-1);

    const arrayLines = [`\\begin{array}{${colSpec}}`, '\\hline'];
    for (let y = 0; y < k; y++) {
      const rowCells = [];
      for (let x = 0; x < k; x++) {
        const idx = y * k + x;
        const val = pat[idx];
        const isCenter = idx === centerIdx;

        if (val < 0) {
          rowCells.push('*');
        } else {
          const hex = colors.getColor(val);
          const textColor = LatexExporter.getContrastColor(hex);
          const shouldColor = (colorMode === 'all') || (colorMode === 'center' && isCenter);

          if (shouldColor) {
            const cc = LatexExporter.formatCellColor(hex, syntax);
            rowCells.push(`${cc}\\color{${textColor}}${val}`);
          } else {
            rowCells.push(String(val));
          }
        }
      }
      arrayLines.push(rowCells.join(' & ') + ' \\\\');
      arrayLines.push('\\hline');
    }
    arrayLines.push('\\end{array}');

    let outStr;
    if (rule.o < 0) {
      outStr = '\\fbox{*}';
    } else {
      const outHex = colors.getColor(rule.o);
      const outTextColor = LatexExporter.getContrastColor(outHex);
      if (colorMode !== 'none') {
        outStr = LatexExporter.formatFColorBox(outHex, outTextColor, rule.o, syntax);
      } else {
        outStr = `\\fbox{${rule.o}}`;
      }
    }

    let mathBody = arrayLines.join('\n') + '\n\\quad\\longrightarrow\\quad\n' + outStr;
    if (rule.sym) {
      mathBody += ' \\quad\\text{(rot / flip)}';
    }
    return mathBody;
  }

  /**
   * Format a single pattern rule as compact single-line LaTeX math for inline rows.
   * @param {object} rule
   * @param {number} radius
   * @param {ColorManager} colors
   * @param {'all' | 'center' | 'none'} [colorMode='all']
   * @param {'hex' | 'html'} [syntax='hex']
   * @returns {string} Single-line LaTeX math expression
   */
  static formatPatternRuleInline(rule, radius, colors, colorMode = 'all', syntax = 'hex') {
    const k = 2 * radius + 1;
    const centerIdx = (k * k - 1) / 2;
    const colSpec = '|' + 'c|'.repeat(k);
    const pat = Array.isArray(rule.pat) && rule.pat.length === k * k
      ? rule.pat
      : new Array(k * k).fill(-1);

    const rows = [];
    for (let y = 0; y < k; y++) {
      const rowCells = [];
      for (let x = 0; x < k; x++) {
        const idx = y * k + x;
        const val = pat[idx];
        const isCenter = idx === centerIdx;

        if (val < 0) {
          rowCells.push('*');
        } else {
          const hex = colors.getColor(val);
          const textColor = LatexExporter.getContrastColor(hex);
          const shouldColor = (colorMode === 'all') || (colorMode === 'center' && isCenter);

          if (shouldColor) {
            const cc = LatexExporter.formatCellColor(hex, syntax);
            rowCells.push(`${cc}\\color{${textColor}}${val}`);
          } else {
            rowCells.push(String(val));
          }
        }
      }
      rows.push(rowCells.join(' & ') + ' \\\\ \\hline');
    }

    const arrayStr = `\\begin{array}{${colSpec}} \\hline ${rows.join(' ')} \\end{array}`;

    let outStr;
    if (rule.o < 0) {
      outStr = '\\fbox{*}';
    } else {
      const outHex = colors.getColor(rule.o);
      const outTextColor = LatexExporter.getContrastColor(outHex);
      if (colorMode !== 'none') {
        outStr = LatexExporter.formatFColorBox(outHex, outTextColor, rule.o, syntax);
      } else {
        outStr = `\\fbox{${rule.o}}`;
      }
    }

    let mathBody = `${arrayStr}\\quad\\longrightarrow\\quad${outStr}`;
    if (rule.sym) {
      mathBody += ' \\quad\\text{(rot / flip)}';
    }
    return mathBody;
  }

  /**
   * Format a single count rule as LaTeX math.
   * @param {object} rule
   * @param {ColorManager} colors
   * @param {'all' | 'center' | 'none'} [colorMode='all']
   * @param {'hex' | 'html'} [syntax='hex']
   * @returns {string} LaTeX math string
   */
  static formatCountRule(rule, colors, colorMode = 'all', syntax = 'hex') {
    const sHex = colors.getColor(rule.s);
    const sTextColor = LatexExporter.getContrastColor(sHex);
    const cellBox = colorMode !== 'none'
      ? LatexExporter.formatFColorBox(sHex, sTextColor, rule.s, syntax)
      : `\\fbox{${rule.s}}`;

    const nHex = colors.getColor(rule.n);
    const nTextColor = LatexExporter.getContrastColor(nHex);
    const neighBox = colorMode !== 'none'
      ? LatexExporter.formatFColorBox(nHex, nTextColor, rule.n, syntax)
      : `\\fbox{${rule.n}}`;

    let condStr;
    if (rule.min === rule.max) {
      condStr = `\\text{count}(${neighBox}) = ${rule.min}`;
    } else {
      condStr = `${rule.min} \\le \\text{count}(${neighBox}) \\le ${rule.max}`;
    }

    let outStr;
    if (rule.o < 0) {
      outStr = '\\fbox{*}';
    } else {
      const outHex = colors.getColor(rule.o);
      const outTextColor = LatexExporter.getContrastColor(outHex);
      outStr = colorMode !== 'none'
        ? LatexExporter.formatFColorBox(outHex, outTextColor, rule.o, syntax)
        : `\\fbox{${rule.o}}`;
    }

    return `\\text{cell } ${cellBox} \\text{ with } ${condStr}\n\\quad\\longrightarrow\\quad\n${outStr}`;
  }

  /**
   * Export all rules to LaTeX format.
   * @param {object} options
   * @param {Array<object>} options.rules
   * @param {number} options.radius
   * @param {number} options.numStates
   * @param {boolean} options.wrapEdges
   * @param {ColorManager} options.colors
   * @param {'all' | 'center' | 'none'} [options.colorMode='all']
   * @param {'hex' | 'html'} [options.syntax='hex']
   * @param {'display' | 'inline' | 'bracket' | 'enumerate' | 'document'} [options.format='display']
   * @returns {string}
   */
  static exportRules({ rules, radius, numStates, wrapEdges, colors, colorMode = 'all', syntax = 'hex', format = 'display' }) {
    if (!rules || rules.length === 0) {
      if (format === 'document') {
        return `\\documentclass{article}
\\usepackage{amsmath}
\\usepackage[table]{xcolor}

\\title{Cellular Automaton Rules}
\\date{}

\\begin{document}
\\maketitle

\\section*{Rules}
% States: ${numStates} | Radius: ${radius} | Wrap edges: ${wrapEdges}
No rules defined (cells keep current state).

\\end{document}`;
      }
      return '% No rules defined (cells keep current state)';
    }

    const mathItems = rules.map(rule => {
      if (rule.t === 'c') {
        return LatexExporter.formatCountRule(rule, colors, colorMode, syntax);
      }
      return LatexExporter.formatPatternRule(rule, radius, colors, colorMode, syntax);
    });

    if (format === 'display') {
      return mathItems.map(m => `$$\n${m}\n$$`).join('\n\n');
    }

    if (format === 'bracket') {
      return mathItems.map(m => `\\[\n${m}\n\\]`).join('\n\n');
    }

    if (format === 'inline') {
      const inlineItems = rules.map(rule => {
        if (rule.t === 'c') {
          return LatexExporter.formatCountRule(rule, colors, colorMode, syntax).replace(/\n/g, ' ');
        }
        return LatexExporter.formatPatternRuleInline(rule, radius, colors, colorMode, syntax);
      });

      const chunkedRows = [];
      const separator = ' \\quad\\quad\\quad\\quad\\quad ';
      for (let i = 0; i < inlineItems.length; i += 3) {
        const slice = inlineItems.slice(i, i + 3);
        chunkedRows.push(`$${slice.join(separator)}$`);
      }
      return chunkedRows.join('\n\n');
    }

    if (format === 'enumerate') {
      const items = mathItems.map(m => `  \\item\n$$\n${m}\n$$`).join('\n');
      return `\\begin{enumerate}\n${items}\n\\end{enumerate}`;
    }

    if (format === 'document') {
      const items = mathItems.map(m => `  \\item\n$$\n${m}\n$$`).join('\n');
      return `\\documentclass{article}
\\usepackage{amsmath}
\\usepackage[table]{xcolor}

\\title{Cellular Automaton Rules}
\\date{}

\\begin{document}
\\maketitle

\\section*{Rules}
% States: ${numStates} | Radius: ${radius} | Wrap edges: ${wrapEdges}

\\begin{enumerate}
${items}
\\end{enumerate}

\\end{document}`;
    }

    return mathItems.map(m => `$$\n${m}\n$$`).join('\n\n');
  }
}

// ============================================================================
// Main Application
// ============================================================================

class CellularAutomatonApp {
  constructor() {
    // Core parameters
    this.numStates = 2;
    this.radius = 1;
    this.width = 60;
    this.height = 40;
    this.wrapEdges = true;
    this.speed = 12;
    this.density = 30;

    /** @type {Array<object>} */
    this.rules = [];
    /** @type {Uint8Array} */
    this.grid = new Uint8Array(this.width * this.height);
    /** @type {Uint8Array} */
    this.initialGrid = new Uint8Array(this.width * this.height);

    this.generation = 0;
    this.timer = null;
    this.brush = 1;
    this.pen = 1;
    this.cellPixelSize = 10;
    this.isPainting = false;

    // Helpers
    this.colors = new ColorManager();
    this.saveTimeout = null;

    // Cache DOM Elements
    this.dom = {
      // Navigation
      navButtons: document.querySelectorAll('nav.tabs button'),
      sections: document.querySelectorAll('main > section'),
      navGoButtons: document.querySelectorAll('[data-go]'),

      // Section 0 - States
      numStatesInput: document.getElementById('nStates'),
      colsInput: document.getElementById('cols'),
      rowsInput: document.getElementById('rows'),
      legendContainer: document.getElementById('legend'),
      resetColorsBtn: document.getElementById('resetColors'),
      ioTextarea: document.getElementById('io'),
      exportBtn: document.getElementById('exp'),
      importBtn: document.getElementById('imp'),
      ioMsg: document.getElementById('ioMsg'),

      // Section 1 - Rules
      radiusInput: document.getElementById('radius'),
      wrapCheckbox: document.getElementById('wrap'),
      maxNeighborsHint: document.getElementById('maxn'),
      penContainer: document.getElementById('pen'),
      rulesContainer: document.getElementById('rules'),
      addPatternRuleBtn: document.getElementById('addP'),
      addCountRuleBtn: document.getElementById('addC'),

      // Section 2 - Canvas & Run
      brushContainer: document.getElementById('brush'),
      canvas: document.getElementById('cv'),
      playBtn: document.getElementById('play'),
      stepBtn: document.getElementById('step'),
      resetBtn: document.getElementById('reset'),
      speedSlider: document.getElementById('speed'),
      genDisplay: document.getElementById('gen'),
      randomizeBtn: document.getElementById('rand'),
      densityInput: document.getElementById('dens'),
      clearBtn: document.getElementById('clear'),

      // LaTeX Export Modal & Buttons
      expLatexBtn: document.getElementById('expLatex'),
      expLatexRulesBtn: document.getElementById('expLatexRules'),
      latexModal: document.getElementById('latexModal'),
      latexCloseBtn: document.getElementById('latexCloseBtn'),
      latexDismissBtn: document.getElementById('latexDismissBtn'),
      latexCopyBtn: document.getElementById('latexCopyBtn'),
      latexDownloadBtn: document.getElementById('latexDownloadBtn'),
      latexOutput: document.getElementById('latexOutput'),
      latexColorMode: document.getElementById('latexColorMode'),
      latexSyntax: document.getElementById('latexSyntax'),
      latexFormat: document.getElementById('latexFormat'),
      latexStatusMsg: document.getElementById('latexStatusMsg')
    };

    this.init();
  }

  /**
   * Clamp helper with fallback.
   * @param {any} val
   * @param {number} min
   * @param {number} max
   * @param {number} fallback
   * @returns {number}
   */
  static clamp(val, min, max, fallback = min) {
    const num = parseInt(val, 10);
    if (isNaN(num)) return fallback;
    return Math.max(min, Math.min(max, num));
  }

  /**
   * Kernel dimension (2*R + 1).
   * @returns {number}
   */
  get kernelSize() {
    return 2 * this.radius + 1;
  }

  /**
   * Max neighbors in Moore neighborhood ((2*R+1)^2 - 1).
   * @returns {number}
   */
  get maxNeighbors() {
    return Math.pow(this.kernelSize, 2) - 1;
  }

  /**
   * Initialize application and restore state from localStorage if available.
   */
  init() {
    this.restoreFromStorage();
    this.initGrid();
    this.setupEventListeners();
    this.switchTab(0);
  }

  /**
   * Schedule debounced persistence to localStorage.
   */
  scheduleSave() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.saveToStorage();
    }, 150);
  }

  /**
   * Save current configuration, rules, states, custom colors and grid to localStorage.
   */
  saveToStorage() {
    const data = {
      version: 1,
      numStates: this.numStates,
      width: this.width,
      height: this.height,
      radius: this.radius,
      wrapEdges: this.wrapEdges,
      speed: this.speed,
      density: this.density,
      rules: this.rules,
      customColors: this.colors.exportCustomColors(),
      grid: Array.from(this.grid),
      initialGrid: Array.from(this.initialGrid)
    };
    StorageManager.save(data);
  }

  /**
   * Restore configuration, rules, states, custom colors and grid from localStorage.
   */
  restoreFromStorage() {
    const saved = StorageManager.load();
    if (!saved) return;

    if (Number.isInteger(saved.numStates)) {
      this.numStates = CellularAutomatonApp.clamp(saved.numStates, 2, 32, 2);
      this.dom.numStatesInput.value = this.numStates;
    }
    if (Number.isInteger(saved.width)) {
      this.width = CellularAutomatonApp.clamp(saved.width, 8, 200, 60);
      this.dom.colsInput.value = this.width;
    }
    if (Number.isInteger(saved.height)) {
      this.height = CellularAutomatonApp.clamp(saved.height, 8, 200, 40);
      this.dom.rowsInput.value = this.height;
    }
    if (Number.isInteger(saved.radius)) {
      this.radius = CellularAutomatonApp.clamp(saved.radius, 1, 5, 1);
      this.dom.radiusInput.value = this.radius;
    }
    if (typeof saved.wrapEdges === 'boolean') {
      this.wrapEdges = saved.wrapEdges;
      this.dom.wrapCheckbox.checked = this.wrapEdges;
    }
    if (Number.isInteger(saved.speed)) {
      this.speed = CellularAutomatonApp.clamp(saved.speed, 1, 60, 12);
      this.dom.speedSlider.value = this.speed;
    }
    if (Number.isInteger(saved.density)) {
      this.density = CellularAutomatonApp.clamp(saved.density, 1, 100, 30);
      this.dom.densityInput.value = this.density;
    }
    if (saved.customColors) {
      this.colors.importCustomColors(saved.customColors);
    }
    if (Array.isArray(saved.rules)) {
      this.rules = saved.rules;
    }
    if (Array.isArray(saved.grid) && saved.grid.length === this.width * this.height) {
      this.grid = new Uint8Array(saved.grid);
      if (Array.isArray(saved.initialGrid) && saved.initialGrid.length === this.width * this.height) {
        this.initialGrid = new Uint8Array(saved.initialGrid);
      } else {
        this.initialGrid = this.grid.slice();
      }
    }
  }

  /**
   * Set up all DOM and Window event listeners.
   */
  setupEventListeners() {
    // Navigation Tabs
    this.dom.navButtons.forEach((btn, index) => {
      btn.addEventListener('click', () => this.switchTab(index));
    });

    this.dom.navGoButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const target = parseInt(btn.dataset.go, 10);
        this.switchTab(target);
      });
    });

    // Section 0 - State Controls
    this.dom.numStatesInput.addEventListener('change', () => this.handleNumStatesChange());
    this.dom.colsInput.addEventListener('change', () => this.handleDimensionsChange());
    this.dom.rowsInput.addEventListener('change', () => this.handleDimensionsChange());

    this.dom.resetColorsBtn.addEventListener('click', () => {
      this.colors.resetAllColors();
      this.renderLegend();
      this.renderPenBar();
      this.renderBrushBar();
      this.renderRules();
      this.drawCanvas();
      this.scheduleSave();
      this.showIoMessage('Colors reset to defaults.');
    });

    // Import / Export
    this.dom.exportBtn.addEventListener('click', () => this.exportConfig());
    this.dom.importBtn.addEventListener('click', () => this.importConfig());
    if (this.dom.expLatexBtn) {
      this.dom.expLatexBtn.addEventListener('click', () => {
        this.openLatexExportModal();
        this.showIoMessage('LaTeX rules exported.');
      });
    }
    if (this.dom.expLatexRulesBtn) {
      this.dom.expLatexRulesBtn.addEventListener('click', () => {
        this.openLatexExportModal();
      });
    }

    // LaTeX Modal Controls
    if (this.dom.latexCloseBtn) {
      this.dom.latexCloseBtn.addEventListener('click', () => this.closeLatexExportModal());
    }
    if (this.dom.latexDismissBtn) {
      this.dom.latexDismissBtn.addEventListener('click', () => this.closeLatexExportModal());
    }
    if (this.dom.latexModal) {
      this.dom.latexModal.addEventListener('click', e => {
        if (e.target === this.dom.latexModal) {
          this.closeLatexExportModal();
        }
      });
    }
    if (this.dom.latexColorMode) {
      this.dom.latexColorMode.addEventListener('change', () => this.updateLatexExport());
    }
    if (this.dom.latexSyntax) {
      this.dom.latexSyntax.addEventListener('change', () => this.updateLatexExport());
    }
    if (this.dom.latexFormat) {
      this.dom.latexFormat.addEventListener('change', () => {
        if (this.dom.latexFormat.value === 'document' && this.dom.latexSyntax.value === 'hex') {
          this.dom.latexSyntax.value = 'html';
        }
        this.updateLatexExport();
      });
    }
    if (this.dom.latexCopyBtn) {
      this.dom.latexCopyBtn.addEventListener('click', () => this.copyLatexToClipboard());
    }
    if (this.dom.latexDownloadBtn) {
      this.dom.latexDownloadBtn.addEventListener('click', () => this.downloadLatexFile());
    }

    // Section 1 - Rules
    this.dom.radiusInput.addEventListener('change', () => this.handleRadiusChange());
    this.dom.wrapCheckbox.addEventListener('change', () => {
      this.wrapEdges = this.dom.wrapCheckbox.checked;
      this.scheduleSave();
    });

    this.dom.addPatternRuleBtn.addEventListener('click', () => {
      const k = this.kernelSize;
      this.rules.push({
        t: 'p',
        pat: new Array(k * k).fill(-1),
        o: -1,
        sym: false
      });
      this.renderRules();
      this.scheduleSave();
    });

    this.dom.addCountRuleBtn.addEventListener('click', () => {
      this.rules.push({
        t: 'c',
        s: 0,
        n: Math.min(1, this.numStates - 1),
        min: 1,
        max: this.maxNeighbors,
        o: Math.min(1, this.numStates - 1)
      });
      this.renderRules();
      this.scheduleSave();
    });

    // Section 2 - Canvas & Run
    this.dom.playBtn.addEventListener('click', () => this.togglePlay());
    this.dom.stepBtn.addEventListener('click', () => {
      this.stop();
      if (this.generation === 0) {
        this.initialGrid = this.grid.slice();
      }
      this.step();
      this.scheduleSave();
    });

    this.dom.resetBtn.addEventListener('click', () => {
      this.stop();
      this.grid = this.initialGrid.slice();
      this.generation = 0;
      this.drawCanvas();
      this.scheduleSave();
    });

    this.dom.speedSlider.addEventListener('input', () => {
      this.speed = parseInt(this.dom.speedSlider.value, 10) || 12;
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = setInterval(() => this.step(), 1000 / this.speed);
      }
      this.scheduleSave();
    });

    this.dom.clearBtn.addEventListener('click', () => {
      this.stop();
      this.grid.fill(0);
      this.initialGrid = this.grid.slice();
      this.generation = 0;
      this.drawCanvas();
      this.scheduleSave();
    });

    this.dom.randomizeBtn.addEventListener('click', () => {
      this.stop();
      this.density = CellularAutomatonApp.clamp(this.dom.densityInput.value, 1, 100, 30);
      const ratio = this.density / 100;
      for (let i = 0; i < this.grid.length; i++) {
        this.grid[i] = Math.random() < ratio ? 1 + Math.floor(Math.random() * (this.numStates - 1)) : 0;
      }
      this.initialGrid = this.grid.slice();
      this.generation = 0;
      this.drawCanvas();
      this.scheduleSave();
    });

    // Canvas Pointer Painting
    this.dom.canvas.addEventListener('pointerdown', e => {
      this.isPainting = true;
      try {
        this.dom.canvas.setPointerCapture(e.pointerId);
      } catch (_) {}
      this.paintCanvasCell(e);
    });

    this.dom.canvas.addEventListener('pointermove', e => {
      if (this.isPainting) {
        this.paintCanvasCell(e);
      }
    });

    window.addEventListener('pointerup', () => {
      if (this.isPainting) {
        this.isPainting = false;
        this.scheduleSave();
      }
    });

    window.addEventListener('pointercancel', () => {
      if (this.isPainting) {
        this.isPainting = false;
        this.scheduleSave();
      }
    });

    // Theme changes (Dark/Light mode switch)
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        this.renderLegend();
        this.renderPenBar();
        this.renderBrushBar();
        this.renderRules();
        this.drawCanvas();
      });
    }
  }

  /**
   * Switch active navigation tab.
   * @param {number} tabIndex 0: States, 1: Rules, 2: Initial & run
   */
  switchTab(tabIndex) {
    this.dom.sections.forEach((sec, i) => sec.classList.toggle('on', i === tabIndex));
    this.dom.navButtons.forEach((btn, i) => btn.classList.toggle('on', i === tabIndex));

    if (tabIndex === 0) {
      this.renderLegend();
    } else if (tabIndex === 1) {
      this.renderPenBar();
      this.renderRules();
    } else if (tabIndex === 2) {
      this.renderBrushBar();
      this.drawCanvas();
    }

    if (tabIndex !== 2) {
      this.stop();
    }
  }

  /**
   * Allocate new grid or resize canvas backing store.
   */
  initGrid(preserveExisting = true) {
    this.width = CellularAutomatonApp.clamp(this.dom.colsInput.value, 8, 200, 60);
    this.height = CellularAutomatonApp.clamp(this.dom.rowsInput.value, 8, 200, 40);
    this.dom.colsInput.value = this.width;
    this.dom.rowsInput.value = this.height;

    const totalCells = this.width * this.height;
    if (!this.grid || this.grid.length !== totalCells || !preserveExisting) {
      this.grid = new Uint8Array(totalCells);
      this.initialGrid = this.grid.slice();
      this.generation = 0;
    }

    // Dynamic cell rendering size: between 4px and 12px
    this.cellPixelSize = Math.max(4, Math.min(12, Math.floor(1200 / this.width)));
    this.dom.canvas.width = this.width * this.cellPixelSize;
    this.dom.canvas.height = this.height * this.cellPixelSize;

    this.stop();
    this.drawCanvas();
  }

  /**
   * Handle changes to columns or rows input.
   */
  handleDimensionsChange() {
    this.initGrid(false);
    this.scheduleSave();
  }

  /**
   * Handle changes to number of states (2 - 32).
   */
  handleNumStatesChange() {
    this.numStates = CellularAutomatonApp.clamp(this.dom.numStatesInput.value, 2, 32, 2);
    this.dom.numStatesInput.value = this.numStates;

    // Sanitize rules for state count reduction
    this.rules.forEach(rule => {
      if (rule.t === 'c') {
        rule.s = Math.min(rule.s, this.numStates - 1);
        rule.n = Math.min(rule.n, this.numStates - 1);
        rule.o = rule.o >= this.numStates ? -1 : rule.o;
      } else if (rule.t === 'p') {
        rule.pat = rule.pat.map(val => (val >= this.numStates ? -1 : val));
        if (rule.o >= this.numStates) {
          rule.o = -1;
        }
      }
    });

    if (this.brush >= this.numStates) {
      this.brush = this.numStates - 1;
    }
    if (this.pen >= this.numStates) {
      this.pen = this.numStates - 1;
    }

    // Clamp grid cells
    for (let i = 0; i < this.grid.length; i++) {
      if (this.grid[i] >= this.numStates) {
        this.grid[i] = 0;
      }
    }
    this.initialGrid = this.initialGrid.map(val => (val >= this.numStates ? 0 : val));

    this.renderLegend();
    this.renderPenBar();
    this.renderBrushBar();
    this.drawCanvas();
    this.scheduleSave();
  }

  /**
   * Handle changes to radius input (1 - 5).
   */
  handleRadiusChange() {
    const oldRadius = this.radius;
    this.radius = CellularAutomatonApp.clamp(this.dom.radiusInput.value, 1, 5, 1);
    this.dom.radiusInput.value = this.radius;

    const maxNeigh = this.maxNeighbors;
    this.dom.maxNeighborsHint.textContent = maxNeigh;

    // Update rules
    this.rules.forEach(rule => {
      if (rule.t === 'c') {
        rule.min = Math.min(rule.min, maxNeigh);
        rule.max = Math.min(rule.max, maxNeigh);
      } else if (rule.t === 'p') {
        rule.pat = RuleEngine.resizePattern(rule.pat, oldRadius, this.radius);
      }
    });

    this.renderRules();
    this.scheduleSave();
  }

  /**
   * Render the States legend with interactive custom color pickers.
   */
  renderLegend() {
    const container = this.dom.legendContainer;
    container.innerHTML = '';

    for (let i = 0; i < this.numStates; i++) {
      const currentColor = this.colors.getColor(i);

      const item = document.createElement('div');
      item.className = 'swatch-item';
      item.title = `State ${i} — Click to customize color`;

      // Color picker wrapper
      const pickerWrapper = document.createElement('label');
      pickerWrapper.className = 'color-picker-wrapper';

      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value = currentColor;
      colorInput.setAttribute('aria-label', `Color for state ${i}`);

      const previewBox = document.createElement('span');
      previewBox.className = 'color-preview-box';
      previewBox.style.backgroundColor = currentColor;

      colorInput.addEventListener('input', () => {
        const newColor = colorInput.value;
        this.colors.setColor(i, newColor);
        previewBox.style.backgroundColor = newColor;
        hexLabel.textContent = newColor;
        this.renderPenBar();
        this.renderBrushBar();
        this.renderRules();
        this.drawCanvas();
        this.scheduleSave();
      });

      pickerWrapper.append(colorInput, previewBox);

      const label = document.createElement('span');
      label.textContent = `State ${i}`;

      const hexLabel = document.createElement('span');
      hexLabel.className = 'swatch-hex';
      hexLabel.textContent = currentColor;

      item.append(pickerWrapper, label, hexLabel);
      container.appendChild(item);
    }
  }

  /**
   * Render the Pen selector bar in Rules section.
   */
  renderPenBar() {
    const container = this.dom.penContainer;
    container.innerHTML = '';

    if (this.pen >= this.numStates) {
      this.pen = this.numStates - 1;
    }

    // Pen values: -1 (any / *) and 0 .. numStates - 1
    for (let val = -1; val < this.numStates; val++) {
      const span = document.createElement('span');
      if (val === this.pen) {
        span.className = 'on';
      }

      const icon = document.createElement('i');
      if (val < 0) {
        icon.style.backgroundColor = 'transparent';
        icon.textContent = '*';
      } else {
        icon.style.backgroundColor = this.colors.getColor(val);
        icon.textContent = '';
      }

      span.append(icon, val < 0 ? 'any (*)' : val);
      span.addEventListener('click', () => {
        this.pen = val;
        this.renderPenBar();
      });

      container.appendChild(span);
    }
  }

  /**
   * Render the Brush selector bar in Initial & run section.
   */
  renderBrushBar() {
    const container = this.dom.brushContainer;
    container.innerHTML = '';

    if (this.brush >= this.numStates) {
      this.brush = this.numStates - 1;
    }

    for (let i = 0; i < this.numStates; i++) {
      const span = document.createElement('span');
      if (i === this.brush) {
        span.className = 'on';
      }

      const icon = document.createElement('i');
      icon.style.backgroundColor = this.colors.getColor(i);

      span.append(icon, `State ${i}`);
      span.addEventListener('click', () => {
        this.brush = i;
        this.renderBrushBar();
      });

      container.appendChild(span);
    }
  }

  /**
   * Paint styling for an interactive pattern cell.
   * @param {HTMLElement} el
   * @param {number} val State value (-1 for wildcard or 0..N-1)
   */
  applyCellState(el, val) {
    if (val < 0) {
      el.style.backgroundColor = 'transparent';
      el.textContent = '*';
      el.title = 'Any state (*)';
    } else {
      el.style.backgroundColor = this.colors.getColor(val);
      el.textContent = '';
      el.title = `State ${val}`;
    }
  }

  /**
   * Create an interactive pattern cell DOM element.
   * @param {() => number} getter
   * @param {(val: number) => void} setter
   * @param {number} sizePx
   * @param {boolean} isCenter
   * @returns {HTMLElement}
   */
  createPatternCellElement(getter, setter, sizePx, isCenter) {
    const cell = document.createElement('div');
    cell.className = 'pcell' + (isCenter ? ' ctr' : '');
    cell.style.width = `${sizePx}px`;
    cell.style.height = `${sizePx}px`;
    this.applyCellState(cell, getter());

    const update = () => {
      setter(this.pen);
      this.applyCellState(cell, this.pen);
      this.scheduleSave();
    };

    cell.addEventListener('pointerdown', e => {
      try {
        if (cell.hasPointerCapture && cell.hasPointerCapture(e.pointerId)) {
          cell.releasePointerCapture(e.pointerId);
        }
      } catch (_) {}
      update();
    });

    cell.addEventListener('pointerenter', e => {
      if (e.buttons === 1) {
        update();
      }
    });

    return cell;
  }

  /**
   * Create a state select dropdown for count rules.
   * @param {number} currentValue
   * @param {(newVal: number) => void} onChange
   * @param {boolean} allowWildcard Allow -1 for unchanged
   * @returns {HTMLSelectElement}
   */
  createStateSelect(currentValue, onChange, allowWildcard = false) {
    const select = document.createElement('select');

    if (allowWildcard) {
      const optAny = new Option('* (keep)', -1);
      select.add(optAny);
    }

    for (let i = 0; i < this.numStates; i++) {
      const opt = new Option(`State ${i}`, i);
      select.add(opt);
    }

    select.value = currentValue;
    select.style.borderLeft = `6px solid ${currentValue >= 0 ? this.colors.getColor(currentValue) : 'transparent'}`;

    select.addEventListener('change', () => {
      const val = parseInt(select.value, 10);
      select.style.borderLeft = `6px solid ${val >= 0 ? this.colors.getColor(val) : 'transparent'}`;
      onChange(val);
      this.scheduleSave();
    });

    return select;
  }

  /**
   * Create a number input element for neighbor counts.
   * @param {number} currentValue
   * @param {(newVal: number) => void} onChange
   * @returns {HTMLInputElement}
   */
  createCountInput(currentValue, onChange) {
    const max = this.maxNeighbors;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = 0;
    input.max = max;
    input.value = CellularAutomatonApp.clamp(currentValue, 0, max, 0);

    input.addEventListener('change', () => {
      const val = CellularAutomatonApp.clamp(input.value, 0, max, 0);
      input.value = val;
      onChange(val);
      this.scheduleSave();
    });

    return input;
  }

  /**
   * Render all rules in the Rules section.
   */
  renderRules() {
    this.renderPenBar();
    const box = this.dom.rulesContainer;
    box.innerHTML = '';

    if (this.rules.length === 0) {
      const emptyHint = document.createElement('p');
      emptyHint.className = 'hint';
      emptyHint.textContent = 'No rules yet — every cell stays as it is.';
      box.appendChild(emptyHint);
      return;
    }

    const k = this.kernelSize;
    const cellPx = k <= 3 ? 26 : k <= 5 ? 20 : 14;

    this.rules.forEach((rule, idx) => {
      const ruleRow = document.createElement('div');
      ruleRow.className = 'rule';

      // Rule number badge
      const numLabel = document.createElement('span');
      numLabel.className = 'rule-num';
      numLabel.textContent = `${idx + 1}.`;
      ruleRow.appendChild(numLabel);

      if (rule.t === 'c') {
        // Count Rule
        const t1 = document.createElement('span');
        t1.textContent = 'If cell is';

        const sSelect = this.createStateSelect(rule.s, val => { rule.s = val; });

        const t2 = document.createElement('span');
        t2.textContent = 'and number of';

        const nSelect = this.createStateSelect(rule.n, val => { rule.n = val; });

        const t3 = document.createElement('span');
        t3.textContent = 'neighbors is from';

        const minInput = this.createCountInput(rule.min, val => { rule.min = val; });

        const t4 = document.createElement('span');
        t4.textContent = 'to';

        const maxInput = this.createCountInput(rule.max, val => { rule.max = val; });

        const arrow = document.createElement('span');
        arrow.textContent = '→ becomes';

        const oSelect = this.createStateSelect(rule.o, val => { rule.o = val; }, true);

        ruleRow.append(t1, sSelect, t2, nSelect, t3, minInput, t4, maxInput, arrow, oSelect);
      } else {
        // Pattern Rule
        const gridBox = document.createElement('div');
        gridBox.className = 'pg';
        gridBox.style.gridTemplateColumns = `repeat(${k}, ${cellPx}px)`;

        const centerIndex = (k * k - 1) / 2;
        for (let j = 0; j < k * k; j++) {
          const pCell = this.createPatternCellElement(
            () => rule.pat[j],
            val => { rule.pat[j] = val; },
            cellPx,
            j === centerIndex
          );
          gridBox.appendChild(pCell);
        }

        const arrow = document.createElement('span');
        arrow.textContent = '→';

        const outCell = this.createPatternCellElement(
          () => rule.o,
          val => { rule.o = val; },
          cellPx + 6,
          false
        );

        const symLabel = document.createElement('label');
        const symCheckbox = document.createElement('input');
        symCheckbox.type = 'checkbox';
        symCheckbox.checked = !!rule.sym;
        symCheckbox.addEventListener('change', () => {
          rule.sym = symCheckbox.checked;
          this.scheduleSave();
        });
        symLabel.append(symCheckbox, 'rotate / flip');

        ruleRow.append(gridBox, arrow, outCell, symLabel);
      }

      // Action Tools (Up, Down, Delete)
      const tools = document.createElement('span');
      tools.className = 'tools';

      const moveRule = dir => {
        const targetIdx = idx + dir;
        if (targetIdx < 0 || targetIdx >= this.rules.length) return;
        const temp = this.rules[idx];
        this.rules[idx] = this.rules[targetIdx];
        this.rules[targetIdx] = temp;
        this.renderRules();
        this.scheduleSave();
      };

      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.className = 'btn-tool';
      upBtn.textContent = '↑';
      upBtn.title = 'Move rule up';
      upBtn.disabled = idx === 0;
      upBtn.addEventListener('click', () => moveRule(-1));

      const downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.className = 'btn-tool';
      downBtn.textContent = '↓';
      downBtn.title = 'Move rule down';
      downBtn.disabled = idx === this.rules.length - 1;
      downBtn.addEventListener('click', () => moveRule(1));

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-tool del';
      delBtn.textContent = '×';
      delBtn.title = 'Delete rule';
      delBtn.addEventListener('click', () => {
        this.rules.splice(idx, 1);
        this.renderRules();
        this.scheduleSave();
      });

      tools.append(upBtn, downBtn, delBtn);
      ruleRow.appendChild(tools);
      box.appendChild(ruleRow);
    });
  }

  /**
   * Render current grid state onto canvas.
   */
  drawCanvas() {
    const cv = this.dom.canvas;
    const ctx = cv.getContext('2d');
    if (!ctx || !this.grid) return;

    const w = this.width;
    const h = this.height;
    const cellSize = this.cellPixelSize;

    // Build palette lookup
    const palette = new Array(this.numStates);
    for (let i = 0; i < this.numStates; i++) {
      palette[i] = this.colors.getColor(i);
    }

    // Draw cells
    for (let y = 0; y < h; y++) {
      const yOffset = y * w;
      for (let x = 0; x < w; x++) {
        const val = this.grid[yOffset + x];
        ctx.fillStyle = palette[val] || palette[0];
        ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
      }
    }

    // Subtle grid lines when cells are large enough
    if (cellSize >= 6) {
      ctx.strokeStyle = 'rgba(128, 128, 120, 0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= w; x++) {
        ctx.moveTo(x * cellSize + 0.5, 0);
        ctx.lineTo(x * cellSize + 0.5, h * cellSize);
      }
      for (let y = 0; y <= h; y++) {
        ctx.moveTo(0, y * cellSize + 0.5);
        ctx.lineTo(w * cellSize, y * cellSize + 0.5);
      }
      ctx.stroke();
    }

    this.dom.genDisplay.textContent = `gen ${this.generation}`;
  }

  /**
   * Compute one generation of the cellular automaton.
   */
  step() {
    const w = this.width;
    const h = this.height;
    const n = this.numStates;
    const r = this.radius;
    const k = this.kernelSize;
    const wrap = this.wrapEdges;

    const nextGrid = new Uint8Array(w * h);
    const neighborCounts = new Int32Array(n);
    const compiledRules = RuleEngine.compile(this.rules, r);

    for (let y = 0; y < h; y++) {
      const yOffset = y * w;
      for (let x = 0; x < w; x++) {
        neighborCounts.fill(0);

        // Count neighbors in Moore neighborhood
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (dx === 0 && dy === 0) continue;

            let nx = x + dx;
            let ny = y + dy;

            if (wrap) {
              nx = (nx + w) % w;
              ny = (ny + h) % h;
            } else if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
              continue;
            }

            neighborCounts[this.grid[ny * w + nx]]++;
          }
        }

        const currentState = this.grid[yOffset + x];
        let outputState = currentState;

        // Apply first matching rule
        for (const rule of compiledRules) {
          if (rule.t === 'c') {
            if (
              rule.s === currentState &&
              neighborCounts[rule.n] >= rule.min &&
              neighborCounts[rule.n] <= rule.max
            ) {
              outputState = rule.o < 0 ? currentState : rule.o;
              break;
            }
          } else {
            // Pattern rule
            let matched = false;
            for (const pat of rule.variants) {
              if (RuleEngine.matchPattern(pat, x, y, wrap, this.grid, w, h, r, k)) {
                matched = true;
                break;
              }
            }
            if (matched) {
              outputState = rule.output < 0 ? currentState : rule.output;
              break;
            }
          }
        }

        nextGrid[yOffset + x] = outputState;
      }
    }

    this.grid = nextGrid;
    this.generation++;
    this.drawCanvas();
  }

  /**
   * Paint cell under pointer on canvas.
   * @param {PointerEvent} e
   */
  paintCanvasCell(e) {
    const rect = this.dom.canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * this.width);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * this.height);

    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;

    const idx = y * this.width + x;
    if (this.grid[idx] !== this.brush) {
      this.grid[idx] = this.brush;
      if (this.generation === 0) {
        this.initialGrid[idx] = this.brush;
      }
      this.drawCanvas();
    }
  }

  /**
   * Start or resume simulation loop.
   */
  play() {
    if (this.timer) {
      this.stop();
      return;
    }
    if (this.generation === 0) {
      this.initialGrid = this.grid.slice();
    }
    this.dom.playBtn.textContent = 'Pause';
    this.timer = setInterval(() => this.step(), 1000 / this.speed);
  }

  /**
   * Stop simulation loop.
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.dom.playBtn.textContent = 'Run';
  }

  /**
   * Toggle between play and pause.
   */
  togglePlay() {
    if (this.timer) {
      this.stop();
    } else {
      this.play();
    }
  }

  /**
   * Show feedback message next to Import/Export buttons.
   * @param {string} text
   * @param {boolean} isError
   */
  showIoMessage(text, isError = false) {
    this.dom.ioMsg.textContent = text;
    this.dom.ioMsg.className = 'msg-status' + (isError ? ' error' : ' success');
  }

  /**
   * Export current configuration to JSON textarea and copy to clipboard.
   */
  async exportConfig() {
    const payload = {
      ca: 1,
      states: this.numStates,
      radius: this.radius,
      wrap: this.wrapEdges,
      rules: this.rules,
      colors: Array.from({ length: this.numStates }, (_, i) => this.colors.getColor(i))
    };

    const jsonStr = JSON.stringify(payload, null, 2);
    this.dom.ioTextarea.value = jsonStr;

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(jsonStr);
        this.showIoMessage('Exported and copied to clipboard.');
      } else {
        throw new Error('Clipboard API unavailable');
      }
    } catch (_) {
      this.dom.ioTextarea.focus();
      this.dom.ioTextarea.select();
      this.showIoMessage('Exported — copy the JSON text above.');
    }
  }

  /**
   * Import configuration from JSON textarea.
   */
  importConfig() {
    try {
      const text = this.dom.ioTextarea.value.trim();
      if (!text) throw new Error('Please paste JSON configuration to import.');

      const data = JSON.parse(text);
      const states = data.states;
      const radius = data.radius ?? 1;

      if (!Number.isInteger(states) || states < 2 || states > 32) {
        throw new Error('States must be an integer between 2 and 32.');
      }
      if (!Number.isInteger(radius) || radius < 1 || radius > 5) {
        throw new Error('Radius must be an integer between 1 and 5.');
      }
      if (!Array.isArray(data.rules)) {
        throw new Error('Rules must be a list.');
      }

      const k = 2 * radius + 1;
      const maxNeighbors = k * k - 1;
      const isValidState = v => Number.isInteger(v) && v >= 0 && v < states;
      const isValidOutput = v => v === -1 || isValidState(v);

      const validatedRules = data.rules.map((rule, idx) => {
        const prefix = `Rule ${idx + 1}: `;
        if (rule.t === 'c') {
          if (
            !isValidState(rule.s) ||
            !isValidState(rule.n) ||
            !isValidOutput(rule.o) ||
            !Number.isInteger(rule.min) ||
            !Number.isInteger(rule.max) ||
            rule.min < 0 ||
            rule.max > maxNeighbors ||
            rule.min > rule.max
          ) {
            throw new Error(prefix + 'Invalid count rule parameters.');
          }
          return {
            t: 'c',
            s: rule.s,
            n: rule.n,
            min: rule.min,
            max: rule.max,
            o: rule.o
          };
        } else if (rule.t === 'p') {
          if (
            !Array.isArray(rule.pat) ||
            rule.pat.length !== k * k ||
            !rule.pat.every(isValidOutput) ||
            !isValidOutput(rule.o)
          ) {
            throw new Error(prefix + 'Invalid pattern rule cells.');
          }
          return {
            t: 'p',
            pat: rule.pat.slice(),
            o: rule.o,
            sym: !!rule.sym
          };
        }
        throw new Error(prefix + 'Unknown rule type.');
      });

      this.stop();
      this.radius = radius;
      this.rules = validatedRules;
      this.numStates = states;
      this.wrapEdges = data.wrap !== false;

      // Import custom colors if available
      if (Array.isArray(data.colors) || (data.colors && typeof data.colors === 'object')) {
        this.colors.importCustomColors(data.colors);
      } else {
        this.colors.resetAllColors();
      }

      // Update inputs
      this.dom.numStatesInput.value = states;
      this.dom.radiusInput.value = radius;
      this.dom.wrapCheckbox.checked = this.wrapEdges;
      this.brush = 1;

      this.handleNumStatesChange();
      this.handleRadiusChange();
      this.scheduleSave();

      this.showIoMessage(`Imported successfully: ${states} states, ${validatedRules.length} rules.`);
    } catch (err) {
      this.showIoMessage(`Import failed — ${err.message || err}`, true);
    }
  }

  /**
   * Generate LaTeX rules text using current options from the modal.
   * @returns {string}
   */
  generateLatexRulesText() {
    const colorMode = this.dom.latexColorMode ? this.dom.latexColorMode.value : 'all';
    const syntax = this.dom.latexSyntax ? this.dom.latexSyntax.value : 'hex';
    const format = this.dom.latexFormat ? this.dom.latexFormat.value : 'display';

    return LatexExporter.exportRules({
      rules: this.rules,
      radius: this.radius,
      numStates: this.numStates,
      wrapEdges: this.wrapEdges,
      colors: this.colors,
      colorMode,
      syntax,
      format
    });
  }

  /**
   * Update the LaTeX textarea with regenerated output.
   */
  updateLatexExport() {
    if (!this.dom.latexOutput) return;
    this.dom.latexOutput.value = this.generateLatexRulesText();
  }

  /**
   * Open the LaTeX Export modal, populate text, and copy to clipboard.
   */
  async openLatexExportModal() {
    if (!this.dom.latexModal) return;
    this.updateLatexExport();

    if (typeof this.dom.latexModal.showModal === 'function') {
      try {
        if (!this.dom.latexModal.open) {
          this.dom.latexModal.showModal();
        }
      } catch (_) {
        this.dom.latexModal.setAttribute('open', '');
      }
    } else {
      this.dom.latexModal.setAttribute('open', '');
    }

    // Auto-copy to clipboard on open
    await this.copyLatexToClipboard(true);
  }

  /**
   * Close the LaTeX Export modal.
   */
  closeLatexExportModal() {
    if (!this.dom.latexModal) return;
    if (typeof this.dom.latexModal.close === 'function') {
      try {
        this.dom.latexModal.close();
      } catch (_) {
        this.dom.latexModal.removeAttribute('open');
      }
    } else {
      this.dom.latexModal.removeAttribute('open');
    }
  }

  /**
   * Show status message inside the LaTeX modal.
   * @param {string} text
   * @param {boolean} isError
   */
  showLatexStatus(text, isError = false) {
    if (!this.dom.latexStatusMsg) return;
    this.dom.latexStatusMsg.textContent = text;
    this.dom.latexStatusMsg.className = 'msg-status' + (isError ? ' error' : ' success');
  }

  /**
   * Copy current LaTeX output to clipboard.
   * @param {boolean} isAutoCopy Whether this was triggered automatically on modal open
   */
  async copyLatexToClipboard(isAutoCopy = false) {
    if (!this.dom.latexOutput) return;
    const text = this.dom.latexOutput.value;

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        this.showLatexStatus(isAutoCopy ? 'Exported and copied to clipboard.' : 'Copied to clipboard!');
      } else {
        throw new Error('Clipboard API unavailable');
      }
    } catch (_) {
      this.dom.latexOutput.focus();
      this.dom.latexOutput.select();
      this.showLatexStatus(isAutoCopy ? 'Exported — copy text above.' : 'Selected — press Ctrl+C / Cmd+C to copy');
    }
  }

  /**
   * Download exported LaTeX rules as a .tex file.
   */
  downloadLatexFile() {
    if (!this.dom.latexOutput) return;
    const text = this.dom.latexOutput.value;
    const blob = new Blob([text], { type: 'text/x-tex;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cellular_automaton_rules.tex';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.showLatexStatus('Downloaded cellular_automaton_rules.tex');
  }
}

// Bootstrap application on DOM load
window.addEventListener('DOMContentLoaded', () => {
  window.app = new CellularAutomatonApp();
});
