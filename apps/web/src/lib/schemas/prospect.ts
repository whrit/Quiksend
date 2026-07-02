import { z } from "zod";

export const prospectStatusSchema = z.enum([
  "new",
  "active",
  "replied",
  "bounced",
  "unsubscribed",
  "do_not_contact",
]);

export const prospectSourceSchema = z.enum(["manual", "csv", "crm", "api"]);

export const createProspectInputSchema = z.object({
  email: z.string().min(1).max(320),
  firstName: z.string().max(200).optional(),
  lastName: z.string().max(200).optional(),
  title: z.string().max(200).optional(),
  phone: z.string().max(50).optional(),
  linkedinUrl: z.string().max(500).optional(),
  timezone: z.string().max(100).optional(),
  status: prospectStatusSchema.optional(),
  companyId: z.string().uuid().optional(),
  source: prospectSourceSchema.optional().default("manual"),
});

export const apiCreateProspectSchema = createProspectInputSchema.omit({ source: true }).extend({
  status: prospectStatusSchema.optional(),
  companyId: z.string().uuid().optional(),
});

export type ProspectStatus = z.infer<typeof prospectStatusSchema>;
export type CreateProspectInput = z.infer<typeof createProspectInputSchema>;
