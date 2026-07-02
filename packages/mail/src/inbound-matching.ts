/**
 * Inbound thread matching — links an inbound message to an outbound anchor.
 *
 * Priority: In-Reply-To → References → provider thread id → subject heuristic.
 * All Message-Id comparisons use normalizeMessageId from threading.ts.
 */

import { normalizeMessageId, parseReferences } from "./threading.ts";

export interface InboundMatch {
  outboundMessageIdHeader: string;
  matchType: "in_reply_to" | "references" | "thread_id" | "subject_heuristic";
  confidence: "high" | "medium" | "low";
}

export interface InboundHeaders {
  inReplyTo: string | null;
  references: string | null;
  providerThreadId: string | null;
  subject: string | null;
}

export interface OutboundAnchor {
  messageIdHeader: string;
  providerThreadId: string | null;
  subject: string | null;
}

export function extractCandidateIds(inbound: InboundHeaders): {
  normalizedInReplyTo: string | null;
  normalizedReferences: string[];
  providerThreadId: string | null;
} {
  let normalizedInReplyTo: string | null = null;
  if (inbound.inReplyTo?.trim()) {
    try {
      normalizedInReplyTo = normalizeMessageId(inbound.inReplyTo);
    } catch {
      normalizedInReplyTo = null;
    }
  }

  return {
    normalizedInReplyTo,
    normalizedReferences: [...parseReferences(inbound.references)],
    providerThreadId: inbound.providerThreadId?.trim() || null,
  };
}

export function matchInbound(
  inbound: InboundHeaders,
  outboundAnchors: OutboundAnchor[],
): InboundMatch | null {
  if (outboundAnchors.length === 0) return null;

  const candidates = extractCandidateIds(inbound);
  const normalizedAnchors = outboundAnchors.map((anchor) => ({
    ...anchor,
    normalizedMessageId: safeNormalizeMessageId(anchor.messageIdHeader),
    normalizedSubject: normalizeSubjectForMatch(anchor.subject),
  }));

  if (candidates.normalizedInReplyTo) {
    const match = normalizedAnchors.find(
      (anchor) => anchor.normalizedMessageId === candidates.normalizedInReplyTo,
    );
    if (match?.normalizedMessageId) {
      return {
        outboundMessageIdHeader: match.normalizedMessageId,
        matchType: "in_reply_to",
        confidence: "high",
      };
    }
  }

  if (candidates.normalizedReferences.length > 0) {
    const refSet = new Set(candidates.normalizedReferences);
    const match = normalizedAnchors.find(
      (anchor) => anchor.normalizedMessageId !== null && refSet.has(anchor.normalizedMessageId),
    );
    if (match?.normalizedMessageId) {
      return {
        outboundMessageIdHeader: match.normalizedMessageId,
        matchType: "references",
        confidence: "high",
      };
    }
  }

  if (candidates.providerThreadId) {
    const match = normalizedAnchors.find(
      (anchor) =>
        anchor.providerThreadId !== null && anchor.providerThreadId === candidates.providerThreadId,
    );
    if (match?.normalizedMessageId) {
      return {
        outboundMessageIdHeader: match.normalizedMessageId,
        matchType: "thread_id",
        confidence: "high",
      };
    }
  }

  const inboundSubject = normalizeSubjectForMatch(inbound.subject);
  if (inboundSubject) {
    const match = normalizedAnchors.find(
      (anchor) => anchor.normalizedSubject !== null && anchor.normalizedSubject === inboundSubject,
    );
    if (match?.normalizedMessageId) {
      return {
        outboundMessageIdHeader: match.normalizedMessageId,
        matchType: "subject_heuristic",
        confidence: "medium",
      };
    }
  }

  return null;
}

function safeNormalizeMessageId(raw: string): string | null {
  try {
    return normalizeMessageId(raw);
  } catch {
    return null;
  }
}

function normalizeSubjectForMatch(subject: string | null | undefined): string | null {
  if (!subject?.trim()) return null;
  let s = subject.trim();
  while (/^(re|fwd?):\s*/i.test(s)) {
    s = s.replace(/^(re|fwd?):\s*/i, "").trim();
  }
  return s.toLowerCase();
}
