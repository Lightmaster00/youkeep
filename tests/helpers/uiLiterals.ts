// Finds English UI text that bypasses the i18n catalogue: string literals bound in templates
// (`:label="'Foo bar'"`, `{{ ok ? 'Yes' : 'No' }}`) or written in scripts (`toast.error('Failed')`,
// `message: 'Nope'`). Used by tests/unit/i18nCatalogues.test.ts.

export interface Literal {
  value: string;
  /** Source text just before the opening quote (comments blanked), for context checks. */
  before: string;
  line: number;
}

/** Blank out comments, keeping offsets and newlines, so literals inside them are never seen. */
export function blankComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];
    if (c === '"' || c === "'" || c === '`') {
      // Copy the string untouched (comment markers inside it are text).
      const q = c;
      let j = i + 1;
      while (j < src.length && src[j] !== q) {
        if (src[j] === '\\') j++;
        else if (q !== '`' && src[j] === '\n') break;
        j++;
      }
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && n === '/' && src[i - 1] !== ':') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
    } else if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Every '...', "..." and `...` literal in a piece of JS/TS (template literals: `${}` becomes `{}`). */
export function literalsOf(code: string, firstLine = 1): Literal[] {
  const src = blankComments(code);
  const out: Literal[] = [];
  let i = 0;
  let line = firstLine;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '\n') { line++; i++; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      const startLine = line;
      let j = i + 1;
      let value = '';
      let depth = 0;
      while (j < src.length) {
        const d = src[j]!;
        if (d === '\\') { value += src[j + 1] ?? ''; j += 2; continue; }
        if (q === '`' && d === '$' && src[j + 1] === '{') { depth++; value += '{'; j += 2; continue; }
        if (q === '`' && depth > 0) {
          // Skip the interpolated expression (nested strings are rare and not UI text).
          if (d === '{') depth++;
          if (d === '}') { depth--; if (depth === 0) value += '}'; }
          if (d === '\n') line++;
          j++;
          continue;
        }
        if (d === q) break;
        if (d === '\n') { if (q !== '`') break; line++; }
        value += d;
        j++;
      }
      out.push({ value, before: src.slice(Math.max(0, i - 80), i), line: startLine });
      i = j + 1;
      continue;
    }
    i++;
  }
  return out;
}

// Calls whose first argument is a catalogue key or a technical value, never UI text.
const KEY_CALL = /(?:\$?\bt|\$?\bte|\$?\btm|\brt|\$?\bn|\$?\bd|i18n\.t|\$i18n\.t|\$i18n\.te|useState|useFetch|\$fetch|fetch|csrfFetch|navigateTo|addEventListener|removeEventListener|querySelector(?:All)?|getElementById|getItem|setItem|removeItem|emit|defineEmits|\$emit|import|require|useRoute|resolve|push|replace|includes|startsWith|endsWith|has|get|set|delete|add|test|match|split|join|useHead|useSeoMeta|definePageMeta|createError|setHeader|getHeader|useCookie|\.on|\.off|setAttribute|getAttribute|classList\.\w+|matchMedia|dispatchEvent|CustomEvent|Event|hook|callHook|useLazyFetch|useAsyncData|refreshNuxtData|clearNuxtData|ref|reactive)\(\s*(?:[^()]*,\s*)?$/;

/** Whether a literal is probably text a user reads. */
export function looksLikeUiText(lit: Literal): boolean {
  const v = lit.value.trim();
  if (!/[A-Za-z]/.test(v) || v.length < 2) return false;
  // Console and thrown-error messages are for developers.
  if (/console\.\w+\(\s*(?:[^()]*,\s*)?$/.test(lit.before) || /\bnew Error\(\s*$/.test(lit.before)) return false;
  // Catalogue keys and technical lookups.
  if (KEY_CALL.test(lit.before)) return false;
  // Constants (UPPER_CASE), mime types, selectors, urls.
  if (/^[A-Z0-9_ .\-/]+$/.test(v) && !/ [A-Z][a-z]/.test(v)) return false;
  if (/^[\w-]+\/[\w.+-]+$/.test(v) || /^[#.\[]/.test(v) || /^(?:https?:)?\/\//.test(v)) return false;
  // Format strings made only of interpolations, digits and punctuation.
  if (/^[\s{}\d.:,-]*$/.test(v)) return false;
  const inUiContext = UI_KEY.test(lit.before) || TOAST_CALL.test(lit.before);
  const words = v.split(/\s+/).filter(w => /[A-Za-z]/.test(w));
  if (words.length < 2 && !/\s/.test(v)) {
    // One token: class names, routes, keys, enum values... Only a capitalised word in a UI position counts.
    const capitalisedWord = /^[A-Z][a-z]{2,}[A-Za-z']*[.!?…:]?$/.test(v);
    return capitalisedWord && (inUiContext || TERNARY.test(lit.before));
  }
  if (/^[a-z]/.test(v)) {
    // Lower-case text: class lists, selectors, css values; prose only in a UI position or as a sentence.
    return inUiContext && /[a-z]{2,} [a-z]{2,}/.test(v) || (words.length >= 3 && /[.!?…]$/.test(v));
  }
  return /^[A-Z]/.test(v);
}

const UI_KEY = /(?:label|title|message|placeholder|text|description|caption|heading|subtitle|kicker|tooltip|hint|alt|error|name|confirmLabel|emptyTitle|emptyText|ariaLabel|aria-label|summary|reason|status)['"]?\s*[:=]\s*$/i;
const TOAST_CALL = /(?:\btoast\.(?:error|success|info)|\bshowToast|\b(?:error|success|info))\(\s*$/;
// Positions where a bare word is a displayed alternative: ternary branches, fallbacks, returns.
const TERNARY = /\?\s*$|['"`]\s*:\s*$|\|\|\s*$|\?\?\s*$|\breturn\s*$|=>\s*$/;

/** Literals in the expressions of a .vue template: bound attributes, event handlers and `{{ }}`. */
export function templateExpressions(source: string): Literal[] {
  const tplStart = source.indexOf('<template>');
  if (tplStart === -1) return [];
  const tplEnd = source.lastIndexOf('</template>');
  const tpl = source.slice(tplStart, tplEnd === -1 ? undefined : tplEnd);
  const baseLine = source.slice(0, tplStart).split('\n').length;
  const out: Literal[] = [];
  const lineAt = (offset: number) => baseLine + tpl.slice(0, offset).split('\n').length - 1;
  const clean = tpl.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '));
  for (const m of clean.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    out.push(...literalsOf(m[1]!, lineAt(m.index!)));
  }
  for (const m of clean.matchAll(/(?:^|\s)(?::|v-bind:|@|v-on:|v-(?:if|else-if|show|for|model|html|text|bind|slot))[\w.\-:\[\]]*\s*=\s*"([^"]*)"/g)) {
    out.push(...literalsOf(m[1]!, lineAt(m.index!)));
  }
  // Single-quoted attribute values (`:x='...'`) hold double-quoted literals.
  for (const m of clean.matchAll(/(?:^|\s)(?::|@|v-[\w-]+)[\w.\-:\[\]]*\s*=\s*'([^']*)'/g)) {
    out.push(...literalsOf(m[1]!, lineAt(m.index!)));
  }
  return out;
}

/** Literals in the <script> blocks of a .vue file, or in a whole .ts file. */
export function scriptLiterals(source: string, isVue: boolean): Literal[] {
  if (!isVue) return literalsOf(source);
  const out: Literal[] = [];
  for (const m of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
    const start = m.index! + m[0].indexOf('>') + 1;
    out.push(...literalsOf(m[1]!, source.slice(0, start).split('\n').length));
  }
  return out;
}

/** `file:line: "text"` for every literal that looks like English UI text. */
export function uiLiteralHits(source: string, isVue: boolean): string[] {
  const lits = [...(isVue ? templateExpressions(source) : []), ...scriptLiterals(source, isVue)];
  return lits.filter(looksLikeUiText).map(l => `line ${l.line}: "${l.value}"`);
}
