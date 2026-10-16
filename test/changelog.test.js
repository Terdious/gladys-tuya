import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { releaseChangelog } from '../scripts/release-changelog.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SAMPLE = `# Changelog

## [Unreleased]

### Added

- A new device type.

## [1.0.0] - 2026-01-01

### Added

- First release.
`;

test('releaseChangelog moves Unreleased under the new version and returns its notes', () => {
  const { changelog, notes } = releaseChangelog(SAMPLE, '1.1.0', '2026-02-02');
  assert.equal(notes, '### Added\n\n- A new device type.');
  assert.equal(
    changelog,
    `# Changelog

## [Unreleased]

## [1.1.0] - 2026-02-02

### Added

- A new device type.

## [1.0.0] - 2026-01-01

### Added

- First release.
`,
  );
});

test('releaseChangelog refuses an empty Unreleased section', () => {
  const empty = SAMPLE.replace('### Added\n\n- A new device type.\n\n', '');
  assert.throws(() => releaseChangelog(empty, '1.1.0', '2026-02-02'), /empty/);
});

test('releaseChangelog refuses a version that already has a section', () => {
  assert.throws(() => releaseChangelog(SAMPLE, '1.0.0', '2026-02-02'), /already/);
});

test('CHANGELOG.md has a section for the version in the manifest', () => {
  // The Release workflow bumps the manifest and the changelog together; a
  // version without its section means the changelog went out of sync.
  const { version } = JSON.parse(
    readFileSync(join(ROOT, 'gladys-assistant-integration.json'), 'utf8'),
  );
  const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
  assert.ok(changelog.includes('## [Unreleased]'));
  assert.ok(changelog.includes(`## [${version}] - `), `CHANGELOG.md misses [${version}]`);
});
