/**
 * RFC-822 threading headers — the difference between a follow-up landing in the
 * anchor thread (deliverability + prospect UX win) and one landing as a new
 * conversation (deliverability + UX loss).
 *
 * The engine passes `anchorMessageId` + prior message ids; this module produces
 * `In-Reply-To` (single value) + `References` (chain) and the normalized
 * subject with `Re:` prepended without stacking `Re: Re:`.
 *
 * Message-Id normalization matters because Gmail returns bare uuids, Graph
 * returns angle-bracket-wrapped, and IMAP is a wild-west. Phase-7's thread
 * matcher relies on `normalizeMessageId()` producing a single canonical form.
 */

export interface ThreadingHeaders {
  readonly inReplyTo: string;
  readonly references: string;
  readonly subject: string;
  /** Provider-native thread id (Gmail threadId, Graph conversationId) if known. */
  readonly providerThreadId: string | null;
}

export interface ThreadAnchor {
  readonly messageId: string;
  readonly subject: string;
  readonly providerThreadId?: string | null;
  /** Prior message ids in send order, oldest first. May be empty. */
  readonly priorReferences?: readonly string[];
}

/**
 * Canonicalize an RFC-822 Message-Id:
 *   • trim, lowercase
 *   • ensure exactly one leading `<` and trailing `>`
 *   • reject empty / whitespace-only ids
 *
 * The normalized form is what we index in `message.message_id_header` for
 * thread matching in Phase 7.
 */
export function normalizeMessageId(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) throw new Error("Cannot normalize empty Message-Id");
  const stripped = trimmed.replace(/^<+/, "").replace(/>+$/, "");
  if (stripped.length === 0) throw new Error("Cannot normalize whitespace-only Message-Id");
  return `<${stripped}>`;
}

/** Parse the space-separated `References` header into a canonical chain. */
export function parseReferences(header: string | null | undefined): readonly string[] {
  if (!header) return [];
  const chunks = header.split(/\s+/).filter((chunk) => chunk.length > 0);
  const out: string[] = [];
  for (const chunk of chunks) {
    try {
      out.push(normalizeMessageId(chunk));
    } catch {
      // Silently skip malformed entries — real-world References headers include garbage.
    }
  }
  return out;
}

/** Prepend "Re: " to the anchor subject, avoiding "Re: Re: Re:" stacking. */
export function replySubject(anchorSubject: string): string {
  const trimmed = anchorSubject.trim();
  if (/^re\s*:/i.test(trimmed)) return trimmed;
  return `Re: ${trimmed}`;
}

/** Build the ThreadingHeaders payload for an outbound follow-up. */
export function buildThreadingHeaders(anchor: ThreadAnchor): ThreadingHeaders {
  const anchorNormalized = normalizeMessageId(anchor.messageId);
  const priorNormalized = (anchor.priorReferences ?? []).map(normalizeMessageId);
  // References chain: oldest → newest, ending at the anchor. Dedup while preserving order.
  const seen = new Set<string>();
  const chain: string[] = [];
  for (const id of [...priorNormalized, anchorNormalized]) {
    if (!seen.has(id)) {
      seen.add(id);
      chain.push(id);
    }
  }
  return {
    inReplyTo: anchorNormalized,
    references: chain.join(" "),
    subject: replySubject(anchor.subject),
    providerThreadId: anchor.providerThreadId ?? null,
  };
}
