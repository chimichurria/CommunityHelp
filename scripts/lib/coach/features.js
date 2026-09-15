#!/usr/bin/env node
/**
 * Prompt feature extraction for the AI-literacy coach.
 *
 * Runs on every UserPromptSubmit, so the hot path is budgeted at ~0.6ms:
 * every regex is compiled once at module load, the analyzed text is capped,
 * and nothing here touches the filesystem or the network.
 *
 * PRIVACY: this module returns primitives only. No substring of the prompt
 * is ever placed on a returned Features object, because that object is what
 * the rest of the coach sees, and anything on it could end up persisted by a
 * careless future change. Callers that need the raw text (to check whether it
 * already names a component) receive it as a separate argument that is never
 * stored.
 */

'use strict';

// A prompt longer than this is essentially never lacking anchors or scope,
// so analyzing more buys nothing and costs linear time.
const MAX_ANALYZED_CHARS = 4000;
// Language detection only needs an opening sample.
const MAX_LANG_CHARS = 400;

const LEN_BUCKETS = Object.freeze(['xs', 's', 'm', 'l', 'xl']);

const RE = Object.freeze({
  // Imperative or interrogative task shapes, EN + ES.
  taskVerb: /\b(add|fix|change|update|implement|refactor|remove|delete|create|build|write|make|migrate|rename|optimi[sz]e|debug|investigate|review|test|deploy|install|configure|convert|extract|split|merge|handle|support|agrega|agreg[aá]|arregl[aá]|arregla|cambi[aá]|actualiz[aá]|implement[aá]|refactoriz[aá]|borr[aá]|elimin[aá]|cre[aá]|construi|escrib[ií]|hac[eé]|migr[aá]|renombr[aá]|optimiz[aá]|revis[aá]|prob[aá]|instal[aá]|configur[aá]|convert[ií]|divid[ií]|junt[aá]|soport[aá]|necesito|quiero|pod[eé]s|puedes|hay que)\b/i,
  // Paths and filenames.
  pathLike: /(?:[\w.-]+\/[\w./-]+)|(?:\b[\w-]+\.(?:js|mjs|cjs|ts|tsx|jsx|py|go|rs|rb|java|kt|swift|php|c|h|cpp|cs|sh|md|json|ya?ml|toml|sql|css|scss|html)\b)/i,
  backtickIdent: /`[^`\n]{1,80}`/,
  // "done when" language, EN + ES.
  acceptance: /\b(should|must|expect(?:ed|s)?|acceptance|criteri[ao]n?|done when|so that|until it|pass(?:es|ing)?\s+when|debe|deber[ií]a|espero|esperado|criterio|listo cuando|hasta que|de modo que|que quede)\b/i,
  tests: /\b(test|tests|testing|spec|specs|unit test|coverage|regression|prueba|pruebas|test(?:e|é)a|cobertura|regresi[oó]n)\b/i,
  // Unbounded scope.
  vagueScope: /\b(everything|all the (?:code|files|tests|bugs)|the whole (?:codebase|project|repo|thing)|fix all|clean up the code|make it better|improve the code|todo el (?:c[oó]digo|proyecto|repo)|todos los (?:archivos|errores|bugs)|arregl[aá]\s+todo|arregla todo|hac[eé]\s+todo|haz todo|mejor[aá]\s+el c[oó]digo|limpi[aá]\s+el c[oó]digo|dej[aá]lo bien)\b/i,
  // Asking for thinking rather than code.
  wantsPlan: /\b(plan|planning|design|approach|strategy|options|trade-?offs?|architecture|how (?:should|would) (?:we|i)|propose|recommend|dise[nñ]o|dise[nñ][aá]|enfoque|estrategia|opciones|alternativas|arquitectura|c[oó]mo (?:conviene|deber[ií]a|har[ií]as)|propon[eé]|recomend[aá])\b/i,
  // Clause joiners that stack independent asks.
  clauseJoin: /\b(?:and then|and also|then|also|after that|next,|y luego|y tambi[eé]n|luego|despu[eé]s|adem[aá]s|tambi[eé]n)\b|(?:;|\n\s*[-*\d]+[.)]\s)/gi,
  codeFenceHint: /```/,
});

// Closed function-word lists. Deliberately small and fixed: this is a coin-flip
// between two languages, not general language identification.
const ES_WORDS = Object.freeze(['que','para','con','del','los','las','una','por','como','este','esta','mas','pero','cuando','hacer','todo','archivo','codigo','prueba','error','agrega','arregla','revisa','necesito','quiero','deberia','tambien','asi','sin','muy','the','and']);
const EN_WORDS = Object.freeze(['the','and','for','with','this','that','from','have','will','should','when','make','file','code','test','error','need','want','also','into']);
// "the"/"and" appear in ES_WORDS above only as a guard against a mixed-language
// prompt scoring Spanish on loan words; they are removed from the ES tally here.
const ES_SET = new Set(ES_WORDS.filter(w => w !== 'the' && w !== 'and'));
const EN_SET = new Set(EN_WORDS);
const RE_SPANISH_ORTHOGRAPHY = /[¿¡ñáéíóúü]/i;
const RE_WORD_SPLIT = /[^a-zA-ZáéíóúñüÁÉÍÓÚÑÜ]+/;

/**
 * @param {string} text
 * @returns {'es'|'en'}
 */
function detectLanguage(text) {
  if (typeof text !== 'string' || text.length === 0) return 'en';
  const sample = text.length > MAX_LANG_CHARS ? text.slice(0, MAX_LANG_CHARS) : text;

  let es = 0;
  let en = 0;
  for (const word of sample.toLowerCase().split(RE_WORD_SPLIT)) {
    if (!word) continue;
    if (ES_SET.has(word)) es += 1;
    if (EN_SET.has(word)) en += 1;
  }

  if (es > en) return 'es';
  if (en > es) return 'en';
  // Tie: Spanish orthography is decisive, since English never produces it.
  return RE_SPANISH_ORTHOGRAPHY.test(sample) ? 'es' : 'en';
}

function lenBucketFor(length) {
  if (length < 40) return 'xs';
  if (length < 160) return 's';
  if (length < 600) return 'm';
  if (length < 2000) return 'l';
  return 'xl';
}

function countClauses(text) {
  RE.clauseJoin.lastIndex = 0;
  let n = 1;
  let m;
  while ((m = RE.clauseJoin.exec(text)) !== null) {
    n += 1;
    if (n > 12) break; // bounded: we only care about "several", not the exact count
    if (m.index === RE.clauseJoin.lastIndex) RE.clauseJoin.lastIndex += 1;
  }
  return n;
}

/**
 * @param {string} promptText
 * @param {{hints?: Record<string, {component: string, kind: string}>}} [options]
 * @returns {object} Features — primitives only, never prompt text.
 */
function extractFeatures(promptText, options = {}) {
  const text = typeof promptText === 'string' ? promptText : '';
  const analyzed = text.length > MAX_ANALYZED_CHARS ? text.slice(0, MAX_ANALYZED_CHARS) : text;
  const lower = analyzed.toLowerCase();

  const wordCount = analyzed.split(/\s+/).filter(Boolean).length;
  const isQuestion = analyzed.includes('?') || analyzed.includes('¿');

  let skillHint = null;
  const hints = options.hints;
  if (hints) {
    for (const keyword of Object.keys(hints)) {
      if (lower.includes(keyword)) {
        const entry = hints[keyword];
        // Do not suggest a component the prompt already names.
        if (!lower.includes(String(entry.component).toLowerCase())) {
          skillHint = { component: entry.component, kind: entry.kind };
        }
        break;
      }
    }
  }

  return {
    len: analyzed.length,
    wordCount,
    lenBucket: lenBucketFor(analyzed.length),
    isTaskRequest: RE.taskVerb.test(analyzed) && !isQuestion,
    hasPathLike: RE.pathLike.test(analyzed),
    hasCodeFence: analyzed.indexOf('```') !== -1,
    hasBacktickIdent: RE.backtickIdent.test(analyzed),
    hasAcceptanceLanguage: RE.acceptance.test(analyzed),
    mentionsTests: RE.tests.test(analyzed),
    vagueScope: RE.vagueScope.test(analyzed),
    wantsPlan: RE.wantsPlan.test(analyzed),
    clauseCount: countClauses(analyzed),
    skillHint,
    lang: detectLanguage(analyzed),
  };
}

module.exports = {
  extractFeatures,
  detectLanguage,
  lenBucketFor,
  MAX_ANALYZED_CHARS,
  LEN_BUCKETS,
};
