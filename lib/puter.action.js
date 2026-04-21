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

// ─── Project CRUD ─────────────────────────────────────────────────────────────

export const createProject = async ({ item, visibility = "private" }) => {
  try {
    console.log("[puter.action] createProject:", {
      id:          item.id,
      type:        item.type || "uploaded",
      hasSource:   !!item.sourceImage,
      hasRendered: !!item.renderedImage,
      hasLayout:   !!item.layoutJson,
    });

    const response = await authFetch("/api/projects", {
      method: "POST",
      body:   JSON.stringify({ project: item, visibility }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[puter.action] Failed to save project:", response.status, errText);
      return null;
    }

    const data  = await response.json();
    const saved = data?.project ?? null;

    console.log("[puter.action] createProject result:", {
      savedId:   saved?.id,
      savedType: saved?.type,
    });

    return saved;
  } catch (e) {
    console.error("[puter.action] Failed to save project:", e);
    return null;
  }
};

/** Lightweight update for auto-save — only sends changed fields */
export const updateProject = async ({ id, changes }) => {
  try {
    const response = await authFetch(`/api/projects/${encodeURIComponent(id)}`, {
      method: "PUT",
      body:   JSON.stringify(changes),
    });

    if (!response.ok) {
      console.error("[puter.action] Failed to update project:", response.status);
      return false;
    }

    return true;
  } catch (e) {
    console.error("[puter.action] Failed to update project:", e);
    return false;
  }
};

/**
 * Fetch projects. Pass { type: 'created' } or { type: 'uploaded' } to filter.
 * Omit the options or pass {} to get all projects.
 */
export const getProjects = async (options = {}) => {
  try {
    let url = "/api/projects";
    if (options.type) {
      url += `?type=${encodeURIComponent(options.type)}`;
    }

    const response = await authFetch(url, { method: "GET" });

    if (!response.ok) {
      console.error("[puter.action] Failed to fetch projects:", response.status);
      return [];
    }

    const data = await response.json();
    return Array.isArray(data?.projects) ? data.projects : [];
  } catch (e) {
    console.error("[puter.action] Failed to get projects:", e);
    return [];
  }
};

export const getProjectById = async ({ id }) => {
  try {
    console.log("[puter.action] getProjectById:", id);

    const response = await authFetch(
      `/api/projects/${encodeURIComponent(id)}`,
      { method: "GET" },
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("[puter.action] Failed to fetch project:", response.status, errText);
      return null;
    }

    const data    = await response.json();
    const project = data?.project ?? null;

    console.log("[puter.action] getProjectById result:", {
      id:          project?.id,
      type:        project?.type,
      hasSource:   !!project?.sourceImage,
      hasRendered: !!project?.renderedImage,
      hasLayout:   !!project?.layoutJson,
    });

    return project;
  } catch (e) {
    console.error("[puter.action] Failed to fetch project:", e);
    return null;
  }
};

export const deleteProject = async ({ id }) => {
  try {
    const response = await authFetch(
      `/api/projects/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );

    if (!response.ok) {
      console.error("[puter.action] Failed to delete project:", response.status);
      return false;
    }

    return true;
  } catch (e) {
    console.error("[puter.action] Failed to delete project:", e);
    return false;
  }
};

// ─── Render History ───────────────────────────────────────────────────────────

/** Save a rendered image to the project_renders table */
export const saveProjectRender = async ({ projectId, renderedImage }) => {
  try {
    const response = await authFetch(
      `/api/projects/${encodeURIComponent(projectId)}/renders`,
      {
        method: "POST",
        body:   JSON.stringify({ renderedImage }),
      },
    );

    if (!response.ok) {
      console.error("[puter.action] Failed to save render:", response.status);
      return false;
    }

    return true;
  } catch (e) {
    console.error("[puter.action] Failed to save render:", e);
    return false;
  }
};

/** Get all renders for a specific project */
export const getProjectRenders = async ({ projectId }) => {
  try {
    const response = await authFetch(
      `/api/projects/${encodeURIComponent(projectId)}/renders`,
      { method: "GET" },
    );

    if (!response.ok) {
      console.error("[puter.action] Failed to fetch renders:", response.status);
      return [];
    }

    const data = await response.json();
    return Array.isArray(data?.renders) ? data.renders : [];
  } catch (e) {
    console.error("[puter.action] Failed to get renders:", e);
    return [];
  }
};

/** Get ALL renders across all projects for the current user */
export const getAllRenders = async () => {
  try {
    const response = await authFetch("/api/projects/renders-all", { method: "GET" });

    if (!response.ok) {
      console.error("[puter.action] Failed to fetch all renders:", response.status);
      return [];
    }

    const data = await response.json();
    return Array.isArray(data?.renders) ? data.renders : [];
  } catch (e) {
    console.error("[puter.action] Failed to get all renders:", e);
    return [];
  }
};
/** Delete a single render record by its render ID */
export const deleteRender = async ({ renderId }) => {
  try {
    const response = await authFetch(
      `/api/projects/renders/${encodeURIComponent(renderId)}`,
      { method: 'DELETE' },
    );

    if (!response.ok) {
      console.error('[puter.action] Failed to delete render:', response.status);
      return false;
    }

    return true;
  } catch (e) {
    console.error('[puter.action] Failed to delete render:', e);
    return false;
  }
};