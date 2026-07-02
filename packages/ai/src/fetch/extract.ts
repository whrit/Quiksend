export interface FetchedPage {
  url: string;
  finalUrl: string;
  title: string | null;
  mainText: string;
  extractedAt: string;
}

const USER_AGENT = "Quiksend-Research-Bot/1.0 (+https://quiksend.dev)";
const FETCH_TIMEOUT_MS = 10_000;

function stripTags(html: string, tagNames: readonly string[]): string {
  let out = html;
  for (const tag of tagNames) {
    const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
    out = out.replace(re, " ");
  }
  return out;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function htmlToText(html: string): string {
  const withoutScripts = stripTags(html, ["script", "style", "nav", "footer", "header"]);
  const mainMatch =
    withoutScripts.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i) ??
    withoutScripts.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i) ??
    withoutScripts.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const chunk = mainMatch?.[1] ?? withoutScripts;
  const text = decodeHtmlEntities(chunk.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) return null;
  return decodeHtmlEntities(match[1].replace(/\s+/g, " ").trim()) || null;
}

export function extractMainTextFromHtml(html: string): { title: string | null; mainText: string } {
  return {
    title: extractTitle(html),
    mainText: htmlToText(html),
  };
}

export async function fetchAndExtract(url: string): Promise<FetchedPage> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }

  const html = await response.text();
  const { title, mainText } = extractMainTextFromHtml(html);

  return {
    url,
    finalUrl: response.url,
    title,
    mainText,
    extractedAt: new Date().toISOString(),
  };
}
