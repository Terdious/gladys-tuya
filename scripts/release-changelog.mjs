// -----------------------------------------------------------------------------
// Release helper for CHANGELOG.md, run by .github/workflows/release.yml.
//
//   node scripts/release-changelog.mjs <version> <notes-file>
//   node scripts/release-changelog.mjs --notes <version> <notes-file>
//
// Moves the content of the "## [Unreleased]" section under a new
// "## [<version>] - <today>" heading, leaves an empty Unreleased section on
// top, and writes the released section to <notes-file> (the GitHub Release
// body). Exits non-zero when Unreleased has no entry: a release always says
// what it ships.
//
// With --notes, CHANGELOG.md is left untouched: the section of an already
// released version is written to <notes-file> (the Release workflow's
// "resume" mode, finishing a release interrupted after its version commit).
// -----------------------------------------------------------------------------

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const UNRELEASED_HEADING = '## [Unreleased]';

/**
 * @description Cut a release section out of the Unreleased one.
 * @param {string} changelog - The current CHANGELOG.md content.
 * @param {string} version - The version being released (e.g. `1.21.0`).
 * @param {string} date - The release date (`YYYY-MM-DD`).
 * @returns {{changelog: string, notes: string}} The updated changelog and the
 * released section body (without its heading).
 * @example
 * releaseChangelog(text, '1.21.0', '2026-10-20');
 */
export function releaseChangelog(changelog, version, date) {
  const start = changelog.indexOf(UNRELEASED_HEADING);
  if (start === -1) {
    throw new Error(`CHANGELOG.md has no "${UNRELEASED_HEADING}" section`);
  }
  if (changelog.includes(`## [${version}]`)) {
    throw new Error(`CHANGELOG.md already has a [${version}] section`);
  }
  const bodyStart = start + UNRELEASED_HEADING.length;
  const next = changelog.indexOf('\n## [', bodyStart);
  const bodyEnd = next === -1 ? changelog.length : next + 1;
  const notes = changelog.slice(bodyStart, bodyEnd).trim();
  if (!/^- /m.test(notes)) {
    throw new Error(
      'The Unreleased section of CHANGELOG.md is empty: add what this release ships before releasing',
    );
  }
  const updated =
    `${changelog.slice(0, bodyStart)}\n\n## [${version}] - ${date}\n\n${notes}\n\n` +
    changelog.slice(bodyEnd);
  return { changelog: updated, notes };
}

/**
 * @description The notes of an already released version.
 * @param {string} changelog - The current CHANGELOG.md content.
 * @param {string} version - A released version (e.g. `1.22.0`).
 * @returns {string} The section body (without its heading).
 * @example
 * extractReleaseNotes(text, '1.22.0');
 */
export function extractReleaseNotes(changelog, version) {
  const heading = `## [${version}]`;
  const start = changelog.indexOf(heading);
  if (start === -1) {
    throw new Error(`CHANGELOG.md has no [${version}] section`);
  }
  const bodyStart = changelog.indexOf('\n', start);
  const next = changelog.indexOf('\n## [', bodyStart);
  const notes = changelog.slice(bodyStart, next === -1 ? changelog.length : next).trim();
  if (!/^- /m.test(notes)) {
    throw new Error(`The [${version}] section of CHANGELOG.md is empty`);
  }
  return notes;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const notesOnly = args[0] === '--notes';
  const [version, notesFile] = notesOnly ? args.slice(1) : args;
  if (!version || !notesFile) {
    console.error('Usage: node scripts/release-changelog.mjs [--notes] <version> <notes-file>');
    process.exit(2);
  }
  try {
    if (notesOnly) {
      writeFileSync(
        notesFile,
        `${extractReleaseNotes(readFileSync('CHANGELOG.md', 'utf8'), version)}\n`,
      );
      process.exit(0);
    }
    const date = new Date().toISOString().slice(0, 10);
    const { changelog, notes } = releaseChangelog(
      readFileSync('CHANGELOG.md', 'utf8'),
      version,
      date,
    );
    writeFileSync('CHANGELOG.md', changelog);
    writeFileSync(notesFile, `${notes}\n`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
