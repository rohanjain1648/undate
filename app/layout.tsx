import type { Metadata } from "next";
import Link from "next/link";
import { Fraunces, Rubik } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"] });
const rubik = Rubik({ variable: "--font-rubik", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Undate: your agent dates for you",
  description: "Paste a LinkedIn and an Instagram. An AI agent reads the person, dates every other agent on their behalf, and ranks who fits best.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${fraunces.variable} ${rubik.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5">
          <Link href="/" className="font-serif text-2xl text-gold">
            undate<span className="text-rose">.</span>
          </Link>
          <nav className="flex gap-5 text-sm text-muted">
            <Link href="/#pool" className="hover:text-gold">The 25</Link>
            <Link href="/rankings" className="hover:text-gold">Rankings</Link>
            <Link href="/how" className="hover:text-gold">How it works</Link>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-20">{children}</main>
        <footer className="border-t border-line/50 py-6 text-center text-xs text-muted">
          Two sources only: public LinkedIn + public Instagram. Agents never infer gender, orientation, religion or ethnicity.
        </footer>
      </body>
    </html>
  );
}
