import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "roomify-dev-secret-change-in-production";

export const AUTH_COOKIE_NAME = "roomify_token";

/** JWT and cookie lifetime — keep in sync */
const JWT_EXPIRES = "15d";
const COOKIE_MAX_AGE_MS = 15 * 24 * 60 * 60 * 1000;

function isSecureCookie() {
  if (process.env.COOKIE_SECURE === "true") return true;
  if (process.env.COOKIE_SECURE === "false") return false;
  return process.env.NODE_ENV === "production";
}

/** Base options shared by set and clear (browsers require matching attributes) */
export function getAuthCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict",
    secure: isSecureCookie(),
    path: "/",
    maxAge: COOKIE_MAX_AGE_MS,
  };
}

export function generateToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES,
  });
}

export function setAuthCookie(res, token) {
  res.cookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions());
}

export function clearAuthCookie(res) {
  const o = getAuthCookieOptions();
  res.clearCookie(AUTH_COOKIE_NAME, {
    path: o.path,
    httpOnly: o.httpOnly,
    sameSite: o.sameSite,
    secure: o.secure,
  });
}

function getTokenFromRequest(req) {
  const fromCookie = req.cookies?.[AUTH_COOKIE_NAME];
  if (fromCookie) return fromCookie;
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return null;
}

export function authMiddleware(req, res, next) {
  const token = getTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function optionalAuth(req, _res, next) {
  const token = getTokenFromRequest(req);
  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET);
    } catch {
      // ignore invalid token
    }
  }
  next();
}
