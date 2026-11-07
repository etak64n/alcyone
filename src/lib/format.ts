/** A date as YYYY/MM/DD in the time zone of the browser. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
}

/** The initials of a name, for an avatar: the first letter, or two for a name in two parts. */
export function initialsOf(name: string): string {
  const parts = name.split(/[\s._-]+/).filter((part) => part !== "");
  const first = parts[0]?.[0] ?? "?";
  const second = parts.length > 1 ? (parts[1]?.[0] ?? "") : "";
  return (first + second).toUpperCase();
}
