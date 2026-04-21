import "./env.js";
import mysql from "mysql2/promise";

export const DB_NAME = process.env.DB_NAME || "roomify";

const defaultHost =
  process.env.DB_HOST || (process.platform === "win32" ? "127.0.0.1" : "localhost");

const poolConfig = {
  host: defaultHost,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD ?? "",
  port: Number(process.env.DB_PORT || 3306),
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

const pool = mysql.createPool(poolConfig);

function safeIdent(name) {
  return "`" + String(name).replace(/`/g, "") + "`";
}

const qualifiedUsers = `${safeIdent(DB_NAME)}.${safeIdent("users")}`;

pool.on("connection", (conn) => {
  // Raise max_allowed_packet to 64MB so large base64 images save correctly.
  // The default (1MB or 16MB) is too small for AI-rendered images.
  conn.query("SET SESSION max_allowed_packet = 67108864", (err) => {
    if (err) console.error("[db] SET max_allowed_packet failed:", err.message);
    else console.log("[db] max_allowed_packet set to 64MB for this connection");
  });
  conn.query("SET SESSION autocommit = 1", (err) => {
    if (err) console.error("[db] SET autocommit=1 failed:", err.message);
  });
});

export function logPoolConfig() {
  console.log("[db] pool config (password hidden):", {
    host: poolConfig.host,
    port: poolConfig.port,
    user: poolConfig.user,
    database: poolConfig.database,
  });
}

export async function logServerIdentity() {
  try {
    const [rows] = await pool.query(
      `SELECT 
        DATABASE() AS current_db,
        @@hostname AS server_hostname,
        @@port AS server_port,
        @@version AS version,
        @@autocommit AS autocommit,
        @@max_allowed_packet AS max_packet,
        CONNECTION_ID() AS connection_id`,
    );
    const r = rows[0];
    console.log("[db] MySQL session:", {
      DATABASE: r.current_db,
      expectedDb: DB_NAME,
      server_hostname: r.server_hostname,
      server_port: r.server_port,
      version: r.version,
      autocommit: r.autocommit,
      max_allowed_packet: r.max_packet,
      connection_id: r.connection_id,
    });
  } catch (e) {
    console.error("[db] logServerIdentity failed:", e.message);
  }
}

export async function logDbDiagnostics() {
  try {
    const [dbRows] = await pool.query("SELECT DATABASE() AS current_db");
    const currentDb = dbRows[0]?.current_db;
    const [countRows] = await pool.query(`SELECT COUNT(*) AS user_count FROM ${qualifiedUsers}`);
    const userCount = countRows[0]?.user_count;
    console.log(
      `[db] DATABASE()="${currentDb}" | expected DB_NAME="${DB_NAME}" | ${qualifiedUsers} row count=${userCount}`,
    );
    if (String(currentDb).toLowerCase() !== String(DB_NAME).toLowerCase()) {
      console.warn(
        `[db] WARNING: Connected schema does not match DB_NAME. Check server/.env (DB_NAME=${DB_NAME}).`,
      );
    }
  } catch (e) {
    console.error("[db] diagnostics failed:", e.message);
  }
}

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${qualifiedUsers} (
      id CHAR(36) NOT NULL PRIMARY KEY,
      username VARCHAR(255) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const qualifiedProjects = `${safeIdent(DB_NAME)}.${safeIdent("projects")}`;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${qualifiedProjects} (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      name VARCHAR(500) DEFAULT NULL,
      source_image LONGTEXT,
      rendered_image LONGTEXT,
      visibility ENUM('private', 'public') NOT NULL DEFAULT 'private',
      type ENUM('uploaded', 'created') NOT NULL DEFAULT 'uploaded',
      layout_json LONGTEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_projects_user FOREIGN KEY (user_id) REFERENCES ${qualifiedUsers}(id) ON DELETE CASCADE,
      INDEX idx_projects_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // ── Idempotent migrations for existing databases ─────────────────────────
  // Add type column if missing (existing rows default to 'uploaded')
  try { await pool.query(`ALTER TABLE ${qualifiedProjects} ADD COLUMN type ENUM('uploaded','created') NOT NULL DEFAULT 'uploaded'`); console.log("[db] Added column: type"); }
  catch (e) { if (e.code !== "ER_DUP_FIELDNAME") throw e; }

  // Add layout_json column if missing
  try { await pool.query(`ALTER TABLE ${qualifiedProjects} ADD COLUMN layout_json LONGTEXT DEFAULT NULL`); console.log("[db] Added column: layout_json"); }
  catch (e) { if (e.code !== "ER_DUP_FIELDNAME") throw e; }

  // Add updated_at column if missing (old tables may not have it)
  try { await pool.query(`ALTER TABLE ${qualifiedProjects} ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`); console.log("[db] Added column: updated_at"); }
  catch (e) { if (e.code !== "ER_DUP_FIELDNAME") throw e; }

  // Make source_image nullable (editor-created projects may not have a PNG yet)
  try { await pool.query(`ALTER TABLE ${qualifiedProjects} MODIFY COLUMN source_image LONGTEXT DEFAULT NULL`); }
  catch { /* ignore — column already nullable or doesn't exist */ }

  // Ensure projects table uses utf8mb4 so FK from project_renders can match
  try { await pool.query(`ALTER TABLE ${qualifiedProjects} CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); }
  catch { /* ignore */ }

  // ── project_renders table ────────────────────────────────────────────────
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${safeIdent(DB_NAME)}.${safeIdent("project_renders")} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        project_id VARCHAR(64) NOT NULL,
        rendered_image LONGTEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_renders_project FOREIGN KEY (project_id) REFERENCES ${qualifiedProjects}(id) ON DELETE CASCADE,
        INDEX idx_renders_project (project_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } catch (e) {
    // If FK still fails, create without FK and log warning
    if (e.errno === 150 || e.code === "ER_FK_CANNOT_OPEN_PARENT" || String(e.message).includes("errno: 150")) {
      console.warn("[db] FK constraint failed, creating project_renders without FK...");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${safeIdent(DB_NAME)}.${safeIdent("project_renders")} (
          id INT AUTO_INCREMENT PRIMARY KEY,
          project_id VARCHAR(64) NOT NULL,
          rendered_image LONGTEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_renders_project (project_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    } else {
      throw e;
    }
  }
}

export { qualifiedUsers };
export default pool;