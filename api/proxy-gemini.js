// ============================================================
// VERCEL SERVERLESS FUNCTION — api/proxy-gemini.js
// ✅ Modèle : gemini-2.5-flash-lite
//    Le moins cher : $0.10/1M input · $0.40/1M output
//    Tier gratuit : 1500 req/jour sans carte bancaire
// ✅ Outil public ouvert
// ✅ Validation payload stricte
// ✅ Timeout 15s
// ✅ Plafond tokens côté serveur
// ✅ Clé API sécurisée côté serveur
// ============================================================

const CONFIG = {
  MODEL:              'gemini-2.5-flash-lite',
  MAX_TOKENS:         1000,
  MAX_CONTENT_LENGTH: 20,
  MAX_TEXT_LENGTH:    2000,
  TIMEOUT_MS:         15_000,
};

function validatePayload(body) {
  if (!body || typeof body !== 'object')
    return 'Payload invalide.';
  if (!Array.isArray(body.contents) || body.contents.length === 0)
    return '"contents" requis et non vide.';
  if (body.contents.length > CONFIG.MAX_CONTENT_LENGTH)
    return `Trop de messages (max ${CONFIG.MAX_CONTENT_LENGTH}).`;
  for (const msg of body.contents) {
    if (!msg.role || !Array.isArray(msg.parts))
      return 'Chaque message doit avoir "role" et "parts".';
    for (const part of msg.parts) {
      if (typeof part.text !== 'string')
        return '"text" doit être une string.';
      if (part.text.length > CONFIG.MAX_TEXT_LENGTH)
        return `Message trop long (max ${CONFIG.MAX_TEXT_LENGTH} caractères).`;
    }
  }
  return null;
}

export default async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Méthode non autorisée.' });

  const validationError = validatePayload(req.body);
  if (validationError) {
    console.warn(`[VALIDATION] ${validationError}`);
    return res.status(400).json({ error: validationError });
  }

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_KEY) {
    console.error('[CONFIG] GEMINI_API_KEY manquante.');
    return res.status(500).json({ error: 'Configuration serveur incorrecte.' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.TIMEOUT_MS);

  try {
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.MODEL}:generateContent?key=${GEMINI_KEY}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        signal:  controller.signal,
        body: JSON.stringify({
          contents: req.body.contents,
          generationConfig: {
            temperature:     req.body.generationConfig?.temperature     ?? 0.7,
            maxOutputTokens: Math.min(
              req.body.generationConfig?.maxOutputTokens ?? CONFIG.MAX_TOKENS,
              CONFIG.MAX_TOKENS
            ),
          },
        }),
      }
    );

    clearTimeout(timeout);
    const data = await geminiResponse.json();

    if (!geminiResponse.ok) {
      const msg = data?.error?.message || `Erreur Gemini HTTP ${geminiResponse.status}`;
      console.error(`[GEMINI_ERROR] ${msg}`);
      return res.status(geminiResponse.status).json({ error: msg });
    }

    console.log(`[OK] ${CONFIG.MODEL}`);
    return res.status(200).json(data);

  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      console.error('[TIMEOUT]');
      return res.status(504).json({ error: "Délai d'attente dépassé. Réessaie." });
    }
    console.error(`[SERVER_ERROR] ${err.message}`);
    return res.status(500).json({ error: 'Erreur serveur. Réessaie.' });
  }
}
