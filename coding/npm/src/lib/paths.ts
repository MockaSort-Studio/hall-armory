// A workspace-relative path the caller chose: plain segments only.
export function safeRelative(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.length || value.length > 1024 || /[\0-\x1f\x7f\\]/.test(value))
    throw new Error(`${label} must be a workspace-relative path`);
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value)) throw new Error(`${label} must be a workspace-relative path`);
  const parts = value.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.some((part) => part === "..")) throw new Error(`${label} must not leave the workspace`);
  return parts.join("/");
}

export const joinPath = (base: string, ...parts: string[]) =>
  [base.replace(/\/+$/, ""), ...parts.filter(Boolean)].join("/").replace(/\/{2,}/g, "/") || "/";
