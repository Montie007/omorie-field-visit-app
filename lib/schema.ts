import { z } from "zod";

export const VisitExtractionSchema = z.object({
  return_visit: z.enum(["New", "Return"]),
  cafe_name: z.string(),
  location: z.string(),
  city: z.string(),
  contact_name: z.string(),
  contact_role: z.string(),
  interest_level: z.enum(["Low", "Medium", "High", "Unknown"]),
  email_account: z.string(),
  phone_number: z.string()
});

export type VisitExtraction = z.infer<typeof VisitExtractionSchema>;
