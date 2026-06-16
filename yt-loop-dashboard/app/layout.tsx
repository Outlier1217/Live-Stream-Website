import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "YT Loop Dashboard",
  description: "YouTube Live Stream Loop Manager",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen" style={{ background: "var(--bg)" }}>
        {children}
      </body>
    </html>
  );
}
