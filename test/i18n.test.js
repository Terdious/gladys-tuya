import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SUPPORTED_FEATURE_NAMES_LANGS } from '../src/config.js';

// Every user-facing text of this integration ships in the four languages of
// the Gladys UI. These tests keep it that way: a new manifest label, runtime
// message or docs page that forgets one of them fails CI (see the
// "Translations" section of the README).
const LANGS = ['en', 'fr', 'de', 'es'];

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'gladys-assistant-integration.json'), 'utf8'));

// A manifest multi-language text is any object with an `en` string.
function collectMultiLanguageTexts(node, path, found) {
  if (Array.isArray(node)) {
    node.forEach((child, index) => collectMultiLanguageTexts(child, `${path}[${index}]`, found));
  } else if (node && typeof node === 'object') {
    if (typeof node.en === 'string') {
      found.push({ path, value: node });
      return;
    }
    Object.entries(node).forEach(([key, child]) =>
      collectMultiLanguageTexts(child, `${path}.${key}`, found),
    );
  }
  return found;
}

test('every manifest text has exactly en/fr/de/es, all non-empty', () => {
  const texts = collectMultiLanguageTexts(manifest, '', []);
  assert.ok(texts.length > 30, 'the walker should find the manifest texts');
  const invalid = texts
    .filter(
      ({ value }) =>
        Object.keys(value).sort().join() !== [...LANGS].sort().join() ||
        LANGS.some((lang) => typeof value[lang] !== 'string' || value[lang].trim() === ''),
    )
    .map(({ path, value }) => `${path} (${Object.keys(value).join('/')})`);
  assert.deepEqual(invalid, [], 'Add the missing languages to these manifest texts');
});

test('the manifest description fits the store limit (100 chars) in every language', () => {
  const tooLong = LANGS.filter((lang) => manifest.description[lang].length > 100);
  assert.deepEqual(tooLong, []);
});

test('the feature_names option lists exactly the supported languages', () => {
  const option = manifest.config_schema.find((entry) => entry.key === 'feature_names');
  assert.deepEqual(
    option.options.map(({ value }) => value),
    SUPPORTED_FEATURE_NAMES_LANGS,
  );
  assert.deepEqual([...SUPPORTED_FEATURE_NAMES_LANGS].sort(), [...LANGS].sort());
});

// --- Runtime messages ---------------------------------------------------------
// Connection statuses, degraded-badge tooltips and action results are
// `{ en, fr, de, es }` literals in the source. Find every object literal
// with an `en:` key and require the three other keys in the same object.

function listSourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      return listSourceFiles(full);
    }
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

// The `{ ... }` object literal enclosing `index` (brace counting; good enough
// for this codebase's message literals, template `${}` included).
function enclosingObject(source, index) {
  let depth = 0;
  let start = -1;
  for (let i = index; i >= 0; i -= 1) {
    if (source[i] === '}') depth += 1;
    if (source[i] === '{') {
      if (depth === 0) {
        start = i;
        break;
      }
      depth -= 1;
    }
  }
  depth = 0;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return '';
}

test('every runtime multi-language message has en/fr/de/es', () => {
  const files = [join(ROOT, 'index.js'), ...listSourceFiles(join(ROOT, 'src'))];
  const keyPattern = /(^|[{,])\s*en\s*:/gm;
  const missing = [];
  let messages = 0;
  files.forEach((file) => {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(keyPattern)) {
      messages += 1;
      const literal = enclosingObject(source, match.index + match[1].length);
      const absent = ['fr', 'de', 'es'].filter(
        (lang) => !new RegExp(`(^|[{,])\\s*${lang}\\s*:`, 'm').test(literal),
      );
      if (absent.length > 0) {
        const line = source.slice(0, match.index + match[0].lastIndexOf('en')).split('\n').length;
        missing.push(`${file.slice(ROOT.length + 1)}:${line} (missing ${absent.join('/')})`);
      }
    }
  });
  assert.ok(messages >= 15, `the scanner should find the runtime messages (${messages})`);
  assert.deepEqual(missing, [], 'Add the missing languages to these messages');
});

// --- Documentation ------------------------------------------------------------

test('the documentation exists in every language with the same structure', () => {
  const headings = (lang) =>
    readFileSync(join(ROOT, 'docs', `${lang}.md`), 'utf8')
      .split('\n')
      .filter((line) => /^#{1,3} /.test(line))
      .map((line) => line.match(/^#+/)[0]);
  LANGS.forEach((lang) =>
    assert.ok(existsSync(join(ROOT, 'docs', `${lang}.md`)), `docs/${lang}.md`),
  );
  const reference = headings('en');
  LANGS.forEach((lang) =>
    assert.deepEqual(
      headings(lang),
      reference,
      `docs/${lang}.md must mirror the sections of docs/en.md`,
    ),
  );
});
