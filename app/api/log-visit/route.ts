import { NextResponse } from "next/server";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { google } from "googleapis";
import { VisitExtractionSchema, type VisitExtraction } from "@/lib/schema";

export const runtime = "nodejs";

type Body = {
  rep?: string;
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

function normalizeEmail(raw: string): string {
  let text = raw.toLowerCase();

  text = text
    .replace(/\s+at\s+/g, "@")
    .replace(/\s+dot\s+/g, ".")
    .replace(/\s+period\s+/g, ".")
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9@._+-]/g, "");

  const commonDomains: Record<string, string> = {
    "@gmail": "@gmail.com",
    "@outlook": "@outlook.com",
    "@hotmail": "@hotmail.com",
    "@yahoo": "@yahoo.com",
    "@icloud": "@icloud.com"
  };

  for (const [shortDomain, fullDomain] of Object.entries(commonDomains)) {
    if (text.endsWith(shortDomain)) {
      text = text.slice(0, -shortDomain.length) + fullDomain;
    }
  }

  const match = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);
  return match ? match[0] : "";
}

function extractEmailFromRawNote(note: string): string {
  const patterns = [
    /(?:his|her|their|the|contact|best|main)?\s*email(?: address)?\s*(?:is|was|:)?\s+(.{3,80})/i,
    /(?:email|e-mail)\s*(?:is|was|:)?\s+(.{3,80})/i
  ];

  for (const pattern of patterns) {
    const match = note.match(pattern);
    if (!match?.[1]) continue;

    const candidate = match[1].split(/[.,;]|\b(phone|number|follow|call|text|spoke|liked|interested)\b/i)[0];
    const normalized = normalizeEmail(candidate);

    if (normalized) return normalized;
  }

  const directEmail = note.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return directEmail ? directEmail[0].toLowerCase() : "";
}

function wordToDigit(word: string): string {
  const map: Record<string, string> = {
    zero: "0",
    oh: "0",
    o: "0",
    one: "1",
    two: "2",
    three: "3",
    four: "4",
    five: "5",
    six: "6",
    seven: "7",
    eight: "8",
    nine: "9"
  };

  return map[word.toLowerCase()] ?? word;
}

function normalizePhone(raw: string): string {
  let text = raw.toLowerCase();

  text = text.replace(
    /\b(zero|oh|o|one|two|three|four|five|six|seven|eight|nine)\b/g,
    word => wordToDigit(word)
  );

  const digits = text.replace(/[^\d+]/g, "");

  if (digits.length < 7) return "";

  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return `${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  }

  return digits;
}

function extractPhoneFromRawNote(note: string): string {
  const patterns = [
    /(?:his|her|their|the|contact|best|main)?\s*(?:phone|phone number|number|mobile|cell)\s*(?:is|was|:)?\s+(.{3,60})/i,
    /(?:call|text)\s+(?:him|her|them)?\s*(?:at)?\s+(.{3,60})/i
  ];

  for (const pattern of patterns) {
    const match = note.match(pattern);
    if (!match?.[1]) continue;

    const candidate = match[1].split(/[.,;]|\b(email|follow|spoke|liked|interested)\b/i)[0];
    const normalized = normalizePhone(candidate);

    if (normalized) return normalized;
  }

  const directPhone = note.match(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  return directPhone ? normalizePhone(directPhone[0]) : "";
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

  const fallbackEmail = extractEmailFromRawNote(input.note);
  const fallbackPhone = extractPhoneFromRawNote(input.note);

  return {
    ...cleaned,
    email_account: fallbackEmail || cleaned.email_account,
    phone_number: fallbackPhone || cleaned.phone_number
  };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

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
