/**
 * ai.action.js
 * Client-side helpers for the AI render pipeline.
 *
 * Two distinct rendering paths:
 *  A) UPLOADED 2D IMAGE  → image-to-image, generic prompt (unchanged)
 *  B) EDITOR-DRAWN PLAN  → text-to-image using structured layout data (precision path)
 *
 * Path B does NOT send the PNG image to the AI.
 * The structured text description is the ONLY input, eliminating visual ambiguity.
 */

export const fetchAsDataUrl = async (url) => {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror   = reject;
    reader.readAsDataURL(blob);
  });
};

const optimizeImage = async (dataUrl, maxWidth = 1024, quality = 0.85) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      if (width > maxWidth || height > maxWidth) {
        if (width > height) { height = Math.round(height * maxWidth / width); width = maxWidth; }
        else                { width  = Math.round(width  * maxWidth / height); height = maxWidth; }
      }
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('Failed to load image for optimization'));
    img.src = dataUrl;
  });
};

/**
 * Build a precise, structured text description from the editor's layoutJson.
 * This is used as the sole input for the precision rendering path.
 */
export const buildLayoutDescription = (layoutJson) => {
  try {
    const state = typeof layoutJson === 'string' ? JSON.parse(layoutJson) : layoutJson;
    if (!state?.rooms?.length) return null;

    const { rooms, doors = [], windows = [], furniture = [], floor, unit } = state;
    const FT     = 3.281;
    // Internal values are always in metres; convert to ft for the description
    const toFt   = (m) => (m * FT).toFixed(1);

    let desc = '';

    // Floor
    desc += `FLOOR: ${toFt(floor.w)} ft wide x ${toFt(floor.h)} ft deep\n\n`;

    // Rooms
    desc += `ROOMS (${rooms.length}):\n`;
    for (const r of rooms) {
      desc += `  - "${r.name}" [${r.type}] | ${toFt(r.w)} x ${toFt(r.d)} ft`;
      desc += ` | position: (${toFt(r.x)}, ${toFt(r.z)}) from top-left\n`;
    }

    // Doors
    desc += `\nDOORS: `;
    if (doors.length === 0) {
      desc += `NONE. All walls must be completely solid. No door openings, no door frames, no door arcs anywhere.\n`;
    } else {
      desc += `${doors.length} total.\n`;
      for (const d of doors) {
        const rm = rooms.find(r => r.id === d.roomId);
        desc += `  - Room "${rm?.name ?? '?'}" | ${d.wall} wall | ${Math.round(d.position * 100)}% along wall\n`;
      }
    }

    // Windows
    desc += `\nWINDOWS: `;
    if (windows.length === 0) {
      desc += `NONE. No window openings, no glass elements, no wall cutouts anywhere.\n`;
    } else {
      desc += `${windows.length} total.\n`;
      for (const w of windows) {
        const rm = rooms.find(r => r.id === w.roomId);
        desc += `  - Room "${rm?.name ?? '?'}" | ${w.wall} wall | ${Math.round(w.position * 100)}% along wall\n`;
      }
    }

    // Furniture
    desc += `\nFURNITURE: `;
    if (furniture.length === 0) {
      desc += `NONE. Every room must be completely empty. Do not place any objects regardless of room type.\n`;
      desc += `  - Bathrooms: empty tiled floor and walls. No toilet, no sink, no tub.\n`;
      desc += `  - Kitchens: empty floor and walls. No counters, no appliances.\n`;
      desc += `  - Bedrooms: empty floor. No bed, no wardrobe.\n`;
    } else {
      desc += `${furniture.length} items total.\n`;
      for (const f of furniture) {
        const rm = rooms.find(r =>
          f.x >= r.x && f.x < r.x + r.w &&
          f.z >= r.z && f.z < r.z + r.d
        );
        const label = f.type.replace(/_/g, ' ');
        desc += `  - "${label}" in room "${rm?.name ?? 'floor'}"`;
        desc += ` | x=${toFt(f.x)}, y=${toFt(f.z)}, rotation=${f.rotation ?? 0} degrees\n`;
      }
      // List rooms that explicitly have NO furniture
      const furnishedRoomIds = new Set(furniture.map(f => {
        const rm = rooms.find(r => f.x >= r.x && f.x < r.x + r.w && f.z >= r.z && f.z < r.z + r.d);
        return rm?.id;
      }).filter(Boolean));
      const emptyRooms = rooms.filter(r => !furnishedRoomIds.has(r.id));
      if (emptyRooms.length > 0) {
        desc += `\n  EMPTY ROOMS (no furniture at all): ${emptyRooms.map(r => `"${r.name}"`).join(', ')}\n`;
        desc += `  These rooms must be rendered with empty floors — no objects of any kind.\n`;
      }
    }

    return desc;
  } catch (e) {
    console.error('[ai.action] buildLayoutDescription failed:', e);
    return null;
  }
};

/**
 * generate3DView
 *
 * For editor-drawn plans (layoutJson provided):
 *   Sends ONLY the structured text description (no image) to eliminate visual ambiguity.
 *   The AI generates the render from exact specification.
 *
 * For uploaded 2D images (no layoutJson):
 *   Sends the image as usual with the generic prompt — this path is unchanged.
 *
 * @param {string}       sourceImage  - base64 data URL of the floor plan image
 * @param {string|object} [layoutJson] - optional raw layoutJson from the editor
 */
export const generate3DView = async ({ sourceImage, layoutJson }) => {
  // Build layout description for editor plans
  const layoutDescription = layoutJson ? buildLayoutDescription(layoutJson) : null;

  console.log('[ai.action] Sending to Gemini render route…', {
    mode: layoutDescription ? 'text-only precision' : 'image-to-image generic',
  });

  let body;

  if (layoutDescription) {
    // PRECISION PATH (editor plans): text-only, no image sent
    // The structured description completely specifies the layout.
    body = JSON.stringify({ layoutDescription });
  } else {
    // GENERIC PATH (uploaded images): image-to-image, unchanged
    let dataUrl = sourceImage.startsWith('data:')
      ? sourceImage
      : await fetchAsDataUrl(sourceImage);

    try {
      if (typeof window !== 'undefined') {
        dataUrl = await optimizeImage(dataUrl, 1024, 0.85);
      }
    } catch (e) {
      console.warn('[ai.action] Image optimization failed — sending original:', e.message);
    }

    body = JSON.stringify({ sourceImage: dataUrl });
  }

  let renderResponse;
  try {
    renderResponse = await fetch('/api/render', {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
      body,
    });
  } catch (networkErr) {
    throw new Error('Could not reach the render server: ' + networkErr.message);
  }

  if (!renderResponse.ok) {
    const errData = await renderResponse.json().catch(() => ({}));
    const msg = errData?.error || `Render server returned ${renderResponse.status}`;
    if (renderResponse.status === 429) throw new Error('RATE_LIMITED: ' + msg);
    if (renderResponse.status === 503) throw new Error(
      'Gemini API key is not configured on the server. Add GEMINI_API_KEY to server/.env'
    );
    throw new Error(msg);
  }

  const { renderedImage } = await renderResponse.json();
  if (!renderedImage) throw new Error('Gemini returned a response but no image was produced.');

  return { renderedImage, renderedPath: undefined };
};