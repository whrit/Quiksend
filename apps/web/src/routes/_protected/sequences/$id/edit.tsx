import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronLeft,
  Copy,
  GripVertical,
  MoreHorizontal,
  Plus,
  Settings,
  Trash2,
  Check,
  ChevronsUpDown,
} from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { generateEmailForProspect } from "@/lib/ai.functions.ts";
import { GATEWAY_FILTER_OPTIONS } from "@/components/gateway-badge.tsx";
import { listMailboxes } from "@/lib/mailboxes.functions.ts";
import { renderPreview, validateTemplate } from "@/lib/sequence-templates.ts";
import {
  activateSequence,
  deleteStep,
  getSequence,
  reorderSteps,
  updateSequence,
  upsertStep,
  type SequenceSettings,
  type StepConfig,
} from "@/lib/sequences.functions.ts";
import { cn } from "@/lib/utils";

type SequenceDetail = Awaited<ReturnType<typeof getSequence>>;

const editSearchSchema = z.object({
  anchorMessageId: z.string().uuid().optional(),
});

export const Route = createFileRoute("/_protected/sequences/$id/edit")({
  validateSearch: (search) => editSearchSchema.parse(search),
  loader: async ({ params }) => {
    const [sequence, mailboxes] = await Promise.all([
      getSequence({ data: { id: params.id } }),
      listMailboxes(),
    ]);
    return { sequence, mailboxes };
  },
  component: SequenceBuilderPage,
});

type Step = SequenceDetail["steps"][number];
type StepType = Step["type"];

const STEP_TYPE_LABELS: Record<StepType, string> = {
  manual_email: "Manual email",
  auto_email: "Auto email",
  wait: "Wait",
  task: "Task",
};

const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Asia/Tokyo",
  "Australia/Sydney",
];

interface StepFormState {
  id?: string;
  type: StepType;
  index: number;
  delayMinutes: number;
  businessDaysOnly: boolean;
  subject: string;
  bodyTemplate: string;
  aiGenerate: boolean;
  waitMinutes: number;
  taskTitle: string;
  taskInstructions: string;
  variantBSubject: string;
  variantBBody: string;
  showVariantB: boolean;
  ifNoReply: boolean;
  recipientGatewayIn: string[];
  recipientGatewayNotIn: string[];
}

function emptyStepForm(index: number, type: StepType = "manual_email"): StepFormState {
  return {
    type,
    index,
    delayMinutes: 0,
    businessDaysOnly: true,
    subject: "",
    bodyTemplate: "",
    aiGenerate: false,
    waitMinutes: 60,
    taskTitle: "",
    taskInstructions: "",
    variantBSubject: "",
    variantBBody: "",
    showVariantB: false,
    ifNoReply: false,
    recipientGatewayIn: [],
    recipientGatewayNotIn: [],
  };
}

function stepToForm(step: Step): StepFormState {
  const config = step.config as StepConfig;
  const variantB = step.variantB;
  return {
    id: step.id,
    type: step.type,
    index: step.index,
    delayMinutes: step.delayMinutes,
    businessDaysOnly: step.businessDaysOnly,
    subject: "subject" in config ? config.subject : "",
    bodyTemplate: "body_template" in config ? config.body_template : "",
    aiGenerate: "ai_generate" in config ? config.ai_generate : false,
    waitMinutes: "minutes" in config ? config.minutes : step.delayMinutes,
    taskTitle: "title" in config ? config.title : "",
    taskInstructions: "instructions" in config ? config.instructions : "",
    variantBSubject: variantB?.subject ?? "",
    variantBBody: variantB?.body_template ?? "",
    showVariantB: Boolean(variantB),
    ifNoReply: step.entryCondition?.kind === "if_no_reply",
    recipientGatewayIn: step.entryCondition?.recipientGatewayIn ?? [],
    recipientGatewayNotIn: step.entryCondition?.recipientGatewayNotIn ?? [],
  };
}

function buildEntryCondition(form: StepFormState) {
  const hasGateway = form.recipientGatewayIn.length > 0 || form.recipientGatewayNotIn.length > 0;
  if (!form.ifNoReply && !hasGateway) return undefined;
  return {
    ...(form.ifNoReply ? { kind: "if_no_reply" as const } : {}),
    ...(form.recipientGatewayIn.length > 0 ? { recipientGatewayIn: form.recipientGatewayIn } : {}),
    ...(form.recipientGatewayNotIn.length > 0
      ? { recipientGatewayNotIn: form.recipientGatewayNotIn }
      : {}),
  };
}

function formToStepPayload(form: StepFormState) {
  const entryCondition = buildEntryCondition(form);
  const base = {
    id: form.id,
    index: form.index,
    type: form.type,
    delayMinutes: form.delayMinutes,
    businessDaysOnly: form.businessDaysOnly,
    ...(entryCondition ? { entryCondition } : {}),
  };

  if (form.type === "wait") {
    return {
      ...base,
      config: { minutes: form.waitMinutes },
    };
  }
  if (form.type === "task") {
    return {
      ...base,
      config: { title: form.taskTitle, instructions: form.taskInstructions },
    };
  }

  const emailConfig = {
    subject: form.subject,
    body_template: form.bodyTemplate,
    ai_generate: form.aiGenerate,
  };
  return {
    ...base,
    config: emailConfig,
    variantB:
      form.showVariantB && (form.variantBSubject || form.variantBBody)
        ? {
            subject: form.variantBSubject,
            body_template: form.variantBBody,
            ai_generate: form.aiGenerate,
          }
        : undefined,
  };
}

function SortableStepCard({
  step,
  isDraft,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  step: Step;
  isDraft: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: step.id,
    disabled: !isDraft,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const waitMinutes =
    step.type === "wait" && "minutes" in step.config ? step.config.minutes : step.delayMinutes;
  const emailSubject =
    (step.type === "manual_email" || step.type === "auto_email") && "subject" in step.config
      ? step.config.subject
      : "";
  const emailBody =
    (step.type === "manual_email" || step.type === "auto_email") && "body_template" in step.config
      ? step.config.body_template
      : "";
  const taskTitle = step.type === "task" && "title" in step.config ? step.config.title : "";
  const taskInstr =
    step.type === "task" && "instructions" in step.config ? step.config.instructions : "";

  return (
    <article
      ref={setNodeRef}
      style={style}
      className="paper group relative flex gap-4 p-5 transition-[transform,box-shadow] duration-150 ease-out hover:-translate-y-[1px] hover:shadow-[0_0_0_1px_rgba(20,15,5,0.03),0_2px_4px_rgba(20,15,5,0.04),0_8px_20px_-10px_rgba(20,15,5,0.08)]"
    >
      <div className="flex w-14 shrink-0 flex-col items-start border-r border-border pr-4">
        <div className="font-display tabular text-[2.25rem] leading-none text-foreground">
          {String(step.index + 1).padStart(2, "0")}
        </div>
        {step.type === "wait" ? (
          <div className="mt-2 font-mono tabular text-[0.6875rem] text-muted-foreground">
            +{waitMinutes}m
          </div>
        ) : step.delayMinutes > 0 ? (
          <div className="mt-2 font-mono tabular text-[0.6875rem] text-muted-foreground">
            +{step.delayMinutes}m
          </div>
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <div className="micro-label">{STEP_TYPE_LABELS[step.type]}</div>
          {step.entryCondition?.kind === "if_no_reply" ? (
            <span className="font-mono text-[0.6875rem] text-muted-foreground">if no reply</span>
          ) : null}
        </div>

        {step.type === "manual_email" || step.type === "auto_email" ? (
          <>
            <div className="mt-1.5 truncate text-[0.9375rem] font-medium text-foreground">
              {emailSubject || (
                <span className="font-display-italic text-muted-foreground">Untitled email</span>
              )}
            </div>
            {emailBody ? (
              <p className="mt-1 line-clamp-2 text-[0.8125rem] leading-snug text-muted-foreground">
                {emailBody}
              </p>
            ) : (
              <p className="mt-1 font-display-italic text-[0.8125rem] text-muted-foreground">
                No body yet — open to compose.
              </p>
            )}
          </>
        ) : null}

        {step.type === "wait" ? (
          <>
            <div className="mt-1 font-display-italic text-[1.25rem] leading-tight text-foreground">
              Wait {waitMinutes} minutes
            </div>
            {step.businessDaysOnly ? (
              <div className="mt-1 text-[0.75rem] text-muted-foreground">Business days only</div>
            ) : null}
          </>
        ) : null}

        {step.type === "task" ? (
          <>
            <div className="mt-1.5 truncate text-[0.9375rem] font-medium text-foreground">
              {taskTitle || (
                <span className="font-display-italic text-muted-foreground">Untitled task</span>
              )}
            </div>
            {taskInstr ? (
              <p className="mt-1 line-clamp-2 text-[0.8125rem] leading-snug text-muted-foreground">
                {taskInstr}
              </p>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="flex shrink-0 items-start gap-0.5 opacity-80 transition-opacity group-hover:opacity-100">
        {isDraft ? (
          <>
            <Button size="icon" variant="ghost" onClick={onEdit} aria-label="Edit step">
              <Settings className="h-3.5 w-3.5" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" aria-label="More actions">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>
                <DropdownMenuItem onClick={onDuplicate}>
                  <Copy className="mr-2 h-4 w-4" />
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem className="text-destructive" onClick={onDelete}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              type="button"
              aria-label="Reorder step"
              className="inline-flex h-8 w-8 cursor-grab items-center justify-center rounded-[6px] text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--amber-600)] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="h-4 w-4" />
            </button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={onEdit}>
            View
          </Button>
        )}
      </div>
    </article>
  );
}

function SequenceBuilderPage() {
  const { sequence: initial, mailboxes } = Route.useLoaderData();
  const { id } = Route.useParams();
  const { anchorMessageId } = Route.useSearch();

  const [sequence, setSequence] = useState(initial);
  const [steps, setSteps] = useState<Step[]>(initial.steps);
  const [settings, setSettings] = useState<SequenceSettings>(initial.settings);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [stepForm, setStepForm] = useState<StepFormState>(emptyStepForm(steps.length));
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const [aiPreviewOpen, setAiPreviewOpen] = useState(false);
  const [aiPreviewProspectId, setAiPreviewProspectId] = useState("");
  const [aiPreviewLoading, setAiPreviewLoading] = useState(false);
  const [aiPreviewResult, setAiPreviewResult] = useState<{
    subject: string;
    body: string;
    rationale: string;
  } | null>(null);

  const isDraft = sequence.status === "draft";

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const reload = useCallback(async () => {
    const fresh = await getSequence({ data: { id } });
    setSequence(fresh);
    setSteps(fresh.steps);
    setSettings(fresh.settings);
  }, [id]);

  async function saveSettings() {
    setSaving(true);
    try {
      await updateSequence({ data: { id, patch: { settings } } });
      toast.success("Settings saved");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = steps.findIndex((s) => s.id === active.id);
    const newIndex = steps.findIndex((s) => s.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(steps, oldIndex, newIndex);
    setSteps(reordered);

    try {
      const updated = await reorderSteps({
        data: { sequenceId: id, orderedIds: reordered.map((s) => s.id) },
      });
      setSteps(updated as Step[]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reorder");
      await reload();
    }
  }

  async function saveStep() {
    setSaving(true);
    try {
      const payload = formToStepPayload(stepForm);
      await upsertStep({ data: { sequenceId: id, step: payload } });
      toast.success(stepForm.id ? "Step updated" : "Step added");
      setSheetOpen(false);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save step");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteStep(stepId: string) {
    try {
      await deleteStep({ data: { id: stepId } });
      toast.success("Step deleted");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  async function handleActivate() {
    setActivating(true);
    try {
      await activateSequence({ data: { id } });
      toast.success("Sequence activated");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to activate");
    } finally {
      setActivating(false);
    }
  }

  const templateWarnings = [
    ...validateTemplate(stepForm.subject).unknown,
    ...validateTemplate(stepForm.bodyTemplate).unknown,
    ...validateTemplate(stepForm.variantBSubject).unknown,
    ...validateTemplate(stepForm.variantBBody).unknown,
  ];

  return (
    <div className="mx-auto max-w-[1200px] px-8 py-10">
      <div className="rise mb-2">
        <Link
          to="/sequences"
          className="micro-label inline-flex items-center gap-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--amber-600)] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <ChevronLeft className="h-3 w-3" /> All sequences
        </Link>
      </div>

      <header className="rise rise-1 mb-10 flex items-end justify-between gap-6 border-b border-border pb-6">
        <div className="min-w-0">
          <div className="micro-label">{sequence.status}</div>
          <h1 className="mt-2 truncate font-display text-[2.5rem] leading-none tracking-[-0.02em]">
            {sequence.name}
          </h1>
          <p className="mt-1 font-display-italic text-[0.9375rem] text-muted-foreground">
            {isDraft ? "Draft — add steps and activate when ready." : "Active sequence"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {sequence.status === "active" && (
            <>
              <Link
                to="/sequences/$id/enroll"
                params={{ id }}
                className={buttonVariants({ variant: "outline" })}
              >
                Enroll
              </Link>
              <Link
                to="/sequences/$id/enrollments"
                params={{ id }}
                className={buttonVariants({ variant: "outline" })}
              >
                Enrollments
              </Link>
            </>
          )}
          {isDraft && (
            <Button
              onClick={() => void handleActivate()}
              disabled={activating || steps.length === 0}
            >
              {activating ? "Activating…" : "Activate"}
            </Button>
          )}
        </div>
      </header>

      {anchorMessageId ? (
        <div className="rise rise-2 paper mb-6 p-4 text-[0.875rem]">
          <div className="micro-label">Anchored thread</div>
          <p className="mt-1.5 text-foreground">
            Replies land in message{" "}
            <code className="rounded-[4px] border border-border bg-secondary px-1.5 py-0.5 font-mono text-[0.75rem]">
              {anchorMessageId.slice(0, 8)}…
            </code>
            . Use <code className="font-mono text-[0.75rem] text-muted-foreground">auto_email</code>{" "}
            steps to reply into that thread when you activate and enroll.
          </p>
        </div>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <div className="rise rise-2 space-y-4">
          <div className="flex items-end justify-between">
            <div>
              <div className="micro-label">The sequence</div>
              <h2 className="mt-1 font-display text-[1.5rem] leading-none tracking-[-0.02em]">
                Steps
                <span className="ml-2 font-mono tabular text-[0.75rem] text-muted-foreground">
                  {steps.length.toString().padStart(2, "0")}
                </span>
              </h2>
            </div>
            {isDraft && (
              <Button
                size="sm"
                onClick={() => {
                  setStepForm(emptyStepForm(steps.length));
                  setSheetOpen(true);
                }}
              >
                <Plus className="mr-1 h-4 w-4" />
                Add step
              </Button>
            )}
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(e) => void handleDragEnd(e)}
          >
            <SortableContext items={steps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              {steps.length === 0 ? (
                <div className="paper relative overflow-hidden p-10 text-center">
                  <div
                    className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full opacity-[0.06]"
                    style={{ background: "var(--amber-600)" }}
                  />
                  <div className="pointer-events-none absolute -right-4 top-1/2 -translate-y-1/2 opacity-[0.04]">
                    <svg width="280" height="280" viewBox="0 0 100 100" fill="none">
                      <circle cx="50" cy="50" r="48" stroke="currentColor" strokeWidth="0.3" />
                      <circle cx="50" cy="50" r="34" stroke="currentColor" strokeWidth="0.3" />
                      <circle cx="50" cy="50" r="20" stroke="currentColor" strokeWidth="0.3" />
                      <line
                        x1="0"
                        y1="50"
                        x2="100"
                        y2="50"
                        stroke="currentColor"
                        strokeWidth="0.3"
                      />
                      <line
                        x1="50"
                        y1="0"
                        x2="50"
                        y2="100"
                        stroke="currentColor"
                        strokeWidth="0.3"
                      />
                    </svg>
                  </div>
                  <div className="relative mx-auto max-w-md">
                    <div className="micro-label">Step 01 · Compose the first move</div>
                    <h3 className="mt-3 font-display text-[2rem] leading-[0.95] tracking-[-0.025em] text-foreground">
                      A sequence is a{" "}
                      <span className="font-display-italic text-[color:var(--amber-600)]">
                        series of notes
                      </span>
                      .
                    </h3>
                    <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted-foreground">
                      Start with a manual email, layer follow-ups, land the ask. Each step is a
                      paper slip in the ledger.
                    </p>
                    {isDraft ? (
                      <div className="mt-6 flex justify-center">
                        <Button
                          variant="accent"
                          size="lg"
                          onClick={() => {
                            setStepForm(emptyStepForm(0));
                            setSheetOpen(true);
                          }}
                        >
                          <Plus className="mr-1 h-4 w-4" />
                          Add first step
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="relative">
                  <div
                    className="pointer-events-none absolute bottom-6 top-6 w-px bg-border"
                    style={{ left: "calc(1.25rem + 1.375rem)" }}
                    aria-hidden="true"
                  />
                  <div className="relative space-y-3">
                    {steps.map((step) => (
                      <SortableStepCard
                        key={step.id}
                        step={step}
                        isDraft={isDraft}
                        onEdit={() => {
                          setStepForm(stepToForm(step));
                          setSheetOpen(true);
                        }}
                        onDuplicate={() => {
                          const form = stepToForm(step);
                          delete form.id;
                          form.index = steps.length;
                          setStepForm(form);
                          setSheetOpen(true);
                        }}
                        onDelete={() => void handleDeleteStep(step.id)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </SortableContext>
          </DndContext>
        </div>

        <aside className="rise rise-3 paper space-y-5 p-5">
          <div>
            <div className="micro-label flex items-center gap-1.5">
              <Settings className="h-3 w-3" />
              Settings
            </div>
            <h2 className="mt-1 font-display text-[1.25rem] leading-none tracking-[-0.02em]">
              How it sends
            </h2>
          </div>

          <div className="rule" />

          <div className="space-y-2">
            <Label className="micro-label">Timezone</Label>
            <Select
              value={settings.timezone}
              onValueChange={(v) => setSettings((s) => ({ ...s, timezone: v }))}
              disabled={!isDraft && sequence.status !== "active"}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="micro-label">Throttle · seconds between sends</Label>
            <Input
              type="number"
              min={0}
              value={settings.throttle_seconds}
              className="font-mono tabular"
              onChange={(e) =>
                setSettings((s) => ({ ...s, throttle_seconds: Number(e.target.value) }))
              }
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="business-days"
              checked={settings.business_days_only}
              onCheckedChange={(c) =>
                setSettings((s) => ({ ...s, business_days_only: c === true }))
              }
            />
            <Label htmlFor="business-days" className="text-[0.8125rem] font-normal">
              Business days only
            </Label>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="stop-reply"
              checked={settings.stop_on_reply}
              onCheckedChange={(c) => setSettings((s) => ({ ...s, stop_on_reply: c === true }))}
            />
            <Label htmlFor="stop-reply" className="text-[0.8125rem] font-normal">
              Stop on reply
            </Label>
          </div>

          <div className="space-y-2">
            <Label className="micro-label">Mailboxes</Label>
            <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-[6px] border border-border bg-background/50 p-2">
              {mailboxes.length === 0 ? (
                <p className="font-display-italic text-[0.8125rem] text-muted-foreground">
                  No mailboxes configured.
                </p>
              ) : (
                mailboxes.map((mb) => (
                  <div key={mb.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`mb-${mb.id}`}
                      checked={settings.mailbox_ids.includes(mb.id)}
                      disabled={!isDraft}
                      onCheckedChange={(checked) => {
                        setSettings((s) => ({
                          ...s,
                          mailbox_ids: checked
                            ? [...s.mailbox_ids, mb.id]
                            : s.mailbox_ids.filter((x) => x !== mb.id),
                        }));
                      }}
                    />
                    <Label
                      htmlFor={`mb-${mb.id}`}
                      className="truncate font-mono text-[0.75rem] font-normal text-foreground"
                    >
                      {mb.address}
                    </Label>
                  </div>
                ))
              )}
            </div>
          </div>

          <Button
            variant="outline"
            className="w-full"
            onClick={() => void saveSettings()}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save settings"}
          </Button>
        </aside>
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <div className="micro-label">
              {stepForm.id
                ? `Editing step ${String(stepForm.index + 1).padStart(2, "0")}`
                : `New · step ${String(stepForm.index + 1).padStart(2, "0")}`}
            </div>
            <SheetTitle className="font-display text-[1.75rem] leading-none tracking-[-0.02em]">
              {stepForm.id ? "Refine this step" : "Compose a step"}
            </SheetTitle>
          </SheetHeader>

          <div className="mt-6 space-y-5">
            <div className="space-y-2">
              <Label className="micro-label">Step type</Label>
              <Select
                value={stepForm.type}
                onValueChange={(v) => setStepForm((f) => ({ ...f, type: v as StepType }))}
                disabled={Boolean(stepForm.id)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["manual_email", "auto_email", "wait", "task"] as const).map((t) => (
                    <SelectItem key={t} value={t}>
                      {STEP_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="micro-label">Delay after previous step · minutes</Label>
              <Input
                type="number"
                min={0}
                className="font-mono tabular"
                value={stepForm.delayMinutes}
                onChange={(e) =>
                  setStepForm((f) => ({ ...f, delayMinutes: Number(e.target.value) }))
                }
              />
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="step-biz-days"
                checked={stepForm.businessDaysOnly}
                onCheckedChange={(c) =>
                  setStepForm((f) => ({ ...f, businessDaysOnly: c === true }))
                }
              />
              <Label htmlFor="step-biz-days" className="text-[0.8125rem] font-normal">
                Business days only
              </Label>
            </div>

            <div className="rounded-[6px] border border-border bg-background/40 p-3">
              <div className="micro-label">Entry conditions</div>
              <div className="mt-3 space-y-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="if-no-reply"
                    checked={stepForm.ifNoReply}
                    onCheckedChange={(c) => setStepForm((f) => ({ ...f, ifNoReply: c === true }))}
                  />
                  <Label htmlFor="if-no-reply" className="text-[0.8125rem] font-normal">
                    Only if no reply on thread
                  </Label>
                </div>
                <GatewayMultiSelect
                  label="Only send if recipient is behind"
                  selected={stepForm.recipientGatewayIn}
                  onChange={(recipientGatewayIn) =>
                    setStepForm((f) => ({ ...f, recipientGatewayIn }))
                  }
                />
                <GatewayMultiSelect
                  label="Never send if recipient is behind"
                  selected={stepForm.recipientGatewayNotIn}
                  onChange={(recipientGatewayNotIn) =>
                    setStepForm((f) => ({ ...f, recipientGatewayNotIn }))
                  }
                />
              </div>
            </div>

            {(stepForm.type === "manual_email" || stepForm.type === "auto_email") && (
              <>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="ai-gen"
                    checked={stepForm.aiGenerate}
                    onCheckedChange={(c) => setStepForm((f) => ({ ...f, aiGenerate: c === true }))}
                  />
                  <Label htmlFor="ai-gen" className="text-[0.8125rem] font-normal">
                    AI generate content
                  </Label>
                </div>

                {stepForm.aiGenerate ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setAiPreviewResult(null);
                      setAiPreviewProspectId("");
                      setAiPreviewOpen(true);
                    }}
                  >
                    Preview generation for a sample prospect
                  </Button>
                ) : null}

                <div className="space-y-2">
                  <Label className="micro-label">Subject</Label>
                  <Input
                    value={stepForm.subject}
                    onChange={(e) => setStepForm((f) => ({ ...f, subject: e.target.value }))}
                    placeholder="Quick question about {{ company_name }}"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="micro-label">Body template</Label>
                  <Textarea
                    rows={6}
                    value={stepForm.bodyTemplate}
                    onChange={(e) => setStepForm((f) => ({ ...f, bodyTemplate: e.target.value }))}
                    placeholder="Hi {{ first_name }}, …"
                  />
                </div>

                {templateWarnings.length > 0 && (
                  <p className="font-mono text-[0.75rem] text-[color:var(--amber-600)]">
                    Unknown tokens: {templateWarnings.join(", ")}
                  </p>
                )}

                {(stepForm.subject || stepForm.bodyTemplate) && (
                  <div className="rounded-[6px] border border-border bg-secondary/50 p-3 text-[0.8125rem]">
                    <div className="micro-label">Preview</div>
                    <p className="mt-1.5 font-medium text-foreground">
                      {renderPreview(stepForm.subject)}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-foreground/90">
                      {renderPreview(stepForm.bodyTemplate)}
                    </p>
                  </div>
                )}

                <button
                  type="button"
                  className="flex w-full items-center gap-1 text-[0.75rem] font-medium uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--amber-600)] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  onClick={() => setStepForm((f) => ({ ...f, showVariantB: !f.showVariantB }))}
                >
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${stepForm.showVariantB ? "rotate-180" : ""}`}
                  />
                  A/B · Variant B
                </button>

                {stepForm.showVariantB && (
                  <div className="space-y-3 rounded-[6px] border border-border bg-background/40 p-3">
                    <div className="space-y-2">
                      <Label className="micro-label">Variant B · subject</Label>
                      <Input
                        value={stepForm.variantBSubject}
                        onChange={(e) =>
                          setStepForm((f) => ({ ...f, variantBSubject: e.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="micro-label">Variant B · body</Label>
                      <Textarea
                        rows={4}
                        value={stepForm.variantBBody}
                        onChange={(e) =>
                          setStepForm((f) => ({ ...f, variantBBody: e.target.value }))
                        }
                      />
                    </div>
                  </div>
                )}
              </>
            )}

            {stepForm.type === "wait" && (
              <div className="space-y-2">
                <Label className="micro-label">Wait duration · minutes</Label>
                <Input
                  type="number"
                  min={1}
                  className="font-mono tabular"
                  value={stepForm.waitMinutes}
                  onChange={(e) =>
                    setStepForm((f) => ({
                      ...f,
                      waitMinutes: Number(e.target.value),
                      delayMinutes: Number(e.target.value),
                    }))
                  }
                />
              </div>
            )}

            {stepForm.type === "task" && (
              <>
                <div className="space-y-2">
                  <Label className="micro-label">Task title</Label>
                  <Input
                    value={stepForm.taskTitle}
                    onChange={(e) => setStepForm((f) => ({ ...f, taskTitle: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="micro-label">Instructions</Label>
                  <Textarea
                    rows={4}
                    value={stepForm.taskInstructions}
                    onChange={(e) =>
                      setStepForm((f) => ({ ...f, taskInstructions: e.target.value }))
                    }
                  />
                </div>
              </>
            )}
          </div>

          <SheetFooter className="mt-6">
            <Button variant="outline" onClick={() => setSheetOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void saveStep()} disabled={saving}>
              {saving ? "Saving…" : "Save step"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Dialog open={aiPreviewOpen} onOpenChange={setAiPreviewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>AI generation preview</DialogTitle>
            <DialogDescription>
              Enter a prospect ID to preview AI-generated content for this step.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="preview-prospect">Prospect ID</Label>
              <Input
                id="preview-prospect"
                value={aiPreviewProspectId}
                onChange={(e) => setAiPreviewProspectId(e.target.value)}
                placeholder="UUID of a sample prospect"
              />
            </div>
            {aiPreviewResult ? (
              <div className="rounded border bg-muted/40 p-3 text-sm">
                <p className="font-medium">{aiPreviewResult.subject}</p>
                <p className="mt-2 whitespace-pre-wrap">{aiPreviewResult.body}</p>
                <p className="mt-2 text-muted-foreground">{aiPreviewResult.rationale}</p>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAiPreviewOpen(false)}>
              Close
            </Button>
            <Button
              disabled={!aiPreviewProspectId || aiPreviewLoading}
              onClick={() => {
                setAiPreviewLoading(true);
                void generateEmailForProspect({
                  data: {
                    prospectId: aiPreviewProspectId,
                    stepId: stepForm.id,
                  },
                })
                  .then((result) => {
                    if (result.status === "RESEARCH_PENDING") {
                      // RESEARCH_PENDING is a normal state, not an error.
                      toast.info("Research kicked off — try again in a few seconds");
                      return;
                    }
                    setAiPreviewResult({
                      subject: result.subject,
                      body: result.body,
                      rationale: result.rationale,
                    });
                    toast.success("Preview generated");
                  })
                  .catch((err: Error) => toast.error(err.message))
                  .finally(() => setAiPreviewLoading(false));
              }}
            >
              {aiPreviewLoading ? "Generating…" : "Generate preview"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GatewayMultiSelect({
  label,
  selected,
  onChange,
}: {
  label: string;
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-between font-normal">
            {selected.length > 0 ? `${selected.length} selected` : "Select gateways…"}
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search gateways…" />
            <CommandList>
              <CommandEmpty>No gateway found.</CommandEmpty>
              <CommandGroup>
                {GATEWAY_FILTER_OPTIONS.map((opt) => {
                  const checked = selected.includes(opt.value);
                  return (
                    <CommandItem
                      key={opt.value}
                      onSelect={() => {
                        onChange(
                          checked
                            ? selected.filter((v) => v !== opt.value)
                            : [...selected, opt.value],
                        );
                      }}
                    >
                      <Check
                        className={cn("mr-2 h-4 w-4", checked ? "opacity-100" : "opacity-0")}
                      />
                      {opt.label}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
