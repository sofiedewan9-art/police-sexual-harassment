export const metadata = { title: "Methodology — Police Sexual Assault Lawsuits Database" };

function Rule({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-navy/10 bg-white p-5">
      <h2 className="text-lg font-semibold">
        <span className="mr-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">
          {n}
        </span>
        {title}
      </h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-ink/85">{children}</div>
    </section>
  );
}

export default function MethodologyPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Methodology</h1>
        <p className="mt-2 max-w-3xl text-ink/80">
          This database records civil lawsuits involving sexual assault or sexual harassment and
          law-enforcement agencies in the United States and Canada. It was seeded from a dataset
          compiled from news-media searches (July 2026) and grows through an automated discovery
          pipeline whose output is verified before publication. These are the compilation rules;
          every record follows them.
        </p>
      </div>

      <Rule n={1} title="One record per lawsuit">
        <p>
          Each civil lawsuit (or formal claim) is its own record. Multiple articles covering the
          same lawsuit are grouped into one record&apos;s sources. Distinct suits arising from the
          same incident or scandal — e.g., several plaintiffs filing separately over the same
          officer&apos;s conduct — are separate records. Class actions and consolidated mass
          litigation (e.g., hundreds of claims filed together) are one record, marked as class
          action / mass litigation.
        </p>
      </Rule>

      <Rule n={2} title="Time window">
        <p>
          Lawsuits filed roughly 2021 to present. A small number of earlier-filed suits are
          included because their settlement or verdict occurred in the window; these are flagged
          in the record notes.
        </p>
      </Rule>

      <Rule n={3} title="Three case types">
        <p>
          (a) <strong>Civilian</strong> — an officer, deputy, or jailer accused of sexually
          assaulting a civilian; (b) <strong>internal</strong> — an officer or department employee
          suing their own agency over sexual assault or harassment by colleagues or supervisors;
          (c) <strong>class action / mass litigation</strong>.
        </p>
      </Rule>

      <Rule n={4} title="Agency scope">
        <p>
          Municipal, county, and state police and sheriffs are the core. The database also includes
          corrections, juvenile-detention, federal, campus, and transit agencies — each categorized
          so records outside the strict &quot;police department&quot; definition can be filtered.
        </p>
      </Rule>

      <Rule n={5} title="Strictly factual descriptions">
        <p>
          Unproven claims are attributed (&quot;the suit alleges…&quot;). Conduct is stated as fact
          only where supported by a conviction, guilty plea, admission, or jury finding. No
          editorial or pattern-drawing language is used anywhere in the database.
        </p>
      </Rule>

      <Rule n={6} title="Outcome discipline">
        <p>
          Every record&apos;s outcome is verified with a dedicated search, not carried over from
          filing coverage. Statuses use a controlled vocabulary: <em>Settled</em> (amount, date),{" "}
          <em>Plaintiff verdict</em>, <em>Defense verdict</em>, <em>Dismissed</em> (grounds, appeal
          status), <em>Ongoing</em>, and <em>No resolution found in coverage</em>. &quot;No
          resolution found&quot; means our searches surfaced nothing — it does <strong>not</strong>{" "}
          mean the case is confirmed active. Unresolved cases are re-checked on a rolling schedule;
          each record shows its last-verified date.
        </p>
      </Rule>

      <Rule n={7} title="Criminal and civil cases are separate tracks">
        <p>
          A civil lawsuit (a victim seeking damages, decided on a preponderance-of-the-evidence
          standard) is independent of criminal charges against an officer (state prosecution,
          beyond a reasonable doubt). Every combination occurs in the data — acquitted criminally
          while the city settled civilly; convicted with a civil verdict; civil suits where no
          charges were ever filed. The two are stored and displayed as separate fields.
        </p>
      </Rule>

      <Rule n={8} title="Conservative 30x30 matching">
        <p>
          Each record is marked Yes/No for whether the agency appears on the{" "}
          <a href="https://30x30initiative.org/" className="text-brand underline">
            30x30 Initiative
          </a>{" "}
          participant list. Matching requires the same city <em>and</em> state (for example,
          &quot;Vancouver Police Department&quot; on the list is Vancouver, Washington — not
          Vancouver, BC). Ambiguous matches carry an explanatory note.
        </p>
      </Rule>

      <Rule n={9} title="Archived sources">
        <p>
          Media URLs break or get geo-blocked. An archive.org snapshot is captured for each source
          link at ingestion time and shown alongside the original.
        </p>
      </Rule>

      <section className="rounded-lg border-l-4 border-accent bg-white p-5">
        <h2 className="text-lg font-semibold">Accuracy</h2>
        <div className="mt-2 space-y-2 text-sm leading-relaxed text-ink/85">
          <p>
            Every field in a record must be independently derived from the cited sources by
            multiple automated passes that agree before publication; disagreements are routed to
            human review. Published records are audited against their sources on a rolling
            schedule, and each audited column is held to a 95% accuracy standard. Audit results
            will be published on this page.
          </p>
          <p>
            Victims are never named beyond what already appears in cited public reporting.
            Agencies or parties who believe a record is inaccurate can{" "}
            <a href="/corrections" className="text-brand underline">request a correction</a>.
          </p>
        </div>
      </section>
    </div>
  );
}
