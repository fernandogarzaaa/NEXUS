// Tokenisation shared by the knowledge index and its queries. Identifiers
// such as SHP-2000, D-07, FAC-AUS or NX-817-HERO are kept whole (lower-cased)
// so an exact id in a question matches exactly that record.

const STOPWORDS = new Set(
  "a an and are as at be been but by can could did do does for from had has have how i if in into is it its me my of on or our please show so than that the their them then there these they this to tell us was we were what when where which who whom why will with would you your about any all give get list".split(
    " "
  )
);

export const ID_PATTERN = /\b(?:SHP|D|VEH|FAC|EXC|RUN|APR|POL|NX|RTE|COMM)-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/gi;

export function extractIds(text: string): string[] {
  return Array.from(new Set((text.match(ID_PATTERN) ?? []).map((m) => m.toUpperCase())));
}

export function tokenize(text: string): string[] {
  const ids = (text.match(ID_PATTERN) ?? []).map((m) => m.toLowerCase());
  const rest = text
    .replace(ID_PATTERN, " ")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
  return [...ids, ...rest];
}

/** Very small suffix stripper; enough that "delays"/"delayed"/"delay" meet. */
function stem(t: string): string {
  if (/^\d+$/.test(t) || t.length <= 4) return t;
  for (const suffix of ["ments", "ment", "ings", "ing", "ies", "ed", "es", "s"]) {
    if (t.endsWith(suffix) && t.length - suffix.length >= 3) {
      return suffix === "ies" ? `${t.slice(0, -3)}y` : t.slice(0, -suffix.length);
    }
  }
  return t;
}
