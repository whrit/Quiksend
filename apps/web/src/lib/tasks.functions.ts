import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "./org-fn.ts";
import {
  listTasksCore,
  getTaskContextCore,
  completeGenericTaskCore,
  skipTaskCore,
} from "./tasks.server.ts";

const taskIdInput = (data: unknown) => z.object({ taskId: z.string().uuid() }).parse(data);

export const listTasks = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { organizationId } = context.orgContext;
    return listTasksCore(organizationId);
  });

export const getTaskContext = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(taskIdInput)
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    return getTaskContextCore(data.taskId, organizationId);
  });

export const completeGenericTask = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(taskIdInput)
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    return completeGenericTaskCore(data.taskId, organizationId);
  });

export const skipTask = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(taskIdInput)
  .handler(async ({ data, context }) => {
    const { organizationId } = context.orgContext;
    return skipTaskCore(data.taskId, organizationId);
  });
