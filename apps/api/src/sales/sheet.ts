import type { SalesAccount, SalesSearch } from "@shipdeck/shared";

const COLUMNS = [
  "Company",
  "Person",
  "Role",
  "What they do",
  "Why they fit",
  "Opener",
  "Website",
  "Email",
  "Phone",
  "LinkedIn",
  "Country",
  "City or region",
  "Fit",
  "Status",
  "Note",
  "Public site read",
] as const;

function cell(value: string): string {
  const text = /^[=+\-@]/.test(value) ? `'${value}` : value;
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function salesSpreadsheet(input: {
  title: string;
  search: SalesSearch;
  accounts: SalesAccount[];
}): { filename: string; csv: string } {
  const rows = input.accounts.map((account) =>
    [
      account.company,
      account.person,
      account.role,
      account.whatTheyDo,
      account.whyTheyFit,
      account.opener,
      account.website,
      account.email,
      account.phone,
      account.linkedin,
      input.search.country,
      input.search.place,
      account.fit,
      account.status,
      account.repNote,
      account.confirmed ? "Yes" : "No",
    ]
      .map(cell)
      .join(",")
  );
  const safe = input.title.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "sales";
  return {
    filename: `${safe}-sales.csv`,
    csv: `\uFEFF${COLUMNS.join(",")}\n${rows.join("\n")}\n`,
  };
}
