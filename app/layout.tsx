import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Matcha Mate",
  description: "Omorie field cafe visit logger",
  icons: {
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
