import { z } from "zod";

export const VisitExtractionSchema = z.object({
  cafe_name: z.string(),
  location: z.string(),
  city: z.string(),
  contact_name: z.string(),
  contact_role: z.string(),
  interest_level: z.enum(["Low", "Medium", "High", "Unknown"]),
  products_liked: z.array(z.string()),
  objections: z.array(z.string()),
  current_supplier: z.string(),
  volume: z.string(),
  follow_up_needed: z.boolean(),
  follow_up_date: z.string(),
  follow_up_action: z.string(),
  email_account: z.string(),
  phone_number: z.string(),
  summary: z.string()
});

export type VisitExtraction = z.infer<typeof VisitExtractionSchema>;
