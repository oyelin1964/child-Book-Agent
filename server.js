import "dotenv/config";
import express from "express";
import OpenAI from "openai";

const app = express();
app.use(express.json());
app.use(express.static("public"));

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const PORT = process.env.PORT || 3000;

// Простая эвристика "слишком сложно" (для демо)
function looksTooHard(text) {
  if (!text) return true;
  if (text.length > 6500) return true;
  const longWords = (text.match(/\b[А-Яа-яA-Za-z]{12,}\b/g) || []).length;
  return longWords > 50;
}

// Нормализуем входные параметры, чтобы не было странных значений
function normalizeInput(body) {
  const topic = String(body?.topic ?? "котёнок и луна").slice(0, 120);

  let age = Number(body?.age ?? 4);
  if (!Number.isFinite(age)) age = 4;
  age = Math.min(10, Math.max(3, Math.round(age)));

  let pages = Number(body?.pages ?? 10);
  if (!Number.isFinite(pages)) pages = 10;
  pages = Math.min(20, Math.max(4, Math.round(pages)));

  const languageRaw = String(body?.language ?? "ru").toLowerCase();
  const language = languageRaw === "en" ? "en" : "ru";

  return { topic, age, pages, language };
}

app.post("/api/agent", async (req, res) => {
  try {
    const { topic, age, pages, language } = normalizeInput(req.body);

    const rulesRu =
      "Правила: очень простые слова, очень короткие предложения, максимум 2 предложения на страницу, одна мысль на страницу, добрый тон.";
    const rulesEn =
      "Rules: very simple words, very short sentences, max 2 sentences per page, one idea per page, kind tone.";

    const userPrompt =
      language === "en"
        ? `Create a children's book for a ${age}-year-old about "${topic}".
Format EXACTLY:
Page 1: ...
Page 2: ...
...
Page ${pages}: ...
${rulesEn}`
        : `Сделай детскую книжку для ребёнка ${age} лет про тему: "${topic}".
Формат СТРОГО:
Страница 1: ...
Страница 2: ...
...
Страница ${pages}: ...
${rulesRu}`;

    // 1) Черновик
    const draftResp = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a careful children's book writer. Keep it strictly age-appropriate and follow the requested page format.",
        },
        { role: "user", content: userPrompt },
      ],
    });

    let text = draftResp.choices?.[0]?.message?.content ?? "";

    // 2) Если вышло сложно/длинно — один проход упрощения (чтобы не зависать)
    if (looksTooHard(text)) {
      const simplifyPrompt =
        language === "en"
          ? `Simplify strongly for a ${age}-year-old. Keep EXACTLY the same page numbering format (Page 1..Page ${pages}).\n\n${text}`
          : `Упрости максимально для ребёнка ${age} лет. Сохрани НУМЕРАЦИЮ и формат страниц (Страница 1..Страница ${pages}).\n\n${text}`;

      const simpResp = await client.chat.completions.create({
        model: MODEL,
        messages: [
          {
            role: "system",
            content:
              "Simplify aggressively while keeping the same page format. No extra commentary.",
          },
          { role: "user", content: simplifyPrompt },
        ],
      });

      text = simpResp.choices?.[0]?.message?.content ?? text;
    }

    // UI ждёт поле text
    res.json({ ok: true, text, meta: { topic, age, pages, language, model: MODEL } });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`Open http://localhost:${PORT}`);
});
