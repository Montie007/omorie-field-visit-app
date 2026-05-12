"use client";

import { useState } from "react";

type Result = {
  cafe_name: string;
  city: string;
  state: string;
  contact_name: string;
  contact_role: string;
  interest_level: "Low" | "Medium" | "High" | "Unknown";
  products_liked: string[];
  objections: string[];
  current_supplier: string;
  follow_up_needed: boolean;
  follow_up_date: string;
  follow_up_action: string;
  summary: string;
};

export default function Home() {
  const [rep, setRep] = useState("Landon");
  const [password, setPassword] = useState("");
  const [cafeName, setCafeName] = useState("");
  const [city, setCity] = useState("");
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
        body: JSON.stringify({ rep, password, cafeName, city, note })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something failed.");

      setResult(data.result);
      setCafeName("");
      setCity("");
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
        <h1>Log Cafe Visit</h1>
        <p className="sub">Dictate the note with the phone keyboard, then submit.</p>

        <form onSubmit={submitVisit}>
          <div className="row">
            <div>
              <label htmlFor="rep">Rep</label>
              <input id="rep" value={rep} onChange={(e) => setRep(e.target.value)} />
            </div>
            <div>
              <label htmlFor="password">Password</label>
              <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          </div>

          <label htmlFor="cafeName">Cafe Name optional</label>
          <input id="cafeName" value={cafeName} onChange={(e) => setCafeName(e.target.value)} placeholder="e.g. Luna Coffee" />

          <label htmlFor="city">City optional</label>
          <input id="city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Austin" />

          <label htmlFor="note">Visit Note</label>
          <textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Dictate here after the visit..." />

          <button disabled={loading}>{loading ? "Submitting..." : "Submit Visit"}</button>
        </form>

        {error && <div className="message error">{error}</div>}

        {result && (
          <div className="message success">
            <div className="summaryTitle">Saved: {result.cafe_name || "Cafe visit"}</div>
            <div>{result.summary}</div>
            <div className="kv">
              Interest: {result.interest_level}<br />
              Follow-up: {result.follow_up_needed ? `${result.follow_up_date || "date unclear"} — ${result.follow_up_action}` : "No"}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
