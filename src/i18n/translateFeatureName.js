import { FEATURE_NAMES_FR } from './featureNames.fr.js';

// One dictionary per non-English `feature_names` config value. Adding a
// language later is one entry here + one dictionary file, no call-site change.
const DICTIONARIES = {
  fr: FEATURE_NAMES_FR,
};

/**
 * @description Translate a feature name/option label through the dictionary
 * for the given language. Passes the value through unchanged for `en` (the
 * default), a language with no dictionary, or a string the dictionary does
 * not know about — translation only ever narrows what is shown, never
 * produces something worse than the English original.
 * @param {string} value - The English string to translate (a feature `name`
 * or a `supported_options[].label`).
 * @param {string} lang - The configured `feature_names` language (`en`/`fr`).
 * @returns {string} The translated string, or `value` unchanged.
 * @example
 * translateFeatureName('Dock', 'fr'); // 'Retour à la base'
 * translateFeatureName('switch_1', 'fr'); // 'switch_1' (not a curated name)
 */
export function translateFeatureName(value, lang) {
  const dictionary = DICTIONARIES[lang];
  if (!dictionary || typeof value !== 'string') {
    return value;
  }
  return dictionary[value] !== undefined ? dictionary[value] : value;
}
