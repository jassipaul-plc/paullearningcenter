const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ------------------ helpers ------------------
function json(statusCode, bodyObj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(bodyObj),
  };
}

function normalize(s) {
  return (s ?? "").toString().trim();
}

// Extract LAST integer from text: "sorry its 37" -> 37
function parseIntLoose(s) {
  const str = normalize(s);
  if (!str) return null;
  const matches = str.match(/-?\d+/g);
  if (!matches || matches.length === 0) return null;
  const n = parseInt(matches[matches.length - 1], 10);
  return Number.isFinite(n) ? n : null;
}

function gcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b !== 0) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

function lcm(a, b) {
  if (a === 0 || b === 0) return 0;
  return Math.abs((a / gcd(a, b)) * b);
}

function simplifyFraction(fr) {
  const g = gcd(fr.num, fr.den);
  return { num: fr.num / g, den: fr.den / g };
}

function fractionsEqual(a, b) {
  return a.num * b.den === b.num * a.den;
}

function parseFractionSafe(s) {
  // Accept "a/b" or "a"
  const str = normalize(s);
  if (!str) return null;

  // strip spaces
  const cleaned = str.replace(/\s+/g, "");

  if (cleaned.includes("/")) {
    const parts = cleaned.split("/");
    if (parts.length !== 2) return null;
    const num = parseInt(parts[0], 10);
    const den = parseInt(parts[1], 10);
    if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
    return { num, den };
  }

  const num = parseInt(cleaned, 10);
  if (!Number.isFinite(num)) return null;
  return { num, den: 1 };
}

function addFractions(list) {
  // list: [{num,den}, ...]
  const den = list.reduce((acc, f) => lcm(acc, f.den), 1);
  const nums = list.map((f) => f.num * (den / f.den));
  const sumNum = nums.reduce((a, b) => a + b, 0);
  return {
    commonDen: den,
    convertedNums: nums,
    unsimplified: { num: sumNum, den },
    simplified: simplifyFraction({ num: sumNum, den }),
  };
}

// Parse fraction addition like: "1/4 + 1/5 + 1/6"
function parseFractionExpression(expr) {
  const s = normalize(expr);
  if (!s) return null;

  // Remove spaces
  const cleaned = s.replace(/\s+/g, "");

  // Only allow + between terms for now (Grade 4 guided)
  const parts = cleaned.split("+").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2 || parts.length > 3) return null;

  const frs = parts.map(parseFractionSafe);
  if (frs.some((f) => !f)) return null;

  // Ensure denominators positive
  for (const f of frs) {
    if (f.den <= 0) return null;
  }

  return frs;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function makeProperFraction(denMin = 2, denMax = 12) {
  const den = randomInt(denMin, denMax);
  const num = randomInt(1, den - 1);
  return { num, den };
}

function fractionToString(f) {
  return `${f.num}/${f.den}`;
}

function toMixedOrProper(fr) {
  // Keep as proper fraction for Grade 4; but if improper, keep improper a/b
  return `${fr.num}/${fr.den}`;
}

// ------------------ AI helper (optional explanations only) ------------------
async function aiOneSentenceHelp(prompt) {
  try {
    const resp = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        {
          role: "system",
          content:
            "You are a calm Grade 4 math tutor. Give a short 1–2 sentence explanation. Use a/b for fractions. No LaTeX.",
        },
        { role: "user", content: prompt },
      ],
    });
    return resp.output_text || "";
  } catch {
    return "";
  }
}

// =====================
// 1) HOMEWORK GENERATOR + GRADER (deterministic)
// =====================
function homeworkGenerate({ grade = 4, topic = "fractions_add", count = 5 }) {
  const safeCount = Math.max(1, Math.min(20, parseInt(count, 10) || 5));
  const problems = [];

  for (let i = 1; i <= safeCount; i++) {
    // For MVP: Fractions addition with unlike denominators (2 fractions)
    // You can extend topics later.
    let a = makeProperFraction();
    let b = makeProperFraction();

    // Avoid same denominator too often to make it interesting
    let tries = 0;
    while (b.den === a.den && tries < 5) {
      b = makeProperFraction();
      tries++;
    }

    const calc = addFractions([a, b]);
    const correct = calc.simplified;

    problems.push({
      id: i,
      question: `${fractionToString(a)} + ${fractionToString(b)} = ?`,
      // store solution in state (frontend will not display unless you choose)
      answerKey: `${correct.num}/${correct.den}`,
      meta: {
        a,
        b,
        commonDen: calc.commonDen,
        convertedNums: calc.convertedNums,
        unsimplified: calc.unsimplified,
        simplified: calc.simplified,
      },
    });
  }

  return {
    ok: true,
    kind: "homework",
    homework: {
      grade,
      topic,
      count: safeCount,
      problems: problems.map(({ id, question }) => ({ id, question })),
    },
    // keep server-grade-able state
    state: {
      grade,
      topic,
      problems, // includes answerKey/meta
    },
  };
}

function homeworkGrade({ state, studentAnswers }) {
  if (!state?.problems || !Array.isArray(state.problems)) {
    return { ok: false, error: "Missing homework state/problems." };
  }

  const answersMap = studentAnswers || {};
  const results = [];
  let correctCount = 0;

  for (const p of state.problems) {
    const userRaw = normalize(answersMap[p.id]);
    const userFr = parseFractionSafe(userRaw);
    const correctFr = parseFractionSafe(p.answerKey);

    let isCorrect = false;
    if (userFr && correctFr) isCorrect = fractionsEqual(userFr, correctFr);

    if (isCorrect) correctCount++;

    results.push({
      id: p.id,
      question: p.question,
      userAnswer: userRaw || "",
      isCorrect,
      correctAnswer: p.answerKey,
      // Optional: show quick deterministic feedback
      feedback: isCorrect
        ? "✅ Correct"
        : "❌ Not correct. Check common denominators and simplify.",
    });
  }

  return {
    ok: true,
    kind: "homework",
    summary: {
      total: results.length,
      correct: correctCount,
      incorrect: results.length - correctCount,
      scorePercent: Math.round((correctCount / Math.max(1, results.length)) * 100),
    },
    results,
  };
}

// =====================
// 2) GUIDED FRACTIONS (user starts with their question)
// =====================
function guidedWelcome() {
  return {
    ok: true,
    kind: "guided",
    state: { phase: "await_problem" },
    tutor: {
      text:
        "Guided Fractions Tutor ✅\n\nType a fraction addition problem like:\n" +
        "1/4 + 1/5 + 1/6\n\nThen I’ll guide you step-by-step (and I will check your answers).",
      expectedFormat: "Example: 1/3 + 2/5",
    },
  };
}

function guidedStartFromProblem(problemText) {
  const frs = parseFractionExpression(problemText);
  if (!frs) {
    return {
      ok: true,
      kind: "guided",
      state: { phase: "await_problem" },
      tutor: {
        text:
          "I can guide fraction addition problems like:\n" +
          "1/4 + 1/5\n" +
          "or\n" +
          "1/4 + 1/5 + 1/6\n\nPlease type your problem using a/b format and + signs only.",
        expectedFormat: "Example: 3/8 + 1/6",
      },
    };
  }

  const calc = addFractions(frs);

  const frStrings = frs.map(fractionToString);

  return {
    ok: true,
    kind: "guided",
    state: {
      phase: "in_lesson",
      step: 1,
      fractions: frStrings,
      commonDen: calc.commonDen,
      convertedNums: calc.convertedNums,
      correctSum: calc.unsimplified.num,
      simplified: calc.simplified, // {num,den}
    },
    tutor: {
      text:
        `Great. Let’s solve: ${frStrings.join(" + ")}\n\n` +
        `Step 1: What is the LCM of the denominators (${frs.map((f) => f.den).join(", ")})?`,
      expectedFormat: "Number (example: 60)",
    },
  };
}

async function guidedAnswer(body) {
  const state = body.state || {};
  const phase = state.phase;
  const studentAnswer = normalize(body.studentAnswer);

  // allow reset anytime
  if (studentAnswer.toLowerCase() === "restart") {
    return guidedWelcome();
  }

  // Phase: user must provide a problem
  if (phase === "await_problem") {
    return guidedStartFromProblem(studentAnswer);
  }

  // Phase: in lesson
  if (phase !== "in_lesson") {
    return guidedWelcome();
  }

  const step = state.step;
  const fractions = state.fractions || [];
  const commonDen = state.commonDen;
  const nums = state.convertedNums || [];
  const correctSum = state.correctSum;
  const simplified = state.simplified;

  // STEP 1: LCM
  if (step === 1) {
    const ans = parseIntLoose(studentAnswer);
    const isCorrect = ans !== null && ans === commonDen;

    if (!isCorrect) {
      const hint = await aiOneSentenceHelp(
        `Student is finding LCM of denominators for ${fractions.join(" + ")}.
Student answered: "${studentAnswer}"
Give a short hint without giving the final LCM. Ask one question.`
      );

      return {
        ok: true,
        kind: "guided",
        state: { ...state, step: 1 },
        tutor: {
          text: `Not quite. ${hint || "Try listing multiples and find the first one all denominators share."}`,
          expectedFormat: "Number",
        },
        validation: { isCorrect: false },
      };
    }

    return {
      ok: true,
      kind: "guided",
      state: { ...state, step: 2 },
      tutor: {
        text:
          `Correct! Common denominator = ${commonDen}.\n\n` +
          `Step 2: Convert each fraction to denominator ${commonDen}.\n` +
          `What numerators do you get? Reply as a,b (or a,b,c) like: 15,12,10`,
        expectedFormat: "Comma-separated numerators",
      },
      validation: { isCorrect: true },
    };
  }

  // STEP 2: Converted numerators
  if (step === 2) {
    // Accept "15,12,10" or "15/60,12/60,10/60"
    let userNums = null;

    // try comma ints
    const parts = studentAnswer.split(",").map((x) => x.trim()).filter(Boolean);
    if (parts.length === nums.length) {
      const asInts = parts.map((p) => parseIntLoose(p));
      if (asInts.every((n) => Number.isFinite(n))) userNums = asInts;
    }

    // try comma fractions
    if (!userNums && parts.length === nums.length) {
      const asFr = parts.map(parseFractionSafe);
      if (asFr.every(Boolean)) userNums = asFr.map((f) => f.num);
    }

    const isCorrect =
      Array.isArray(userNums) &&
      userNums.length === nums.length &&
      userNums.every((n, i) => n === nums[i]);

    if (!isCorrect) {
      const hint = await aiOneSentenceHelp(
        `Student is converting ${fractions.join(" + ")} to denominator ${commonDen}.
Student answered: "${studentAnswer}"
Give ONE hint without giving final numerators. Ask one question.`
      );

      return {
        ok: true,
        kind: "guided",
        state: { ...state, step: 2 },
        tutor: {
          text:
            `Not quite. ${hint || "Multiply each numerator by (commonDenominator ÷ its denominator)."}\n` +
            `Reply like: ${nums.length === 2 ? "a,b" : "a,b,c"}`,
          expectedFormat: "Comma-separated numerators",
        },
        validation: { isCorrect: false },
      };
    }

    return {
      ok: true,
      kind: "guided",
      state: { ...state, step: 3 },
      tutor: {
        text:
          `Exactly! Now we have: ${nums
            .map((n) => `${n}/${commonDen}`)
            .join(", ")}\n\n` +
          `Step 3: Add the numerators: ${nums.join(" + ")}\n` +
          `What is the total numerator?`,
        expectedFormat: "Number",
      },
      validation: { isCorrect: true },
    };
  }

  // STEP 3: Add numerators (handles partial sums too)
  if (step === 3) {
    const ans = parseIntLoose(studentAnswer);
    const fullCorrect = ans !== null && ans === correctSum;

    // If user answers partial sum of first two, accept and continue
    if (ans !== null && nums.length >= 2) {
      const partial = nums[0] + nums[1];
      if (!fullCorrect && ans === partial) {
        const remaining = nums.slice(2).reduce((a, b) => a + b, 0);
        return {
          ok: true,
          kind: "guided",
          state: { ...state, step: 31, partial },
          tutor: {
            text:
              `Good! ${nums[0]} + ${nums[1]} = ${partial}.\n\n` +
              `Now add the remaining numerator(s). What is ${partial} + ${remaining}?`,
            expectedFormat: "Number",
          },
          validation: { isCorrect: true },
        };
      }
    }

    if (!fullCorrect) {
      const hint = await aiOneSentenceHelp(
        `Student is adding numerators: ${nums.join(" + ")}.
Student answered: "${studentAnswer}"
Give a hint to re-check addition, starting with first two numbers. Do not give final sum. Ask one question.`
      );

      return {
        ok: true,
        kind: "guided",
        state: { ...state, step: 3 },
        tutor: {
          text: `Not quite. ${hint || `Try ${nums[0]} + ${nums[1]} first.`}`,
          expectedFormat: "Number",
        },
        validation: { isCorrect: false },
      };
    }

    return {
      ok: true,
      kind: "guided",
      state: { ...state, step: 4 },
      tutor: {
        text:
          `Great! So we have ${correctSum}/${commonDen}.\n\n` +
          `Step 4: Simplify ${correctSum}/${commonDen}.\n` +
          `What is the simplified fraction? (a/b)`,
        expectedFormat: "Fraction a/b",
      },
      validation: { isCorrect: true },
    };
  }

  // STEP 31: finish sum from partial
  if (step === 31) {
    const ans = parseIntLoose(studentAnswer);
    const fullCorrect = ans !== null && ans === correctSum;

    if (!fullCorrect) {
      return {
        ok: true,
        kind: "guided",
        state: { ...state, step: 31 },
        tutor: {
          text:
            `Not quite. Add carefully.\n` +
            `What is the final numerator when you finish adding all the converted numerators?`,
          expectedFormat: "Number",
        },
        validation: { isCorrect: false },
      };
    }

    return {
      ok: true,
      kind: "guided",
      state: { ...state, step: 4 },
      tutor: {
        text:
          `Nice! So we have ${correctSum}/${commonDen}.\n\n` +
          `Step 4: Simplify ${correctSum}/${commonDen}.\n` +
          `What is the simplified fraction? (a/b)`,
        expectedFormat: "Fraction a/b",
      },
      validation: { isCorrect: true },
    };
  }

  // STEP 4: Simplify
  if (step === 4) {
    const ans = parseFractionSafe(studentAnswer);
    if (!ans) {
      return {
        ok: true,
        kind: "guided",
        state: { ...state, step: 4 },
        tutor: {
          text: `Please answer as a fraction like a/b. Try simplifying ${correctSum}/${commonDen}.`,
          expectedFormat: "Fraction a/b",
        },
        validation: { isCorrect: false },
      };
    }

    const isCorrect = fractionsEqual(ans, simplified);

    if (!isCorrect) {
      const hint = await aiOneSentenceHelp(
        `Student is simplifying ${correctSum}/${commonDen}.
Student answered: "${studentAnswer}".
Give a hint about greatest common factor. Don't give final fraction. Ask one question.`
      );

      return {
        ok: true,
        kind: "guided",
        state: { ...state, step: 4 },
        tutor: {
          text: `Not quite. ${hint || "Find the greatest common factor of numerator and denominator, then divide both."}`,
          expectedFormat: "Fraction a/b",
        },
        validation: { isCorrect: false },
      };
    }

    return {
      ok: true,
      kind: "guided",
      state: { phase: "await_problem" }, // go back to start new problem
      tutor: {
        text:
          `Excellent ✅ Final Answer: ${simplified.num}/${simplified.den}\n\n` +
          `Type another fraction problem to practice, or type "restart" for instructions.`,
        expectedFormat: "Example: 2/3 + 1/6",
      },
      validation: { isCorrect: true },
    };
  }

  return guidedWelcome();
}

// ------------------ handler ------------------
exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return json(200, {});
    if (event.httpMethod !== "POST") return json(405, { ok: false, error: "POST only" });

    const body = JSON.parse(event.body || "{}");
    const mode = body.mode || "";

    // HOMEWORK
    if (mode === "homework_generate") {
      const grade = body.grade ?? 4;
      const topic = body.topic ?? "fractions_add";
      const count = body.count ?? 5;
      return json(200, homeworkGenerate({ grade, topic, count }));
    }

    if (mode === "homework_grade") {
      const result = homeworkGrade({
        state: body.state,
        studentAnswers: body.studentAnswers,
      });
      return json(result.ok ? 200 : 400, result);
    }

    // GUIDED (user-started)
    if (mode === "guided_welcome") {
      return json(200, guidedWelcome());
    }

    if (mode === "guided_answer") {
      const result = await guidedAnswer(body);
      return json(200, result);
    }

    // If no mode provided, default to guided welcome (safe)
    return json(200, guidedWelcome());
  } catch (err) {
    console.error("Tutor function error:", err);
    return json(500, { ok: false, error: "Internal server error", details: err.message });
  }
};