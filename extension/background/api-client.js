/**
 * Backend API client with JWT auth.
 */

async function getBackendUrl() {
  const raw =
    C.BACKEND_URL_HOSTED ||
    C.BACKEND_URL ||
    C.Backend_URL ||
    "http://127.0.0.1:3579";
  return PAGE_MONITOR_UTILS.normalizeBackendUrl(raw);
}

async function apiFetch(path, options = {}) {
  const session = await getSession();
  if (!session?.access_token) {
    throw new Error("Not authenticated");
  }
  const headers = {
    ...(options.headers || {}),
    Authorization: `Bearer ${session.access_token}`,
    "Content-Type": options.body ? "application/json" : undefined,
  };
  const base = await getBackendUrl();
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const resp = await fetch(url, { ...options, headers });
  const text = await resp.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { error: text || resp.statusText };
  }
  if (!resp.ok) {
    const err = new Error(json.error || resp.statusText || "Request failed");
    err.status = resp.status;
    err.body = json;
    throw err;
  }
  return json;
}
