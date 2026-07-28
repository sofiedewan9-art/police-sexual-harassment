export const OUTCOME_LABELS: Record<string, string> = {
  settled: "Settled",
  plaintiff_verdict: "Plaintiff verdict",
  defense_verdict: "Defense verdict",
  dismissed: "Dismissed",
  ongoing: "Ongoing",
  no_resolution_found: "No resolution found in coverage",
};

export const TYPE_LABELS: Record<string, string> = {
  civilian: "Civilian plaintiff",
  internal: "Internal (officer/employee plaintiff)",
  class_action: "Class action / mass litigation",
};

export const CATEGORY_LABELS: Record<string, string> = {
  police: "Police",
  sheriff: "Sheriff",
  state_police: "State police",
  corrections: "Corrections",
  juvenile: "Juvenile detention",
  federal: "Federal",
  campus: "Campus",
  transit: "Transit",
  other: "Other",
};

export const CRIMINAL_LABELS: Record<string, string> = {
  none_filed: "No charges filed",
  charged: "Charged",
  convicted: "Convicted",
  pleaded_guilty: "Pleaded guilty",
  acquitted: "Acquitted",
  charges_dropped: "Charges dropped",
  unknown: "Unknown",
};

export function money(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

export function label(map: Record<string, string>, key: string | null): string {
  return key ? map[key] ?? key : "—";
}
