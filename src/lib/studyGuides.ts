import { supabase, requireSupabase } from './supabase';
import { aiAsk } from './ai';
import { logUserActivity } from './activity';

export interface StudyGuideContent {
  summary: string;
  keyConcepts: { term: string; definition: string }[];
  formulasAndLaws: string[];
  examQuestions: { question: string; modelAnswer: string }[];
  revisionChecklist: string[];
}

export interface StudyGuideItem {
  id: string;
  user_id: string;
  title: string;
  course_code?: string | null;
  topic?: string | null;
  content: StudyGuideContent;
  material_id?: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchStudyGuides(): Promise<StudyGuideItem[]> {
  if (!supabase) return [];
  const client = requireSupabase();
  const { data, error } = await client
    .from('study_guides')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.warn('Failed to load study guides:', error);
    return [];
  }
  return (data || []) as StudyGuideItem[];
}

export async function deleteStudyGuide(id: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.from('study_guides').delete().eq('id', id);
  if (error) throw error;
}

export async function generateAndSaveStudyGuide(input: {
  courseCode: string;
  topic: string;
  materialId?: string | null;
}): Promise<StudyGuideItem> {
  const client = requireSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('Authentication required');

  const prompt = `Generate a comprehensive exam revision study guide for course "${input.courseCode}" on the topic "${input.topic}".

Format strictly into these sections:
### SUMMARY
[Concise executive overview of the topic]

### KEY CONCEPTS & DEFINITIONS
- [Term]: [Definition]
- [Term]: [Definition]
- [Term]: [Definition]

### FORMULAS, LAWS & PRINCIPLES
- [Law or formula 1]
- [Law or formula 2]

### EXAM PRACTICE QUESTIONS
1. Q: [Question 1]
A: [Model Answer 1]

2. Q: [Question 2]
A: [Model Answer 2]

3. Q: [Question 3]
A: [Model Answer 3]

### REVISION CHECKLIST
- [ ] [Topic checklist item 1]
- [ ] [Topic checklist item 2]
- [ ] [Topic checklist item 3]`;

  const res = await aiAsk({
    message: prompt,
    materialId: input.materialId,
    mode: 'exam'
  });

  const parsedContent = parseGuideMarkdown(res.answer);

  const { data, error } = await client
    .from('study_guides')
    .insert({
      user_id: user.id,
      title: `${input.courseCode}: ${input.topic} Study Guide`,
      course_code: input.courseCode.toUpperCase(),
      topic: input.topic,
      content: parsedContent,
      material_id: input.materialId ?? null
    })
    .select()
    .single();

  if (error) throw error;

  // Log activity
  logUserActivity({
    activityType: 'study_guide_created',
    entityType: 'study_guide',
    entityId: data.id,
    entityTitle: `Study Guide created: ${input.courseCode} - ${input.topic}`,
    metadata: { courseCode: input.courseCode, topic: input.topic }
  }).catch(() => {});

  return data as StudyGuideItem;
}

function parseGuideMarkdown(text: string): StudyGuideContent {
  const content: StudyGuideContent = {
    summary: '',
    keyConcepts: [],
    formulasAndLaws: [],
    examQuestions: [],
    revisionChecklist: []
  };

  const sections = text.split(/###\s+/);

  for (const sec of sections) {
    const trimmed = sec.trim();
    if (!trimmed) continue;

    const firstLineEnd = trimmed.indexOf('\n');
    const title = (firstLineEnd !== -1 ? trimmed.slice(0, firstLineEnd) : trimmed).toUpperCase().trim();
    const body = firstLineEnd !== -1 ? trimmed.slice(firstLineEnd).trim() : '';

    if (title.includes('SUMMARY')) {
      content.summary = body;
    } else if (title.includes('KEY CONCEPTS')) {
      const lines = body.split('\n');
      for (const line of lines) {
        const clean = line.replace(/^[-*•]\s+/, '').trim();
        const colonIdx = clean.indexOf(':');
        if (colonIdx !== -1) {
          content.keyConcepts.push({
            term: clean.slice(0, colonIdx).trim(),
            definition: clean.slice(colonIdx + 1).trim()
          });
        }
      }
    } else if (title.includes('FORMULAS') || title.includes('LAWS')) {
      content.formulasAndLaws = body
        .split('\n')
        .map((l) => l.replace(/^[-*•]\s+/, '').trim())
        .filter(Boolean);
    } else if (title.includes('EXAM PRACTICE')) {
      const blocks = body.split(/\n(?=\d+\.\s+Q:|\d+\.\s+)/i);
      for (const block of blocks) {
        const qMatch = block.match(/Q:\s*(.+?)(?=(A:|$))/is);
        const aMatch = block.match(/A:\s*(.+)/is);
        if (qMatch && aMatch) {
          content.examQuestions.push({
            question: qMatch[1].trim(),
            modelAnswer: aMatch[1].trim()
          });
        }
      }
    } else if (title.includes('CHECKLIST')) {
      content.revisionChecklist = body
        .split('\n')
        .map((l) => l.replace(/^[-*•\[\]\s]+/, '').trim())
        .filter(Boolean);
    }
  }

  if (!content.summary && text) {
    content.summary = text;
  }

  return content;
}
