import { supabase } from "./supabaseClient.js";

function safeText(v, fallback = "") {
  const s = (v ?? "").toString().trim();
  return s || fallback;
}

export function isUuidLike(value) {
  const s = safeText(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

export function computeMasteryLevel(accuracy, attempts) {
  const a = Number(accuracy) || 0;
  const n = Number(attempts) || 0;
  if (a < 50) return "Beginner";
  if (a < 75) return "Developing";
  if (a < 90) return "Proficient";
  if (n >= 10) return "Master";
  return "Proficient";
}

export async function logActivity({
  studentId,
  mode = "homework",
  topicKey = "general",
  skillKey = "general",
  difficulty = "easy",
  result = "incorrect",
  errorType = null,
  timeSpentSeconds = 0,
  hintsUsed = 0,
  metadata = {},
}) {
  try {
    if (!isUuidLike(studentId)) return { ok: false, skipped: true, reason: "non_uuid_student_id" };

    const payload = {
      student_id: studentId,
      mode: safeText(mode, "homework"),
      topic_key: safeText(topicKey, "general"),
      skill_key: safeText(skillKey, safeText(topicKey, "general")),
      difficulty: safeText(difficulty, "easy"),
      result: safeText(result, "incorrect"),
      error_type: errorType ? safeText(errorType) : null,
      time_spent_seconds: Math.max(0, Number(timeSpentSeconds) || 0),
      hints_used: Math.max(0, Number(hintsUsed) || 0),
      metadata: metadata && typeof metadata === "object" ? metadata : {},
    };

    const { data, error } = await supabase.from("activity_log").insert(payload).select("id").single();
    if (error) {
      console.error("[supabase] logActivity failed", error);
      return { ok: false, error };
    }
    return { ok: true, data };
  } catch (err) {
    console.error("[supabase] logActivity exception", err);
    return { ok: false, error: err };
  }
}

export async function upsertSkillProgress({
  studentId,
  topicKey = "general",
  skillKey = "general",
  attemptsDelta = 0,
  correctDelta = 0,
  incorrectDelta = 0,
  hintsUsedDelta = 0,
  lastErrorType = null,
}) {
  try {
    if (!isUuidLike(studentId)) return { ok: false, skipped: true, reason: "non_uuid_student_id" };

    const topic = safeText(topicKey, "general");
    const skill = safeText(skillKey, topic);
    const addAttempts = Math.max(0, Number(attemptsDelta) || 0);
    const addCorrect = Math.max(0, Number(correctDelta) || 0);
    const addIncorrect = Math.max(0, Number(incorrectDelta) || 0);
    const addHints = Math.max(0, Number(hintsUsedDelta) || 0);

    const { data: existing, error: selectErr } = await supabase
      .from("skill_progress")
      .select("attempts, correct, incorrect, hints_used")
      .eq("student_id", studentId)
      .eq("topic_key", topic)
      .eq("skill_key", skill)
      .maybeSingle();

    if (selectErr) {
      console.error("[supabase] upsertSkillProgress select failed", selectErr);
      return { ok: false, error: selectErr };
    }

    const attempts = (Number(existing?.attempts) || 0) + addAttempts;
    const correct = (Number(existing?.correct) || 0) + addCorrect;
    const incorrect = (Number(existing?.incorrect) || 0) + addIncorrect;
    const hintsUsed = (Number(existing?.hints_used) || 0) + addHints;
    const accuracy = attempts > 0 ? Number(((correct / attempts) * 100).toFixed(2)) : 0;
    const masteryLevel = computeMasteryLevel(accuracy, attempts);

    const payload = {
      student_id: studentId,
      topic_key: topic,
      skill_key: skill,
      attempts,
      correct,
      incorrect,
      accuracy,
      hints_used: hintsUsed,
      last_error_type: lastErrorType ? safeText(lastErrorType) : null,
      mastery_level: masteryLevel,
    };

    const { data, error } = await supabase
      .from("skill_progress")
      .upsert(payload, { onConflict: "student_id,topic_key,skill_key" })
      .select("student_id, topic_key, skill_key, attempts, correct, incorrect, accuracy, hints_used, mastery_level")
      .single();

    if (error) {
      console.error("[supabase] upsertSkillProgress failed", error);
      return { ok: false, error };
    }
    return { ok: true, data };
  } catch (err) {
    console.error("[supabase] upsertSkillProgress exception", err);
    return { ok: false, error: err };
  }
}

export async function fetchStudentProgressFromSupabase(studentId) {
  if (!isUuidLike(studentId)) return null;
  try {
    const [{ data: skillRows, error: skillErr }, { data: logRows, error: logErr }] = await Promise.all([
      supabase
        .from("skill_progress")
        .select("topic_key, skill_key, attempts, correct, incorrect, accuracy, hints_used, last_error_type, updated_at")
        .eq("student_id", studentId),
      supabase
        .from("activity_log")
        .select("mode, topic_key, skill_key, difficulty, result, error_type, time_spent_seconds, hints_used, metadata, created_at")
        .eq("student_id", studentId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    if (skillErr) {
      console.error("[supabase] fetch skill_progress failed", skillErr);
      return null;
    }
    if (logErr) {
      console.error("[supabase] fetch activity_log failed", logErr);
      return null;
    }

    const byTopic = {};
    for (const row of skillRows || []) {
      const topic = safeText(row.topic_key, "general");
      if (!byTopic[topic]) byTopic[topic] = { attempts: 0, correct: 0, incorrect: 0, accuracy: 0 };
      byTopic[topic].attempts += Number(row.attempts) || 0;
      byTopic[topic].correct += Number(row.correct) || 0;
      byTopic[topic].incorrect += Number(row.incorrect) || 0;
    }
    for (const topic of Object.keys(byTopic)) {
      const t = byTopic[topic];
      t.accuracy = t.attempts > 0 ? Number(((t.correct / t.attempts) * 100).toFixed(2)) : 0;
    }

    const totals = Object.values(byTopic).reduce(
      (acc, t) => {
        acc.attempts += t.attempts;
        acc.correct += t.correct;
        acc.incorrect += t.incorrect;
        return acc;
      },
      { attempts: 0, correct: 0, incorrect: 0 }
    );
    const totalAccuracy = totals.attempts > 0 ? Number(((totals.correct / totals.attempts) * 100).toFixed(2)) : 0;

    const errorTypeByTopic = {};
    const recentEvents = [];
    let timedAttempts = 0;
    let totalTimeSeconds = 0;
    const byMode = {};

    for (const row of logRows || []) {
      const topic = safeText(row.topic_key, "general");
      const mode = safeText(row.mode, "homework");
      const result = safeText(row.result, "incorrect");
      const sec = Number(row.time_spent_seconds) || 0;
      const isCorrect = result === "correct";

      if (!byMode[mode]) byMode[mode] = { attempts: 0, correct: 0, incorrect: 0, accuracy: 0 };
      byMode[mode].attempts += 1;
      if (isCorrect) byMode[mode].correct += 1;
      else byMode[mode].incorrect += 1;

      if (sec > 0) {
        timedAttempts += 1;
        totalTimeSeconds += sec;
      }

      const err = safeText(row.error_type).toUpperCase();
      if (err) {
        if (!errorTypeByTopic[topic]) errorTypeByTopic[topic] = {};
        errorTypeByTopic[topic][err] = (errorTypeByTopic[topic][err] || 0) + 1;
      }

      recentEvents.push({
        ts: row.created_at,
        mode,
        topic,
        isCorrect,
        meta: {
          difficulty: safeText(row.difficulty, "easy"),
          timeSpentMs: sec * 1000,
          hintsUsed: Number(row.hints_used) || 0,
          metadata: row.metadata || {},
        },
      });
    }

    for (const mode of Object.keys(byMode)) {
      const m = byMode[mode];
      m.accuracy = m.attempts > 0 ? Number(((m.correct / m.attempts) * 100).toFixed(2)) : 0;
    }

    const weakTopics = Object.entries(byTopic)
      .filter(([, v]) => v.attempts >= 3 && v.incorrect >= 2 && v.accuracy < 85)
      .sort((a, b) => {
        if (a[1].accuracy !== b[1].accuracy) return a[1].accuracy - b[1].accuracy;
        return b[1].attempts - a[1].attempts;
      })
      .slice(0, 3)
      .map(([topic, stats]) => ({ topic, ...stats }));

    return {
      studentId,
      totals: {
        attempts: totals.attempts,
        correct: totals.correct,
        incorrect: totals.incorrect,
        accuracy: totalAccuracy,
        averageTimePerProblemSec: timedAttempts > 0 ? Math.round(totalTimeSeconds / timedAttempts) : 0,
      },
      byTopic,
      byMode,
      errorTypeByTopic,
      weakTopics,
      recentEvents: recentEvents.slice(0, 30),
    };
  } catch (err) {
    console.error("[supabase] fetchStudentProgressFromSupabase exception", err);
    return null;
  }
}
