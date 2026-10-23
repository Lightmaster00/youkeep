/**
 * French counts 0 as singular ("0 vidéo", "1 vidéo", "2 vidéos"). vue-i18n's
 * default rule sends 0 to the plural form, which is right for English only.
 * Messages with two forms ("a | b"): 0 and 1 use the first. Messages with
 * three forms ("none | one | many") keep the 0 / 1 / other split.
 */
export function frenchPlural(choice: number, choicesLength: number): number {
  if (choicesLength === 2) return Math.abs(choice) < 2 ? 0 : 1;
  if (choice === 0) return 0;
  return Math.abs(choice) === 1 ? 1 : 2;
}
