import { aiAsk } from './ai';
import { logUserActivity } from './activity';

export interface SimilarQuestion {
  question: string;
  hint: string;
  solution: string;
}

export interface QuestionAnalysisResult {
  question: string;
  topic: string;
  courseCode?: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Exam Standard' | 'Advanced';
  explanation: string;
  stepByStep: string[];
  keyConcepts: string[];
  commonMistakes: string[];
  similarQuestions: SimilarQuestion[];
  suggestedTopics: string[];
  citations?: { title: string; materialId: string; page?: number }[];
}

/**
 * Perform in-depth academic question analysis using the FUW AI engine.
 */
export async function analyzeQuestion(
  questionText: string,
  options?: {
    courseCode?: string;
    materialId?: string | null;
  }
): Promise<QuestionAnalysisResult> {
  const prompt = `Analyze this university examination/assignment question thoroughly:
"${questionText}"

${options?.courseCode ? `Context course: ${options.courseCode}` : ''}

Provide your response in structured markdown with the following sections clearly labeled:
### TOPIC
[Specific subject domain and topic]

### DIFFICULTY
[One of: Beginner, Intermediate, Exam Standard, Advanced]

### OVERVIEW & EXPLANATION
[Clear explanation of what the question is asking and the fundamental principles involved]

### STEP-BY-STEP SOLUTION
1. [Step 1]
2. [Step 2]
3. [Step 3]

### KEY CONCEPTS & FORMULAS
- [Concept 1]
- [Concept 2]

### COMMON MISTAKES & EXAMINER TRAPS
- [Mistake 1]
- [Mistake 2]

### SIMILAR PRACTICE QUESTIONS
1. [Practice Question 1]
HINT: [Brief hint]
ANSWER: [Concise answer]

2. [Practice Question 2]
HINT: [Brief hint]
ANSWER: [Concise answer]

### SUGGESTED REVISION TOPICS
- [Topic 1]
- [Topic 2]`;

  const res = await aiAsk({
    message: prompt,
    materialId: options?.materialId,
    mode: 'exam'
  });

  const parsed = parseAnalysisMarkdown(questionText, res.answer, options?.courseCode);

  if (res.citations && res.citations.length > 0) {
    parsed.citations = res.citations.map((c) => ({
      title: c.title,
      materialId: c.material_id,
      page: c.page ?? undefined
    }));
  }

  // Log activity
  logUserActivity({
    activityType: 'study_task_completed',
    entityType: 'question_analysis',
    entityTitle: `Question Analysis: ${questionText.slice(0, 45)}...`,
    metadata: {
      courseCode: options?.courseCode,
      difficulty: parsed.difficulty,
      topic: parsed.topic
    }
  }).catch(() => {});

  return parsed;
}

function parseAnalysisMarkdown(
  originalQuestion: string,
  text: string,
  courseCode?: string
): QuestionAnalysisResult {
  const result: QuestionAnalysisResult = {
    question: originalQuestion,
    topic: 'University Course Topic',
    courseCode,
    difficulty: 'Exam Standard',
    explanation: '',
    stepByStep: [],
    keyConcepts: [],
    commonMistakes: [],
    similarQuestions: [],
    suggestedTopics: []
  };

  const sections = text.split(/###\s+/);

  for (const sec of sections) {
    const trimmed = sec.trim();
    if (!trimmed) continue;

    const firstLineEnd = trimmed.indexOf('\n');
    const title = (firstLineEnd !== -1 ? trimmed.slice(0, firstLineEnd) : trimmed).toUpperCase().trim();
    const content = firstLineEnd !== -1 ? trimmed.slice(firstLineEnd).trim() : '';

    if (title.includes('TOPIC')) {
      result.topic = content.replace(/^\[|\]$/g, '').trim();
    } else if (title.includes('DIFFICULTY')) {
      if (content.includes('Beginner')) result.difficulty = 'Beginner';
      else if (content.includes('Intermediate')) result.difficulty = 'Intermediate';
      else if (content.includes('Advanced')) result.difficulty = 'Advanced';
      else result.difficulty = 'Exam Standard';
    } else if (title.includes('OVERVIEW') || title.includes('EXPLANATION')) {
      result.explanation = content;
    } else if (title.includes('STEP-BY-STEP')) {
      result.stepByStep = content
        .split(/\n(?=\d+\.\s+)/)
        .map((s) => s.replace(/^\d+\.\s+/, '').trim())
        .filter(Boolean);
      if (result.stepByStep.length === 0 && content) {
        result.stepByStep = content.split('\n').filter(Boolean);
      }
    } else if (title.includes('KEY CONCEPTS') || title.includes('FORMULAS')) {
      result.keyConcepts = content
        .split('\n')
        .map((l) => l.replace(/^[-*•]\s+/, '').trim())
        .filter(Boolean);
    } else if (title.includes('COMMON MISTAKES') || title.includes('TRAPS')) {
      result.commonMistakes = content
        .split('\n')
        .map((l) => l.replace(/^[-*•]\s+/, '').trim())
        .filter(Boolean);
    } else if (title.includes('SIMILAR') || title.includes('PRACTICE')) {
      const items = content.split(/\n(?=\d+\.\s+)/);
      for (const it of items) {
        const clean = it.replace(/^\d+\.\s+/, '').trim();
        const hintMatch = clean.match(/HINT:\s*(.+?)(?=(ANSWER:|$))/is);
        const ansMatch = clean.match(/ANSWER:\s*(.+)/is);
        const qText = clean.replace(/HINT:[\s\S]+/i, '').trim();

        if (qText) {
          result.similarQuestions.push({
            question: qText,
            hint: hintMatch ? hintMatch[1].trim() : 'Review core definitions',
            solution: ansMatch ? ansMatch[1].trim() : 'Refer to lecture notes'
          });
        }
      }
    } else if (title.includes('SUGGESTED') || title.includes('REVISION')) {
      result.suggestedTopics = content
        .split('\n')
        .map((l) => l.replace(/^[-*•]\s+/, '').trim())
        .filter(Boolean);
    }
  }

  // Fallback if formatting was non-standard
  if (!result.explanation && text) {
    result.explanation = text;
  }

  return result;
}
