const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ----------------------------
// Helpers
// ----------------------------
function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  };
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Deterministic Fraction Normalizer
function normalizeFraction(str) {
  if (!str || !str.includes("/")) return null;

  const [numStr, denStr] = str.split("/").map(s => s.trim());
  const num = parseInt(numStr);
  const den = parseInt(denStr);

  if (isNaN(num) || isNaN(den) || den === 0) return null;

  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(Math.abs(num), Math.abs(den));

  return {
    num: num / divisor,
    den: den / divisor
  };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { error: "Method Not Allowed" });
    }

    const body = safeJsonParse(event.body || "{}") || {};
    const mode = body.mode || "tutor";

    // =========================================
    // MODE: TUTOR (Socratic Hint Engine)
    // =========================================
    if (mode === "tutor") {
      const conversation = Array.isArray(body.conversation) ? body.conversation : [];
      const topic = body.topic || "fractions";

      if (conversation.length === 0) {
        return json(200, { reply: "Ask a math question to begin." });
      }

      const response = await client.responses.create({
        model: "gpt-4o-mini",
        input: [
          {
            role: "system",
            content: [
              "You are a calm, teacher-like K–8 math tutor.",
              `Topic focus: ${topic}.`,
              "",
              "STRICT RULES:",
              "- Do NOT give the final numeric answer.",
              "- Do NOT confirm the final numeric answer.",
              "- Do NOT say 'equals X' or 'the answer is X'.",
              "- Give a small hint and ask ONE guiding question.",
              "- Stay on the student’s current problem.",
              "- No LaTeX. Use simple fractions like 3/4.",
              "- Keep responses short and supportive.",
            ].join("\n"),
          },
          ...conversation,
        ],
      });

      return json(200, { reply: response.output_text });
    }

    // =========================================
    // MODE: GENERATE HOMEWORK
    // =========================================
    if (mode === "generate_homework") {
      const topic = body.topic || "simplifying fractions";
      const grade = Number(body.grade || 4);
      const count = Math.max(5, Math.min(12, Number(body.count || 8)));

      const response = await client.responses.create({
        model: "gpt-4o-mini",
        text: { format: { type: "json_object" } },
        input: [
          {
            role: "system",
            content: [
              "You generate Grade-level math homework.",
              "Return ONLY valid JSON. No extra text.",
              "No markdown. No explanations.",
              "Fractions must be in a/b format like 3/4.",
              "Questions must NOT include solutions.",
              "",
              "Return JSON exactly like:",
              '{ "topic":"...", "grade":4, "problems":[{"id":1,"question":"..."}], "answerKey":[{"id":1,"answer":"..."}] }',
            ].join("\n"),
          },
          {
            role: "user",
            content: `Generate ${count} problems for Grade ${grade}. Topic: ${topic}.`,
          },
        ],
      });

      const payload = safeJsonParse(response.output_text);

      if (!payload || !Array.isArray(payload.problems) || !Array.isArray(payload.answerKey)) {
        return json(500, {
          error: "Homework generator returned invalid JSON.",
          raw: response.output_text,
        });
      }

      return json(200, {
        topic: payload.topic || topic,
        grade: payload.grade || grade,
        problems: payload.problems,
        answerKey: payload.answerKey,
      });
    }

    // =========================================
    // MODE: CHECK HOMEWORK ANSWER
    // =========================================
    if (mode === "check_homework_answer") {
      const { correctAnswer, studentAnswer } = body;

      if (!correctAnswer || !studentAnswer) {
        return json(400, { error: "correctAnswer and studentAnswer required" });
      }

      const normalizedCorrect = normalizeFraction(correctAnswer);
      const normalizedStudent = normalizeFraction(studentAnswer);git r

      const isCorrect =
        normalizedCorrect &&
        normalizedStudent &&
        normalizedCorrect.num === normalizedStudent.num &&
        normalizedCorrect.den === normalizedStudent.den;

      return json(200, {
        correct: isCorrect,
        correctAnswer,
      });
    }

    return json(400, { error: `Invalid mode: ${mode}` });

  } catch (err) {
    console.error("Tutor function error:", err);
    return json(500, { error: "Internal server error", details: err.message });
  }
};