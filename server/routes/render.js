import { Router } from 'express';
import { authMiddleware } from '../auth.js';

const router = Router();

let lastRenderTime = 0;
const RENDER_COOLDOWN_MS = 35_000;

// ── Generic prompt — for uploaded 2D images (no structured layout data) ──────
// This pipeline must remain COMPLETELY UNCHANGED and fully functional.
const RENDER_PROMPT_IMAGE_ONLY = `
TASK: Convert the input 2D floor plan into a photorealistic, top-down 3D architectural render.

STRICT REQUIREMENTS:
1) GEOMETRY MUST MATCH: Walls, rooms, doors, and windows must follow the exact lines and positions shown in the image.
2) TOP-DOWN ONLY: Orthographic top-down view. No perspective tilt.
3) CLEAN, REALISTIC OUTPUT: Crisp edges, balanced lighting, and realistic materials.
4) NO EXTRA CONTENT: Do not add rooms, furniture, or objects not clearly shown in the plan.
5) REMOVE ALL TEXT: Do not render any letters, numbers, labels, or annotations.

STRUCTURE:
- Walls: Extrude precisely from the plan lines.
- Doors: Convert door swing arcs shown in the plan into open doors.
- Windows: Convert thin perimeter lines into realistic glass windows.

FURNITURE (only render items clearly visible as icons/symbols in the plan):
- Bed icon → realistic bed with duvet and pillows.
- Sofa icon → modern sectional or sofa.
- Dining table icon → table with chairs.
- Kitchen icon → counters with sink and stove.
- Bathroom fixtures → only if clearly shown in the plan.

STYLE:
- Bright, neutral daylight. High clarity and balanced contrast.
- Realistic wood or tile floors, clean walls, subtle shadows.
- Professional architectural visualization. No text, no watermarks.
`.trim();

// ── Precision text-to-image prompt — for editor-drawn plans ──────────────────
// This generates a 3D render purely from the structured layout description.
// No floor plan image is sent — the text is the complete specification.
const buildPrecisionTextPrompt = (layoutDescription) => `
TASK: Generate a photorealistic, top-down 3D architectural render of a floor plan using ONLY the exact specifications below.

FLOOR PLAN SPECIFICATION:
${layoutDescription}

RENDERING RULES — FOLLOW EXACTLY WITH ZERO DEVIATION:

VIEW: Strict orthographic top-down view. No perspective tilt.

WALLS: Render all room boundaries as solid extruded walls with clean white surfaces.

DOORS:
- Render ONLY the doors explicitly listed in the specification above.
- If DOORS: NONE — render ZERO door openings. Every wall is 100% solid. No gaps, no frames.
- Do NOT infer doors from room types or adjacency.

WINDOWS:
- Render ONLY the windows explicitly listed in the specification above.
- If WINDOWS: NONE — render ZERO window openings. Every exterior wall is solid.
- Do NOT add skylights, glass elements, or any wall transparency.

FURNITURE AND FIXTURES — THIS IS THE MOST CRITICAL RULE:
- Place ONLY the furniture items explicitly listed in the specification above.
- If FURNITURE: NONE — every room must be completely empty. Render only walls and floors.
- EMPTY ROOMS listed in the specification must have zero objects on the floor.
- Do NOT add default fixtures based on room type. Examples:
    * A "Bathroom" room with no furniture listed = empty tiled room. No toilet, no sink, no bathtub.
    * A "Kitchen" room with no furniture listed = empty room. No counters, no appliances, no sink.
    * A "Bedroom" room with no furniture listed = empty room. No bed, no wardrobe.
- Only place items that are EXPLICITLY NAMED in the furniture list.
- Place each listed item at the specified position and rotation.

FLOORS: Use realistic materials — wood for living/bedroom/dining, tile for bathroom/kitchen.
LIGHTING: Bright neutral daylight, subtle shadows, high clarity.
QUALITY: Professional architectural visualization. Clean, crisp, no labels, no watermarks.
`.trim();

// Current working model for multimodal generation
const GEMINI_MODEL = 'gemini-3-pro-image-preview';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const TIMEOUT_MS = 120_000; // 2 minutes

// POST /api/render — generate a photorealistic 3D render from a 2D floor plan
router.post('/', authMiddleware, async (req, res) => {
  try {
    // ── Rate limit ────────────────────────────────────────────────────────────
    const now = Date.now();
    const timeSinceLast = now - lastRenderTime;
    if (timeSinceLast < RENDER_COOLDOWN_MS) {
      const waitSeconds = Math.ceil((RENDER_COOLDOWN_MS - timeSinceLast) / 1000);
      return res.status(429).json({
        error: `Please wait ${waitSeconds} seconds before rendering again.`,
        retryAfter: waitSeconds,
      });
    }

    const oldRenderTime = lastRenderTime;
    lastRenderTime = Date.now();

    const { floorPlanDescription, sourceImage, layoutDescription } = req.body;

    if (!floorPlanDescription && !sourceImage && !layoutDescription) {
      lastRenderTime = oldRenderTime;
      return res.status(400).json({ error: 'sourceImage, layoutDescription, or floorPlanDescription is required.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      lastRenderTime = oldRenderTime;
      return res.status(503).json({ error: 'AI rendering is not configured. Add GEMINI_API_KEY to server/.env.' });
    }

    // ── Build request parts ───────────────────────────────────────────────────
    let requestParts;

    if (layoutDescription) {
      // ── PRECISION PATH: text-only for editor-drawn plans ──────────────────
      // No image is sent — the structured text description IS the full input.
      // This eliminates visual ambiguity and produces exact results.
      console.log(`[render] precision text-to-image | user=${req.user?.id} | descLen=${layoutDescription.length}`);
      requestParts = [
        { text: buildPrecisionTextPrompt(layoutDescription) },
      ];

    } else if (floorPlanDescription) {
      // ── LEGACY TEXT PATH (unchanged) ──────────────────────────────────────
      console.log(`[render] legacy text-to-image | user=${req.user?.id}`);
      requestParts = [
        { text: `${RENDER_PROMPT_IMAGE_ONLY}\n\nFLOOR PLAN DESCRIPTION:\n${floorPlanDescription}` },
      ];

    } else {
      // ── GENERIC IMAGE PATH: for uploaded 2D floor plan images (unchanged) ─
      if (!sourceImage.startsWith('data:')) {
        lastRenderTime = oldRenderTime;
        return res.status(400).json({ error: 'sourceImage must be a base64 data URL.' });
      }

      const commaIndex = sourceImage.indexOf(',');
      const meta = sourceImage.slice(0, commaIndex);
      const base64Data = sourceImage.slice(commaIndex + 1);
      const mimeType = meta.split(';')[0].split(':')[1];

      console.log(`[render] generic image-to-image | user=${req.user?.id} | mime=${mimeType}`);
      requestParts = [
        { text: RENDER_PROMPT_IMAGE_ONLY },
        { inline_data: { mime_type: mimeType, data: base64Data } },
      ];
    }

    // ── Call Gemini ───────────────────────────────────────────────────────────
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let geminiResponse;
    try {
      geminiResponse = await fetch(GEMINI_API_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: requestParts }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
        }),
      });
    } catch (fetchErr) {
      lastRenderTime = oldRenderTime;
      clearTimeout(timeoutId);
      if (fetchErr.name === 'AbortError') return res.status(504).json({ error: 'AI rendering timed out. Please try again.' });
      console.error('[render] Fetch to Gemini failed:', fetchErr.message);
      return res.status(502).json({ error: 'Could not reach Gemini API.' });
    }
    clearTimeout(timeoutId);

    // ── Handle HTTP errors ────────────────────────────────────────────────────
    if (!geminiResponse.ok) {
      lastRenderTime = oldRenderTime;
      const errorBody = await geminiResponse.text();
      console.error(`[render] Gemini HTTP ${geminiResponse.status}:`, errorBody);
      if (geminiResponse.status === 429) return res.status(429).json({ error: 'Gemini rate limit reached. Please wait and retry.' });
      if (geminiResponse.status === 401 || geminiResponse.status === 403) return res.status(403).json({ error: 'Gemini API key is invalid or lacks permissions.' });
      if (geminiResponse.status === 400) return res.status(400).json({ error: 'Bad request sent to Gemini: ' + errorBody });
      return res.status(502).json({ error: 'Gemini returned an error: ' + geminiResponse.status });
    }

    // ── Parse response ────────────────────────────────────────────────────────
    const geminiData = await geminiResponse.json();
    const parts = geminiData?.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find(p => !p.thought && (p.inlineData || p.inline_data));

    if (!imagePart) {
      const textPart = parts.find(p => !p.thought && p.text);
      console.error('[render] No image in Gemini response. Text:', textPart?.text ?? '(none)');
      console.error('[render] Full response:', JSON.stringify(geminiData, null, 2));
      return res.status(502).json({ error: 'Gemini did not return an image. Try again or simplify the floor plan.' });
    }

    const imageData = imagePart.inlineData || imagePart.inline_data;
    const outMimeType = imageData.mimeType || imageData.mime_type || 'image/png';
    const renderedImage = `data:${outMimeType};base64,${imageData.data}`;

    console.log(`[render] success | user=${req.user?.id} | outputMimeType=${outMimeType}`);
    return res.json({ renderedImage });

  } catch (error) {
    lastRenderTime = 0;
    console.error('[render] Unexpected error:', error);
    return res.status(500).json({ error: 'An unexpected error occurred during rendering.' });
  }
});

export default router;