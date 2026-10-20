// Confirmed relationships and automatic title-based season buttons. Discovery never mutates media identity.
const { randomUUID } = require('node:crypto');
function sourceOf(id) {
  const value = String(id);
  return value.startsWith('custom:') ? value.split(':').slice(0, 2).join(':')
    : value.startsWith('xifan:') ? 'xifan' : value.startsWith('hema:') ? 'hema' : 'hongguo';
}
function chineseNumber(value) {
  if (/^\d+$/.test(value)) return Number(value);
  const digits = { 零:0, 〇:0, 一:1, 二:2, 两:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9 };
  if (![...value].some(c => c === '十' || c === '百')) return Number([...value].map(c => digits[c] ?? '').join(''));
  let total = 0, digit = 0;
  for (const c of value) {
    if (c === '十' || c === '百') { total += (digit || 1) * (c === '十' ? 10 : 100); digit = 0; }
    else if (Object.hasOwn(digits, c)) digit = digits[c];
    else return null;
  }
  return total + digit;
}
function titleInfo(title) {
  const text = String(title || '').normalize('NFKC').trim();
  const explicit = text.match(/^(.*?)[\s·:_\-(]*(?:第\s*([零〇一二两三四五六七八九十百\d]{1,8})\s*[季部]|season\s*(\d{1,3})|s(\d{1,3}))[\s)]*$/i);
  const bare = !explicit && text.match(/^(.*?)[\s·:_\-(]*([零〇一二两三四五六七八九十百]{1,5}|\d{1,3})[\s)]*$/);
  const match = explicit || bare;
  const number = match ? chineseNumber(match[2] || match[3] || match[4]) : null;
  const base = match?.[1].trim() || '';
  const valid = base.length >= 2 && !base.endsWith('第') && (explicit || !/\d$/.test(base)) && Number.isInteger(number) && number > 0 && number <= (explicit ? 999 : 99);
  const root = valid ? base : text;
  return { base: root, key: root.toLocaleLowerCase().replace(/[\s·:_\-()《》]/g, ''), number: valid ? number : null };
}

function find(registry, id) {
  if (typeof id !== 'string' || !id || id.length > 256) throw Error('剧集编号无效');
  const entry = registry.find(s => String(s.series_id) === id && !s.dismissed);
  if (!entry) throw Error('请先将该季加入剧库');
  return entry;
}
const seasonNumber = entry => Number.isInteger(entry.season_number) && entry.season_number > 0 && entry.season_number <= 999
  ? entry.season_number : titleInfo(entry.series_title).number || 1;
function view(registry, id, discovered = []) {
  const anchor = find(registry, id), source = sourceOf(id), info = titleInfo(anchor.series_title);
  const members = anchor.season_group ? registry.filter(s => !s.dismissed && s.season_group === anchor.season_group && sourceOf(s.series_id) === source) : [anchor];
  const item = s => ({ series_id: String(s.series_id), series_title: s.series_title || '', cover: s.cover || '',
    total: s.total || s.episodes?.length || 0, number: seasonNumber(s) });
  const seasons = members.map(item).sort((a,b) => a.number-b.number || a.series_id.localeCompare(b.series_id));
  const ids = new Set(seasons.map(s=>s.series_id));
  const candidates = registry.filter(s => !s.dismissed && !ids.has(String(s.series_id)) && sourceOf(s.series_id) === source
    && info.key && titleInfo(s.series_title).key === info.key).slice(0,50).map(item);
  const known = new Map(registry.map(s => [String(s.series_id), s]));
  const automatic = new Map();
  for (const row of [...registry, ...discovered.slice(0,100)]) {
    const sid = String(row.series_id || ''), entry = known.get(sid) || row;
    const title = titleInfo(entry.series_title);
    if (!sid || sid.length > 256 || entry.dismissed || ids.has(sid) || sourceOf(sid) !== source
      || !info.key || title.key !== info.key || (!info.number && !title.number)
      || (entry.season_group && entry.season_group !== anchor.season_group)) continue;
    automatic.set(sid, {...item(entry), automatic:true, registered:known.has(sid)});
  }
  const related = [...seasons.map(s => ({...s, registered:true})), ...[...automatic.values()].slice(0,Math.max(0,100-seasons.length))]
    .sort((a,b) => a.number-b.number || a.series_id.localeCompare(b.series_id));
  return { source, query: info.base, linked: !!anchor.season_group, seasons, related, candidates,
    currentNumber: seasonNumber(anchor), nextNumber: Math.min(999, Math.max(...seasons.map(s=>s.number)) + 1) };
}
function link(registry, anchorId, targetId, number) {
  const anchor = find(registry, anchorId), target = find(registry, targetId);
  if (!Number.isInteger(number) || number < 1 || number > 999) throw Error('季号须为 1 到 999 的整数');
  if (sourceOf(anchorId) !== sourceOf(targetId)) throw Error('请从同一来源选择其他季');
  if (target.season_group && target.season_group !== anchor.season_group) throw Error('该季已关联其他剧，请先解除原关联');
  const members = anchor.season_group ? registry.filter(s => s.season_group === anchor.season_group) : [anchor];
  if (members.some(s => String(s.series_id) !== targetId && seasonNumber(s) === number)) throw Error(`已有第 ${number} 季，请调整季号`);
  if (members.length >= 100 && !members.some(s => String(s.series_id) === targetId)) throw Error('一部剧最多关联 100 季');
  const group = anchor.season_group || randomUUID();
  return registry.map(s => String(s.series_id) === targetId ? {...s, season_group:group, season_number:number}
    : String(s.series_id) === anchorId ? {...s, season_group:group, season_number:seasonNumber(s)} : s);
}
function unlink(registry, anchorId, targetId) {
  const anchor = find(registry, anchorId), target = find(registry, targetId);
  if (!anchor.season_group || anchor.season_group !== target.season_group) throw Error('该季不属于当前关联');
  return registry.map(s => { if (String(s.series_id) !== targetId) return s;
    const { season_group, season_number, ...rest } = s; return rest; });
}
module.exports = { sourceOf, titleInfo, view, link, unlink };
