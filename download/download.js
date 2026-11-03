'use strict';
function decodeBase64(value) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}
function validateSeason(value) {
  if (!value || typeof value.title !== 'string' || !Array.isArray(value.episodes) || !value.episodes.length || value.episodes.length > 1000) throw new Error('Invalid download list.');
  return { title: value.title.slice(0, 300), episodes: value.episodes.map(item => {
    const compact = Array.isArray(item);
    const url = compact ? new URL(item[1], value.base) : new URL(item.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid video link.');
    return { name: String(compact ? 'Episode ' + item[0] : item.name || 'Episode').slice(0, 300), url: url.href };
  }) };
}
async function openSeason(params) {
  const keyBytes = decodeBase64(params.get('k') || ''), iv = decodeBase64(params.get('iv') || '');
  if (keyBytes.length !== 32 || iv.length !== 12) throw new Error('Invalid download key.');
  const data = params.get('d') || '';
  if (!data || data.length > 250000) throw new Error('Invalid download list.');
  const encrypted = decodeBase64(data);
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  return validateSeason(JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted))));
}
function downloadEpisode(item) {
  const anchor = document.createElement('a'); anchor.href = item.url; anchor.download = item.name; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
  document.body.append(anchor); anchor.click(); anchor.remove();
}
if (typeof document !== 'undefined') (async () => {
  const status = document.getElementById('status');
  try {
    const params = new URLSearchParams(location.hash.slice(1)); history.replaceState(null, '', location.pathname);
    const season = await openSeason(params);
    document.getElementById('title').textContent = season.title;
    status.textContent = season.episodes.length + ' episodes · Choose individual episodes or download the season.';
    document.getElementById('actions').hidden = false; document.getElementById('help').hidden = false;
    const rows = season.episodes.map(item => {
      const row = document.createElement('div'); row.className = 'episode';
      const label = document.createElement('span'); label.textContent = item.name;
      const button = document.createElement('button'); button.textContent = 'Download'; button.onclick = () => { downloadEpisode(item); button.textContent = 'Download again'; };
      row.append(label, button); return row;
    });
    document.getElementById('episodes').replaceChildren(...rows);
    document.getElementById('all').onclick = async event => {
      const button = event.currentTarget; button.disabled = true;
      try { for (const [index, item] of season.episodes.entries()) { status.textContent = 'Opening download ' + (index + 1) + ' of ' + season.episodes.length; downloadEpisode(item); await new Promise(r => setTimeout(r, 1000)); } status.textContent = 'Download requests sent. Check your browser downloads; if blocked, use the individual buttons.'; }
      finally { button.disabled = false; }
    };
    document.getElementById('playlist').onclick = () => {
      const clean = value => value.replace(/[\r\n]/g, ' ');
      const blob = new Blob(['#EXTM3U\n' + season.episodes.map(item => '#EXTINF:-1,' + clean(item.name) + '\n' + item.url).join('\n')], { type: 'audio/x-mpegurl' });
      const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = season.title.replace(/[^\p{L}\p{N} _-]/gu, '') + '.m3u'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    };
  } catch (error) { status.textContent = error.message || 'Cannot open download list. Scan a new QR from your TV.'; }
})();
if (typeof module !== 'undefined') module.exports = { openSeason, validateSeason };
