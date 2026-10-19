const FORK = 'yxt02/hongguo-drama-linux';
const UPSTREAM = 'jackotom/hongguo-drama';
const releaseRepository = (platform = process.platform) => platform === 'linux' ? FORK : UPSTREAM;
const releasesUrl = platform => 'https://github.com/' + releaseRepository(platform) + '/releases';
const releasesApi = platform => 'https://api.github.com/repos/' + releaseRepository(platform) + '/releases/latest';
function versionParts(value) {
  const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?$/.exec(String(value || ''));
  if (!match) return null;
  const parts = [Number(match[1]), Number(match[2]), Number(match[3] || 0)];
  return parts.every(Number.isSafeInteger) ? parts : null;
}
function availableRelease(data, currentVersion, { platform = process.platform } = {}) {
  if (!data || data.draft || data.prerelease) return null;
  const tag = String(data.tag_name || '');
  if (platform === 'linux' && !/^v\d+\.\d+\.\d+-linux$/.test(tag)) return null;
  const normalized = platform === 'linux' ? tag.replace(/-linux$/, '') : tag;
  const next = versionParts(normalized), current = versionParts(currentVersion);
  if (!next || !current) return null;
  const difference = next.findIndex((part, i) => part !== current[i]);
  if (difference < 0 || next[difference] < current[difference]) return null;
  return { version: normalized.replace(/^v/, ''), tag, url: releasesUrl(platform) + '/tag/' + encodeURIComponent(tag) };
}
module.exports = { availableRelease, versionParts, releasesApi, releasesUrl, FORK };
