'use strict';
function decodeBase64(value) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}
function validateSeason(value) {
  if (!value || typeof value.title !== 'string' || !Array.isArray(value.episodes) || !value.episodes.length || value.episodes.length > 1000) throw new Error('Invalid download list.');
  return { title: value.title.slice(0, 300), episodes: value.episodes.map(item => {
    const url = new URL(item.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid video link.');
    return { name: String(item.name || 'Episode').slice(0, 300), url: url.href };
  }) };
}
async function openSeason(params, request = fetch) {
  const topic = params.get('t'), expires = Number(params.get('e'));
  if (!/^salwa-download-[a-f0-9]{32}$/.test(topic || '') || !Number.isFinite(expires) || Date.now() > expires || expires > Date.now() + 11 * 60000) throw new Error('This QR has expired. Create a new one on your TV.');
  const keyBytes = decodeBase64(params.get('k') || ''), iv = decodeBase64(params.get('iv') || '');
  if (keyBytes.length !== 32 || iv.length !== 12) throw new Error('Invalid download key.');
  const response = await request('https://ntfy.sh/' + topic + '/json?poll=1&since=' + Math.floor((expires - 11 * 60000) / 1000), { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('Cannot reach the temporary transfer service. Try again.');
  const text = await response.text();
  if (text.length > 400000) throw new Error('Download list is too large.');
  const chunks = new Map(); let total = 0;
  for (const line of text.split('\n').filter(Boolean)) {
    const message = JSON.parse(line); if (message.event !== 'message') continue;
    const part = JSON.parse(message.message);
    if (part.v !== 1 || !Number.isInteger(part.parts) || part.parts < 1 || part.parts > 100 || !Number.isInteger(part.part) || part.part < 0 || part.part >= part.parts || typeof part.data !== 'string' || part.data.length > 2800 || (total && total !== part.parts)) throw new Error('Invalid transfer.');
    total = part.parts; chunks.set(part.part, part.data);
  }
  if (!total || chunks.size !== total) throw new Error('Download list is incomplete. Scan the QR again.');
  const encrypted = decodeBase64(Array.from({ length: total }, (_, i) => chunks.get(i)).join(''));
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
