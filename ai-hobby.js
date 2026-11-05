/* ============================================================
   Netlify Function: /.netlify/functions/ai-hobby
   Job: take {hobby, budget} from the browser, ask Gemini for a
   STRICT-JSON starter checklist, clean it, and send it back.

   WHY a server function: the GEMINI_API_KEY lives only here, in an
   environment variable on Netlify. The browser never sees it.
   ============================================================ */

// WHY a list: model names get renamed or retired, and a busy model can answer 503.
// "flash-lite" is the fastest model, so it goes first (we only have ~9 seconds).
// Each attempt uses the next name, so one overloaded model cannot break the app.
const MODELS = ["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-flash-lite-latest"];
const urlFor = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
const DEADLINE_MS = 9000; // Netlify's default function limit is 10s, so we stop at 9s and answer nicely
const FRIENDLY_ERROR = "The AI got confused. Try again with a simpler hobby.";

/* Helper: build a JSON HTTP response. */
function reply(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}

/* The prompt. We ask for JSON ONLY and give the exact shape.
   WHY so strict: our front-end code reads these exact field names,
   so any extra words from the AI would break it. */
function buildPrompt(hobby, budget) {
  return `You are a shopping planner for beginners in Bangladesh.
The user wants to start this hobby: "${hobby}".
Their budget is ${budget} BDT.

Return ONLY valid JSON (no markdown, no extra text) in exactly this shape:
{"hobby": "...", "items": [{"name": "...", "estimated_cost_bdt": 0, "why_needed": "..."}], "tips": ["..."]}

Rules:
- Maximum 10 items. Only what a true beginner needs.
- Costs are whole numbers in BDT, realistic for Bangladeshi markets.
- Items must be easy to find in Bangladesh (local shops, stationery, Daraz, New Market, etc.).
- Try to keep the total of all items near or below ${budget} BDT.
- "why_needed" is one short sentence.
- 2 to 3 short tips.
- If the hobby is unclear, still return the best simple plan in the same JSON shape.`;
}

/* Call Gemini once. Returns the raw text of the answer.
   AbortController cancels the request if it takes too long. */
async function callGemini(prompt, timeoutMs, model) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(urlFor(model), {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        // Key is sent in a header (not the URL) so it never ends up in logs.
        "x-goog-api-key": process.env.GEMINI_API_KEY
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          // Tells Gemini to output real JSON, which greatly reduces parse errors.
          responseMimeType: "application/json",
          temperature: 0.4 // low = more stable, fewer surprises
        }
      })
    });
    if (!res.ok) {
      // Keep the first part of Google's reason so Netlify logs show WHY it failed.
      const detail = (await res.text()).slice(0, 300);
      throw new Error("Gemini HTTP " + res.status + " (" + model + "): " + detail);
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Empty Gemini answer");
    return text;
  } finally {
    clearTimeout(timer); // always clean up the timer
  }
}

/* Turn the AI text into a clean, SAFE object.
   WHY validate: never trust AI output. We check the shape, cap the
   item count, and force costs to be numbers, so the front-end can
   always rely on the data. Throws an error if the shape is wrong. */
function parseAndClean(text, fallbackHobby) {
  // Remove ```json fences in case the model added them anyway.
  const cleaned = text.replace(/```json|```/gi, "").trim();
  const data = JSON.parse(cleaned); // throws if not valid JSON
  if (!data || !Array.isArray(data.items) || data.items.length === 0) {
    throw new Error("No items in answer");
  }
  const items = data.items.slice(0, 10).map((it) => {
    const name = String(it?.name || "").trim().slice(0, 80);
    const cost = Math.max(0, Math.round(Number(it?.estimated_cost_bdt)));
    if (!name || !Number.isFinite(cost)) throw new Error("Bad item");
    return {
      name,
      estimated_cost_bdt: cost,
      why_needed: String(it?.why_needed || "").trim().slice(0, 160)
    };
  });
  const tips = Array.isArray(data.tips)
    ? data.tips.slice(0, 4).map((t) => String(t).trim().slice(0, 200)).filter(Boolean)
    : [];
  return { hobby: String(data.hobby || fallbackHobby).slice(0, 80), items, tips };
}

/* The main handler: Netlify calls this on every request. */
exports.handler = async (event) => {
  // Only POST is allowed (the front-end uses POST).
  if (event.httpMethod !== "POST") return reply(405, { error: "Use POST." });

  // Missing key = a setup mistake. Say so clearly instead of crashing.
  if (!process.env.GEMINI_API_KEY) {
    return reply(500, { error: "Server is not set up yet (missing API key)." });
  }

  // Read and check the input from the browser.
  let hobby, budget;
  try {
    const body = JSON.parse(event.body || "{}");
    hobby = String(body.hobby || "").trim().slice(0, 80);
    budget = Math.round(Number(body.budget));
  } catch (e) {
    return reply(400, { error: "Bad request." });
  }
  if (!hobby || !(budget > 0)) {
    return reply(400, { error: "Please enter a hobby and a budget." });
  }

  const prompt = buildPrompt(hobby, budget);
  const startedAt = Date.now();

  // Try up to 3 times. WHY retry: AI answers are sometimes malformed JSON or
  // the model is busy (503); a second try usually fixes it. The loop NEVER throws out.
  for (let attempt = 1; attempt <= MODELS.length; attempt++) {
    const timeLeft = DEADLINE_MS - (Date.now() - startedAt);
    if (timeLeft < 1500) break; // not enough time left for another try
    try {
      // WHY cap each try at 4.5s: one slow answer must not eat the whole 9s
      // budget, or the backup model would never get a turn.
      const text = await callGemini(prompt, Math.min(timeLeft - 300, 4500), MODELS[attempt - 1]);
      const plan = parseAndClean(text, hobby);
      return reply(200, plan); // success
    } catch (err) {
      console.error(`Attempt ${attempt} failed:`, err.message); // visible in Netlify function logs
    }
  }

  // All tries failed: friendly message, no crash.
  return reply(502, { error: FRIENDLY_ERROR });
};