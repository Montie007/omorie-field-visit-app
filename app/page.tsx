"use client";

import { useState } from "react";

type Result = {
  return_visit: "New" | "Return";
  cafe_name: string;
  location: string;
  city: string;
  contact_name: string;
  contact_role: string;
  interest_level: "Low" | "Medium" | "High" | "Unknown";
  email_account: string;
  phone_number: string;
  follow_up_status: "NEW" | "REPEAT";
};

export default function Home() {
  const [rep, setRep] = useState("Landon");
  const [cafeName, setCafeName] = useState("");
  const [returnVisit, setReturnVisit] = useState<"New" | "Return">("New");
  const [followUpMethod, setFollowUpMethod] = useState("Generic");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  async function submitVisit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setResult(null);

    if (!note.trim()) {
      setError("Visit note is required.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/log-visit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rep, cafeName, returnVisit, note })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something failed.");

      setResult(data.result);
      setCafeName("");
      setReturnVisit("New");
      setFollowUpMethod("Generic");
      setNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page">
      <section className="card">
        <h1>Matcha Mate</h1>

        <form onSubmit={submitVisit}>
          <label htmlFor="rep">Rep</label>
          <input id="rep" value={rep} onChange={(e) => setRep(e.target.value)} />

          <label htmlFor="cafeName">Cafe Name</label>
          <input
            id="cafeName"
            value={cafeName}
            onChange={(e) => setCafeName(e.target.value)}
            placeholder="optional"
          />

          <label htmlFor="returnVisit">Return Visit</label>
          <select
            id="returnVisit"
            value={returnVisit}
            onChange={(e) => setReturnVisit(e.target.value as "New" | "Return")}
          >
            <option value="New">New</option>
            <option value="Return">Return</option>
          </select>

          <label htmlFor="followUpMethod">Follow Up Method</label>
          <select
            id="followUpMethod"
            value={followUpMethod}
            onChange={(e) => setFollowUpMethod(e.target.value)}
          >
            <option value="Generic">Generic</option>
            <option value="Personal">Personal</option>
            <option value="None">None</option>
          </select>

          <label htmlFor="note">Visit Note</label>
          <textarea
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Dictate here after the visit..."
          />

          <button disabled={loading}>{loading ? "Submitting..." : "Submit Visit"}</button>
        </form>

        {error && <div className="message error">{error}</div>}

        {result && (
          <div className="message success">
            <div className="summaryTitle">Saved: {result.cafe_name || "Cafe visit"}</div>
            <div className="kv">
              Return Visit: {result.return_visit}<br />
              Follow-Up Status: {result.follow_up_status}<br />
              Interest: {result.interest_level}<br />
              Contact: {result.contact_name || "Not provided"}<br />
              Email: {result.email_account || "Not provided"}<br />
              Phone: {result.phone_number || "Not provided"}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
