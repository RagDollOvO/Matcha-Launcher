export function assignments(text: string): Map<string, string>;
export function replaceAssignment(text: string, key: string, value: string): string;
export function appendSection(text: string, title: string, lines: string[]): string;
export function removeAssignments(text: string, key: string): string;
export function setCvars(text: string, cvars: Record<string, string | number | null>, title?: string): {
  text: string;
  changes: { key: string; before: string | null; after: string | null }[];
};
