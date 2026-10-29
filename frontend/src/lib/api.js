/**
 * DevWorkspace Shared API Client
 * - Cookie-authenticated via credentials: 'include'
 * - Automated pre-flight CSRF retrieval and x-csrf-token header on mutations
 * - Automated Idempotency-Key generation on creates
 * - Strict If-Match revision formatting and error handling (412, 428)
 * - Auto-injection of X-Organization-Principal for org-scoped calls
 */

export class ApiError extends Error {
  constructor(status, code, message, details = {}) {
    super(message || code || `Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code || 'UNKNOWN_ERROR';
    this.details = details;
  }
}

export class StaleRevisionError extends ApiError {
  constructor(details) {
    super(412, details?.code || 'STALE_REVISION', details?.message || details?.detail || details?.title || 'This item was updated elsewhere. Reload before saving.', details);
    this.name = 'StaleRevisionError';
  }
}

export class PreconditionRequiredError extends ApiError {
  constructor(details) {
    super(428, details?.code || 'PRECONDITION_REQUIRED', details?.message || details?.detail || details?.title || 'Reload this form before saving.', details);
    this.name = 'PreconditionRequiredError';
  }
}

export class SessionExpiredError extends ApiError {
  constructor(details) {
    super(401, details?.code || 'SESSION_REQUIRED', details?.message || details?.detail || details?.title || 'Session expired. Please sign in again.', details);
    this.name = 'SessionExpiredError';
  }
}

export class ForbiddenError extends ApiError {
  constructor(details) {
    super(403, details?.code || 'FORBIDDEN', details?.message || details?.detail || details?.title || 'You do not have permission to perform this action.', details);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends ApiError {
  constructor(details) {
    super(404, details?.code || 'NOT_FOUND', details?.message || details?.detail || details?.title || 'The requested resource was not found.', details);
    this.name = 'NotFoundError';
  }
}

export class RateLimitedError extends ApiError {
  constructor(details) {
    super(429, details?.code || 'RATE_LIMITED', details?.message || details?.detail || details?.title || 'Too many requests. Please wait a moment and try again.', details);
    this.name = 'RateLimitedError';
  }
}

export class UnavailableError extends ApiError {
  constructor(details) {
    super(details?.status || 503, 'UNAVAILABLE', details?.message || details?.detail || 'Service temporarily unavailable. Try again shortly.', details);
    this.name = 'UnavailableError';
  }
}

/**
 * Escapes arbitrary strings before injection into DOM/innerHTML.
 * Prevents XSS across all vanilla HTML templates.
 */
export function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Global active principal provider callback (registered by auth service)
let principalProvider = () => null;

export function registerPrincipalProvider(fn) {
  principalProvider = fn;
}

let cachedCsrfToken = null;
let csrfFetchPromise = null;

/**
 * Fetch CSRF token from /api/v1/identity/csrf.
 */
export async function getCsrfToken(forceRefresh = false) {
  if (!forceRefresh && cachedCsrfToken) {
    return cachedCsrfToken;
  }
  if (csrfFetchPromise && !forceRefresh) {
    return csrfFetchPromise;
  }

  csrfFetchPromise = (async () => {
    try {
      const res = await fetch('/api/v1/identity/csrf', {
        method: 'GET',
        credentials: 'include'
      });
      if (!res.ok) {
        throw new Error(`Failed to fetch CSRF token: ${res.status}`);
      }
      const data = await res.json();
      cachedCsrfToken = data.token;
      return cachedCsrfToken;
    } finally {
      csrfFetchPromise = null;
    }
  })();

  return csrfFetchPromise;
}

/**
 * Reset cached CSRF token (e.g. after logout or session change)
 */
export function clearCsrfToken() {
  cachedCsrfToken = null;
}

/**
 * Generate a random UUIDv4 string for Idempotency-Key
 */
export function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Core API request method
 */
export async function request(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});

  // Normalize path to /api/v1/...
  let url = path;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    if (!url.startsWith('/api/v1/')) {
      if (url.startsWith('/')) {
        url = `/api/v1${url}`;
      } else {
        url = `/api/v1/${url}`;
      }
    }
  }

  // Inject Active Principal if present and not already specified
  if (!headers.has('X-Organization-Principal')) {
    const activePrincipal = principalProvider();
    if (activePrincipal) {
      headers.set('X-Organization-Principal', activePrincipal);
    }
  }

  // Handle Idempotency-Key for POST requests
  if (method === 'POST' && !headers.has('Idempotency-Key') && options.idempotencyKey !== false) {
    const key = typeof options.idempotencyKey === 'string' ? options.idempotencyKey : generateUUID();
    headers.set('Idempotency-Key', key);
  }

  // Handle If-Match revision for optimistic concurrency
  if (options.revision != null) {
    const raw = String(options.revision).trim();
    const formatted = raw.startsWith('"') && raw.endsWith('"') ? raw : `"${raw}"`;
    headers.set('If-Match', formatted);
  }

  // Handle non-GET/HEAD CSRF token
  const isMutation = !['GET', 'HEAD'].includes(method);
  if (isMutation && !headers.has('x-csrf-token')) {
    const token = await getCsrfToken();
    if (token) {
      headers.set('x-csrf-token', token);
    }
  }

  // JSON Body serialization
  let body = options.body;
  if (body != null && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob)) {
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    body = JSON.stringify(body);
  }

  const fetchOptions = {
    method,
    headers,
    credentials: 'include',
    body
  };

  let res = await fetch(url, fetchOptions);

  // If CSRF check failed, attempt one refresh
  if (res.status === 403 && isMutation && !options._retriedCsrf) {
    let problem = null;
    try {
      problem = await res.clone().json();
    } catch (_) {}
    if (problem && problem.code === 'CSRF_FAILED') {
      const refreshedToken = await getCsrfToken(true);
      if (refreshedToken) {
        headers.set('x-csrf-token', refreshedToken);
        return request(path, { ...options, headers, _retriedCsrf: true });
      }
    }
  }

  // Parse response
  const etagHeader = res.headers.get('etag');
  const revision = etagHeader ? etagHeader.replace(/^"|"$/g, '') : undefined;

  if (!res.ok) {
    let errBody = {};
    try {
      errBody = await res.json();
    } catch (_) {
      try {
        errBody = { message: await res.text() };
      } catch (_) {}
    }

    const code = errBody.code || errBody.error || `HTTP_${res.status}`;
    const message = errBody.message || errBody.detail || errBody.title || res.statusText;

    if (res.status === 412 || code === 'STALE_REVISION') {
      throw new StaleRevisionError(errBody);
    }
    if (res.status === 428 || code === 'PRECONDITION_REQUIRED') {
      throw new PreconditionRequiredError(errBody);
    }
    if (res.status === 401 || code === 'SESSION_REQUIRED' || code === 'UNAUTHENTICATED') {
      throw new SessionExpiredError(errBody);
    }
    if (res.status === 403 || code === 'FORBIDDEN' || code === 'CSRF_FAILED') {
      throw new ForbiddenError(errBody);
    }
    if (res.status === 404 || code === 'NOT_FOUND') {
      throw new NotFoundError(errBody);
    }
    if (res.status === 429 || code === 'RATE_LIMITED') {
      throw new RateLimitedError(errBody);
    }
    if (res.status >= 500) {
      throw new UnavailableError(errBody);
    }

    throw new ApiError(res.status, code, message, errBody);
  }

  if (res.status === 204) {
    return { status: 'ok', revision };
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await res.json();
    if (data && typeof data === 'object' && revision !== undefined) {
      // Attach revision non-enumerable or direct property so callers always have it
      try {
        Object.defineProperty(data, '_revision', {
          value: revision,
          writable: true,
          enumerable: false,
          configurable: true
        });
      } catch (_) {
        data._revision = revision;
      }
      if (data.revision === undefined) {
        data.revision = revision;
      }
    }
    return data;
  }

  return res.text();
}

export const api = {
  request,
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
  put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
  delete: (path, options) => request(path, { body: {}, ...options, method: 'DELETE' }),
  esc
};

export default api;
