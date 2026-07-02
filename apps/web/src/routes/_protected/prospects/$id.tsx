import { zodResolver } from "@hookform/resolvers/zod";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { GatewayBadge } from "@/components/gateway-badge.tsx";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

  const timeline = [
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
  ];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex items-center gap-3">
        <Link to="/prospects" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          ← Back
        </Link>
        <h1 className="text-2xl font-semibold">
          {[prospect.firstName, prospect.lastName].filter(Boolean).join(" ") || prospect.email}
        </h1>
        <Badge variant="secondary">{prospect.status}</Badge>
        <GatewayBadge gateway={prospect.emailGateway} evidence={prospect.gatewayEvidence} />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Contact</CardTitle>
            <CardDescription>{prospect.email}</CardDescription>
          </CardHeader>
          <CardContent>
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
                              {s}
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
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Company</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {company ? (
                <dl className="space-y-2">
                  <div>
                    <dt className="text-muted-foreground">Name</dt>
                    <dd>{company.name ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Domain</dt>
                    <dd>{company.domain ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Industry</dt>
                    <dd>{company.industry ?? "—"}</dd>
                  </div>
                </dl>
              ) : (
                <p className="text-muted-foreground">No company linked.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Lists</CardTitle>
            </CardHeader>
            <CardContent>
              {lists.length ? (
                <ul className="list-inside list-disc text-sm">
                  {lists.map((l: { id: string; name: string }) => (
                    <li key={l.id}>{l.name}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Not on any lists.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
          <CardDescription>Activity and field changes</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h3 className="mb-2 text-sm font-medium">Field changes</h3>
            <ul className="space-y-3 border-l pl-4">
              {timeline.map((event) => (
                <li key={event.id} className="relative">
                  <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-primary" />
                  <p className="text-sm font-medium">{event.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(event.at).toLocaleString()} — {event.detail}
                  </p>
                </li>
              ))}
            </ul>
          </div>
          <Separator />
          <div>
            <h3 className="mb-1 text-sm font-medium">CRM write-back</h3>
            {writebackLogs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No CRM activity logged yet.</p>
            ) : (
              <ul className="space-y-2 border-l pl-4">
                {writebackLogs.map((log) => (
                  <li key={log.id} className="relative text-sm">
                    <span
                      className={`absolute -left-[21px] top-1.5 h-2 w-2 rounded-full ${
                        log.status === "succeeded"
                          ? "bg-emerald-500"
                          : log.status === "failed"
                            ? "bg-red-500"
                            : "bg-amber-500"
                      }`}
                    />
                    <p className="font-medium">
                      {log.eventType} — {log.status}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(log.createdAt).toLocaleString()}
                      {log.lastError ? ` — ${log.lastError}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Separator />
          <div>
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
              <p className="text-sm text-muted-foreground">No enrollments yet.</p>
            ) : (
              <ul className="space-y-2">
                {enrollments.map((enrollment) => (
                  <li
                    key={enrollment.id}
                    className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                  >
                    <div>
                      <p className="font-medium">{enrollment.sequenceName}</p>
                      <p className="text-xs text-muted-foreground">
                        Step {enrollment.currentStepIndex} · Updated{" "}
                        {new Date(enrollment.updatedAt).toLocaleString()}
                      </p>
                    </div>
                    <Badge variant="secondary">{enrollment.state}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium">Messages</h3>
            {messages.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">No messages yet.</p>
            ) : (
              <ul className="space-y-2">
                {messages.items.map((message) => (
                  <li
                    key={message.id}
                    className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{message.subject ?? "(no subject)"}</p>
                      <p className="text-xs text-muted-foreground">
                        {message.direction} ·{" "}
                        {new Date(message.sentAt ?? message.receivedAt ?? "").toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {message.sentiment && <Badge variant="outline">{message.sentiment}</Badge>}
                      <Badge variant={message.direction === "inbound" ? "default" : "secondary"}>
                        {message.status}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
