import { describe, expect, it } from 'vitest';

import { repo } from './system.harness.js';
import { readRepo } from './system-facts.js';
import { deployFacts, shellVars } from './system-facts-deploy.js';
import { placeOf, siteFacts } from './system-facts-site.js';
import { linkRepos } from './system-links.js';

// A static website and deploy scripts, read as text: the site's pages and where they point, where a repo deploys,
// the packages its scripts fetch, and the links to other repos of the system these make.

const page = (/** @type {string} */ title, /** @type {string} */ body = '') => `<!doctype html>\n<html>\n<head>\n<title>${title}</title>\n<link href="https://fonts.googleapis.com/css2?x" rel="stylesheet">\n</head>\n<body>${body}</body>\n</html>\n`;
const DEPLOY = [
  '#!/bin/bash',
  'API=https://developers.hostinger.com',
  'DOMAIN=example.com',
  'zip -r site.zip index.html pricing',
  'curl -X POST "$API/api/hosting/v1/files/upload-urls"',
].join('\n');
const RELEASE = [
  '#!/bin/bash',
  'BUCKET=example-releases',
  'PREFIX="${RELEASE_PREFIX:-updates}"',
  'VERSION="$(cat version)"',
  'aws s3 cp --profile prod "s3://$BUCKET/$PREFIX/feed.xml" "$WORK/feed.xml"   # reads the feed',
  'aws_ s3 cp --only-show-errors "$ZIP" \\',
  '  "s3://$BUCKET/$PREFIX/app-$VERSION.zip"',
  'aws s3 sync dist/ s3://example-site/',
  'xcrun notarytool submit app.zip --wait',
  'codesign --force --sign "$IDENTITY" app',
  'if [ "$(npm view "example-server@$V" version 2>/dev/null)" = "$V" ]; then npm pack --silent "example-server@$V"; fi',
  'npm install -g npm@11 left-pad',
].join('\n');

const site = () => repo('example-site', {
  'index.html': page('Example &middot; Home', '<a href="https://github.com/Acme/example-server">Code</a>\n<a href="https://www.npmjs.com/package/example-server">npm</a>\n<script>fetch("https://api.example.net/waitlist")</script>'),
  'pricing/index.html': page('Pricing', '<a href="https://github.com/Acme/example-server/blob/main/README.md">Docs</a>'),
  'docs/index.html': page('Docs', '<script type="module" src="./log.js"></script>'),
  'docs/log.js': "const raw = 'https://raw.githubusercontent.com/Acme/example-server/';\nfetch(`${raw}main/CHANGELOG.md`);\n",
  'docs/vendor/marked.js': "const x = 'https://marked.js.org';\n",
  'deploy.sh': DEPLOY,
});

describe('facts from a static site', () => {
  it('reads the site, its pages with their titles, and the places they link to or read from, one fact per place', () => {
    const facts = siteFacts(site(), ['index.html', 'pricing/index.html', 'docs/index.html', 'docs/log.js', 'docs/vendor/marked.js', 'deploy.sh']);
    expect(facts[0]).toMatchObject({ kind: 'site', name: 'Example · Home', at: 'index.html:4', pages: ['/', '/docs/', '/pricing/'] });
    expect(facts.filter((f) => f.kind === 'page').map((f) => [f.path, f.name])).toEqual([['/', 'Example · Home'], ['/docs/', 'Docs'], ['/pricing/', 'Pricing']]);
    const places = facts.filter((f) => f.kind === 'links_to');
    expect(places).toEqual([
      expect.objectContaining({ name: 'Acme/example-server', how: 'links', github_repo: 'Acme/example-server', from: ['index.html', 'pricing/index.html'] }),
      expect.objectContaining({ name: 'example-server', how: 'links', npm_package: 'example-server' }),
      expect.objectContaining({ name: 'api.example.net', how: 'fetches', at: 'index.html:9' }),
      expect.objectContaining({ name: 'Acme/example-server', how: 'fetches', at: 'docs/log.js:1', urls: ['https://raw.githubusercontent.com/Acme/example-server/'] }),
    ]);
  });
  it('leaves out HTML an app owns, and what loads a page\'s fonts', () => {
    expect(siteFacts(site(), ['package.json', 'index.html'])).toEqual([]);
    expect(placeOf('https://fonts.gstatic.com/x')).toBeNull();
    expect(placeOf('https://api.github.com/repos/Acme/x/git/ref/heads/main')).toMatchObject({ github_repo: 'Acme/x', fetches: true });
  });
});

describe('facts from deploy scripts', () => {
  it('reads plain shell variables, and leaves what is worked out at run time', () => {
    expect(Object.fromEntries(shellVars(RELEASE))).toEqual({ BUCKET: 'example-releases', PREFIX: 'updates' });
  });
  it('reads where a script deploys, the packages it fetches by name, and Apple notarization', () => {
    const root = repo('releases', { 'release.sh': RELEASE, 'deploy.sh': DEPLOY, 'docs/CNAME': 'docs.example.com\n', '.github/workflows/pages.yml': 'jobs:\n  deploy:\n    steps:\n      - uses: actions/deploy-pages@v4\n' });
    const facts = deployFacts(root, ['release.sh', 'deploy.sh', 'docs/CNAME', '.github/workflows/pages.yml']);
    expect(facts.filter((f) => f.kind === 'deploy_target')).toEqual([
      expect.objectContaining({ service: 'S3', name: 'example-releases', prefixes: ['/updates/'], at: 'release.sh:6', via: 'aws s3 cp' }),
      expect.objectContaining({ service: 'S3', name: 'example-site', prefixes: ['/'], via: 'aws s3 sync' }),
      expect.objectContaining({ service: 'Hostinger', name: 'example.com', domain: 'example.com', at: 'deploy.sh:2' }),
      expect.objectContaining({ service: 'GitHub Pages', name: 'GitHub Pages', at: '.github/workflows/pages.yml:4' }),
      expect.objectContaining({ service: 'GitHub Pages', name: 'docs.example.com', at: 'docs/CNAME:1' }),
    ]);
    expect(facts.filter((f) => f.kind === 'pulls_package').map((f) => [f.name, f.via])).toEqual([['example-server', 'npm view'], ['left-pad', 'npm install']]);
    expect(facts.find((f) => f.kind === 'release_signing')).toMatchObject({ service: 'Apple', notarizes: true, signs: true, staples: false, at: 'release.sh:9' });
  });
  it('links a site and an app\'s release script to the repo that is the package they name', async () => {
    const server = { repo: 'example-server', github: { owner: 'Acme', name: 'example-server' }, facts: [{ id: 'f1', kind: 'package', at: 'package.json', language: 'javascript', name: 'example-server', dependencies: [] }] };
    const web = await readRepo(site());
    const releases = await readRepo(repo('releases', { 'release.sh': RELEASE }));
    expect(web.kinds).toEqual(['site', 'deploy']);
    const { links } = linkRepos([web, releases, server]);
    expect(links.map((l) => [l.kind, l.fromRepo, l.toRepo, l.via || l.package, l.how])).toEqual([
      ['points_to_repo', 'example-site', 'example-server', 'GitHub Acme/example-server', 'links'],
      ['points_to_repo', 'example-site', 'example-server', 'npm example-server', 'links'],
      ['points_to_repo', 'example-site', 'example-server', 'GitHub Acme/example-server', 'fetches'],
      ['uses_package', 'releases', 'example-server', 'example-server', undefined],
    ]);
  });
});
