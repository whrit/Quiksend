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
import { Badge } from "@/components/ui/badge";
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

function stepTitle(step: Step): string {
  const config = step.config;
  if (step.type === "manual_email" || step.type === "auto_email") {
    return "subject" in config ? config.subject || "Untitled email" : "Untitled email";
  }
  if (step.type === "task") {
    return "title" in config ? config.title || "Untitled task" : "Untitled task";
  }
  if (step.type === "wait") {
    const mins = "minutes" in config ? config.minutes : step.delayMinutes;
    return `Wait ${mins}m`;
  }
  return "Step";
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 rounded-lg border bg-card p-4 shadow-sm"
    >
      {isDraft && (
        <button
          type="button"
          className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-5 w-5" />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{stepTitle(step)}</span>
          <Badge variant="outline">{STEP_TYPE_LABELS[step.type]}</Badge>
          {step.delayMinutes > 0 && <Badge variant="secondary">+{step.delayMinutes}m delay</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">Step {step.index + 1}</p>
      </div>
      {isDraft && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost">
              <MoreHorizontal className="h-4 w-4" />
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
      )}
      {!isDraft && (
        <Button size="sm" variant="ghost" onClick={onEdit}>
          View
        </Button>
      )}
    </div>
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
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{sequence.name}</h1>
            <Badge>{sequence.status}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {isDraft ? "Draft — add steps and activate when ready." : "Active sequence"}
          </p>
        </div>
        <div className="flex gap-2">
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
      </div>

      {anchorMessageId ? (
        <div className="rounded-md border bg-primary/5 p-3 text-sm">
          Anchored to message{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            {anchorMessageId.slice(0, 8)}…
          </code>{" "}
          — use <code>auto_email</code> steps to reply into that thread when you activate and
          enroll.
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">Steps</h2>
            {isDraft && (
              <Button
                size="sm"
                onClick={() => {
                  setStepForm(emptyStepForm(steps.length));
                  setSheetOpen(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
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
              <div className="space-y-2">
                {steps.length === 0 ? (
                  <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
                    No steps yet. Add your first step to build the sequence.
                  </p>
                ) : (
                  steps.map((step) => (
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
                  ))
                )}
              </div>
            </SortableContext>
          </DndContext>
        </div>

        <div className="space-y-4 rounded-lg border p-4">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            <h2 className="font-medium">Settings</h2>
          </div>

          <div className="space-y-2">
            <Label>Timezone</Label>
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
            <Label>Throttle (seconds between sends)</Label>
            <Input
              type="number"
              min={0}
              value={settings.throttle_seconds}
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
            <Label htmlFor="business-days">Business days only</Label>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="stop-reply"
              checked={settings.stop_on_reply}
              onCheckedChange={(c) => setSettings((s) => ({ ...s, stop_on_reply: c === true }))}
            />
            <Label htmlFor="stop-reply">Stop on reply</Label>
          </div>

          <div className="space-y-2">
            <Label>Mailboxes</Label>
            <div className="max-h-40 space-y-2 overflow-y-auto rounded border p-2">
              {mailboxes.length === 0 ? (
                <p className="text-xs text-muted-foreground">No mailboxes configured.</p>
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
                    <Label htmlFor={`mb-${mb.id}`} className="text-sm font-normal">
                      {mb.address}
                    </Label>
                  </div>
                ))
              )}
            </div>
          </div>

          <Button className="w-full" onClick={() => void saveSettings()} disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{stepForm.id ? "Edit step" : "Add step"}</SheetTitle>
          </SheetHeader>

          <div className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label>Step type</Label>
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
              <Label>Delay after previous step (minutes)</Label>
              <Input
                type="number"
                min={0}
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
              <Label htmlFor="step-biz-days">Business days only</Label>
            </div>

            <div className="space-y-3 rounded border p-3">
              <p className="text-sm font-medium">Entry conditions</p>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="if-no-reply"
                  checked={stepForm.ifNoReply}
                  onCheckedChange={(c) => setStepForm((f) => ({ ...f, ifNoReply: c === true }))}
                />
                <Label htmlFor="if-no-reply">Only if no reply on thread</Label>
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

            {(stepForm.type === "manual_email" || stepForm.type === "auto_email") && (
              <>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="ai-gen"
                    checked={stepForm.aiGenerate}
                    onCheckedChange={(c) => setStepForm((f) => ({ ...f, aiGenerate: c === true }))}
                  />
                  <Label htmlFor="ai-gen">AI generate content</Label>
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
                  <Label>Subject</Label>
                  <Input
                    value={stepForm.subject}
                    onChange={(e) => setStepForm((f) => ({ ...f, subject: e.target.value }))}
                    placeholder="Quick question about {{ company_name }}"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Body template</Label>
                  <Textarea
                    rows={6}
                    value={stepForm.bodyTemplate}
                    onChange={(e) => setStepForm((f) => ({ ...f, bodyTemplate: e.target.value }))}
                    placeholder="Hi {{ first_name }}, …"
                  />
                </div>

                {templateWarnings.length > 0 && (
                  <p className="text-sm text-amber-600">
                    Unknown tokens: {templateWarnings.join(", ")}
                  </p>
                )}

                {(stepForm.subject || stepForm.bodyTemplate) && (
                  <div className="rounded border bg-muted/50 p-3 text-sm">
                    <p className="mb-1 font-medium">Preview</p>
                    <p className="font-medium">{renderPreview(stepForm.subject)}</p>
                    <p className="mt-2 whitespace-pre-wrap">
                      {renderPreview(stepForm.bodyTemplate)}
                    </p>
                  </div>
                )}

                <button
                  type="button"
                  className="flex w-full items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                  onClick={() => setStepForm((f) => ({ ...f, showVariantB: !f.showVariantB }))}
                >
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${stepForm.showVariantB ? "rotate-180" : ""}`}
                  />
                  A/B variant B
                </button>

                {stepForm.showVariantB && (
                  <div className="space-y-3 rounded border p-3">
                    <div className="space-y-2">
                      <Label>Variant B subject</Label>
                      <Input
                        value={stepForm.variantBSubject}
                        onChange={(e) =>
                          setStepForm((f) => ({ ...f, variantBSubject: e.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Variant B body</Label>
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
                <Label>Wait duration (minutes)</Label>
                <Input
                  type="number"
                  min={1}
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
                  <Label>Task title</Label>
                  <Input
                    value={stepForm.taskTitle}
                    onChange={(e) => setStepForm((f) => ({ ...f, taskTitle: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Instructions</Label>
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
