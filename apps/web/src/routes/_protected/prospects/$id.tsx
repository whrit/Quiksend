import { zodResolver } from "@hookform/resolvers/zod";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Mail, User } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { GatewayBadge } from "@/components/gateway-badge.tsx";
import { Absent, Pill, Panel, Tile } from "@/components/ui/primitives.tsx";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  getProspect,
  getProspectEnrollments,
  getProspectMessages,
  getProspectResearchProfile,
  updateProspect,
} from "@/lib/prospects.functions.ts";
import { getProspectWritebackLogs } from "@/lib/analytics.functions.ts";
import {
  enrollmentTone,
  formatDate,
  formatRelative,
  prospectTone,
  type Tone,
} from "@/lib/semantic.ts";

const statusOptions = [
  "new",
  "active",
  "replied",
  "bounced",
  "unsubscribed",
  "do_not_contact",
] as const;

const editSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  title: z.string().optional(),
  phone: z.string().optional(),
  linkedinUrl: z.string().optional(),
  timezone: z.string().optional(),
  status: z.enum(statusOptions),
});

export const Route = createFileRoute("/_protected/prospects/$id")({
  loader: async ({ params }) => {
    const [data, writebackLogs, enrollments, messages, researchProfile] = await Promise.all([
      getProspect({ data: { id: params.id } }),
      getProspectWritebackLogs({ data: { prospectId: params.id } }),
      getProspectEnrollments({ data: { prospectId: params.id } }),
      getProspectMessages({ data: { prospectId: params.id, limit: 20 } }),
      getProspectResearchProfile({ data: { prospectId: params.id } }),
    ]);
    return { ...data, writebackLogs, enrollments, messages, researchProfile };
  },
  component: ProspectDetailPage,
});

function writebackTone(status: string): Tone {
  if (status === "succeeded") return "pos";
  if (status === "failed") return "neg";
  return "warn";
}

function messageTone(status: string): Tone {
  if (status === "delivered" || status === "opened" || status === "clicked") return "pos";
  if (status === "bounced" || status === "failed") return "neg";
  if (status === "sent") return "brand";
  return "neutral";
}

function ProspectDetailPage() {
  const data = Route.useLoaderData();
  const { prospect, company, lists, writebackLogs, enrollments, messages, researchProfile } = data;

  const form = useForm<z.infer<typeof editSchema>>({
    resolver: zodResolver(editSchema),
    values: {
      firstName: prospect.firstName ?? "",
      lastName: prospect.lastName ?? "",
      title: prospect.title ?? "",
      phone: prospect.phone ?? "",
      linkedinUrl: prospect.linkedinUrl ?? "",
      timezone: prospect.timezone ?? "",
      status: prospect.status,
    },
  });

  const onSave = form.handleSubmit(async (values) => {
    try {
      await updateProspect({
        data: {
          id: prospect.id,
          patch: {
            firstName: values.firstName || null,
            lastName: values.lastName || null,
            title: values.title || null,
            phone: values.phone || null,
            linkedinUrl: values.linkedinUrl || null,
            timezone: values.timezone || null,
            status: values.status,
          },
        },
      });
      toast.success("Prospect updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    }
  });

  const fullName = [prospect.firstName, prospect.lastName].filter(Boolean).join(" ");

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      {/* Back */}
      <div className="flex items-center gap-2">
        <Link to="/prospects" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          ← Back
        </Link>
      </div>

      {/* Identity block */}
      <div className="panel flex flex-wrap items-center gap-4 p-4">
        <Tile size="lg" hue={prospectTone(prospect.status)} tint>
          <User />
        </Tile>
        <div className="min-w-0">
          <h1 className="text-[1.125rem] font-semibold leading-tight tracking-[-0.015em]">
            {fullName || <Absent>No name</Absent>}
          </h1>
          <p className="mt-0.5 text-[0.75rem] text-muted-foreground">
            {[prospect.title, company?.name].filter(Boolean).join(" · ") || (
              <Absent>No title or company</Absent>
            )}
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-[0.75rem] text-muted-foreground">
            <Mail className="h-3 w-3 shrink-0" />
            {prospect.email}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Pill tone={prospectTone(prospect.status)} dot>
            {prospect.status.replace(/_/g, " ")}
          </Pill>
          <GatewayBadge gateway={prospect.emailGateway} evidence={prospect.gatewayEvidence} />
        </div>
      </div>

      {/* Two-column: edit form + company/lists */}
      <div className="grid gap-6 md:grid-cols-2">
        <Panel title="Contact" bodyClassName="p-4">
          <Form {...form}>
            <form onSubmit={onSave} className="flex flex-col gap-3">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Title</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="linkedinUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>LinkedIn</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="timezone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Timezone</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {statusOptions.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s.replace(/_/g, " ")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={form.formState.isSubmitting}>
                Save changes
              </Button>
            </form>
          </Form>
        </Panel>

        <div className="flex flex-col gap-6">
          <Panel title="Company" bodyClassName="p-4 text-sm">
            {company ? (
              <dl className="space-y-2">
                <div>
                  <dt className="text-muted-foreground">Name</dt>
                  <dd>{company.name ?? <Absent>Unknown</Absent>}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Domain</dt>
                  <dd>{company.domain ?? <Absent>Unknown</Absent>}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Industry</dt>
                  <dd>{company.industry ?? <Absent>Unknown</Absent>}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-muted-foreground">
                <Absent>No company linked</Absent>
              </p>
            )}
          </Panel>

          <Panel title="Lists" bodyClassName="p-4">
            {lists.length ? (
              <ul className="space-y-1 text-sm">
                {lists.map((l: { id: string; name: string }) => (
                  <li key={l.id}>{l.name}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm">
                <Absent>Not on any lists</Absent>
              </p>
            )}
          </Panel>
        </div>
      </div>

      {/* Activity timeline */}
      <Panel title="Activity">
        <div className="divide-y divide-border p-4">
          {/* Field changes */}
          <div className="pb-4">
            <h3 className="mb-2 text-sm font-medium">Field changes</h3>
            <ul className="space-y-3 border-l pl-4">
              {[
                {
                  id: "created",
                  label: "Created",
                  at: prospect.createdAt,
                  detail: `Imported via ${prospect.source}`,
                },
                ...(prospect.updatedAt !== prospect.createdAt
                  ? [
                      {
                        id: "updated",
                        label: "Updated",
                        at: prospect.updatedAt,
                        detail: "Fields changed",
                      },
                    ]
                  : []),
              ].map((event) => (
                <li key={event.id} className="relative">
                  <span
                    className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full"
                    style={{ background: "var(--brand-600)" }}
                  />
                  <p className="text-sm font-medium">{event.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatRelative(event.at) ?? formatDate(event.at) ?? (
                      <Absent>Unknown time</Absent>
                    )}{" "}
                    — {event.detail}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          {/* CRM write-back */}
          <div className="py-4">
            <h3 className="mb-1 text-sm font-medium">CRM write-back</h3>
            {writebackLogs.length === 0 ? (
              <p className="text-sm">
                <Absent>No CRM activity logged yet</Absent>
              </p>
            ) : (
              <ul className="space-y-2 border-l pl-4">
                {writebackLogs.map((log) => (
                  <li key={log.id} className="relative text-sm">
                    <span
                      className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full"
                      style={{ background: `var(--${writebackTone(log.status)})` }}
                    />
                    <p className="font-medium">
                      {log.eventType} —{" "}
                      <Pill tone={writebackTone(log.status)} dot>
                        {log.status}
                      </Pill>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatRelative(log.createdAt) ?? formatDate(log.createdAt) ?? (
                        <Absent>Unknown</Absent>
                      )}
                      {log.lastError ? ` — ${log.lastError}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Separator />

          {/* Sequence enrollments */}
          <div className="py-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-medium">Sequence history</h3>
              {researchProfile ? (
                <Link
                  to="/prospects/$id/generate"
                  params={{ id: prospect.id }}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  View research
                </Link>
              ) : (
                <Link
                  to="/prospects/$id/generate"
                  params={{ id: prospect.id }}
                  className={buttonVariants({ variant: "ghost", size: "sm" })}
                >
                  Generate research
                </Link>
              )}
            </div>
            {enrollments.length === 0 ? (
              <p className="text-sm">
                <Absent>No enrollments yet</Absent>
              </p>
            ) : (
              <ul className="space-y-2">
                {enrollments.map((enrollment) => (
                  <li
                    key={enrollment.id}
                    className="flex items-center justify-between rounded-[var(--radius-md)] border px-3 py-2 text-sm"
                  >
                    <div>
                      <p className="font-medium">{enrollment.sequenceName}</p>
                      <p className="text-xs text-muted-foreground">
                        Step {enrollment.currentStepIndex} ·{" "}
                        {formatRelative(enrollment.updatedAt) ??
                          formatDate(enrollment.updatedAt) ?? <Absent>Unknown</Absent>}
                      </p>
                    </div>
                    <Pill tone={enrollmentTone(enrollment.state)} dot>
                      {enrollment.state.replace(/_/g, " ")}
                    </Pill>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Messages */}
          <div className="pt-4">
            <h3 className="mb-2 text-sm font-medium">Messages</h3>
            {messages.items.length === 0 ? (
              <p className="text-sm">
                <Absent>No messages yet</Absent>
              </p>
            ) : (
              <ul className="space-y-2">
                {messages.items.map((message) => {
                  const ts =
                    formatRelative(message.sentAt ?? message.receivedAt) ??
                    formatDate(message.sentAt ?? message.receivedAt);
                  return (
                    <li
                      key={message.id}
                      className={`flex items-center justify-between rounded-[var(--radius-md)] border px-3 py-2 text-sm ${
                        message.direction === "outbound" ? "ink-mark-bar" : ""
                      }`}
                    >
                      <div className="min-w-0">
                        <p
                          className="max-w-[32ch] truncate font-medium"
                          title={message.subject ?? "(no subject)"}
                        >
                          {message.subject ?? <Absent>No subject</Absent>}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {message.direction === "inbound" ? "Inbound" : "Outbound"} ·{" "}
                          {ts ?? <Absent>Unknown time</Absent>}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {message.sentiment ? <Pill tone="neutral">{message.sentiment}</Pill> : null}
                        <Pill tone={messageTone(message.status)} dot>
                          {message.status}
                        </Pill>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}
