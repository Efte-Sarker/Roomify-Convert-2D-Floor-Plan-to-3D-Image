import { Router } from "express";
import { authMiddleware } from "../auth.js";
import pool from "../db.js";

const router = Router();

// POST /api/projects — create or update a project
router.post("/", authMiddleware, async (req, res) => {
  try {
    const { project } = req.body;

    if (!project?.id) {
      return res.status(400).json({ error: "Project ID is required" });
    }

    const srcLen    = project.sourceImage?.length || 0;
    const renderLen = project.renderedImage?.length || 0;

    console.log("[projects] POST save:", {
      id: project.id,
      userId: req.user.id,
      type: project.type || "uploaded",
      hasSource: !!project.sourceImage,
      srcLen,
      hasRendered: !!project.renderedImage,
      renderLen,
      hasLayout: !!project.layoutJson,
      payloadMB: ((srcLen + renderLen) / 1024 / 1024).toFixed(2) + " MB",
    });

    const projectName = project.name ? String(project.name).trim().slice(0, 500) : null;
    const projectType = project.type === "created" ? "created" : "uploaded";

    const [existingRows] = await pool.execute(
      "SELECT id FROM projects WHERE id = ? AND user_id = ?",
      [project.id, req.user.id],
    );

    if (existingRows.length > 0) {
      await pool.execute(
        `UPDATE projects SET
          name = ?,
          source_image = COALESCE(?, source_image),
          rendered_image = COALESCE(?, rendered_image),
          type = ?,
          layout_json = COALESCE(?, layout_json)
        WHERE id = ? AND user_id = ?`,
        [
          projectName,
          project.sourceImage || null,
          project.renderedImage || null,
          projectType,
          project.layoutJson || null,
          project.id,
          req.user.id,
        ],
      );
      console.log("[projects] Updated existing project:", project.id);
    } else {
      await pool.execute(
        `INSERT INTO projects (id, user_id, name, source_image, rendered_image, type, layout_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          project.id,
          req.user.id,
          projectName,
          project.sourceImage || null,
          project.renderedImage || null,
          projectType,
          project.layoutJson || null,
        ],
      );
      console.log("[projects] Inserted new project:", project.id, "type:", projectType);
    }

    const [savedRows] = await pool.execute(
      "SELECT * FROM projects WHERE id = ? AND user_id = ?",
      [project.id, req.user.id],
    );
    const saved = savedRows[0];

    if (!saved) {
      return res.status(500).json({ error: "Project saved but could not be retrieved" });
    }

    const formatted = formatProject(saved);
    console.log("[projects] Save confirmed:", {
      id: formatted.id,
      type: formatted.type,
      hasRendered: !!formatted.renderedImage,
      renderedLen: formatted.renderedImage?.length || 0,
    });

    return res.json({ project: formatted });
  } catch (error) {
    console.error("[projects] Save project ERROR:", {
      message: error.message,
      code: error.code,
      sqlMessage: error.sqlMessage,
      errno: error.errno,
    });
    return res.status(500).json({
      error: "Failed to save project",
      detail: error.code === "ER_NET_PACKET_TOO_LARGE"
        ? "MySQL max_allowed_packet is too small for this image. Restart the server — db.js now sets it to 64MB per session."
        : error.message,
    });
  }
});

// PUT /api/projects/:id — lightweight update for auto-save (layout_json, name, source_image)
router.put("/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, layoutJson, sourceImage } = req.body;

    // Verify ownership
    const [existing] = await pool.execute(
      "SELECT id FROM projects WHERE id = ? AND user_id = ?",
      [id, req.user.id],
    );
    if (existing.length === 0) {
      return res.status(404).json({ error: "Project not found" });
    }

    // Build dynamic SET clause — only update provided fields
    const sets = [];
    const params = [];

    if (name !== undefined) {
      sets.push("name = ?");
      params.push(name ? String(name).trim().slice(0, 500) : null);
    }
    if (layoutJson !== undefined) {
      sets.push("layout_json = ?");
      params.push(layoutJson || null);
    }
    if (sourceImage !== undefined) {
      sets.push("source_image = ?");
      params.push(sourceImage || null);
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    params.push(id, req.user.id);
    await pool.execute(
      `UPDATE projects SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`,
      params,
    );

    console.log("[projects] PUT auto-save:", { id, updatedFields: sets.length });
    return res.json({ updated: true, id });
  } catch (error) {
    console.error("[projects] PUT auto-save ERROR:", error.message);
    return res.status(500).json({ error: "Failed to update project" });
  }
});

// GET /api/projects — list current user's projects (optional ?type=created|uploaded)
router.get("/", authMiddleware, async (req, res) => {
  try {
    const typeFilter = req.query.type;
    let query = "SELECT * FROM projects WHERE user_id = ?";
    const params = [req.user.id];

    if (typeFilter === "created" || typeFilter === "uploaded") {
      query += " AND type = ?";
      params.push(typeFilter);
    }

    query += " ORDER BY updated_at DESC";

    const [projects] = await pool.execute(query, params);
    return res.json({ projects: projects.map(formatProject) });
  } catch (error) {
    console.error("List projects error:", error);
    return res.status(500).json({ error: "Failed to list projects" });
  }
});

// ── renders-all MUST be registered BEFORE /:id to avoid ":id" capturing it ──

// GET /api/projects/renders-all — get ALL renders for the current user (across all projects)
router.get("/renders-all", authMiddleware, async (req, res) => {
  try {
    const [renders] = await pool.execute(
      `SELECT pr.id, pr.project_id, pr.rendered_image, pr.created_at, p.name as project_name, p.source_image
       FROM project_renders pr
       JOIN projects p ON pr.project_id = p.id
       WHERE p.user_id = ?
       ORDER BY pr.created_at DESC`,
      [req.user.id],
    );

    return res.json({
      renders: renders.map(r => ({
        id: r.id,
        projectId: r.project_id,
        projectName: r.project_name,
        renderedImage: r.rendered_image,
        sourceImage: r.source_image,
        timestamp: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
      })),
    });
  } catch (error) {
    console.error("[projects] Get all renders ERROR:", error.message);
    return res.status(500).json({ error: "Failed to get renders" });
  }
});

// DELETE /api/projects/renders/:renderId — delete a single render record
// NOTE: Must be registered BEFORE /:id so Express does not capture "renders" as a project id
router.delete("/renders/:renderId", authMiddleware, async (req, res) => {
  try {
    const { renderId } = req.params;

    // Step 1: Verify ownership and get the project_id before deleting
    const [renderRows] = await pool.execute(
      `SELECT pr.id, pr.project_id
       FROM project_renders pr
       JOIN projects p ON pr.project_id = p.id
       WHERE pr.id = ? AND p.user_id = ?`,
      [renderId, req.user.id],
    );

    if (renderRows.length === 0) {
      return res.status(404).json({ error: "Render not found" });
    }
    const projectId = renderRows[0].project_id;

    // Step 2: Delete the render record
    await pool.execute(
      `DELETE FROM project_renders WHERE id = ?`,
      [renderId],
    );

    // Step 3: Sync projects.rendered_image to the next most-recent render,
    // or NULL if no renders remain. This prevents stale cache in the visualizer.
    const [remaining] = await pool.execute(
      `SELECT rendered_image FROM project_renders WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`,
      [projectId],
    );

    const newRenderedImage = remaining.length > 0 ? remaining[0].rendered_image : null;
    await pool.execute(
      `UPDATE projects SET rendered_image = ? WHERE id = ?`,
      [newRenderedImage, projectId],
    );

    console.log("[projects] Deleted render:", renderId, "| project rendered_image updated for project:", projectId);
    return res.json({ deleted: true });
  } catch (error) {
    console.error("Delete render error:", error);
    return res.status(500).json({ error: "Failed to delete render" });
  }
});

// GET /api/projects/:id — get a single project (must belong to current user)
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      "SELECT * FROM projects WHERE id = ? AND user_id = ?",
      [req.params.id, req.user.id],
    );
    const project = rows[0];

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const formatted = formatProject(project);
    console.log("[projects] GET by id:", {
      id: formatted.id,
      type: formatted.type,
      hasRendered: !!formatted.renderedImage,
      renderedLen: formatted.renderedImage?.length || 0,
      hasLayout: !!formatted.layoutJson,
    });

    return res.json({ project: formatted });
  } catch (error) {
    console.error("Get project error:", error.message || error);
    return res.status(500).json({ error: "Failed to get project" });
  }
});

// ─── Render History ────────────────────────────────────────────────────────────

// POST /api/projects/:id/renders — save a new render for the project
router.post("/:id/renders", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { renderedImage } = req.body;

    if (!renderedImage) {
      return res.status(400).json({ error: "renderedImage is required" });
    }

    // Verify project ownership
    const [existing] = await pool.execute(
      "SELECT id FROM projects WHERE id = ? AND user_id = ?",
      [id, req.user.id],
    );
    if (existing.length === 0) {
      return res.status(404).json({ error: "Project not found" });
    }

    // Insert into project_renders
    await pool.execute(
      "INSERT INTO project_renders (project_id, rendered_image) VALUES (?, ?)",
      [id, renderedImage],
    );

    // Also update the project's rendered_image with the latest render
    await pool.execute(
      "UPDATE projects SET rendered_image = ? WHERE id = ? AND user_id = ?",
      [renderedImage, id, req.user.id],
    );

    console.log("[projects] Saved render for project:", id, "imageLen:", renderedImage.length);
    return res.json({ saved: true });
  } catch (error) {
    console.error("[projects] Save render ERROR:", error.message);
    return res.status(500).json({ error: "Failed to save render" });
  }
});

// GET /api/projects/:id/renders — get render history for a project
router.get("/:id/renders", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify project ownership
    const [existing] = await pool.execute(
      "SELECT id, name FROM projects WHERE id = ? AND user_id = ?",
      [id, req.user.id],
    );
    if (existing.length === 0) {
      return res.status(404).json({ error: "Project not found" });
    }

    const [renders] = await pool.execute(
      "SELECT id, project_id, rendered_image, created_at FROM project_renders WHERE project_id = ? ORDER BY created_at DESC",
      [id],
    );

    return res.json({
      renders: renders.map(r => ({
        id: r.id,
        projectId: r.project_id,
        projectName: existing[0].name,
        renderedImage: r.rendered_image,
        timestamp: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
      })),
    });
  } catch (error) {
    console.error("[projects] Get renders ERROR:", error.message);
    return res.status(500).json({ error: "Failed to get renders" });
  }
});

// DELETE /api/projects/:id
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const [result] = await pool.execute(
      "DELETE FROM projects WHERE id = ? AND user_id = ?",
      [req.params.id, req.user.id],
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Project not found" });
    }
    return res.json({ deleted: true });
  } catch (error) {
    console.error("Delete project error:", error);
    return res.status(500).json({ error: "Failed to delete project" });
  }
});

function formatProject(row) {
  if (!row) return null;
  const created = row.created_at ? new Date(row.created_at).getTime() : Date.now();
  const updated = row.updated_at ? new Date(row.updated_at).getTime() : created;
  return {
    id: row.id,
    name: row.name || null,
    sourceImage: row.source_image || null,
    renderedImage: row.rendered_image || null,
    type: row.type || "uploaded",
    layoutJson: row.layout_json || null,
    timestamp: updated,
    createdAt: created,
    ownerId: row.user_id,
  };
}

export default router;