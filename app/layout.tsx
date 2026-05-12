import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Log Cafe Visit",
  description: "Omorie field cafe visit logger"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
