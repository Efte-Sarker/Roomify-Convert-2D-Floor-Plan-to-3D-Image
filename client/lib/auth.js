const jsonHeaders = { "Content-Type": "application/json" };

const authFetch = (url, options = {}) =>
  fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      ...jsonHeaders,
      ...options.headers,
    },
  });

/**
 * Safely parse a fetch Response as JSON.
 * Reads the body as text first, then parses — avoids "Unexpected end of JSON
 * input" when the server returns an empty body or non-JSON content.
 */
async function safeJson(response) {
  const text = await response.text();
  if (!text || !text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    console.error("[auth] Failed to parse JSON response:", text.slice(0, 200));
    return null;
  }
}

/** Register (signup): sets HTTP-only JWT cookie; does not expose token to JS */
export const register = async ({ username, password }) => {
  const response = await authFetch("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });

  const data = await safeJson(response);

  if (!response.ok) {
    throw new Error(data?.error || "Registration failed");
  }

  if (!data) {
    throw new Error("Server returned an empty response");
  }

  return data;
};

export const login = async ({ username, password }) => {
  const response = await authFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });

  const data = await safeJson(response);

  if (!response.ok) {
    throw new Error(data?.error || "Login failed");
  }

  if (!data) {
    throw new Error("Server returned an empty response");
  }

  return data;
};

/** Clears JWT cookie on the server */
export const logout = async () => {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
  } catch {
    // still clear client state
  }
};

/** Uses session cookie sent automatically (credentials: include) */
export const getCurrentUser = async () => {
  try {
    const response = await fetch("/api/auth/me", {
      method: "GET",
      credentials: "include",
    });

    if (!response.ok) {
      return null;
    }

    const data = await safeJson(response);
    return data?.user || null;
  } catch {
    return null;
  }
};
