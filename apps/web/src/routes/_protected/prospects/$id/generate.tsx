import { Link, createFileRoute } from "@tanstack/react-router";
import { AlertCircle, RefreshCw, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Panel, Pill } from "@/components/ui/primitives.tsx";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  approveGeneration,
  discardGeneration,
  generateEmailForProspect,
  getProspectAiReview,
  triggerResearch,
  type PublicGeneration,
} from "@/lib/ai.functions.ts";
import { formatDate } from "@/lib/semantic.ts";

export const Route = createFileRoute("/_protected/prospects/$id/generate")({
  loader: async ({ params }) => getProspectAiReview({ data: { prospectId: params.id } }),
  component: ProspectGeneratePage,
});

/* Skeleton for the generation output area — matches subject input + body textarea shape. */
function GenerationSkeleton() {
  return (
    <div className="space-y-4" aria-label="Generating…">
      <div className="space-y-1.5">
        <div className="skel h-3" style={{ width: "4rem" }} />
        <div className="skel h-10 w-full rounded-[var(--radius-md)]" />
      </div>
      <div className="space-y-1.5">
        <div className="skel h-3" style={{ width: "3rem" }} />
        <div className="skel h-48 w-full rounded-[var(--radius-md)]" />
      </div>
      <div className="flex gap-2">
        <div className="skel h-8 w-20 rounded-[var(--radius-md)]" />
        <div className="skel h-8 w-16 rounded-[var(--radius-md)]" />
        <div className="skel h-8 w-24 rounded-[var(--radius-md)]" />
      </div>
    </div>
  );
}

function ProspectGeneratePage() {
  const initial = Route.useLoaderData();
  const { id: prospectId } = Route.useParams();
  const [review, setReview] = useState(initial);
  const [generation, setGeneration] = useState<PublicGeneration | null>(initial.latestGeneration);
  const [subject, setSubject] = useState(initial.latestGeneration?.outputSubject ?? "");
  const [body, setBody] = useState(initial.latestGeneration?.outputBodyMarkdown ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [researchError, setResearchError] = useState<string | null>(null);

  const reload = async () => {
    const data = await getProspectAiReview({ data: { prospectId } });
    setReview(data);
    if (data.latestGeneration) {
      setGeneration(data.latestGeneration);
      setSubject(data.latestGeneration.outputSubject);
      setBody(data.latestGeneration.outputBodyMarkdown);
    }
  };

  const runResearch = async () => {
    setResearchError(null);
    setBusy("research");
    try {
      await triggerResearch({ data: { prospectId, forceRefresh: true } });
      toast.success("Research job enqueued — refresh in a few seconds");
      setTimeout(() => void reload(), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Research failed";
      setResearchError(msg);
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  };

  const runGenerate = async () => {
    setGenerateError(null);
    setBusy("generate");
    try {
      const result = await generateEmailForProspect({
        data: { prospectId, forceResearch: false },
      });
      if (result.status === "RESEARCH_PENDING") {
        // Normal state — poll and retry.
        toast.info("Research kicked off — regenerating once it lands");
        setTimeout(() => void reload(), 3000);
        return;
      }
      setGeneration(result.generation);
      setSubject(result.subject);
      setBody(result.body);
      toast.success("Email generated");
      await reload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Generation failed";
      setGenerateError(msg);
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  };

  const runApprove = async () => {
    if (!generation) return;
    setBusy("approve");
    try {
      const row = await approveGeneration({
        data: {
          generationId: generation.id,
          edits: { outputSubject: subject, outputBodyMarkdown: body },
        },
      });
      setGeneration(row);
      toast.success("Generation approved");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Approve failed");
    } finally {
      setBusy(null);
    }
  };

  const runDiscard = async () => {
    if (!generation) return;
    setBusy("discard");
    try {
      await discardGeneration({ data: { generationId: generation.id } });
      toast.success("Generation discarded");
      setGeneration(null);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Discard failed");
    } finally {
      setBusy(null);
    }
  };

  const prospectName =
    [review.prospect.firstName, review.prospect.lastName].filter(Boolean).join(" ") ||
    review.prospect.email;

  const isGenerating = busy === "generate";

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex items-center gap-3">
        <Link
          to="/prospects/$id"
          params={{ id: prospectId }}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          ← Back
        </Link>
        <h1 className="text-[1.125rem] font-semibold tracking-[-0.015em]">
          AI Generate — {prospectName}
        </h1>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy !== null} onClick={() => void runResearch()}>
          {busy === "research" ? (
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          {busy === "research" ? "Running research…" : "Trigger research"}
        </Button>
        <Button
          disabled={busy !== null}
          onClick={() => void runGenerate()}
          aria-busy={isGenerating}
        >
          {isGenerating ? (
            <Sparkles className="mr-2 h-4 w-4 animate-pulse" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          {isGenerating ? "Generating…" : "Generate email"}
        </Button>
      </div>

      {/* Research error banner */}
      {researchError ? (
        <div
          className="flex items-center gap-3 rounded-[var(--radius-md)] border p-3 text-sm"
          style={{ borderColor: "var(--neg)", background: "var(--neg-tint)" }}
        >
          <AlertCircle className="h-4 w-4 shrink-0" style={{ color: "var(--neg)" }} />
          <span style={{ color: "var(--neg)" }}>{researchError}</span>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => void runResearch()}
          >
            Retry
          </Button>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Research profile */}
        <Panel
          title="Research profile"
          actions={
            review.researchProfile?.freshUntil ? (
              <span className="text-[0.75rem] text-muted-foreground">
                Fresh until {formatDate(review.researchProfile.freshUntil)}
              </span>
            ) : null
          }
        >
          <div className="space-y-3 p-4 text-sm">
            {review.researchProfile ? (
              <>
                <Pill tone={review.researchProfile.status === "ready" ? "pos" : "warn"} dot>
                  {review.researchProfile.status}
                </Pill>
                {review.researchProfile.summary ? (
                  <p className="whitespace-pre-wrap text-muted-foreground">
                    {review.researchProfile.summary}
                  </p>
                ) : null}
                {review.researchProfile.facts.slice(0, 8).map((fact) => (
                  <div
                    key={`${fact.claim}-${fact.source_url}`}
                    className="rounded-[var(--radius-md)] border p-2"
                  >
                    <p>{fact.claim}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      <a
                        href={fact.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="underline underline-offset-2 hover:text-foreground"
                      >
                        {fact.source_url}
                      </a>{" "}
                      · {(fact.confidence * 100).toFixed(0)}% confidence
                    </p>
                  </div>
                ))}
              </>
            ) : (
              <p className="text-muted-foreground">
                No research yet. Trigger research to populate facts.
              </p>
            )}
          </div>
        </Panel>

        {/* Matched value props */}
        <Panel
          title="Matched value props"
          actions={
            <span className="text-[0.75rem] text-muted-foreground">Top matches via similarity</span>
          }
        >
          <div className="space-y-3 p-4 text-sm">
            {review.matchedValueProps.length ? (
              review.matchedValueProps.map((vp) => (
                <div key={vp.id} className="rounded-[var(--radius-md)] border p-3">
                  <p className="font-medium">{vp.title}</p>
                  <p className="mt-1 line-clamp-3 text-muted-foreground">{vp.body}</p>
                  {vp.similarity > 0 ? (
                    <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                      {(vp.similarity * 100).toFixed(0)}% similarity
                    </p>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="text-muted-foreground">
                No value props configured. Add some in Settings → Value props.
              </p>
            )}
          </div>
        </Panel>
      </div>

      {/* Generation review */}
      <Panel
        title="Generation review"
        actions={
          generation ? (
            <span className="text-[0.75rem] text-muted-foreground">
              <Pill
                tone={
                  generation.status === "approved"
                    ? "pos"
                    : generation.status === "discarded"
                      ? "neg"
                      : "neutral"
                }
                dot
              >
                {generation.status}
              </Pill>
              {generation.humanized ? (
                <span className="ml-2 text-muted-foreground">· humanized</span>
              ) : null}
            </span>
          ) : null
        }
      >
        <div className="space-y-4 p-4">
          {/* Generation error banner */}
          {generateError ? (
            <div
              className="flex items-center gap-3 rounded-[var(--radius-md)] border p-3 text-sm"
              style={{ borderColor: "var(--neg)", background: "var(--neg-tint)" }}
            >
              <AlertCircle className="h-4 w-4 shrink-0" style={{ color: "var(--neg)" }} />
              <span style={{ color: "var(--neg)" }}>{generateError}</span>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                disabled={busy !== null}
                onClick={() => void runGenerate()}
              >
                Retry
              </Button>
            </div>
          ) : null}

          {generation?.warnings && generation.warnings.length > 0 ? (
            <ul
              className="rounded-[var(--radius-md)] border p-3 text-sm"
              style={{
                borderColor: "var(--warn)",
                background: "var(--warn-tint)",
                color: "var(--warn)",
              }}
            >
              {generation.warnings.map((w) => (
                <li key={w.message}>{w.message}</li>
              ))}
            </ul>
          ) : null}

          {/* Skeleton while generating, real form otherwise */}
          {isGenerating ? (
            <GenerationSkeleton />
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="gen-subject">Subject</Label>
                <Input
                  id="gen-subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  disabled={!generation}
                  placeholder={generation ? undefined : "Generate an email first"}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gen-body">Body</Label>
                <Textarea
                  id="gen-body"
                  rows={12}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  disabled={!generation}
                  placeholder={generation ? undefined : "Generate an email first"}
                />
              </div>

              {generation?.outputRationale ? (
                <div
                  className="rounded-[var(--radius-md)] border p-3 text-sm"
                  style={{ background: "var(--paper-050)" }}
                >
                  <p className="font-medium">Rationale</p>
                  <p className="mt-1 text-muted-foreground">{generation.outputRationale}</p>
                </div>
              ) : null}

              {generation?.citedFacts?.length ? (
                <div className="text-sm">
                  <p className="mb-1 font-medium">Cited facts</p>
                  <ul className="space-y-1">
                    {generation.citedFacts.map((f) => (
                      <li
                        key={f.claim}
                        className="rounded-[var(--radius-sm)] border-l-2 pl-3 text-muted-foreground"
                        style={{ borderColor: "var(--brand-600)" }}
                      >
                        {f.claim}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button disabled={!generation || busy !== null} onClick={() => void runApprove()}>
                  {busy === "approve" ? "Approving…" : "Approve"}
                </Button>
                <Button
                  variant="outline"
                  disabled={!generation || busy !== null}
                  onClick={() => void runDiscard()}
                >
                  {busy === "discard" ? "Discarding…" : "Discard"}
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy !== null}
                  onClick={() => void runGenerate()}
                >
                  Regenerate
                </Button>
              </div>
            </>
          )}
        </div>
      </Panel>
    </div>
  );
}
