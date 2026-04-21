import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import pool, { DB_NAME, qualifiedUsers } from "../db.js";
import {
  authMiddleware,
  generateToken,
  setAuthCookie,
  clearAuthCookie,
} from "../auth.js";

const router = Router();

const SALT_ROUNDS = 12;

/**
 * mysql2: pool.query / pool.execute resolve to [rows, fields].
 * Always read rows as result[0] and ensure we treat it as an array.
 */
function getRows(result) {
  if (!result || !Array.isArray(result)) {
    console.error("[auth] unexpected query result shape:", typeof result, result);
    return [];
  }
  const rows = result[0];
  if (!Array.isArray(rows)) {
    console.error("[auth] result[0] is not an array:", rows);
    return [];
  }
  return rows;
}

/** COUNT(*) → safe non-negative integer; never NaN (treat as 0). */
function toSafeUserCount(raw) {
  if (raw == null) return 0;
  const n = typeof raw === "bigint" ? Number(raw) : Number(raw);
  if (!Number.isFinite(n)) return 0;
  const t = Math.trunc(n);
  return t < 0 ? 0 : t;
}

async function signupOrRegister(req, res) {
  try {
    const usernameRaw = req.body?.username;
    const passwordRaw = req.body?.password;
    const username =
      typeof usernameRaw === "string" ? usernameRaw.trim() : String(usernameRaw ?? "").trim();
    const password = typeof passwordRaw === "string" ? passwordRaw : String(passwordRaw ?? "");

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }

    if (username.length < 3) {
      return res.status(400).json({ error: "Username must be at least 3 characters" });
    }

    if (password.length < 4) {
      return res.status(400).json({ error: "Password must be at least 4 characters" });
    }

    // Read [rows, fields] explicitly; COUNT(*) → one row with cnt (alias may vary by driver)
    const countTuple = await pool.execute(
      "SELECT COUNT(*) AS cnt FROM users WHERE username = ?",
      [username],
    );
    const rowsPacket = Array.isArray(countTuple) ? countTuple[0] : null;
    const rowList = Array.isArray(rowsPacket) ? rowsPacket : [];
    const firstRow = rowList[0];
    const rawCnt =
      firstRow && typeof firstRow === "object"
        ? firstRow.cnt ?? firstRow.CNT ?? Object.values(firstRow)[0]
        : undefined;

    const existingCount = toSafeUserCount(rawCnt);

    console.log("[auth/register] existingCount check:", {
      rawCnt,
      rawCntType: rawCnt === null || rawCnt === undefined ? "nullish" : typeof rawCnt,
      existingCount,
      existingCountType: typeof existingCount,
      willBlock: existingCount >= 1,
      rowListLength: rowList.length,
    });

    // Only reject when there is at least one matching row (integer count >= 1)
    if (existingCount >= 1) {
      console.log("[auth/register] reject: username already exists (existingCount >= 1)");
      return res.status(409).json({ error: "Username already taken" });
    }

    const id = crypto.randomUUID();
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    const insertResult = await pool.execute(
      `INSERT INTO ${qualifiedUsers} (id, username, password) VALUES (?, ?, ?)`,
      [id, username, hashedPassword],
    );
    const insertMeta = insertResult[0];
    console.log("[auth/register] insert result:", {
      affectedRows: insertMeta?.affectedRows,
      insertId: insertMeta?.insertId,
      warningStatus: insertMeta?.warningStatus,
    });

    const [dbAfter] = await pool.query("SELECT DATABASE() AS db");
    const [insertedRows] = await pool.query(
      `SELECT id, username, created_at FROM ${qualifiedUsers} WHERE id = ?`,
      [id],
    );
    const [totalAfter] = await pool.query(`SELECT COUNT(*) AS total FROM ${qualifiedUsers}`);
    console.log("[auth/register] post-insert verify (same pool phpMyAdmin should match):", {
      SELECT_DATABASE: dbAfter[0]?.db,
      insertedRow: insertedRows[0] ?? null,
      totalUsersInTable: totalAfter[0]?.total,
      table: qualifiedUsers,
    });

    const user = { id, username };
    const token = generateToken(user);
    setAuthCookie(res, token);

    return res.status(201).json({ user });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      console.log("[auth/register] duplicate key on insert:", error.sqlMessage);
      return res.status(409).json({ error: "Username already taken" });
    }
    console.error("Registration error:", error);
    return res.status(500).json({ error: "Registration failed" });
  }
}

// POST /api/auth/register
router.post("/register", signupOrRegister);

// POST /api/auth/signup — same as register
router.post("/signup", signupOrRegister);

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const usernameRaw = req.body?.username;
    const passwordRaw = req.body?.password;
    const username =
      typeof usernameRaw === "string" ? usernameRaw.trim() : String(usernameRaw ?? "").trim();
    const password = typeof passwordRaw === "string" ? passwordRaw : String(passwordRaw ?? "");

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }

    const loginResult = await pool.execute(`SELECT * FROM ${qualifiedUsers} WHERE username = ?`, [
      username,
    ]);
    const rows = getRows(loginResult);
    const user = rows[0];

    console.log("[auth/login] lookup:", {
      searchedUsername: username,
      userFound: !!user,
      storedUsername: user?.username ?? null,
      passwordFieldLength: user?.password?.length ?? 0,
    });

    if (!user) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    console.log("[auth/login] bcrypt.compare result:", passwordMatch);

    if (!passwordMatch) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const token = generateToken({ id: user.id, username: user.username });
    setAuthCookie(res, token);

    console.log("[auth/login] SUCCESS for user:", user.username);
    return res.json({ user: { id: user.id, username: user.username } });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ error: "Login failed" });
  }
});

// POST /api/auth/logout — clear HTTP-only cookie
router.post("/logout", (_req, res) => {
  clearAuthCookie(res);
  return res.json({ ok: true });
});

// GET /api/auth/me
router.get("/me", authMiddleware, async (req, res) => {
  try {
    const meResult = await pool.execute(
      `SELECT id, username, created_at FROM ${qualifiedUsers} WHERE id = ?`,
      [req.user.id],
    );
    const rows = getRows(meResult);
    const user = rows[0];

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json({ user });
  } catch (error) {
    console.error("Auth me error:", error);
    return res.status(500).json({ error: "Failed to load user" });
  }
});

export default router;
