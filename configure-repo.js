'use strict';

const fs = require('node:fs');
const path = require('node:path');

const username = String(process.argv[2] || '').trim();
const repository = String(process.argv[3] || 'circleftp-nuvio').trim();
const branch = String(process.argv[4] || 'main').trim();

if (!/^[A-Za-z0-9-]+$/.test(username)) {
  console.error('Usage: node configure-repo.js <github-username> [repository] [branch]');
  process.exit(1);
}
if (!/^[A-Za-z0-9_.-]+$/.test(repository) || !/^[A-Za-z0-9_.\/-]+$/.test(branch) || branch.indexOf('..') !== -1) {
  console.error('Repository or branch contains unsupported characters.');
  process.exit(1);
}

const manifestPath = path.join(__dirname, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const providerUrl = 'https://raw.githubusercontent.com/' + username + '/' + repository + '/' + branch + '/providers/circleftp.js';
['scrapers', 'providers'].forEach((listName) => {
  if (!Array.isArray(manifest[listName])) return;
  manifest[listName].forEach((provider) => {
    if (provider.id === 'circleftp') provider.url = providerUrl;
  });
});
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log('Configured CircleFTP provider URL:');
console.log(providerUrl);
console.log('Upload this folder to https://github.com/' + username + '/' + repository);
console.log('After publishing, add this manifest URL in Nuvio:');
console.log('https://raw.githubusercontent.com/' + username + '/' + repository + '/' + branch + '/manifest.json');
