// ============================================================
// VERCEL SERVERLESS FUNCTION — api/proxy-gemini.js
// ✅ CORS complet
// ✅ Rate limiting : 20 req / IP / heure
// ✅ Validation payload avant appel Gemini
// ✅ Timeout 10s anti-blocage
// ✅ Plafond tokens côté serveur
// ✅ Logs structurés Vercel dashboard
// ✅ Nettoyage mémoire anti-leak
// ============================================================

// Stockage rate limit en mémoire
// (reset à chaque cold start Vercel — suffisant pour 2000 users)
const rateLimitStore = new Map();

// ── CONFIGURATION ────────────────────────────────────────────
const CONFIG = {
  MAX_REQUESTS:       20,              // requêtes max par fenêtre / IP
  WINDOW_MS:          60 * 60 * 1000, // fenêtre = 1 heure
  MAX_TOKENS:         1000,            // tokens Gemini plafonnés côté serveur
  MAX_CONTENT_LENGTH: 20,              // max messages dans contents[]
  MAX_TEXT_LENGTH:    2000,            // max caractères par message
  TIMEOUT_MS:         10_000,          // timeout appel Gemini = 10s
};

// ── HELPER : récupérer l'IP réelle derrière Vercel ───────────
function getClientIP(req) {
  return (
    req.headers['x-real-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

// ── HELPER : vérifier + incrémenter le compteur ──────────────
function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimitStore.get(ip);

  // Nouvelle IP ou fenêtre expirée → reset
  if (!record || now - record.windowStart > CONFIG.WINDOW_MS) {
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    return {
      allowed:   true,
      remaining: CONFIG.MAX_REQUESTS - 1,
      resetIn:   CONFIG.WINDOW_MS,
    };
  }

  // Quota dépassé
  if (record.count >= CONFIG.MAX_REQUESTS) {
    return {
      allowed:   false,
      remaining: 0,
      resetIn:   CONFIG.WINDOW_MS - (now - record.windowStart),
    };
  }

  // Incrément normal
  record.count++;
  rateLimitStore.set(ip, record);
  return {
    allowed:   true,
    remaining: CONFIG.MAX_REQUESTS - record.count,
    resetIn:   CONFIG.WINDOW_MS - (now - record.windowStart),
  };
}

// ── HELPER : purger les entrées expirées ─────────────────────
function cleanupOldEntries() {
  const now = Date.now();
  for (const [ip, record] of rateLimitStore.entries()) {
    if (now - record.windowStart > CONFIG.WINDOW_MS) {
      rateLimitStore.delete(ip);
    }
  }
}

// ── HELPER : valider le payload avant appel Gemini ───────────
function validatePayload(body) {
  if (!body || typeof body !== 'object') {
    return 'Payload invalide.';
  }
  if (!Array.isArray(body.contents) || body.contents.length === 0) {
    return 'Le champ "contents" est requis et doit être un tableau non vide.';
  }
  if (body.contents.length > CONFIG.MAX_CONTENT_LENGTH) {
    return `Trop de messages (max ${CONFIG.MAX_CONTENT_LENGTH}).`;
  }
  for (const msg of body.contents) {
    if (!msg.role || !Array.isArray(msg.parts)) {
      return 'Chaque message doit avoir "role" et "parts".';
    }
    for (const part of msg.parts) {
      if (typeof part.text !== 'string') {
        return 'Chaque part doit contenir un champ "text" (string).';
      }
      if (part.text.length > CONFIG.MAX_TEXT_LENGTH) {
        return `Message trop long (max ${CONFIG.MAX_TEXT_LENGTH} caractères).`;
      }
    }
  }
  return null; // ✅ payload valide
}

// ── HANDLER PRINCIPAL ────────────────────────────────────────
export default async function handler(req, res) {

  // ── CORS ──────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // ── Méthode ───────────────────────────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }

  // ── Rate limiting ─────────────────────────────────────────
  const ip = getClientIP(req);
  cleanupOldEntries();

  const limit = checkRateLimit(ip);

  // Headers standard de rate limit
  res.setHeader('X-RateLimit-Limit',     CONFIG.MAX_REQUESTS);
  res.setHeader('X-RateLimit-Remaining', limit.remaining);
  res.setHeader('X-RateLimit-Reset',     Math.ceil(limit.resetIn / 1000));

  if (!limit.allowed) {
    const minutesLeft = Math.ceil(limit.resetIn / 60000);
    console.warn(`[RATE_LIMIT] IP bloquée: ${ip} — reset dans ${minutesLeft} min`);
    return res.status(429).json({
      error:      `Trop de requêtes. Réessaie dans ${minutesLeft} minute(s).`,
      retryAfter: minutesLeft,
    });
  }

  // ── Validation payload ────────────────────────────────────
  const validationError = validatePayload(req.body);
  if (validationError) {
    console.warn(`[VALIDATION] IP: ${ip} — ${validationError}`);
    return res.status(400).json({ error: validationError });
  }

  // ── Clé API ───────────────────────────────────────────────
  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_KEY) {
    console.error('[CONFIG] GEMINI_API_KEY manquante dans les variables Vercel.');
    return res.status(500).json({ error: 'Configuration serveur incorrecte.' });
  }

  // ── Appel Gemini avec timeout 10s ─────────────────────────
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.TIMEOUT_MS);

  try {
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
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
              CONFIG.MAX_TOKENS // plafond serveur — non négociable
            ),
          },
        }),
      }
    );

    clearTimeout(timeout);

    const data = await geminiResponse.json();

    // Erreur retournée par Gemini (quota épuisé, clé invalide, etc.)
    if (!geminiResponse.ok) {
      const msg = data?.error?.message || `Erreur Gemini HTTP ${geminiResponse.status}`;
      console.error(`[GEMINI_ERROR] IP: ${ip} — ${msg}`);
      return res.status(geminiResponse.status).json({ error: msg });
    }

    console.log(`[OK] IP: ${ip} — remaining: ${limit.remaining}`);
    return res.status(200).json(data);

  } catch (err) {
    clearTimeout(timeout);

    if (err.name === 'AbortError') {
      console.error(`[TIMEOUT] IP: ${ip} — Gemini n'a pas répondu en ${CONFIG.TIMEOUT_MS / 1000}s`);
      return res.status(504).json({ error: "Délai d'attente dépassé. Réessaie." });
    }

    console.error(`[SERVER_ERROR] IP: ${ip} — ${err.message}`);
    return res.status(500).json({ error: 'Erreur serveur. Réessaie dans quelques secondes.' });
  }
}
