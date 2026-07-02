import Papa from "papaparse";
import { z } from "zod";

export type DedupePolicy = "skip_existing" | "update_existing";

export type ProspectCsvField =
  | "email"
  | "firstName"
  | "lastName"
  | "title"
  | "phone"
  | "linkedinUrl"
  | "timezone"
  | "companyName"
  | "companyDomain"
  | "companyIndustry"
  | "companyWebsite"
  | "ignore";

export type CsvColumnMapping = Record<string, ProspectCsvField>;

export interface ParsedProspectRow {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  title?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  timezone?: string | null;
}

export interface ParsedCompanyRow {
  name?: string | null;
  domain?: string | null;
  industry?: string | null;
  website?: string | null;
}

export interface ValidCsvRow {
  rowNumber: number;
  prospect: ParsedProspectRow;
  company?: ParsedCompanyRow;
}

export interface InvalidCsvRow {
  rowNumber: number;
  raw: Record<string, string>;
  reason: string;
}

export interface ParseCsvResult {
  valid: ValidCsvRow[];
  invalid: InvalidCsvRow[];
}

const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "gmx.com",
]);

const emailSchema = z.email({ pattern: z.regexes.rfc5322Email });

export function normalizeEmail(str: string): string | null {
  const trimmed = str.trim().toLowerCase();
  if (!trimmed) return null;
  const result = emailSchema.safeParse(trimmed);
  return result.success ? result.data : null;
}

export function normalizeDomain(str: string): string | null {
  let value = str.trim().toLowerCase();
  if (!value) return null;

  value = value.replace(/^https?:\/\//, "");
  value = value.replace(/^www\./, "");
  value = value.split("/")[0] ?? "";
  value = value.split("?")[0] ?? "";
  value = value.split("#")[0] ?? "";
  value = value.split(":")[0] ?? "";

  if (!value || value.includes("@") || !value.includes(".")) return null;
  if (FREE_MAIL_DOMAINS.has(value)) return null;

  return value;
}

function deriveDomainFromEmail(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  return normalizeDomain(email.slice(at + 1));
}

function mapRow(
  raw: Record<string, string>,
  mapping: CsvColumnMapping,
  rowNumber: number,
): { valid?: ValidCsvRow; invalid?: InvalidCsvRow } {
  const prospect: ParsedProspectRow = { email: "" };
  const company: ParsedCompanyRow = {};
  let hasMappedField = false;

  for (const [column, target] of Object.entries(mapping)) {
    if (target === "ignore") continue;
    const cell = raw[column];
    if (cell === undefined || cell === "") continue;
    hasMappedField = true;
    const trimmed = cell.trim();

    switch (target) {
      case "email":
        prospect.email = trimmed;
        break;
      case "firstName":
        prospect.firstName = trimmed;
        break;
      case "lastName":
        prospect.lastName = trimmed;
        break;
      case "title":
        prospect.title = trimmed;
        break;
      case "phone":
        prospect.phone = trimmed;
        break;
      case "linkedinUrl":
        prospect.linkedinUrl = trimmed;
        break;
      case "timezone":
        prospect.timezone = trimmed;
        break;
      case "companyName":
        company.name = trimmed;
        break;
      case "companyDomain":
        company.domain = trimmed;
        break;
      case "companyIndustry":
        company.industry = trimmed;
        break;
      case "companyWebsite":
        company.website = trimmed;
        break;
      default:
        break;
    }
  }

  if (!hasMappedField) {
    return {
      invalid: {
        rowNumber,
        raw,
        reason: "Row has no mapped values",
      },
    };
  }

  const email = normalizeEmail(prospect.email);
  if (!email) {
    return {
      invalid: {
        rowNumber,
        raw,
        reason: prospect.email ? "Invalid email address" : "Missing email",
      },
    };
  }

  prospect.email = email;

  if (company.domain) {
    company.domain = normalizeDomain(company.domain);
  }
  if (!company.domain) {
    const derived = deriveDomainFromEmail(email);
    if (derived) company.domain = derived;
  }

  const hasCompany =
    company.name != null ||
    company.domain != null ||
    company.industry != null ||
    company.website != null;

  return {
    valid: {
      rowNumber,
      prospect,
      company: hasCompany ? company : undefined,
    },
  };
}

export function parseCsvStream(
  file: File | string,
  mapping: CsvColumnMapping,
): Promise<ParseCsvResult> {
  return new Promise((resolve, reject) => {
    const valid: ValidCsvRow[] = [];
    const invalid: InvalidCsvRow[] = [];
    let rowNumber = 0;

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      step(results) {
        rowNumber += 1;
        const raw = results.data;
        if (!raw || Object.keys(raw).length === 0) {
          invalid.push({
            rowNumber,
            raw: raw ?? {},
            reason: "Empty row",
          });
          return;
        }

        const mapped = mapRow(raw, mapping, rowNumber);
        if (mapped.valid) valid.push(mapped.valid);
        else if (mapped.invalid) invalid.push(mapped.invalid);
      },
      complete() {
        resolve({ valid, invalid });
      },
      error(error) {
        reject(error);
      },
    });
  });
}

export function parseCsvHeaders(file: File | string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      preview: 1,
      complete(results) {
        const fields = results.meta.fields;
        resolve(fields ?? []);
      },
      error(error) {
        reject(error);
      },
    });
  });
}
