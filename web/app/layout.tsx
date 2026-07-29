import type { Metadata } from "next";
import { DM_Sans, Source_Serif_4 } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans" });
const sourceSerif = Source_Serif_4({ subsets: ["latin"], variable: "--font-source-serif" });

export const metadata: Metadata = {
  title: "Police Sexual Harassment Lawsuits Database",
  description:
    "A searchable database of civil lawsuits involving sexual harassment and law-enforcement agencies in the US and Canada. A research project of the Policing Project at NYU School of Law.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${dmSans.variable} ${sourceSerif.variable} min-h-screen flex flex-col antialiased`}>
        <header className="bg-navy text-white">
          <div className="mx-auto max-w-7xl px-4 py-4 flex flex-wrap items-baseline gap-x-8 gap-y-2">
            <Link href="/" className="font-serif text-xl font-semibold tracking-tight text-white">
              Police Sexual Harassment Lawsuits<span className="text-accent"> Database</span>
            </Link>
            <nav className="flex gap-6 text-sm">
              <Link href="/" className="hover:text-accent">Database</Link>
              <Link href="/methodology" className="hover:text-accent">Methodology</Link>
              <Link href="/corrections" className="hover:text-accent">Corrections</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t border-navy/10 bg-white">
          <div className="mx-auto max-w-7xl px-4 py-6 text-sm text-ink/70 space-y-2">
            <p>
              A research project of the Policing Project at NYU School of Law, examining the
              prevalence of sexual harassment lawsuits in police departments, including whether the
              agency participates in the{" "}
              <a href="https://30x30initiative.org/" className="text-brand underline">
                30x30 Initiative
              </a>
              . Not affiliated with or endorsed by the 30x30 Initiative.
            </p>
            <p>
              Records describe allegations unless a conviction, guilty plea, admission, or jury
              finding is noted. See the{" "}
              <Link href="/methodology" className="text-brand underline">methodology</Link> and{" "}
              <Link href="/corrections" className="text-brand underline">
                request a correction
              </Link>
              .
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
