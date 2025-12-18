import "dotenv/config";
import express from "express";
import OpenAI from "openai";

const app = express();
app.use(express.json());
app.use(express.static("public"));

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const PORT = process.env.PORT || 3000;

// Heuristic: too long/too complex for a small kids book
function looksTooHard(text) {
  if (!text) return true;
  if (text.length > 7500) return true;

  // Count very long "words" (Hebrew/Latin). Rough but ok for demo.
  const longWords = (text.match(/\b[\p{L}]{14,}\b/gu) || []).length;
  return longWords > 40;
}

function normalizeInput(body) {
  const topic = String(body?.topic ?? "חתלתול והירח").trim().slice(0, 160);

  let age = Number(body?.age ?? 4);
  if (!Number.isFinite(age)) age = 4;
  age = Math.min(10, Math.max(3, Math.round(age)));

  let pages = Number(body?.pages ?? 10);
  if (!Number.isFinite(pages)) pages = 10;
  pages = Math.min(20, Math.max(4, Math.round(pages)));

  // For this step: ALWAYS output Hebrew
  const language = "he";

  return { topic, age, pages, language };
}

app.post("/api/agent", async (req, res) => {
  try {
    const { topic, age, pages, language } = normalizeInput(req.body);

    const rulesHe =
      "כללים: עברית בלבד. מילים פשוטות מאוד. משפטים קצרים מאוד. עד שני משפטים בעמוד. רעיון אחד בעמוד. טון חם וטוב. בלי הערות צד או הסברים למבוגרים.";

    const userPrompt = `כתוב ספר ילדים בעברית לילד בן ${age} על הנושא: "${topic}".
אם הנושא לא בעברית — תרגם אותו לעברית בראש שלך וכתוב את הספר בעברית.

פורמט מדויק (שמור בדיוק על המבנה):
עמוד 1: ...
עמוד 2: ...
...
עמוד ${pages}: ...

${rulesHe}`;

    // 1) Draft
    const draftResp = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a careful children's book writer. Output Hebrew only and follow the exact page format requested.",
        },
        { role: "user", content: userPrompt },
      ],
    });

    let text = draftResp.choices?.[0]?.message?.content ?? "";

    // 2) One simplify pass (prevents long hangs and improves age-appropriateness)
    if (looksTooHard(text)) {
      const simplifyPrompt = `פשט מאוד את הטקסט כך שיתאים לילד בן ${age}.
שמור בדיוק על פורמט העמודים (עמוד 1..עמוד ${pages}).
עברית בלבד. בלי טקסט נוסף מחוץ לעמודים.

${text}`;

      const simpResp = await client.chat.completions.create({
        model: MODEL,
        messages: [
          {
            role: "system",
            content:
              "Simplify aggressively for the target age while keeping the exact page format. Hebrew only.",
          },
          { role: "user", content: simplifyPrompt },
        ],
      });

      text = simpResp.choices?.[0]?.message?.content ?? text;
    }

    res.json({
      ok: true,
      text,
      meta: { topic, age, pages, language, model: MODEL },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

app.get("/api/routes", (req, res) => {
  const routes = [];
  for (const layer of app._router.stack) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).join(",").toUpperCase();
      routes.push(`${methods} ${layer.route.path}`);
    }
  }
  res.json({ ok: true, routes });
});


app.listen(PORT, () => {
  console.log(`Open http://localhost:${PORT}`);
});
