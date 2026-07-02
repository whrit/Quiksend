const SPAM_PHRASES = [
  "act now",
  "limited time",
  "guaranteed",
  "free money",
  "click here",
  "buy now",
  "no obligation",
  "risk free",
  "winner",
  "congratulations",
  "dear friend",
  "urgent",
  "once in a lifetime",
  "make money fast",
  "double your",
  "100% free",
  "no cost",
  "apply now",
  "order now",
  "special promotion",
] as const;

export type HumanizeWarning = {
  code: "spam_phrase" | "length" | "reading_grade";
  message: string;
};

export type HumanizeResult = {
  subject: string;
  bodyMarkdown: string;
  warnings: HumanizeWarning[];
  humanized: boolean;
};

function seededRandom(seed: string): () => number {
  let state = 0;
  for (let i = 0; i < seed.length; i++) {
    state = (state * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

export function parseSpintax(text: string, seed: string): string {
  const rand = seededRandom(seed);
  const pattern = /\{([^{}]+)\}/g;
  return text.replace(pattern, (_match, group: string) => {
    const options = group.split("|").map((o) => o.trim());
    if (options.length === 0) return "";
    const index = Math.floor(rand() * options.length);
    return options[index] ?? options[0] ?? "";
  });
}

function countSyllables(word: string): number {
  const cleaned = word.toLowerCase().replace(/[^a-z]/g, "");
  if (cleaned.length <= 3) return 1;
  const vowels = cleaned.match(/[aeiouy]+/g);
  return Math.max(1, vowels?.length ?? 1);
}

function fleschKincaidGrade(text: string): number {
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (sentences.length === 0 || words.length === 0) return 0;
  const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
  return 0.39 * (words.length / sentences.length) + 11.8 * (syllables / words.length) - 15.59;
}

function lintSpamPhrases(text: string): HumanizeWarning[] {
  const lower = text.toLowerCase();
  const warnings: HumanizeWarning[] = [];
  for (const phrase of SPAM_PHRASES) {
    if (lower.includes(phrase)) {
      warnings.push({
        code: "spam_phrase",
        message: `Contains spam trigger phrase: "${phrase}"`,
      });
    }
  }
  return warnings;
}

function lintLength(body: string): HumanizeWarning[] {
  const wordCount = body.split(/\s+/).filter(Boolean).length;
  if (wordCount > 200) {
    return [{ code: "length", message: `Body is ${wordCount} words (recommended ≤ 200)` }];
  }
  return [];
}

function lintReadingGrade(body: string): HumanizeWarning[] {
  const grade = fleschKincaidGrade(body);
  if (grade > 10) {
    return [
      {
        code: "reading_grade",
        message: `Reading grade ${grade.toFixed(1)} (recommended ≤ 10)`,
      },
    ];
  }
  return [];
}

const SPINTAX_SNIPPETS = [
  { pattern: /\bHi\b/g, replacement: "{Hi|Hey|Hello}" },
  { pattern: /\bThanks\b/gi, replacement: "{Thanks|Thank you|Appreciate it}" },
  { pattern: /\bquick\b/gi, replacement: "{quick|brief|short}" },
  { pattern: /\bwanted to\b/gi, replacement: "{wanted to|thought I'd|hoped to}" },
];

function applySpintaxVariations(text: string, seed: string): string {
  let out = text;
  for (const { pattern, replacement } of SPINTAX_SNIPPETS) {
    out = out.replace(pattern, replacement);
  }
  return parseSpintax(out, seed);
}

export function humanizeEmail(
  input: { subject: string; bodyMarkdown: string },
  generationId: string,
): HumanizeResult {
  const subject = applySpintaxVariations(input.subject, `${generationId}:subject`);
  const bodyMarkdown = applySpintaxVariations(input.bodyMarkdown, `${generationId}:body`);

  const combined = `${subject}\n${bodyMarkdown}`;
  const warnings = [
    ...lintSpamPhrases(combined),
    ...lintLength(bodyMarkdown),
    ...lintReadingGrade(bodyMarkdown),
  ];

  const changed = subject !== input.subject || bodyMarkdown !== input.bodyMarkdown;

  return {
    subject,
    bodyMarkdown,
    warnings,
    humanized: changed,
  };
}
