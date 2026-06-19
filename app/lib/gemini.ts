import { GoogleGenAI } from '@google/genai';
import { UserProfile, Scholarship, Application } from '@/app/types';
import {
  enrichScholarships,
  findScholarshipByName,
  daysUntil,
  computeRelevance,
} from './mockData';

const API_KEY = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
const MODEL_NAME = 'gemini-3.5-flash';

const ai = API_KEY ? new GoogleGenAI({ apiKey: API_KEY }) : null;

const PERSONA =
  'You are ScholarPilot, an expert scholarship application strategist. You help students find funding, tailor their SOPs and CVs, and manage deadlines. Be encouraging, specific, and actionable. Keep responses concise but useful.';

async function generateFromAI(contents: string): Promise<string | null> {
  if (!ai) return null;
  try {
    const response = await ai.models.generateContent({ model: MODEL_NAME, contents });
    return response.text ?? null;
  } catch (err) {
    console.error('Gemini generate error:', err);
    return null;
  }
}

function formatProfile(profile: UserProfile): string {
  return `Name: ${profile.name}
Discipline: ${profile.discipline}
CGPA: ${profile.cgpa}
Target Degree: ${profile.targetDegree}
Country Preference: ${profile.countryPreference.join(', ')}
Career Goal: ${profile.careerGoal}`;
}

export async function generateScholarshipMatches(
  profile: UserProfile,
  list: Scholarship[]
): Promise<string> {
  const ranked = enrichScholarships(profile, list).filter((s) => list.some((x) => x.id === s.id));

  const prompt = `${PERSONA}

${formatProfile(profile)}

Recommend the best scholarships from this list and explain why each is a good fit. Keep each recommendation to 2-3 sentences.

Scholarships:
${JSON.stringify(
  ranked.map((s) => ({
    title: s.title,
    funder: s.funder,
    amount: s.amount,
    deadline: s.deadline,
    eligibility: s.eligibility,
  })),
  null,
  2
)}

Respond in markdown bullet list format.`;

  const text = await generateFromAI(prompt);
  if (text) return text;
  return fallbackMatches(profile, ranked);
}

function fallbackMatches(profile: UserProfile, list: Scholarship[]): string {
  const top = list.slice(0, 4);
  return `Here are the top matches for you, ${profile.name}:\n\n${top
    .map(
      (s) =>
        `- **${s.title}** (${s.funder})\n  ${s.amount}. Deadline in ${daysUntil(
          s.deadline
        )} days. ${whyMatch(profile, s)}`
    )
    .join('\n\n')}`;
}

function whyMatch(profile: UserProfile, s: Scholarship): string {
  const reasons: string[] = [];
  reasons.push('Good fit based on your profile.');
  if (profile.cgpa >= 3.5 && s.title.toLowerCase().includes('chevening'))
    reasons.push('Your strong CGPA supports this competitive UK award.');
  return reasons.join(' ');
}

export async function generateSOP(
  profile: UserProfile,
  scholarshipName: string,
  list: Scholarship[]
): Promise<string> {
  const scholarship = findScholarshipByName(scholarshipName, list);

  if (!scholarship) {
    return `I couldn't find a scholarship matching "${scholarshipName}". Please check the name or ask me to find scholarships first.`;
  }

  const prompt = `${PERSONA}

Write a personalised Statement of Purpose (300-500 words) for the student below applying to the ${scholarship.title} funded by ${scholarship.funder}.

Student Profile:
${formatProfile(profile)}

Scholarship Details:
Amount: ${scholarship.amount}
Deadline: ${scholarship.deadline}
Eligibility: ${scholarship.eligibility.join('; ')}
Description: ${scholarship.description}

Reference the program's values and the student's background. Keep it authentic, specific, and structured with an intro, academic/professional journey, why this scholarship, and future contribution.`;

  const text = await generateFromAI(prompt);
  if (text) return text;
  return fallbackSOP(profile, scholarship);
}

function fallbackSOP(profile: UserProfile, s: Scholarship): string {
  return `# Statement of Purpose: ${s.title}

Dear Selection Committee,

My name is ${profile.name}, and I am applying for the ${s.title} funded by ${s.funder}. As a ${profile.discipline} student with a CGPA of ${profile.cgpa} pursuing a ${profile.targetDegree}, I am eager to deepen my expertise through this opportunity.

The ${s.title} aligns perfectly with my career goal: ${profile.careerGoal}. The program’s emphasis on ${s.eligibility[0].toLowerCase()} resonates with my commitment to using ${profile.discipline.toLowerCase()} as a tool for positive change.

Academically, my record reflects discipline and curiosity. I have actively sought projects and experiences that bridge theory with impact, and I am excited to bring that mindset to ${s.funder}. Studying in ${profile.countryPreference[0] ?? 'your country'} will expose me to global best practices and a network of changemakers.

After completing my degree, I plan to return to Nigeria and ${profile.careerGoal.toLowerCase()}. This scholarship is not just financial support; it is a launchpad for the contribution I aspire to make.

Thank you for considering my application.

Sincerely,  
${profile.name}`;
}

export async function generateCVFeedback(profile: UserProfile): Promise<string> {
  const prompt = `${PERSONA}

Review a hypothetical CV for the student below. Provide structured, actionable feedback in bullet points under these headings: Strengths, Gaps, and Top 3 Improvements. Be specific and encouraging.

${formatProfile(profile)}`;

  const text = await generateFromAI(prompt);
  if (text) return text;
  return fallbackCVFeedback(profile);
}

function fallbackCVFeedback(profile: UserProfile): string {
  const strengths: string[] = [];
  const gaps: string[] = [];

  if (profile.cgpa >= 3.5) strengths.push(`Strong CGPA (${profile.cgpa}) — place it near the top of your CV.`);
  else gaps.push(`Consider contextualising your CGPA (${profile.cgpa}) with relevant coursework or projects.`);

  strengths.push('Clear target degree and discipline give your CV focus.');
  strengths.push(`Your stated career goal (“${profile.careerGoal}”) can anchor a compelling personal summary.`);

  gaps.push('Add quantified achievements (e.g., “Led a team of 5”, “Improved process by 20%”).');
  gaps.push('Include leadership, volunteer work, or extracurriculars to support scholarship applications.');
  gaps.push('Tailor your skills section to each scholarship’s priorities.');

  return `## CV Review for ${profile.name}

### Strengths
${strengths.map((s) => `- ${s}`).join('\n')}

### Gaps
${gaps.map((g) => `- ${g}`).join('\n')}

### Top 3 Improvements
1. Lead with a 2-3 line profile summary that mentions your ${profile.discipline} background and ${profile.targetDegree} goal.
2. Quantify at least three bullet points under experience or projects.
3. Add a “Leadership & Community Impact” section to match scholarship selection criteria.`;
}

export async function generateDeadlinesResponse(
  profile: UserProfile,
  applications: Application[],
  list: Scholarship[]
): Promise<string> {
  if (applications.length === 0) {
    return 'You are not tracking any applications yet. Head to the Dashboard to find and track scholarships.';
  }

  const enriched = applications
    .map((a) => {
      const s = list.find((x) => x.id === a.scholarshipId);
      return s ? { ...a, scholarship: s, days: daysUntil(s.deadline) } : null;
    })
    .filter(Boolean) as (Application & { scholarship: Scholarship; days: number })[];

  enriched.sort((a, b) => a.days - b.days);

  const prompt = `${PERSONA}

Summarise the upcoming deadlines for ${profile.name}. Be encouraging and highlight the next action.

Applications:
${JSON.stringify(
    enriched.map((e) => ({
      title: e.scholarship.title,
      deadline: e.scholarship.deadline,
      daysLeft: e.days,
      status: e.status,
      nextMilestone: e.milestones.find((m) => !m.completed)?.label ?? 'Submit Application',
    })),
    null,
    2
  )}`;

  const text = await generateFromAI(prompt);
  if (text) return text;
  return fallbackDeadlines(profile, enriched);
}

function fallbackDeadlines(
  profile: UserProfile,
  enriched: (Application & { scholarship: Scholarship; days: number })[]
): string {
  return `Hi ${profile.name}, here are your upcoming deadlines:\n\n${enriched
    .map(
      (e) =>
        `- **${e.scholarship.title}** — ${e.days} day${e.days === 1 ? '' : 's'} left (${
          e.scholarship.deadline
        })\n  Status: ${e.status}. Next action: **${
          e.milestones.find((m) => !m.completed)?.label ?? 'Submit Application'
        }**.`
    )
    .join('\n\n')}\n\nFocus on the closest deadline first and tick off milestones to keep your health score rising!`;
}

export async function generateGeneralResponse(
  profile: UserProfile,
  messages: { role: 'user' | 'model'; content: string }[]
): Promise<string> {
  const lastUser = messages.filter((m) => m.role === 'user').pop()?.content ?? '';

  const history = messages
    .map((m) => `${m.role === 'user' ? 'User' : 'ScholarPilot'}: ${m.content}`)
    .join('\n\n');

  const prompt = `${PERSONA}

Student Profile:
${formatProfile(profile)}

Conversation:
${history}

Respond helpfully to the latest message as ScholarPilot.`;

  const text = await generateFromAI(prompt);
  if (text) return text;
  return `I'm ScholarPilot. You asked: "${lastUser}". I can help with scholarships, SOPs, CVs, and deadlines — just let me know what you need!`;
}

export function parseScholarshipNameFromMessage(message: string): string | null {
  const patterns = [
    /tailor\s+(?:my\s+)?sop\s+for\s+(.+?)(?:\?|$)/i,
    /statement\s+of\s+purpose\s+for\s+(.+?)(?:\?|$)/i,
    /sop\s+for\s+(.+?)(?:\?|$)/i,
  ];
  for (const p of patterns) {
    const m = message.match(p);
    if (m && m[1].trim()) return m[1].trim();
  }
  return null;
}

export { computeRelevance };
