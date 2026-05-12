# Omorie Field Visit App — V1

A simple mobile-friendly Next.js app for logging cafe visits into Google Sheets.

## What it does

1. Landon opens the mobile web page.
2. He enters optional cafe name and city.
3. He dictates a note into the text box using the phone keyboard.
4. The backend sends the note to OpenAI for structured extraction.
5. The backend appends one row to `VISIT_LOG`.
6. If follow-up is needed, it also appends one row to `FOLLOW_UPS`.

No Make.com, Zapier, Slack, GPS, CRM, or audio transcription.

## Google Sheet tabs

Create a Google Sheet with these exact tabs and headers.

### VISIT_LOG

| Timestamp | Rep | Raw Note | Cafe Name | City | State | Contact Name | Contact Role | Interest Level | Products Liked | Objections | Current Supplier | Follow-Up Needed | Follow-Up Date | Follow-Up Action | AI Summary |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

### FOLLOW_UPS

| Created At | Due Date | Cafe Name | Contact Name | Channel | Action | Draft Message | Status |
|---|---|---|---|---|---|---|---|

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

## Google Cloud setup

1. Create or choose a Google Cloud project.
2. Enable the Google Sheets API.
3. Create a service account.
4. Create a JSON key for that service account.
5. Copy the service account email into `GOOGLE_SERVICE_ACCOUNT_EMAIL`.
6. Copy the private key into `GOOGLE_PRIVATE_KEY`, keeping the `\n` line breaks.
7. Share the Google Sheet with the service account email as Editor.
8. Put the spreadsheet ID into `GOOGLE_SHEET_ID`.

## Deploy to Vercel

1. Push this folder to GitHub.
2. Import the repo into Vercel.
3. Add the same environment variables in Vercel Project Settings.
4. Deploy.
5. Open the Vercel URL on the phone.

## Notes

- `APP_PASSWORD` is checked only on the server.
- The page is intentionally basic for stability.
- The app uses phone keyboard dictation, not audio recording.
- Follow-up draft generation is intentionally left blank for Version 1.
