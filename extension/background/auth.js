/**
 * Session storage and Supabase auth helpers.
 */

async function getSession() {
  const { session } = await chrome.storage.local.get("session");
  return session || null;
}

async function setSession(session) {
  if (session) {
    await chrome.storage.local.set({ session });
  } else {
    await chrome.storage.local.remove("session");
  }
}

async function supabaseAuthFetch(path, body, extraHeaders = {}) {
  const headers = {
    apikey: C.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${C.SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    ...extraHeaders,
  };
  const resp = await fetch(`${C.SUPABASE_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg =
      json.error_description ||
      json.msg ||
      json.message ||
      json.error ||
      resp.statusText;
    throw new Error(msg || "Auth request failed");
  }
  return json;
}

function sessionFromAuthResponse(data) {
  let expires_at;
  if (data.expires_at != null) {
    const raw = Number(data.expires_at);
    expires_at = raw > 1e12 ? raw : raw * 1000;
  } else {
    expires_at = Date.now() + (Number(data.expires_in) || 3600) * 1000;
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at,
    user: data.user || null,
  };
}

async function refreshSessionIfNeeded() {
  const session = await getSession();
  if (!session?.refresh_token) return null;
  const now = Date.now();
  if (session.expires_at && session.expires_at > now + 60_000) {
    return session;
  }
  const data = await supabaseAuthFetch(
    "/auth/v1/token?grant_type=refresh_token",
    { refresh_token: session.refresh_token }
  );
  const next = sessionFromAuthResponse(data);
  await setSession(next);
  return next;
}

async function performGoogleLogin() {
  const redirectUri = chrome.identity.getRedirectURL();
  const params = new URLSearchParams({
    provider: "google",
    redirect_to: redirectUri,
  });
  const authUrl = `${C.SUPABASE_URL}/auth/v1/authorize?${params.toString()}&apikey=${encodeURIComponent(
    C.SUPABASE_ANON_KEY
  )}`;

  const responseUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl,
    interactive: true,
  });

  const url = new URL(responseUrl);
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
  const access_token = hashParams.get("access_token");
  const refresh_token = hashParams.get("refresh_token");
  if (!access_token || !refresh_token) {
    throw new Error(
      "Google login did not return tokens (check Supabase redirect allowlist)"
    );
  }

  const session = sessionFromAuthResponse({
    access_token,
    refresh_token,
    expires_in: hashParams.get("expires_in"),
    expires_at: hashParams.get("expires_at"),
    user: null,
  });

  const userResp = await fetch(`${C.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: C.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${access_token}`,
    },
  });
  const userJson = await userResp.json().catch(() => ({}));
  if (userResp.ok && userJson) {
    session.user = userJson;
  }

  await setSession(session);
  return session;
}
