import { Link, createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, ClipboardList, Mail, SkipForward } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/primitives.tsx";
import {
  listTasks,
  completeGenericTask,
  skipTask,
} from "@/lib/tasks.functions.ts";

export const Route = createFileRoute("/_protected/tasks/")({
  loader: () => listTasks(),
  component: TaskInboxPage,
});

function TaskInboxPage() {
  const initialTasks = Route.useLoaderData();
  const [tasks, setTasks] = useState(initialTasks);
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const resolveTask = async (
    taskId: string,
    action: typeof completeGenericTask | typeof skipTask,
    label: string,
  ) => {
    setLoading((p) => ({ ...p, [taskId]: true }));
    try {
      await action({ data: { taskId } });
      setTasks((prev) => {
        const idx = prev.findIndex((t) => t.id === taskId);
        const next = prev.filter((t) => t.id !== taskId);

        // After removal, focus the primary action of the next task in list
        // order, or the heading when the list empties.
        requestAnimationFrame(() => {
          if (next.length === 0) {
            headingRef.current?.focus();
            return;
          }
          // Focus the task that now occupies the same index (or last if at end)
          const focusIdx = Math.min(idx, next.length - 1);
          const buttons = listRef.current?.querySelectorAll<HTMLElement>(
            "li:nth-child(" + (focusIdx + 1) + ") [data-task-action]",
          );
          buttons?.[0]?.focus();
        });

        return next;
      });
      toast.success(`Task ${label}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to ${label.toLowerCase()} task`);
    } finally {
      setLoading((p) => ({ ...p, [taskId]: false }));
    }
  };

  if (tasks.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-12">
        <EmptyState
          icon={<ClipboardList className="h-8 w-8" />}
          title="No open tasks"
          body="Tasks from sequences will appear here when they require manual action."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-6 fade-in w-full min-w-0">
      <h1 ref={headingRef} className="text-lg font-semibold mb-4" tabIndex={-1}>
        Tasks
      </h1>
      <ul ref={listRef}  className="space-y-3">
        {tasks.map((task) => {
          const busy = loading[task.id] ?? false;
          return (
            <li
              key={task.id}
              className="flex items-center justify-between rounded-lg border p-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium truncate">{task.title}</span>
                  <Badge variant={task.type === "compose" ? "info" : "subtle"}>
                    {task.type === "compose" ? "Compose" : "Task"}
                  </Badge>
                </div>
                {task.instructions && (
                  <p className="text-sm text-muted-foreground truncate">
                    {task.instructions}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 ml-4 shrink-0">
                {task.type === "compose" ? (
                  <Link
                    to="/compose"
                    search={{ taskId: task.id, enrollmentId: task.enrollmentId }}
                    className={buttonVariants({ size: "sm" })}
                    aria-label={`Compose: ${task.title}`}
                    data-task-action
                  >
                    <Mail className="mr-1.5 h-3.5 w-3.5" />
                    Compose
                  </Link>
                ) : (
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => resolveTask(task.id, completeGenericTask, "completed")}
                    disabled={busy}
                    aria-label={`Complete: ${task.title}`}
                    data-task-action
                  >
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                    Complete
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => resolveTask(task.id, skipTask, "skipped")}
                  disabled={busy}
                  aria-label={`Skip: ${task.title}`}
                  data-task-action
                >
                  <SkipForward className="mr-1.5 h-3.5 w-3.5" />
                  Skip
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
