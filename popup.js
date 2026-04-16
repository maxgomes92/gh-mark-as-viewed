const STORAGE_KEY = 'glob_patterns';

const globsEl = document.getElementById('globs');
const markBtn = document.getElementById('mark-btn');
const unmarkBtn = document.getElementById('unmark-btn');
const statusEl = document.getElementById('status');

// Restore saved patterns on open
chrome.storage.local.get(STORAGE_KEY, (result) => {
  if (result[STORAGE_KEY]) {
    globsEl.value = result[STORAGE_KEY];
  }
});

// Save patterns whenever textarea changes
globsEl.addEventListener('input', () => {
  chrome.storage.local.set({ [STORAGE_KEY]: globsEl.value });
});

function setStatus(msg, type = 'info') {
  statusEl.textContent = msg;
  statusEl.className = type;
}

async function sendAction(action) {
  const patterns = globsEl.value
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.url?.match(/github\.com\/.+\/pull\/\d+/)) {
    setStatus('Not a GitHub PR page.', 'error');
    return;
  }

  let result;
  try {
    [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: applyGlobs,
      args: [patterns, action],
    });
  } catch (err) {
    setStatus('Cannot access page. Try refreshing.', 'error');
    return;
  }

  if (result?.result?.error) {
    setStatus(result.result.error, 'error');
  } else {
    const { clicked, total } = result.result;
    const verb = action === 'mark' ? 'Marked' : 'Unmarked';
    setStatus(`${verb} ${clicked} of ${total} matched file(s).`, 'success');
  }
}

markBtn.addEventListener('click', () => sendAction('mark'));
unmarkBtn.addEventListener('click', () => sendAction('unmark'));

// ---------------------------------------------------------------------------
// This function is serialised and injected into the page — keep it self-contained.
// ---------------------------------------------------------------------------
function applyGlobs(patterns, action) {
  function globToRegex(glob) {
    let regex = '^';
    let i = 0;
    while (i < glob.length) {
      const c = glob[i];
      if (c === '*') {
        if (glob[i + 1] === '*') {
          if (glob[i + 2] === '/') {
            regex += '(?:[^/]+/)*';
            i += 3;
          } else {
            regex += '.*';
            i += 2;
          }
        } else {
          regex += '[^/]*';
          i++;
        }
      } else if (c === '?') {
        regex += '[^/]';
        i++;
      } else if ('.+^${}()|[]\\'.includes(c)) {
        regex += '\\' + c;
        i++;
      } else {
        regex += c;
        i++;
      }
    }
    regex += '$';
    return new RegExp(regex);
  }

  function matchesAny(filePath, regexes) {
    if (regexes.length === 0) return true;
    const basename = filePath.includes('/') ? filePath.split('/').pop() : filePath;
    return regexes.some(({ re, hasSlash }) => re.test(hasSlash ? filePath : basename));
  }

  function findToggle(container) {
    // New GitHub UI: button with aria-pressed for "Viewed" / "Mark as viewed"
    return (
      container.querySelector('button[aria-label="Viewed"], button[aria-label="Mark as viewed"]') ||
      container.querySelector('button[class*="MarkAsViewedButton"]') ||
      // Old GitHub UI: checkbox
      container.querySelector('input[type="checkbox"].js-reviewed-toggle') ||
      container.querySelector('input[type="checkbox"][data-mark-file-viewed]') ||
      container.querySelector('input[type="checkbox"][name*="viewed"]') ||
      container.querySelector('.js-file-header input[type="checkbox"]') ||
      container.querySelector('input[type="checkbox"]')
    );
  }

  function isToggled(toggle) {
    if (!toggle) return false;
    if (toggle.tagName === 'INPUT') return toggle.checked;
    return toggle.getAttribute('aria-pressed') === 'true';
  }

  // Collect { path, toggle } pairs using multiple fallback strategies.
  function collectFileItems() {
    // Strategy 1: New GitHub UI — diff containers with role="region" and id="diff-*"
    const byRegion = document.querySelectorAll('div[role="region"][id^="diff-"]');
    if (byRegion.length > 0) {
      return Array.from(byRegion).map((el) => {
        const pathEl = el.querySelector('h3 a code') || el.querySelector('h3 a');
        // Strip Unicode directional marks (U+200E / U+200F) GitHub wraps paths with
        const path = pathEl?.textContent?.replace(/[\u200e\u200f]/g, '').trim() || null;
        return { path, toggle: findToggle(el) };
      }).filter((item) => item.path);
    }

    // Strategy 2: containers with data-tagsearch-path (older github.com)
    const byTagsearch = document.querySelectorAll('[data-tagsearch-path]');
    if (byTagsearch.length > 0) {
      return Array.from(byTagsearch).map((el) => ({
        path: el.getAttribute('data-tagsearch-path'),
        toggle: findToggle(el),
      }));
    }

    // Strategy 3: file-header elements with data-path attribute
    const byDataPath = document.querySelectorAll('[data-path]');
    if (byDataPath.length > 0) {
      const seen = new Set();
      const items = [];
      for (const el of byDataPath) {
        const path = el.getAttribute('data-path');
        if (!path || seen.has(path)) continue;
        seen.add(path);
        const container = el.closest('.js-file, .file') || el.parentElement;
        items.push({ path, toggle: findToggle(container) });
      }
      if (items.length > 0) return items;
    }

    // Strategy 4: find any "Viewed" checkbox and walk up to get the file path
    // from a containing element's attribute or from a nearby link title.
    const candidates = document.querySelectorAll(
      'input[type="checkbox"].js-reviewed-toggle, ' +
      'input[type="checkbox"][data-mark-file-viewed], ' +
      'input[type="checkbox"][name*="viewed"]'
    );
    if (candidates.length > 0) {
      return Array.from(candidates).map((cb) => {
        const ancestor = cb.closest('[data-tagsearch-path], [data-path], .js-file, .file');
        const path =
          ancestor?.getAttribute('data-tagsearch-path') ||
          ancestor?.getAttribute('data-path') ||
          ancestor?.querySelector('a[title]')?.getAttribute('title') ||
          ancestor?.querySelector('.file-info a')?.textContent?.trim() ||
          null;
        return { path, toggle: cb };
      }).filter((item) => item.path);
    }

    return [];
  }

  // Build regexes from patterns; track whether the pattern contains a slash
  // so we can match slash-free patterns against the basename only.
  const regexes = patterns.map((p) => ({ re: globToRegex(p), hasSlash: p.includes('/') }));

  const fileItems = collectFileItems();

  if (fileItems.length === 0) {
    return {
      error:
        'No files found. Make sure you are on the Files (or Changes) tab of a PR and the diff has loaded.',
    };
  }

  let total = 0;
  let clicked = 0;

  for (const { path, toggle } of fileItems) {
    if (!path || !matchesAny(path, regexes)) continue;
    total++;
    if (!toggle) continue;

    const checked = isToggled(toggle);
    if (action === 'mark' && !checked) {
      toggle.click();
      clicked++;
    } else if (action === 'unmark' && checked) {
      toggle.click();
      clicked++;
    }
  }

  return { clicked, total };
}
