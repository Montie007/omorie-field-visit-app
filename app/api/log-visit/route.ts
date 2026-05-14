import { NextResponse } from "next/server";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { google } from "googleapis";
import { VisitExtractionSchema, type VisitExtraction } from "@/lib/schema";

export const runtime = "nodejs";

type Body = {
  rep?: string;
  password?: string;
  cafeName?: string;
  city?: string;
  note?: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function cleanPrivateKey(key: string): string {
  return key.replace(/\\n/g, "\n");
}

function cell(value: unknown): string {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value === null || value === undefined) return "";
  return String(value);
}

function chooseFollowUpChannel(result: VisitExtraction): string {
  const action = result.follow_up_action.toLowerCase();

  const hasEmail = Boolean(result.email_account?.trim());
  const hasPhone = Boolean(result.phone_number?.trim());
  const mentionsPhone = /\b(call|text|phone|sms)\b/i.test(action);

  if (hasEmail && hasPhone) return "Email + Phone";
  if (hasPhone || mentionsPhone) return "Phone";
  return "Email";
}

async function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: requiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    key: cleanPrivateKey(requiredEnv("GOOGLE_PRIVATE_KEY")),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  return google.sheets({ version: "v4", auth });
}

async function appendRow(tabName: string, row: string[]) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: requiredEnv("GOOGLE_SHEET_ID"),
    range: `${tabName}!A:Z`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] }
  });
}

async function extractVisit(input: { note: string; cafeName: string; city: string }): Promise<VisitExtraction> {
  const openai = new OpenAI({ apiKey: requiredEnv("OPENAI_API_KEY") });
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const today = new Date().toISOString().slice(0, 10);

  const completion = await openai.chat.completions.parse({
    model,
    messages: [
      {
        role: "system",
        content: [
          "You extract structured sales visit information for Omorie Matcha.",
          "Return only the required structured fields.",
          "Use empty strings or empty arrays where information is missing.",
          "Do not invent missing information.",
          "interest_level must be Low, Medium, High, or Unknown.",
          "Use US state abbreviations when state is clear.",
          "follow_up_date must be ISO YYYY-MM-DD if clear; otherwise empty string.",
          "email_account must contain only an email address explicitly stated in the note. If no email is stated, return an empty string.",
          "phone_number must contain only a phone number explicitly stated in the note. If no phone number is stated, return an empty string.",
          "If the note says to call, text, or phone someone, reflect that in follow_up_action.",
          `Today's date is ${today}. Resolve relative dates like next Tuesday from this date.`
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({
          optional_cafe_name: input.cafeName,
          optional_city: input.city,
          visit_note: input.note
        })
      }
    ],
    response_format: zodResponseFormat(VisitExtractionSchema, "visit_extraction")
  });

  const parsed = completion.choices[0]?.message?.parsed;
  if (!parsed) throw new Error("OpenAI returned no structured result.");

  const cleaned = VisitExtractionSchema.parse({
    ...parsed,
    cafe_name: parsed.cafe_name || input.cafeName || "",
    city: parsed.city || input.city || ""
  });

  return cleaned;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    if (process.env.APP_PASSWORD && body.password !== process.env.APP_PASSWORD) {
      return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
    }

    const note = body.note?.trim() || "";
    if (!note) return NextResponse.json({ error: "Visit note is required." }, { status: 400 });

    const rep = body.rep?.trim() || "Landon";
    const cafeName = body.cafeName?.trim() || "";
    const city = body.city?.trim() || "";
    const timestamp = new Date().toISOString();

    const result = await extractVisit({ note, cafeName, city });

    await appendRow("VISIT_LOG", [
      timestamp,
      rep,
      note,
      cell(result.cafe_name),
      cell(result.city),
      cell(result.state),
      cell(result.contact_name),
      cell(result.contact_role),
      cell(result.interest_level),
      cell(result.products_liked),
      cell(result.objections),
      cell(result.current_supplier),
      cell(result.follow_up_needed),
      cell(result.follow_up_date),
      cell(result.follow_up_action),
      cell(result.summary)
    ]);

    if (result.follow_up_needed) {
      await appendRow("FOLLOW_UPS", [
        timestamp,
        cell(result.follow_up_date),
        cell(result.cafe_name),
        cell(result.contact_name),
        chooseFollowUpChannel(result),
        cell(result.email_account),
        cell(result.phone_number),
        cell(result.follow_up_action),
        "",
        "NEW"
      ]);
    }

    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
