import { Link, createFileRoute } from "@tanstack/react-router";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

export const Route = createFileRoute("/_protected/prospects/$id/generate")({
  loader: async ({ params }) => getProspectAiReview({ data: { prospectId: params.id } }),
  component: ProspectGeneratePage,
});

function ProspectGeneratePage() {
  const initial = Route.useLoaderData();
  const { id: prospectId } = Route.useParams();
  const [review, setReview] = useState(initial);
  const [generation, setGeneration] = useState<PublicGeneration | null>(initial.latestGeneration);
  const [subject, setSubject] = useState(initial.latestGeneration?.outputSubject ?? "");
  const [body, setBody] = useState(initial.latestGeneration?.outputBodyMarkdown ?? "");
  const [busy, setBusy] = useState<string | null>(null);

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
    setBusy("research");
    try {
      await triggerResearch({ data: { prospectId, forceRefresh: true } });
      toast.success("Research job enqueued — refresh in a few seconds");
      setTimeout(() => void reload(), 3000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Research failed");
    } finally {
      setBusy(null);
    }
  };

  const runGenerate = async () => {
    setBusy("generate");
    try {
      const result = await generateEmailForProspect({
        data: { prospectId, forceResearch: false },
      });
      if (result.status === "RESEARCH_PENDING") {
        // RESEARCH_PENDING is a normal state, not an error — poll and retry.
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
      toast.error(err instanceof Error ? err.message : "Generation failed");
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
        <h1 className="text-2xl font-semibold">AI Generate — {prospectName}</h1>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy !== null} onClick={() => void runResearch()}>
          {busy === "research" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Trigger research
        </Button>
        <Button disabled={busy !== null} onClick={() => void runGenerate()}>
          {busy === "generate" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          Generate email
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Research profile</CardTitle>
            <CardDescription>
              {review.researchProfile?.freshUntil
                ? `Fresh until ${new Date(review.researchProfile.freshUntil).toLocaleDateString()}`
                : "No cached research"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {review.researchProfile ? (
              <>
                <Badge
                  variant={review.researchProfile.status === "ready" ? "secondary" : "outline"}
                >
                  {review.researchProfile.status}
                </Badge>
                {review.researchProfile.summary ? (
                  <p className="whitespace-pre-wrap text-muted-foreground">
                    {review.researchProfile.summary}
                  </p>
                ) : null}
                <ul className="space-y-2">
                  {review.researchProfile.facts.slice(0, 8).map((fact) => (
                    <li key={`${fact.claim}-${fact.source_url}`} className="rounded border p-2">
                      <p>{fact.claim}</p>
                      <p className="text-xs text-muted-foreground">
                        {fact.source_url} · {(fact.confidence * 100).toFixed(0)}%
                      </p>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-muted-foreground">
                No research yet. Trigger research to populate facts.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Matched value props</CardTitle>
            <CardDescription>Top matches via embedding similarity</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {review.matchedValueProps.length ? (
              review.matchedValueProps.map((vp) => (
                <div key={vp.id} className="rounded border p-3">
                  <p className="font-medium">{vp.title}</p>
                  <p className="mt-1 text-muted-foreground line-clamp-3">{vp.body}</p>
                  {vp.similarity > 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Similarity {(vp.similarity * 100).toFixed(0)}%
                    </p>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="text-muted-foreground">
                No value props configured. Add some in Settings → Value props.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Generation review</CardTitle>
          <CardDescription>
            {generation
              ? `Status: ${generation.status}${generation.humanized ? " · humanized" : ""}`
              : "Generate an email to review"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {generation?.warnings && generation.warnings.length > 0 ? (
            <ul className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              {generation.warnings.map((w) => (
                <li key={w.message}>{w.message}</li>
              ))}
            </ul>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="gen-subject">Subject</Label>
            <Input id="gen-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gen-body">Body</Label>
            <Textarea
              id="gen-body"
              rows={12}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>

          {generation?.outputRationale ? (
            <div className="rounded border bg-muted/40 p-3 text-sm">
              <p className="font-medium">Rationale</p>
              <p className="text-muted-foreground">{generation.outputRationale}</p>
            </div>
          ) : null}

          {generation?.citedFacts?.length ? (
            <div className="text-sm">
              <p className="mb-1 font-medium">Cited facts</p>
              <ul className="list-inside list-disc text-muted-foreground">
                {generation.citedFacts.map((f) => (
                  <li key={f.claim}>{f.claim}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button disabled={!generation || busy !== null} onClick={() => void runApprove()}>
              Approve
            </Button>
            <Button
              variant="outline"
              disabled={!generation || busy !== null}
              onClick={() => void runDiscard()}
            >
              Discard
            </Button>
            <Button variant="secondary" disabled={busy !== null} onClick={() => void runGenerate()}>
              Regenerate
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
