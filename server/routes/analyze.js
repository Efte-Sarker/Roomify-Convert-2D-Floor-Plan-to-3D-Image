import { Router } from 'express';
import { authMiddleware } from '../auth.js';

const router  = Router();
const MODEL   = 'gemini-2.5-flash';
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const EXTRACTION_PROMPT = `
You are an architectural floor plan parser. Analyze this 2D floor plan image and extract a precise structured layout.
CRITICAL: If the floor plan contains labeled dimensions (e.g. "13' x 10'", "18\" x 14\""), you MUST use those exact measurements to compute room proportions. Do not estimate visually when labels are available. Convert all measurements to a consistent unit first, then normalize so total width = 10.

Return ONLY a valid JSON object. No markdown. No explanation. No code fences.

Rules:
- Normalize all coordinates so the total floor plan width = 10 units
- Maintain exact proportions from the image
- x increases rightward, z increases downward (top-left = origin 0,0)
- Every room boundary must be a closed rectangle (x, z = top-left corner, w = width, d = depth)
- Walls are STRUCTURAL ONLY — do not repeat shared walls between adjacent rooms
- Each unique wall segment must appear exactly ONCE in the walls array
- Minimum wall length: 0.5 units. Do not output wall segments shorter than 0.5 units
- Windows: only include windows that are CLEARLY VISIBLE on exterior walls in the image. Do not add windows on all perimeter walls by default
- Walls are line segments between two points
- All rooms must share walls with adjacent rooms (no gaps between rooms)
- Openings: position = 0.0 to 1.0 along the wall length from start to end
- If room dimensions are labeled in the image, use them precisely for w and d values after normalizing
- The hallway/corridor must be included as a room if visible
- All rooms must tile perfectly — no gaps between adjacent rooms

Schema:
{
  "boundingBox": { "width": 10, "height": <proportional height> },
  "rooms": [
    {
      "name": "<room name>",
      "x": <left edge>,
      "z": <top edge>,
      "w": <width>,
      "d": <depth>,
      "floor": "wood|tile|other"
    }
  ],
  "walls": [
    { "id": <integer>, "start": [x1, z1], "end": [x2, z2] }
  ],
  "openings": [
    { "type": "door|window", "wall_id": <id>, "position": <0.0-1.0> }
  ]
}

Floor type rules:
- "tile": blue, teal, or grey bathroom/wet room areas
- "wood": warm tan/brown bedroom or living areas
- "other": kitchen, hallway, dining, neutral areas

Critical: Every wall must connect to at least one other wall at each endpoint.
Your entire response must be a single JSON object starting with { and ending with }. No other text before or after.
`.trim();

router.post('/', authMiddleware, async (req, res) => {
  try {
    const imageSource = req.body.sourceImage || req.body.renderedImage;

    if (!imageSource?.startsWith('data:')) {
      return res.status(400).json({ error: 'A base64 data URL image is required.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'GEMINI_API_KEY not configured.' });
    }

    const commaIdx  = imageSource.indexOf(',');
    const mimeType  = imageSource.slice(0, commaIdx).split(';')[0].split(':')[1];
    const base64    = imageSource.slice(commaIdx + 1);

    console.log(`[analyze] Extracting layout | user=${req.user?.id} | mime=${mimeType}`);

    const geminiRes = await fetch(API_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: EXTRACTION_PROMPT },
            { inline_data: { mime_type: mimeType, data: base64 } },
          ],
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8192,
          thinkingConfig: { thinkingBudget: 0 }, // disable thinking — saves all tokens for output
        },
      }),
    });

    if (!geminiRes.ok) {
      const err = await geminiRes.text();
      console.error('[analyze] Gemini error:', err);
      return res.status(502).json({ error: `Gemini returned ${geminiRes.status}` });
    }

    const geminiData = await geminiRes.json();
    const rawText    = geminiData?.candidates?.[0]?.content?.parts
      ?.find(p => p.text)?.text;

    if (!rawText) {
      return res.status(502).json({ error: 'No response from Gemini.' });
    }

    let layout;
    try {
      const stripped   = rawText.replace(/```json|```/gi, '').trim();
      const firstBrace = stripped.indexOf('{');
      if (firstBrace === -1) throw new Error('No JSON object found in response');

      let jsonStr = stripped.slice(firstBrace);

      // If truncated mid-stream, attempt to close open structures
      try {
        layout = JSON.parse(jsonStr);
        console.log('[analyze] Parsed layout:', JSON.stringify(layout, null, 2));
      } catch {
        console.warn('[analyze] JSON truncated — attempting repair');

        // Count unclosed brackets and braces, close them
        let openBraces   = 0;
        let openBrackets = 0;
        let inString     = false;
        let escape       = false;

        for (const ch of jsonStr) {
          if (escape)       { escape = false; continue; }
          if (ch === '\\')  { escape = true;  continue; }
          if (ch === '"')   { inString = !inString; continue; }
          if (inString)     continue;
          if (ch === '{')   openBraces++;
          if (ch === '}')   openBraces--;
          if (ch === '[')   openBrackets++;
          if (ch === ']')   openBrackets--;
        }

        // Strip any trailing incomplete token (partial word/number/key)
        jsonStr = jsonStr.replace(/,\s*$/, '')          // trailing comma
                        .replace(/"\s*:\s*$/, '')       // dangling key
                        .replace(/"[^"]*$/, '"null"')   // unclosed string
                        .replace(/\w+$/, 'null');        // dangling value

        // Close open structures
        jsonStr += ']'.repeat(Math.max(0, openBrackets));
        jsonStr += '}'.repeat(Math.max(0, openBraces));

        layout = JSON.parse(jsonStr);
        console.log('[analyze] JSON repair succeeded');
      }
    } catch (e) {
      console.error('[analyze] JSON parse failed. Raw (first 500):', rawText.slice(0, 500));
      return res.status(502).json({ error: 'Gemini returned invalid JSON: ' + e.message });
    }

    // ── Validate required fields ──────────────────────────────────────────
    if (!layout.rooms?.length || !layout.walls?.length) {
      return res.status(502).json({ error: 'Incomplete layout extracted.' });
    }

    console.log(`[analyze] OK | rooms=${layout.rooms.length} walls=${layout.walls.length}`);
    return res.json({ layout });

  } catch (err) {
    console.error('[analyze] Unexpected error:', err);
    return res.status(500).json({ error: 'Unexpected server error.' });
  }
});

export default router;