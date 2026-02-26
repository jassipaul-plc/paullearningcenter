const OpenAI = require("openai");

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
  : null;

// ------------------ in-memory progress engine ------------------
// Netlify functions may cold-start; this is best-effort session analytics.
const progressStore = globalThis.__plcProgressStore || new Map();
globalThis.__plcProgressStore = progressStore;

function safeStudentId(id) {
  const s = normalize(id);
  return s || "anonymous";
}

function initStudentProgress(studentId) {
  const id = safeStudentId(studentId);
  if (!progressStore.has(id)) {
    progressStore.set(id, {
      studentId: id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      totals: {
        attempts: 0,
        correct: 0,
        incorrect: 0,
      },
      byTopic: {},
      byMode: {},
      recentEvents: [],
      seenEventKeys: {},
    });
  }
  return progressStore.get(id);
}

function pct(correct, attempts) {
  if (!attempts) return 0;
  return Math.round((correct / attempts) * 100);
}

function topicBucket(progress, topic) {
  const key = normalize(topic) || "general";
  if (!progress.byTopic[key]) {
    progress.byTopic[key] = { attempts: 0, correct: 0, incorrect: 0, accuracy: 0 };
  }
  return progress.byTopic[key];
}

function modeBucket(progress, mode) {
  const key = normalize(mode) || "general";
  if (!progress.byMode[key]) {
    progress.byMode[key] = { attempts: 0, correct: 0, incorrect: 0, accuracy: 0 };
  }
  return progress.byMode[key];
}

function recordProgressEvent({
  studentId,
  mode = "general",
  topic = "general",
  isCorrect = false,
  meta = {},
  dedupeKey = "",
}) {
  const progress = initStudentProgress(studentId);
  const key = normalize(dedupeKey);
  if (key && progress.seenEventKeys[key]) return progress;
  if (key) progress.seenEventKeys[key] = true;

  const topicStats = topicBucket(progress, topic);
  const modeStats = modeBucket(progress, mode);

  progress.totals.attempts += 1;
  topicStats.attempts += 1;
  modeStats.attempts += 1;

  if (isCorrect) {
    progress.totals.correct += 1;
    topicStats.correct += 1;
    modeStats.correct += 1;
  } else {
    progress.totals.incorrect += 1;
    topicStats.incorrect += 1;
    modeStats.incorrect += 1;
  }

  topicStats.accuracy = pct(topicStats.correct, topicStats.attempts);
  modeStats.accuracy = pct(modeStats.correct, modeStats.attempts);

  progress.updatedAt = new Date().toISOString();
  progress.recentEvents.unshift({
    ts: progress.updatedAt,
    mode,
    topic,
    isCorrect: !!isCorrect,
    meta,
  });
  progress.recentEvents = progress.recentEvents.slice(0, 30);

  return progress;
}

function rankWeakTopics(progress, limit = 3) {
  return Object.entries(progress.byTopic)
    // Mark as weak only when there is enough signal and clear struggle.
    .filter(([, v]) => v.attempts >= 3 && v.incorrect >= 2 && v.accuracy < 85)
    .sort((a, b) => {
      if (a[1].accuracy !== b[1].accuracy) return a[1].accuracy - b[1].accuracy;
      return b[1].attempts - a[1].attempts;
    })
    .slice(0, limit)
    .map(([topic, stats]) => ({ topic, ...stats }));
}

function buildProgressSummary(studentId) {
  const progress = initStudentProgress(studentId);
  const totals = progress.totals;
  return {
    studentId: progress.studentId,
    createdAt: progress.createdAt,
    updatedAt: progress.updatedAt,
    totals: {
      ...totals,
      accuracy: pct(totals.correct, totals.attempts),
    },
    byTopic: progress.byTopic,
    byMode: progress.byMode,
    weakTopics: rankWeakTopics(progress),
    recentEvents: progress.recentEvents,
  };
}

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

function reduceRational(r) {
  const g = gcd(r.num, r.den);
  return { num: r.num / g, den: r.den / g };
}

function rationalsEqual(a, b) {
  return a.num * b.den === b.num * a.den;
}

function parseFractionSafe(s) {
  // Accept "a/b" or "a"
  const str = normalize(s);
  if (!str) return null;

  const cleaned = str.replace(/\s+/g, "");

  if (cleaned.includes("/")) {
    const parts = cleaned.split("/");
    if (parts.length !== 2) return null;
    const num = parseInt(parts[0], 10);
    const den = parseInt(parts[1], 10);
    if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
    return reduceRational({ num, den });
  }

  const num = parseInt(cleaned, 10);
  if (!Number.isFinite(num)) return null;
  return reduceRational({ num, den: 1 });
}

function parseMixedSafe(s) {
  // Accept:
  // "2 1/3" (preferred)
  // "2-1/3" (optional)
  // "2  1/3" (extra spaces ok)
  const str = normalize(s);
  if (!str) return null;

  const cleaned = str.replace(/\s+/g, " ").trim();

  // handle "w-n/d"
  if (cleaned.includes("-") && cleaned.includes("/")) {
    const [wholePart, fracPart] = cleaned.split("-");
    const w = parseInt(wholePart, 10);
    if (!Number.isFinite(w)) return null;
    const fr = parseFractionSafe(fracPart);
    if (!fr) return null;
    if (fr.den === 0) return null;
    const num = w * fr.den + fr.num;
    return reduceRational({ num, den: fr.den });
  }

  // handle "w n/d"
  const parts = cleaned.split(" ");
  if (parts.length === 2 && parts[1].includes("/")) {
    const w = parseInt(parts[0], 10);
    if (!Number.isFinite(w)) return null;
    const fr = parseFractionSafe(parts[1]);
    if (!fr) return null;
    const num = w * fr.den + fr.num;
    return reduceRational({ num, den: fr.den });
  }

  return null;
}

function parseRationalFlexible(s) {
  // Accept mixed OR fraction OR integer
  return parseMixedSafe(s) || parseFractionSafe(s);
}

function fractionToString(r) {
  return `${r.num}/${r.den}`;
}

function toMixedString(r) {
  // r should be non-negative
  const w = Math.floor(r.num / r.den);
  const rem = r.num % r.den;
  if (rem === 0) return String(w);
  const fr = reduceRational({ num: rem, den: r.den });
  if (w === 0) return `${fr.num}/${fr.den}`;
  return `${w} ${fr.num}/${fr.den}`;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function makeProperFraction(denMin, denMax) {
  const den = randomInt(denMin, denMax);
  const num = randomInt(1, den - 1);
  return reduceRational({ num, den });
}

function addRationals(list) {
  const den = list.reduce((acc, r) => lcm(acc, r.den), 1);
  const nums = list.map((r) => r.num * (den / r.den));
  const sumNum = nums.reduce((a, b) => a + b, 0);
  return {
    commonDen: den,
    convertedNums: nums,
    unsimplified: { num: sumNum, den },
    simplified: reduceRational({ num: sumNum, den }),
  };
}

function subRationals(a, b) {
  // returns a - b (assume a >= b to avoid negative)
  const den = lcm(a.den, b.den);
  const na = a.num * (den / a.den);
  const nb = b.num * (den / b.den);
  const diff = na - nb;
  return {
    commonDen: den,
    convertedNums: [na, nb],
    unsimplified: { num: diff, den },
    simplified: reduceRational({ num: diff, den }),
  };
}

// =====================
// HOMEWORK: Topics + Difficulty
// =====================
function difficultyRanges(difficulty) {
  const d = (difficulty || "easy").toLowerCase();
  if (d === "hard") return { denMin: 2, denMax: 20, threeTerms: true };
  if (d === "medium") return { denMin: 2, denMax: 12, threeTerms: false };
  return { denMin: 2, denMax: 6, threeTerms: false }; // easy
}

function generateFractionsAdd({ count, difficulty }) {
  const { denMin, denMax, threeTerms } = difficultyRanges(difficulty);
  const problems = [];

  for (let i = 1; i <= count; i++) {
    const termCount = threeTerms ? 3 : 2;
    const terms = [];
    while (terms.length < termCount) {
      const f = makeProperFraction(denMin, denMax);
      terms.push(f);
    }
    const calc = addRationals(terms);
    const question = terms.map(fractionToString).join(" + ") + " = ?";
    problems.push({
      id: i,
      question,
      expected: {
        rational: calc.simplified,
        displayKind: "fraction",
      },
      meta: { terms, calc },
    });
  }
  return problems;
}

function generateFractionsSubtract({ count, difficulty }) {
  const { denMin, denMax, threeTerms } = difficultyRanges(difficulty);
  // Grade 4 subtraction: avoid negative; allow proper OR improper results.
  const problems = [];

  for (let i = 1; i <= count; i++) {
    // Hard can still be 2-term subtraction (keep it simple & grade-appropriate)
    const a = makeProperFraction(denMin, denMax);
    let b = makeProperFraction(denMin, denMax);

    // ensure a >= b (to avoid negative). If not, swap or regenerate.
    let tries = 0;
    while (tries < 20) {
      // compare a and b by cross-multiplying
      if (a.num * b.den >= b.num * a.den) break;
      b = makeProperFraction(denMin, denMax);
      tries++;
    }
    // If still not safe (rare), swap:
    const left = a.num * b.den >= b.num * a.den ? a : b;
    const right = a.num * b.den >= b.num * a.den ? b : a;

    const calc = subRationals(left, right);

    const question = `${fractionToString(left)} - ${fractionToString(right)} = ?`;

    problems.push({
      id: i,
      question,
      expected: {
        rational: calc.simplified, // may be proper or improper (A + C)
        displayKind: "fraction",
      },
      meta: { left, right, calc },
    });
  }
  return problems;
}

function generateSimplifyFraction({ count, difficulty }) {
  // Easy: small reducible fractions
  // Medium/Hard: bigger numbers, still reducible
  const d = (difficulty || "easy").toLowerCase();
  const problems = [];

  for (let i = 1; i <= count; i++) {
    let baseDen = d === "hard" ? randomInt(8, 20) : d === "medium" ? randomInt(6, 14) : randomInt(4, 10);
    let baseNum = randomInt(1, baseDen - 1);

    // Pick a multiplier to make it reducible
    const mult = d === "hard" ? randomInt(3, 8) : d === "medium" ? randomInt(2, 6) : randomInt(2, 4);

    const num = baseNum * mult;
    const den = baseDen * mult;

    const given = { num, den };
    const simplified = reduceRational(given);

    problems.push({
      id: i,
      question: `Simplify: ${num}/${den}`,
      expected: {
        rational: simplified,
        displayKind: "fraction",
      },
      meta: { given, simplified },
    });
  }
  return problems;
}

function generateMixedImproper({ count, difficulty }) {
  // Randomly choose direction per problem:
  // - improper -> mixed
  // - mixed -> improper
  const d = (difficulty || "easy").toLowerCase();
  const problems = [];

  for (let i = 1; i <= count; i++) {
    const denMax = d === "hard" ? 20 : d === "medium" ? 12 : 9;
    const den = randomInt(2, denMax);

    const wholeMax = d === "hard" ? 9 : d === "medium" ? 6 : 4;
    const w = randomInt(1, wholeMax);
    const rem = randomInt(1, den - 1);

    const mixedText = `${w} ${rem}/${den}`;
    const improper = reduceRational({ num: w * den + rem, den });

    const direction = Math.random() < 0.5 ? "mixed_to_improper" : "improper_to_mixed";

    if (direction === "mixed_to_improper") {
      problems.push({
        id: i,
        question: `Convert to an improper fraction: ${mixedText}`,
        expected: {
          rational: improper,
          displayKind: "fraction", // we’ll show correct as fraction
        },
        meta: { direction, mixedText, improper },
      });
    } else {
      // make an improper fraction question
      problems.push({
        id: i,
        question: `Convert to a mixed number: ${fractionToString(improper)}`,
        expected: {
          rational: improper,
          displayKind: "mixed", // we’ll show correct as mixed
        },
        meta: { direction, mixedText, improper },
      });
    }
  }
  return problems;
}

function homeworkGenerate({ grade = 4, topic = "fractions_add", difficulty = "easy", count = 5 }) {
  const safeCount = Math.max(1, Math.min(20, parseInt(count, 10) || 5));
  const t = (topic || "fractions_add").toLowerCase();
  const diff = (difficulty || "easy").toLowerCase();

  let problems;
  if (t === "fractions_add") problems = generateFractionsAdd({ count: safeCount, difficulty: diff });
  else if (t === "fractions_subtract") problems = generateFractionsSubtract({ count: safeCount, difficulty: diff });
  else if (t === "simplify_fraction") problems = generateSimplifyFraction({ count: safeCount, difficulty: diff });
  else if (t === "mixed_improper") problems = generateMixedImproper({ count: safeCount, difficulty: diff });
  else problems = generateFractionsAdd({ count: safeCount, difficulty: diff });

  // store answer key in state (rational + displayKind)
  const stateProblems = problems.map((p) => ({
    id: p.id,
    question: p.question,
    expected: p.expected,
    meta: p.meta,
  }));
  const sessionId = `hw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  return {
    ok: true,
    kind: "homework",
    homework: {
      grade,
      topic: t,
      difficulty: diff,
      count: safeCount,
      problems: stateProblems.map(({ id, question }) => ({ id, question })),
    },
    state: {
      sessionId,
      grade,
      topic: t,
      difficulty: diff,
      problems: stateProblems,
    },
  };
}

function formatCorrectAnswer(expected) {
  if (expected.displayKind === "mixed") {
    return toMixedString(expected.rational);
  }
  return fractionToString(expected.rational);
}

function homeworkGrade({ state, studentAnswers, studentId = "anonymous" }) {
  if (!state?.problems || !Array.isArray(state.problems)) {
    return { ok: false, error: "Missing homework state/problems." };
  }

  const answersMap = studentAnswers || {};
  const results = [];
  let correctCount = 0;

  for (const p of state.problems) {
    const userRaw = normalize(answersMap[p.id]);
    const userRat = parseRationalFlexible(userRaw);
    const expectedRat = p.expected?.rational;

    let isCorrect = false;
    if (userRat && expectedRat) {
      // prevent negatives for student input? allow but compare
      isCorrect = rationalsEqual(userRat, expectedRat);
    }

    if (isCorrect) correctCount++;

    recordProgressEvent({
      studentId,
      mode: "homework",
      topic: state.topic || "general",
      isCorrect,
      dedupeKey: `homework:${state.sessionId || "legacy"}:q:${p.id}`,
      meta: {
        sessionId: state.sessionId || "legacy",
        questionId: p.id,
        difficulty: state.difficulty || "easy",
      },
    });

    const correctAnswerText = formatCorrectAnswer(p.expected);

    results.push({
      id: p.id,
      question: p.question,
      userAnswer: userRaw || "",
      isCorrect,
      correctAnswer: correctAnswerText,
      feedback: isCorrect
        ? "✅ Correct"
        : "❌ Not correct. Check common denominators and simplify (if needed).",
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
    progress: buildProgressSummary(studentId),
  };
}

// =====================
// GUIDED: user-initiated fraction addition (2–3 terms)
// =====================
async function aiOneSentenceHelp(prompt) {
  if (!client) return "";
  try {
    const resp = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        {
          role: "system",
          content:
            "You are a calm Grade 4 math tutor. Give a short 1–2 sentence hint. Use a/b for fractions. No LaTeX. Ask one question.",
        },
        { role: "user", content: prompt },
      ],
    });
    return resp.output_text || "";
  } catch {
    return "";
  }
}

async function aiShortAnswer(prompt) {
  if (!client) return "";
  try {
    const resp = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        {
          role: "system",
          content:
            "You are a calm Grade 4 math tutor. Give a short direct answer in 1-2 sentences. Use a/b for fractions. No LaTeX.",
        },
        { role: "user", content: prompt },
      ],
    });
    return resp.output_text || "";
  } catch {
    return "";
  }
}

function parseFractionExpression(expr) {
  const s = normalize(expr);
  if (!s) return null;
  const cleaned = s.replace(/\s+/g, "");
  const parts = cleaned.split("+").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2 || parts.length > 3) return null;
  const frs = parts.map(parseFractionSafe);
  if (frs.some((f) => !f)) return null;
  for (const f of frs) if (f.den <= 0) return null;
  return frs;
}

function extractFractionExpressionFromText(text) {
  const s = normalize(text);
  if (!s) return null;
  const match = s.match(/(?:-?\d+\s*\/\s*-?\d+\s*\+\s*){1,2}-?\d+\s*\/\s*-?\d+/);
  if (!match || !match[0]) return null;
  return parseFractionExpression(match[0]);
}

function extractFirstFractionFromText(text) {
  const s = normalize(text);
  if (!s) return null;
  const match = s.match(/-?\d+\s*\/\s*-?\d+/);
  if (!match || !match[0]) return null;
  return parseFractionSafe(match[0]);
}

function classifyFractionType(fr) {
  if (!fr) return null;
  const n = Math.abs(fr.num);
  const d = Math.abs(fr.den);
  if (n < d) return "proper";
  if (n === d) return "improper (equal to 1)";
  return "improper";
}

function isMathRelatedQuestion(text) {
  const s = normalize(text).toLowerCase();
  if (!s) return false;

  const mathKeywords = [
    "math",
    "fraction",
    "fractions",
    "proper",
    "improper",
    "mixed number",
    "denominator",
    "numerator",
    "lcm",
    "gcf",
    "gcd",
    "simplify",
    "add",
    "subtract",
    "multiply",
    "divide",
    "equation",
    "algebra",
    "geometry",
    "percent",
    "ratio",
    "decimal",
    "integer",
    "number",
  ];

  return mathKeywords.some((k) => s.includes(k));
}

function guidedWelcome() {
  return {
    ok: true,
    kind: "guided",
    state: { phase: "await_problem", lastSolved: null },
    tutor: {
      text:
        "Guided Tutor ✅\n\nType a fraction addition problem like:\n" +
        "1/4 + 1/5\n" +
        "or\n" +
        "1/4 + 1/5 + 1/6\n\nYou can also ask related questions like:\n" +
        "\"Is 7/4 a proper or improper fraction?\"",
      expectedFormat: "Example: 2/3 + 1/6",
    },
  };
}

async function guidedStartFromProblem(problemText, state = {}) {
  const frs = parseFractionExpression(problemText) || extractFractionExpressionFromText(problemText);
  if (!frs) {
    const lower = normalize(problemText).toLowerCase();
    const isQuestionLike = /[a-zA-Z?]/.test(problemText);
    const asksProperImproper = lower.includes("proper") || lower.includes("improper");
    const fromText = extractFirstFractionFromText(problemText);
    const target = fromText || state.lastSolved || null;

    if (isQuestionLike && asksProperImproper && target) {
      const kind = classifyFractionType(target);
      return {
        ok: true,
        kind: "guided",
        state: { phase: "await_problem", lastSolved: state.lastSolved || null },
        tutor: {
          text:
            `${target.num}/${target.den} is a ${kind} fraction.\n\n` +
            "You can type a new addition problem whenever you are ready.",
          expectedFormat: "Example: 3/8 + 1/6",
        },
      };
    }

    if (isQuestionLike) {
      if (!isMathRelatedQuestion(problemText)) {
        return {
          ok: true,
          kind: "guided",
          state: { phase: "await_problem", lastSolved: state.lastSolved || null },
          tutor: {
            text:
              "I can only answer math-related questions here.\n\n" +
              "Please ask a math question or type a fraction problem like 1/4 + 1/5.",
            expectedFormat: "Example: 3/8 + 1/6",
          },
        };
      }

      const answer = await aiShortAnswer(
        `Student asked: "${problemText}"\n` +
          "Answer briefly for Grade 4 fractions. If it is not clear, ask them to include the fraction like a/b."
      );
      return {
        ok: true,
        kind: "guided",
        state: { phase: "await_problem", lastSolved: state.lastSolved || null },
        tutor: {
          text:
            `${answer || "I can help with fraction questions. Please include the fraction like a/b."}\n\n` +
            "You can also start a guided problem like: 1/4 + 1/5",
          expectedFormat: "Example: 3/8 + 1/6",
        },
      };
    }

    return {
      ok: true,
      kind: "guided",
      state: { phase: "await_problem", lastSolved: state.lastSolved || null },
      tutor: {
        text:
          "Please type a fraction addition problem using a/b format and + only.\n" +
          "Examples:\n" +
          "3/8 + 1/6\n" +
          "1/4 + 1/5 + 1/6\n\n" +
          "Or ask a related question like: Is 7/4 proper or improper?",
        expectedFormat: "Example: 3/8 + 1/6",
      },
    };
  }

  const frStrings = frs.map(fractionToString);
  const calc = addRationals(frs);
  const densText = frs.map((f) => f.den).join(", ");

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
      simplified: calc.simplified,
    },
    tutor: {
      text:
        `Great. Let’s solve: ${frStrings.join(" + ")}\n\n` +
        `Step 1: What is the LCM of the denominators (${densText})?`,
      expectedFormat: "Number",
    },
  };
}

async function guidedAnswer(body) {
  const state = body.state || {};
  const studentId = safeStudentId(body.studentId);
  const phase = state.phase;
  const studentAnswer = normalize(body.studentAnswer);

  if (studentAnswer.toLowerCase() === "restart") return guidedWelcome();

  if (phase === "await_problem") {
    return guidedStartFromProblem(studentAnswer, state);
  }

  if (phase !== "in_lesson") return guidedWelcome();

  const step = state.step;
  const fractions = state.fractions || [];
  const commonDen = state.commonDen;
  const nums = state.convertedNums || [];
  const correctSum = state.correctSum;
  const simplified = state.simplified;

  if (step === 1) {
    const ans = parseIntLoose(studentAnswer);
    const isCorrect = ans !== null && ans === commonDen;

    if (!isCorrect) {
      recordProgressEvent({
        studentId,
        mode: "guided",
        topic: "fractions_add",
        isCorrect: false,
        meta: { step: 1 },
      });

      const hint = await aiOneSentenceHelp(
        `Student is finding LCM for denominators in: ${fractions.join(" + ")}.
Student answered: "${studentAnswer}".
Give a short hint WITHOUT giving the final LCM. Ask one question.`
      );
      return {
        ok: true,
        kind: "guided",
        state: { ...state, step: 1 },
        tutor: {
          text: `Not quite. ${hint || "Try listing multiples of each denominator and find the first common one."}`,
          expectedFormat: "Number",
        },
        validation: { isCorrect: false },
      };
    }

    recordProgressEvent({
      studentId,
      mode: "guided",
      topic: "fractions_add",
      isCorrect: true,
      meta: { step: 1 },
    });

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

  if (step === 2) {
    const parts = studentAnswer.split(",").map((x) => x.trim()).filter(Boolean);
    let userNums = null;

    if (parts.length === nums.length) {
      // numbers
      const asInts = parts.map((p) => parseIntLoose(p));
      if (asInts.every((n) => Number.isFinite(n))) userNums = asInts;

      // or fractions: "15/60"
      if (!userNums) {
        const asFr = parts.map(parseFractionSafe);
        if (asFr.every(Boolean)) userNums = asFr.map((f) => f.num);
      }
    }

    const isCorrect =
      Array.isArray(userNums) &&
      userNums.length === nums.length &&
      userNums.every((n, i) => n === nums[i]);

    if (!isCorrect) {
      recordProgressEvent({
        studentId,
        mode: "guided",
        topic: "fractions_add",
        isCorrect: false,
        meta: { step: 2 },
      });

      const hint = await aiOneSentenceHelp(
        `Student is converting ${fractions.join(" + ")} to denominator ${commonDen}.
Student answered: "${studentAnswer}".
Give ONE hint without giving numerators. Ask one question.`
      );
      return {
        ok: true,
        kind: "guided",
        state: { ...state, step: 2 },
        tutor: {
          text: `Not quite. ${hint || "Multiply each numerator by (commonDenominator ÷ its denominator)."}`
        },
        validation: { isCorrect: false },
      };
    }

    recordProgressEvent({
      studentId,
      mode: "guided",
      topic: "fractions_add",
      isCorrect: true,
      meta: { step: 2 },
    });

    return {
      ok: true,
      kind: "guided",
      state: { ...state, step: 3 },
      tutor: {
        text:
          `Exactly! Now we have: ${nums.map((n) => `${n}/${commonDen}`).join(", ")}\n\n` +
          `Step 3: Add the numerators: ${nums.join(" + ")}\n` +
          `What is the total numerator?`,
        expectedFormat: "Number",
      },
      validation: { isCorrect: true },
    };
  }

  if (step === 3) {
    const ans = parseIntLoose(studentAnswer);
    const isCorrect = ans !== null && ans === correctSum;

    if (!isCorrect) {
      recordProgressEvent({
        studentId,
        mode: "guided",
        topic: "fractions_add",
        isCorrect: false,
        meta: { step: 3 },
      });

      const hint = await aiOneSentenceHelp(
        `Student is adding numerators: ${nums.join(" + ")}.
Student answered: "${studentAnswer}".
Give a hint to re-check addition (start with first two), do NOT give final sum. Ask one question.`
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

    recordProgressEvent({
      studentId,
      mode: "guided",
      topic: "fractions_add",
      isCorrect: true,
      meta: { step: 3 },
    });

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

  if (step === 4) {
    const ans = parseFractionSafe(studentAnswer);
    if (!ans) {
      recordProgressEvent({
        studentId,
        mode: "guided",
        topic: "fractions_add",
        isCorrect: false,
        meta: { step: 4, reason: "invalid_fraction_format" },
      });

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

    const isCorrect = rationalsEqual(ans, simplified);

    if (!isCorrect) {
      recordProgressEvent({
        studentId,
        mode: "guided",
        topic: "fractions_add",
        isCorrect: false,
        meta: { step: 4 },
      });

      const hint = await aiOneSentenceHelp(
        `Student is simplifying ${correctSum}/${commonDen}.
Student answered: "${studentAnswer}".
Give a hint about greatest common factor, do NOT give final fraction. Ask one question.`
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

    recordProgressEvent({
      studentId,
      mode: "guided",
      topic: "fractions_add",
      isCorrect: true,
      meta: { step: 4, completed: true },
    });

    return {
      ok: true,
      kind: "guided",
      state: { phase: "await_problem", lastSolved: simplified },
      tutor: {
        text:
          `Excellent ✅ Final Answer: ${simplified.num}/${simplified.den}\n\n` +
          `Type another fraction addition problem, ask a related question, or type "restart" for instructions.`,
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
      const difficulty = body.difficulty ?? "easy";
      const count = body.count ?? 5;
      return json(200, homeworkGenerate({ grade, topic, difficulty, count }));
    }

    if (mode === "homework_grade") {
      const result = homeworkGrade({
        state: body.state,
        studentAnswers: body.studentAnswers,
        studentId: body.studentId,
      });
      return json(result.ok ? 200 : 400, result);
    }

    if (mode === "progress_event") {
      const progress = recordProgressEvent({
        studentId: body.studentId,
        mode: body.eventMode || "general",
        topic: body.topic || "general",
        isCorrect: !!body.isCorrect,
        meta: body.meta || {},
      });
      return json(200, {
        ok: true,
        kind: "progress",
        progress: buildProgressSummary(progress.studentId),
      });
    }

    if (mode === "progress_summary") {
      return json(200, {
        ok: true,
        kind: "progress",
        progress: buildProgressSummary(body.studentId),
      });
    }

    // GUIDED
    if (mode === "guided_welcome") return json(200, guidedWelcome());
    if (mode === "guided_answer") return json(200, await guidedAnswer(body));

    // Default
    return json(200, guidedWelcome());
  } catch (err) {
    console.error("Tutor function error:", err);
    return json(500, { ok: false, error: "Internal server error", details: err.message });
  }
};
