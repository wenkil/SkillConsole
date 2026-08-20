export function replaceTechnicalSubjectLabel(
  label: string,
  replacement: string,
): string {
  return label
    .replace(/no-skill baseline/gi, () => replacement)
    .replace(/baseline/gi, () => replacement)
    .replace(/target/gi, () => replacement)
    .replace(/candidate/gi, () => replacement)
}
