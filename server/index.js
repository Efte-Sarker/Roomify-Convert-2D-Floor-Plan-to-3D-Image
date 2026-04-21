import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import pool, { initDb, logDbDiagnostics, logPoolConfig, logServerIdentity } from "./db.js";
import authRoutes from "./routes/auth.js";
import projectRoutes from "./routes/projects.js";
import uploadRoutes from "./routes/upload.js";
import renderRoutes from "./routes/render.js";
import { UPLOADS_DIR } from "./routes/upload.js";


const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3001;

/** Origins allowed to send cookies (browser + credentials). */
const defaultOrigins = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000";
const allowedOrigins = (process.env.CORS_ORIGINS || defaultOrigins)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
  }),
);

app.use(cookieParser());
app.use(express.json({ limit: "60mb" }));
app.use(express.urlencoded({ extended: true, limit: "60mb" }));

app.use("/api/uploads", express.static(UPLOADS_DIR));

app.use("/api/auth", authRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/render", renderRoutes);


app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      status: "ok",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    res.status(503).json({
      status: "degraded",
      database: "disconnected",
      error: e.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// ── Global error handler — always returns valid JSON ────────────────────────
// Express 5 requires 4-argument signature: (err, req, res, next).
// This catches any unhandled errors (bad JSON body, crashed middleware, etc.)
// and guarantees the frontend never receives an empty or non-JSON response.
app.use((err, _req, res, _next) => {
  // JSON parse error from express.json() middleware
  if (err.type === "entity.parse.failed") {
    console.error("[server] Bad JSON in request body:", err.message);
    return res.status(400).json({ error: "Invalid JSON in request body" });
  }

  console.error("[server] Unhandled error:", err.message || err);
  const status = err.status || err.statusCode || 500;
  return res.status(status).json({
    error: err.message || "Internal server error",
  });
});

async function start() {
  logPoolConfig();
  try {
    await initDb();
    console.log("  ✓  MySQL tables ready (users, projects, project_renders)");
    await logServerIdentity();
    await logDbDiagnostics();
  } catch (err) {
    console.error("\n  ✗  MySQL connection failed:", err.message);
    console.error("     Create database `roomify` in phpMyAdmin, check server/.env (see server/.env.example)\n");
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`\n  ✓  Roomify API server running at http://localhost:${PORT}`);
    console.log(`     Auth: JWT in HTTP-only cookie (15d), SameSite=Strict`);
    console.log(`     Routes:`);
    console.log(`       POST /api/auth/register  |  POST /api/auth/signup`);
    console.log(`       POST /api/auth/login`);
    console.log(`       POST /api/auth/logout`);
    console.log(`       GET  /api/auth/me`);
    console.log(`       GET  /api/projects           (?type=created|uploaded)`);
    console.log(`       POST /api/projects`);
    console.log(`       GET  /api/projects/:id`);
    console.log(`       PUT  /api/projects/:id        (auto-save)`);
    console.log(`       DELETE /api/projects/:id`);
    console.log(`       POST /api/projects/:id/renders`);
    console.log(`       GET  /api/projects/:id/renders`);
    console.log(`       GET  /api/projects/renders-all`);
    console.log(`       POST /api/upload`);
    console.log(`       POST /api/render`);
    console.log(`       GET  /api/health\n`);
  });
}

start();
