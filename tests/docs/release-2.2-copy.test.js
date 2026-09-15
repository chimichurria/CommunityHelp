'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const readme = read('README.md');
const changelog = read('CHANGELOG.md');
const releaseNotes = read('docs/releases/2.2.0/release-notes.md');
const nasikoSkill = read('skills/nasiko-control-plane/SKILL.md');
const modules = read('manifests/install-modules.json');
const components = read('manifests/install-components.json');
const staleReleaseCopy = [
  /guided package setup is coming in .*2\.2/i,
  /current npm\s+release,?\s+2\.1\.0/i,
  /until .*2\.2\.0 is published/i,
  /coming soon: guided setup in release 2\.2/i,
  /release 2\.2 will support/i,
];

for (const pattern of staleReleaseCopy) {
  assert.doesNotMatch(readme, pattern);
}

assert.match(readme, /ECC 2\.2 includes guided package setup/i);
// Upstream asserted the README documents `npm view ecc-universal version`, its
// way of checking the published release. This fork publishes no npm package, so
// that command would query UPSTREAM's registry entry. The equivalent freshness
// check here is the clone the install instructions actually use.
assert.match(readme, /git clone https:\/\/github\.com\/chimichurria\/CommunityHelp\.git/);
assert.doesNotMatch(
  readme.replace(/^>.*$/gm, ''),  // warnings about upstream's package are allowed
  /npm view ecc-universal/,
);

for (const source of [changelog, releaseNotes, nasikoSkill, modules, components]) {
  assert.doesNotMatch(source, /Nasiko integration/i);
  assert.doesNotMatch(source, /operate the optional Nasiko agent control plane/i);
  assert.match(source, /Nasiko CLI lifecycle bridge/i);
}

console.log('ECC 2.2 release copy: ok');
