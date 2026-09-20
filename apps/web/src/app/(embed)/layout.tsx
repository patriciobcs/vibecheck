import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import type { ReactNode } from "react";
import "../globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = { title: "Seamless UX", robots: { index: false } };

/**
 * Root layout for the dialog iframe: transparent page so only the card is visible over the
 * host site, no app chrome, and the Next.js dev indicator hidden inside the frame.
 */
export default function EmbedRootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable} embed antialiased`}>
      <body className="embed-body">{children}</body>
    </html>
  );
}
