import { NextResponse } from "next/server";
import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { google } from "googleapis";
import { VisitExtractionSchema, type VisitExtraction } from "@/lib/schema";

export const runtime = "nodejs";

type Body = {
  rep?: string;
  cafeName?: string;
  returnVisit?: "New" | "Return";
  city?: string;
  note?: string;
};

type VisitResult = VisitExtraction & {
  follow_up_status: "NEW" | "REPEAT";
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
  if (value === null || value === undefined) return "";
  return String(value);
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
    range: `${tabName}!A:M`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] }
  });
}

async function extractVisit(input: {
  note: string;
  cafeName: string;
  returnVisit: "New" | "Return";
  city: string;
}): Promise<VisitExtraction> {
  const openai = new OpenAI({ apiKey: requiredEnv("OPENAI_API_KEY") });
  const model = process.env.OPENAI_MODEL || "gpt-5-nano";

  const completion = await openai.chat.completions.parse({
    model,
    messages: [
      {
        role: "system",
        content: [
          "You extract structured sales visit information for Omorie Matcha.",
          "Return only the required structured fields.",
          "Use empty strings where information is missing.",
          "Do not invent missing information.",
          "return_visit must be New or Return.",
          "Use Return if the note says this is a return visit, follow-up visit, second visit, visited again, came back, stopped by again, already visited before, or similar.",
          "Otherwise use New.",
          "interest_level must be Low, Medium, High, or Unknown.",
          "location should capture the specific location stated in the note, such as street, neighbourhood, district, area, or exact address.",
          "city should capture the actual city only, such as New York, Phoenix, Los Angeles, Austin, or Salt Lake City. Do not put neighbourhoods or streets in city.",
          "email_account must contain only an email address explicitly stated in the note. If no email is stated, return an empty string.",
          "phone_number must contain only a phone number explicitly stated in the note. If no phone number is stated, return an empty string."
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({
          selected_return_visit: input.returnVisit,
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
    return_visit:
      input.returnVisit === "Return" || parsed.return_visit === "Return"
        ? "Return"
        : "New",
    cafe_name: input.cafeName || parsed.cafe_name || "",
    location: parsed.location || "",
    city: input.city || parsed.city || ""
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
    if (!note) {
      return NextResponse.json({ error: "Visit note is required." }, { status: 400 });
    }

    const rep = body.rep?.trim() || "Landon";
    const cafeName = body.cafeName?.trim() || "";
    const returnVisit = body.returnVisit === "Return" ? "Return" : "New";
    const city = body.city?.trim() || "";
    const timestamp = new Date().toISOString();

    const extraction = await extractVisit({ note, cafeName, returnVisit, city });

    const result: VisitResult = {
      ...extraction,
      follow_up_status: extraction.return_visit === "Return" ? "REPEAT" : "NEW"
    };

    await appendRow("VISIT_LOG", [
      timestamp,
      rep,
      note,
      cell(result.return_visit),
      cell(result.cafe_name),
      cell(result.location),
      cell(result.city),
      cell(result.contact_name),
      cell(result.contact_role),
      cell(result.interest_level),
      cell(result.email_account),
      cell(result.phone_number),
      cell(result.follow_up_status)
    ]);

    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

