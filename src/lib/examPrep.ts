import { store } from './store';
import { aiAsk } from './ai';
import { fetchCardsForDeck, fetchFlashcardDecks } from './flashcards';
import { logUserActivity } from './activity';

export interface ExamReadinessResult {
  courseCode: string;
  score: number;
  tier: 'Exam Ready' | 'Good Progress' | 'Needs Review' | 'Critical Revision';
  readingProgressPct: number;
  flashcardMasteryPct: number;
  tasksCompletedCount: number;
  actionableInsights: string[];
}

export interface ExamPrepQuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface ExamPrepPlan {
  courseCode: string;
  examDate: string;
  daysRemaining: number;
  summary: string;
  weeklyPlan: {
    week: string;
    focus: string;
    dailyTasks: string[];
  }[];
  quizQuestions: ExamPrepQuizQuestion[];
  recommendedMaterialIds: string[];
}

/**
 * Deterministically calculates student readiness score for a specific course.
 */
export async function calculateExamReadiness(
  courseCode: string,
  targetExamDate?: string
): Promise<ExamReadinessResult> {
  const normCode = courseCode.trim().toUpperCase();

  // 1. Reading progress for this course
  const reading = store.getReadingHistory();
  const courseReading = reading.filter(
    (r) => (r.course || '').toUpperCase() === normCode
  );

  let readingProgressPct = 0;
  if (courseReading.length > 0) {
    const totalPct = courseReading.reduce((sum, r) => sum + (r.percentage || 0), 0);
    readingProgressPct = Math.min(100, Math.round(totalPct / courseReading.length));
  }

  // 2. Flashcard mastery for this course
  let flashcardMasteryPct = 0;
  try {
    const decks = await fetchFlashcardDecks();
    const courseDecks = decks.filter(
      (d) => (d.course_code || '').toUpperCase() === normCode
    );

    if (courseDecks.length > 0) {
      let totalReviewed = 0;
      let totalCards = 0;

      for (const deck of courseDecks) {
        const cards = await fetchCardsForDeck(deck.id);
        totalCards += cards.length;
        totalReviewed += cards.filter((c) => c.repetitions > 0).length;
      }

      if (totalCards > 0) {
        flashcardMasteryPct = Math.min(100, Math.round((totalReviewed / totalCards) * 100));
      }
    }
  } catch {}

  // 3. Completed materials downloads
  const downloads = store.getDownloadHistory();
  const courseDownloads = downloads.filter(
    (d) => (d.course || '').toUpperCase() === normCode
  );
  const downloadScore = Math.min(100, courseDownloads.length * 25);

  // Weighted score calculation
  // Reading: 45%, Flashcards: 35%, Downloads/Materials: 20%
  const score = Math.min(
    100,
    Math.round(
      readingProgressPct * 0.45 +
      flashcardMasteryPct * 0.35 +
      downloadScore * 0.20
    )
  );

  let tier: ExamReadinessResult['tier'] = 'Critical Revision';
  if (score >= 80) tier = 'Exam Ready';
  else if (score >= 60) tier = 'Good Progress';
  else if (score >= 40) tier = 'Needs Review';

  // Actionable Insights
  const actionableInsights: string[] = [];
  if (readingProgressPct < 60) {
    actionableInsights.push(`Read remaining approved course materials for ${normCode} (+${Math.round((100 - readingProgressPct) * 0.45)}% readiness).`);
  }
  if (flashcardMasteryPct < 50) {
    actionableInsights.push(`Review ${normCode} flashcards to lock in core formulas and definitions (+${Math.round((100 - flashcardMasteryPct) * 0.35)}% readiness).`);
  }
  if (courseDownloads.length === 0) {
    actionableInsights.push(`Download past questions and lecture packs for offline preparation.`);
  }
  if (actionableInsights.length === 0) {
    actionableInsights.push(`Maintain your active recall schedule until exam day!`);
  }

  return {
    courseCode: normCode,
    score,
    tier,
    readingProgressPct,
    flashcardMasteryPct,
    tasksCompletedCount: courseReading.length + courseDownloads.length,
    actionableInsights
  };
}

/**
 * Generate an AI-assisted exam preparation schedule and practice quiz.
 */
export async function generateExamPrepPlan(input: {
  courseCode: string;
  examDate: string;
  weakTopics?: string;
}): Promise<ExamPrepPlan> {
  const normCode = input.courseCode.trim().toUpperCase();
  const exam = new Date(input.examDate);
  const now = new Date();
  const diffDays = Math.max(1, Math.ceil((exam.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

  const prompt = `Generate a rigorous exam preparation plan for university course "${normCode}".
Target exam date: in ${diffDays} days (${input.examDate}).
${input.weakTopics ? `Identified weak topics to prioritize: ${input.weakTopics}` : ''}

Format response into these exact sections:
### SUMMARY
[Strategic approach to mastering this course in the remaining days]

### SCHEDULE
WEEK 1: [Focus Area]
- [Day 1 Task]
- [Day 2 Task]
- [Day 3 Task]

WEEK 2: [Focus Area]
- [Day 4 Task]
- [Day 5 Task]

### PRACTICE QUIZ
1. [Question text]
A) [Option A]
B) [Option B]
C) [Option C]
D) [Option D]
CORRECT: [A/B/C/D]
EXPLANATION: [Reasoning]

2. [Question text]
A) [Option A]
B) [Option B]
C) [Option C]
D) [Option D]
CORRECT: [A/B/C/D]
EXPLANATION: [Reasoning]

3. [Question text]
A) [Option A]
B) [Option B]
C) [Option C]
D) [Option D]
CORRECT: [A/B/C/D]
EXPLANATION: [Reasoning]`;

  const res = await aiAsk({
    message: prompt,
    mode: 'exam'
  });

  const parsed = parseExamPrepPlan(res.answer, normCode, input.examDate, diffDays);

  // Log activity
  logUserActivity({
    activityType: 'study_task_completed',
    entityType: 'exam_prep_plan',
    entityTitle: `Exam Prep Plan created for ${normCode} (${diffDays}d remaining)`,
    metadata: { courseCode: normCode, examDate: input.examDate, daysRemaining: diffDays }
  }).catch(() => {});

  return parsed;
}

function parseExamPrepPlan(
  text: string,
  courseCode: string,
  examDate: string,
  daysRemaining: number
): ExamPrepPlan {
  const plan: ExamPrepPlan = {
    courseCode,
    examDate,
    daysRemaining,
    summary: '',
    weeklyPlan: [],
    quizQuestions: [],
    recommendedMaterialIds: []
  };

  const sections = text.split(/###\s+/);

  for (const sec of sections) {
    const trimmed = sec.trim();
    if (!trimmed) continue;

    const firstLineEnd = trimmed.indexOf('\n');
    const title = (firstLineEnd !== -1 ? trimmed.slice(0, firstLineEnd) : trimmed).toUpperCase().trim();
    const body = firstLineEnd !== -1 ? trimmed.slice(firstLineEnd).trim() : '';

    if (title.includes('SUMMARY')) {
      plan.summary = body;
    } else if (title.includes('SCHEDULE')) {
      const weeks = body.split(/(?=WEEK\s+\d+:)/i);
      for (const w of weeks) {
        const lines = w.split('\n').filter(Boolean);
        if (lines.length > 0) {
          const header = lines[0].replace(/^WEEK\s+\d+:\s*/i, '').trim();
          const tasks = lines.slice(1).map((l) => l.replace(/^[-*•]\s+/, '').trim()).filter(Boolean);
          plan.weeklyPlan.push({
            week: lines[0].split(':')[0] || 'Week 1',
            focus: header,
            dailyTasks: tasks
          });
        }
      }
    } else if (title.includes('PRACTICE QUIZ')) {
      const qBlocks = body.split(/\n(?=\d+\.\s+)/);
      for (const qb of qBlocks) {
        const clean = qb.replace(/^\d+\.\s+/, '').trim();
        const optA = clean.match(/A\)\s*(.+?)(?=(B\)|$))/is);
        const optB = clean.match(/B\)\s*(.+?)(?=(C\)|$))/is);
        const optC = clean.match(/C\)\s*(.+?)(?=(D\)|$))/is);
        const optD = clean.match(/D\)\s*(.+?)(?=(CORRECT:|$))/is);
        const correctMatch = clean.match(/CORRECT:\s*([A-D])/i);
        const explMatch = clean.match(/EXPLANATION:\s*(.+)/is);
        const qText = clean.split(/A\)/)[0]?.trim();

        if (qText && optA && optB) {
          const options = [
            optA[1].trim(),
            optB[1].trim(),
            optC ? optC[1].trim() : 'None of the above',
            optD ? optD[1].trim() : 'All of the above'
          ];
          const letter = (correctMatch ? correctMatch[1] : 'A').toUpperCase();
          const correctIndex = letter === 'B' ? 1 : letter === 'C' ? 2 : letter === 'D' ? 3 : 0;

          plan.quizQuestions.push({
            question: qText,
            options,
            correctIndex,
            explanation: explMatch ? explMatch[1].trim() : 'Correct answer per course materials.'
          });
        }
      }
    }
  }

  if (!plan.summary && text) {
    plan.summary = text;
  }

  return plan;
}
