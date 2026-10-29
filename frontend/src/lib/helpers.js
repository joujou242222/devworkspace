/**
 * DevWorkspace Shared Page Helpers
 * 
 * Provides:
 * - esc (HTML sanitization)
 * - Date & relative time formatting
 * - Enum mappings (API <-> UI)
 * - Error-to-banner rendering (preserves #et / #eh child nodes)
 * - Empty-state helper
 * - Row data-id / data-revision convention
 * - Shared header loader (user initials/name, notification drawer & unread dot)
 */

import { api, esc } from './api.js';
import { auth } from './auth.js';

export { esc };

/**
 * Fetch all pages from a paginated endpoint up to maxPages (default: 5 pages = 500 items).
 * Avoids silent truncation on lists that exceed 25/100 items.
 */
export async function fetchAllPages(path, baseParams = {}, maxPages = 5) {
  const limit = 100;
  let page = 1;
  let allItems = [];
  let total = 0;

  while (page <= maxPages) {
    const params = new URLSearchParams(baseParams);
    params.set('limit', String(limit));
    params.set('page', String(page));

    const res = await api.get(`${path}?${params.toString()}`);
    const items = res?.items || [];
    total = typeof res?.total === 'number' ? res.total : items.length;
    allItems = allItems.concat(items);

    if (allItems.length >= total || items.length < limit) {
      break;
    }
    page++;
  }

  return {
    items: allItems,
    total,
    capped: total > allItems.length,
    loaded: allItems.length
  };
}

/**
 * Renders a visible notice if a paginated dataset was capped by fetchAllPages.
 * e.g. "Showing 500 of 1240 items"
 */
export function renderCapNotice(container, res) {
  if (!container || !res || !res.capped) return;
  const existing = container.querySelector('.cap-notice');
  if (existing) existing.remove();
  const notice = document.createElement('p');
  notice.className = 'cap-notice';
  notice.style.cssText = 'padding:10px 16px;color:var(--muted);font-size:13px;text-align:center';
  notice.textContent = `Showing ${res.loaded} of ${res.total} items`;
  container.appendChild(notice);
}

// --- DATE & TIME FORMATTERS ---

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(isoString, includeYear = false) {
  if (!isoString || isoString === 'null' || isoString === 'undefined') return '—';
  const d = new Date(isoString);
  if (isNaN(d.getTime()) || d.getTime() === 0) return '—';
  // Use UTC methods to prevent timezone rollover across midnight
  const day = d.getUTCDate();
  const month = MONTHS[d.getUTCMonth()];
  return includeYear ? `${day} ${month} ${d.getUTCFullYear()}` : `${day} ${month}`;
}

export function formatRelativeTime(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '—';
  const now = Date.now();
  const diffMs = now - d.getTime();

  // Future dates (e.g. invitation expiry)
  if (diffMs < 0) {
    const futureSec = Math.floor(-diffMs / 1000);
    const futureMin = Math.floor(futureSec / 60);
    const futureHours = Math.floor(futureMin / 60);
    const futureDays = Math.round(futureHours / 24);

    if (futureSec < 60) return 'In a few seconds';
    if (futureMin < 60) return `in ${futureMin}m`;
    if (futureHours < 24) return `in ${futureHours} hour${futureHours === 1 ? '' : 's'}`;
    if (futureDays === 1) return 'Tomorrow';
    if (futureDays < 30) return `in ${futureDays} days`;
    return formatDate(isoString);
  }

  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return formatDate(isoString);
}

export function formatDaysDue(daysOrIso) {
  if (daysOrIso === null || daysOrIso === undefined) return '—';
  let diffDays;
  if (typeof daysOrIso === 'number') {
    diffDays = daysOrIso;
  } else {
    const d = new Date(daysOrIso);
    if (isNaN(d.getTime())) return '—';
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const target = new Date(d);
    target.setHours(0, 0, 0, 0);
    diffDays = Math.round((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  }

  if (diffDays < 0) {
    return `<span class="late">Overdue ${Math.abs(diffDays)}d</span>`;
  }
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays <= 7) return `In ${diffDays} days`;
  return formatDate(daysOrIso);
}

// --- ENUM MAPPINGS ---

export const PRIORITY_MAP = {
  LOW: 'Low',
  NORMAL: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent'
};

export const REVERSE_PRIORITY_MAP = {
  Low: 'LOW',
  Medium: 'NORMAL',
  High: 'HIGH',
  Urgent: 'URGENT'
};

export function toUIPriority(apiPriority) {
  return PRIORITY_MAP[apiPriority] || apiPriority || 'Medium';
}

export function toApiPriority(uiPriority) {
  return REVERSE_PRIORITY_MAP[uiPriority] || 'NORMAL';
}

export const STATUS_MAP = {
  PLANNED: 'Planned',
  ACTIVE: 'Active',
  COMPLETED: 'Completed',
  ARCHIVED: 'Archived'
};

export const REVERSE_STATUS_MAP = {
  Planned: 'PLANNED',
  Active: 'ACTIVE',
  Completed: 'COMPLETED',
  Archived: 'ARCHIVED'
};

export function toUIStatus(apiStatus) {
  return STATUS_MAP[apiStatus] || apiStatus || 'Planned';
}

export function toApiStatus(uiStatus) {
  return REVERSE_STATUS_MAP[uiStatus] || 'PLANNED';
}

export const TASK_STATUS_MAP = {
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  DONE: 'Done',
  BLOCKED: 'Blocked',
  CANCELLED: 'Cancelled'
};

export const REVERSE_TASK_STATUS_MAP = {
  'To do': 'TODO',
  'In progress': 'IN_PROGRESS',
  'Done': 'DONE',
  'Blocked': 'BLOCKED',
  'Cancelled': 'CANCELLED'
};

export function toUITaskStatus(apiStatus) {
  return TASK_STATUS_MAP[apiStatus] || apiStatus || 'To do';
}

export function toApiTaskStatus(uiStatus) {
  return REVERSE_TASK_STATUS_MAP[uiStatus] || 'TODO';
}

// --- ERROR & EMPTY BANNER HELPERS ---

/**
 * Render empty state without overwriting child elements of #em.
 * Setting textContent on #em destroys #et and #eh!
 */
export function setEmptyState(show, title = 'No items found', hint = 'Try adjusting your filters.') {
  const em = document.getElementById('em');
  if (!em) return;
  em.hidden = !show;
  const et = document.getElementById('et');
  const eh = document.getElementById('eh');
  if (et) et.textContent = title;
  if (eh) {
    if (typeof hint === 'string' && hint.includes('<a')) {
      eh.innerHTML = ' ' + hint;
    } else {
      eh.textContent = hint ? ` ${hint}` : '';
    }
  }
}

/**
 * Map API error or standard error to the UI banners.
 */
export function handleErrorBanner(err, options = {}) {
  const {
    conflictElId = 'ce',
    dialogErrElId = 'derr',
    generalErrElId = 'err'
  } = options;

  // Stale revision conflict (412)
  if (err.status === 412 || err.code === 'STALE_REVISION') {
    const ce = document.getElementById(conflictElId);
    if (ce) {
      ce.hidden = false;
      ce.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
  }

  // Dialog error element (e.g. #derr)
  const derr = document.getElementById(dialogErrElId);
  if (derr && derr.offsetParent !== null) {
    derr.textContent = err.details?.message || err.message || 'Action failed.';
    derr.hidden = false;
    return;
  }

  // General error banner
  const errEl = document.getElementById(generalErrElId);
  if (errEl) {
    errEl.textContent = err.details?.message || err.message || 'An error occurred.';
    errEl.hidden = false;
    errEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } else {
    console.error('Unhandled API Error:', err);
  }
}

// --- CONFIRMATION DIALOG HELPER ---

/**
 * Displays a styled confirmation dialog built from the design's native dialog markup and classes.
 * Returns a Promise that resolves to true if confirmed, false if cancelled.
 */
export function askConfirm(message, { title = 'Please confirm', confirmText = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.innerHTML = `
      <form method="dialog">
        <h2>${esc(title)}</h2>
        <p style="margin-top:12px;color:var(--text);font-size:14px;line-height:1.5"></p>
        <div class="row2" style="margin-top:16px">
          <button class="btn ${danger ? 'red' : 'lime'}" type="submit">${esc(confirmText)}</button>
          <button class="btn" type="button" data-n>Cancel</button>
        </div>
      </form>
    `;
    document.body.appendChild(d);
    d.querySelector('p').textContent = message;

    const cancelBtn = d.querySelector('[data-n]');
    if (cancelBtn) {
      cancelBtn.onclick = () => {
        d.close();
        resolve(false);
      };
    }

    const form = d.querySelector('form');
    if (form) {
      form.onsubmit = (e) => {
        e.preventDefault();
        d.close();
        resolve(true);
      };
    }

    d.addEventListener('close', () => {
      d.remove();
    });

    if (typeof d.showModal === 'function') {
      d.showModal();
    } else {
      resolve(window.confirm(`${title}\n\n${message}`));
    }
  });
}

// --- ROW DATA CONVENTION HELPERS ---

/**
 * Return dataset attributes string to embed on rendered elements:
 * e.g. `data-id="${record.id}" data-revision="${record.revision}"`
 */
export function rowAttrs(record) {
  return `data-id="${esc(record.id)}" data-revision="${record.revision}"`;
}

/**
 * Retrieve { id, revision } from any event target or DOM element.
 */
export function getRowMeta(el) {
  const target = el?.closest ? el.closest('[data-id]') : null;
  if (!target) return null;
  return {
    id: target.dataset.id,
    revision: parseInt(target.dataset.revision, 10),
    element: target
  };
}

// --- SHARED HEADER LOADER ---

export async function loadHeader() {
  const activePrincipal = auth.getActivePrincipal();
  const orgId = auth.activeOrgId;

  // 1. User initials & name in .util or portal header
  const user = auth.user;
  if (user) {
    const av = document.querySelector('.util .av, .ph .av');
    if (av) {
      const parts = (user.name || '').trim().split(/\s+/);
      const initials = parts.length > 1
        ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
        : (user.name ? user.name.slice(0, 2).toUpperCase() : 'U');
      av.textContent = initials;
      // Also update sibling text node (user display name)
      const parent = av.parentElement;
      if (parent) {
        for (const child of parent.childNodes) {
          if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) {
            child.textContent = ' ' + (parts[0] || user.name);
            break;
          }
        }
      }

      // Check if user has an uploaded profile photo
      try {
        const imgRef = await api.get('/me/image');
        if (imgRef && imgRef.asset_id) {
          av.style.backgroundImage = `url('/api/v1/me/image/content?v=${encodeURIComponent(imgRef.asset_id)}')`;
          av.style.backgroundSize = 'cover';
          av.style.backgroundPosition = 'center';
          av.textContent = '';
        } else {
          av.style.backgroundImage = '';
          av.textContent = initials;
        }
      } catch (_) {}
    }
  }

  // 2. Notifications drawer & unread dot
  const bell = document.getElementById('bell');
  const dot = document.getElementById('bd');
  const dr = document.getElementById('dr');
  const dl = document.getElementById('dl');

  if (bell && dr && dl && orgId) {
    try {
      const res = await api.get(`/organizations/${orgId}/notifications?limit=8`);
      const items = res?.items || [];
      const unreadCount = res?.unread || items.filter(n => !n.read_at).length;

      if (dot) {
        dot.style.display = unreadCount > 0 ? '' : 'none';
      }

      const renderNotifications = () => {
        if (!items.length) {
          dl.innerHTML = '<li style="padding:12px;color:var(--muted)">No notifications yet</li>';
          return;
        }
        dl.innerHTML = items.map(n => {
          const isUnread = !n.read_at;
          const href = n.href || '#';
          return `<li class="${isUnread ? 'u' : ''}"><a href="${esc(href)}" style="text-decoration:none;color:inherit"><b>${esc(n.summary)}</b><small>${formatRelativeTime(n.occurred_at)}</small></a></li>`;
        }).join('');
      };

      bell.onclick = () => {
        dr.hidden = !dr.hidden;
        bell.setAttribute('aria-expanded', String(!dr.hidden));
        if (!dr.hidden) {
          renderNotifications();
        }
      };

      document.addEventListener('click', (e) => {
        if (!dr.hidden && !e.target.closest('#dr,#bell')) {
          dr.hidden = true;
          bell.setAttribute('aria-expanded', 'false');
        }
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !dr.hidden) {
          dr.hidden = true;
          bell.setAttribute('aria-expanded', 'false');
          bell.focus();
        }
      });
    } catch (_) {
      // Quietly ignore notification fetch errors on secondary widgets
    }
  }
}

export function formatReauthMessage(action) {
  const returnPath = typeof window !== 'undefined' ? encodeURIComponent(window.location.pathname + window.location.search) : '';
  return `For security, <a class="lnk" href="/login?returnTo=${returnPath}">sign in again</a> to ${action}.`;
}

export function renderRestrictedState(container, message = 'You don’t have permission to access this page.') {
  if (!container) return;
  const target = typeof container === 'string' ? document.getElementById(container) : container;
  if (!target) return;
  target.innerHTML = `<div class="empty"><b>Access restricted</b>${esc(message)}</div>`;
}

export function renderNotAvailableState(container, message = 'This item is not available.') {
  if (!container) return;
  const target = typeof container === 'string' ? document.getElementById(container) : container;
  if (!target) return;
  target.innerHTML = `<div class="empty"><b>Not available</b>${esc(message)}</div>`;
}

export function handlePageAccessError(err, container = 'app') {
  if (!err) return false;
  const root = typeof container === 'string' ? document.getElementById(container) : container;
  if (!root) return false;
  const main = root.querySelector('main.page') || root;

  if (err.status === 403 || err.code === 'FORBIDDEN' || err.code === 'ADMIN_REQUIRED' || err.code === 'OWNER_REQUIRED') {
    renderRestrictedState(main, err.message || 'You don’t have permission to access this page.');
    return true;
  }
  if (err.status === 404 || err.code === 'NOT_FOUND') {
    renderNotAvailableState(main, err.message || 'This item is not available.');
    return true;
  }
  return false;
}

/**
 * Shared media upload helper
 * - Validates file: image/png or image/jpeg, <= 2 MiB (2097152 bytes)
 * - Computes SHA-256 digest using crypto.subtle
 * - POST to baseUploadUrl (e.g. '/me/image/uploads' or '/organizations/${orgId}/logo/uploads')
 * - PUT binary buffer via /dw-staging (extracted from capability.url)
 * - POST to ${baseUploadUrl}/${intent.id}/finalize
 * - Polls ${baseUploadUrl}/${intent.id} until terminal state (READY, REJECTED, FAILED)
 *
 * Messages:
 * - SCANNER_UNAVAILABLE is a server problem: "We couldn't process this file right now. Try again later."
 * - REJECTED/INFECTED/wrong type/too large: "This image was rejected. Use a JPG or PNG under 2 MB."
 */
export async function uploadMedia(file, baseUploadUrl, onProgress) {
  if (!file) {
    const err = new Error('This image was rejected. Use a JPG or PNG under 2 MB.');
    err.code = 'NO_FILE';
    throw err;
  }

  // Validate type
  const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg'];
  const mime = file.type === 'image/jpeg' || file.type === 'image/jpg' ? 'image/jpeg' : (file.type === 'image/png' ? 'image/png' : null);
  if (!mime || !allowedTypes.includes(file.type)) {
    const err = new Error('This image was rejected. Use a JPG or PNG under 2 MB.');
    err.code = 'INVALID_TYPE';
    throw err;
  }

  // Validate size (2 MiB = 2 * 1024 * 1024)
  const MAX_SIZE = 2 * 1024 * 1024;
  if (file.size > MAX_SIZE) {
    const err = new Error('This image was rejected. Use a JPG or PNG under 2 MB.');
    err.code = 'FILE_TOO_LARGE';
    throw err;
  }

  if (onProgress) onProgress('Preparing image…');

  // Compute SHA-256
  const arrayBuffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const digest = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  if (onProgress) onProgress('Uploading…');

  // 1. Create upload intent
  const intent = await api.post(baseUploadUrl, {
    name: file.name || 'image.png',
    size: file.size,
    digest,
    mime
  });

  if (!intent || !intent.capability || !intent.capability.url) {
    const err = new Error("We couldn't process this file right now. Try again later.");
    err.code = 'UPLOAD_INIT_FAILED';
    throw err;
  }

  // 2. PUT via /dw-staging
  const capUrl = new URL(intent.capability.url);
  const stagingPath = capUrl.pathname + capUrl.search;
  const putHeaders = {
    ...(intent.capability.headers || {})
  };
  delete putHeaders['host'];
  delete putHeaders['Host'];
  delete putHeaders['content-length'];
  delete putHeaders['Content-Length'];

  const stagingRes = await fetch(stagingPath, {
    method: 'PUT',
    headers: putHeaders,
    body: arrayBuffer
  });

  if (!stagingRes.ok && stagingRes.status !== 204) {
    const err = new Error('This image was rejected. Use a JPG or PNG under 2 MB.');
    err.code = 'STAGING_FAILED';
    throw err;
  }

  if (onProgress) onProgress('Scanning…');

  // 3. Finalize upload
  const finUrl = `${baseUploadUrl.replace(/\/$/, '')}/${intent.id}/finalize`;
  await api.post(finUrl, {});

  // 4. Poll until READY / FAILED / REJECTED
  const checkUrl = `${baseUploadUrl.replace(/\/$/, '')}/${intent.id}`;
  const start = Date.now();
  const timeoutMs = 60000;

  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 1000));
    const check = await api.get(checkUrl);
    const status = check?.status;

    if (status === 'READY') {
      return check;
    }

    if (status === 'FAILED') {
      if (check.error_code === 'SCANNER_UNAVAILABLE') {
        const err = new Error("We couldn't process this file right now. Try again later.");
        err.code = 'SCANNER_UNAVAILABLE';
        throw err;
      }
      const err = new Error('This image was rejected. Use a JPG or PNG under 2 MB.');
      err.code = 'FAILED';
      throw err;
    }

    if (status === 'REJECTED') {
      const err = new Error('This image was rejected. Use a JPG or PNG under 2 MB.');
      err.code = 'REJECTED';
      throw err;
    }
  }

  const timeoutErr = new Error("We couldn't process this file right now. Try again later.");
  timeoutErr.code = 'TIMEOUT';
  throw timeoutErr;
}

// Expose globally for classic script page execution
if (typeof window !== 'undefined') {
  window.__DW_HELPERS__ = {
    esc,
    formatDate,
    formatRelativeTime,
    formatDaysDue,
    toUIPriority,
    toApiPriority,
    toUIStatus,
    toApiStatus,
    toUITaskStatus,
    toApiTaskStatus,
    setEmptyState,
    handleErrorBanner,
    rowAttrs,
    getRowMeta,
    loadHeader,
    fetchAllPages,
    askConfirm,
    renderCapNotice,
    formatReauthMessage,
    renderRestrictedState,
    renderNotAvailableState,
    handlePageAccessError,
    uploadMedia
  };
}
