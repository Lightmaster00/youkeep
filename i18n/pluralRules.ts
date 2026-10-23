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

/** Chinese and Japanese have no grammatical number: always the first form. */
export function noPlural(): number {
  return 0;
}

/**
 * Russian: "1 видео / 2 видео / 5 видео" style Slavic rule for three-form
 * messages ("one | few | many"); two-form messages fall back to 1 -> first.
 */
export function russianPlural(choice: number, choicesLength: number): number {
  const n = Math.abs(choice);
  if (choicesLength === 2) return n === 1 ? 0 : 1;
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 0;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 1;
  return 2;
}
