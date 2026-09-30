// Update check against the latest GitHub release (public repo, CORS-enabled API, checked at most every 6 h).
export const REPO = 'end2-237/dip';
export const UPDATE_CMD = `irm https://raw.githubusercontent.com/${REPO}/main/scripts/update-dip.ps1 | iex`;

// Where DIP is installed on this computer: written by the update script in extension/install.json,
// or typed once in Réglages (chrome.storage). null when unknown.
export async function installHome() {
  const typed = (await chrome.storage.local.get(['dipHome'])).dipHome;
  if (typed) return typed;
  try {
    const r = await fetch(chrome.runtime.getURL('install.json'), { cache: 'no-store' });
    if (r.ok) return (await r.json()).home || null;
  } catch (e) {
    /* not installed by the script */
  }
  return null;
}
export async function setInstallHome(home) {
  home = String(home || '').trim().replace(/[\\/]+$/, '').replace(/[\\/]extension$/i, '');
  if (home) await chrome.storage.local.set({ dipHome: home });
  else await chrome.storage.local.remove('dipHome');
  return home || null;
}
// The PowerShell command for this install: it updates the folder Chrome loads DIP from
export async function updateCommand() {
  const home = await installHome().catch(() => null);
  return home ? `$env:DIP_HOME = "${home}"; ${UPDATE_CMD}` : UPDATE_CMD;
}

const newer = (a, b) => {
  const x = String(a).replace(/^v/, '').split('.').map(Number), y = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

export async function checkUpdate(force) {
  const current = chrome.runtime.getManifest().version;
  const cache = (await chrome.storage.local.get(['dipUpdate'])).dipUpdate;
  let latest = cache && Date.now() - cache.at < 6 * 3600e3 && !force ? cache : null;
  if (!latest) {
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
      if (!r.ok) return { current, available: false };
      const j = await r.json();
      latest = { at: Date.now(), tag: j.tag_name, name: j.name, url: j.html_url, notes: (j.body || '').split('\n---')[0].trim() };
      await chrome.storage.local.set({ dipUpdate: latest });
    } catch (e) {
      return { current, available: false };
    }
  }
  return { current, available: newer(latest.tag, current), ...latest };
}
