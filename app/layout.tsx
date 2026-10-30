import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Manrope, Playfair_Display } from "next/font/google";
import "./globals.css";

// Display tier: high-contrast serif, self-hosted by next/font so the
// `font-src 'self'` CSP in next.config.ts stays satisfied.
const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const playfairItalic = Playfair_Display({
  subsets: ["latin"],
  style: "italic",
  variable: "--font-display-italic",
  display: "swap",
});

// Body / UI tier: humanist geometric sans for paragraphs, labels and controls.
const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Campus Assembly | Assemble Your Campus",
  description:
    "An independent, Avengers-inspired campus ambassador initiative. Discover the program, explore missions and get ready to assemble your campus.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${playfair.variable} ${playfairItalic.variable} ${manrope.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
