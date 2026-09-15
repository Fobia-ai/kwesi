/**
 * The app-wide language catalog — the real, exact 50-value vocabulary ACE-
 * Step 1.5's own server accepts for `vocal_language`
 * (servers/ace-step-1.5/vendor/acestep/constants.py's `VALID_LANGUAGES`),
 * used as-is rather than inventing a separate app-level list the way
 * src/data/genres.ts does for genre. Unlike genre (where MuseCoco's real
 * vocabulary and the app's own catalog are two genuinely different lists
 * needing a reconciliation map), there's only one real fixed language
 * vocabulary in the whole catalog today, so this *is* that vocabulary,
 * codes and all — an artist's selected languages map onto ACE-Step's field
 * by exact code match, no fuzzy mapping needed.
 *
 * Values are real ISO 639-1 codes (plus "yue" for Cantonese, ISO 639-3, and
 * the model's own "unknown" sentinel) — the codes themselves come from the
 * vendored constant; the display names are standard language names for
 * those codes, not something read out of any model's own documentation.
 */
export interface Language {
  code: string;
  name: string;
}

export const LANGUAGES: Language[] = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "nl", name: "Dutch" },
  { code: "sv", name: "Swedish" },
  { code: "no", name: "Norwegian" },
  { code: "da", name: "Danish" },
  { code: "is", name: "Icelandic" },
  { code: "fi", name: "Finnish" },
  { code: "pl", name: "Polish" },
  { code: "cs", name: "Czech" },
  { code: "sk", name: "Slovak" },
  { code: "hu", name: "Hungarian" },
  { code: "ro", name: "Romanian" },
  { code: "bg", name: "Bulgarian" },
  { code: "hr", name: "Croatian" },
  { code: "sr", name: "Serbian" },
  { code: "ru", name: "Russian" },
  { code: "uk", name: "Ukrainian" },
  { code: "el", name: "Greek" },
  { code: "tr", name: "Turkish" },
  { code: "he", name: "Hebrew" },
  { code: "ar", name: "Arabic" },
  { code: "fa", name: "Persian" },
  { code: "ur", name: "Urdu" },
  { code: "hi", name: "Hindi" },
  { code: "bn", name: "Bengali" },
  { code: "pa", name: "Punjabi" },
  { code: "ta", name: "Tamil" },
  { code: "te", name: "Telugu" },
  { code: "ne", name: "Nepali" },
  { code: "sa", name: "Sanskrit" },
  { code: "th", name: "Thai" },
  { code: "vi", name: "Vietnamese" },
  { code: "id", name: "Indonesian" },
  { code: "ms", name: "Malay" },
  { code: "tl", name: "Tagalog" },
  { code: "zh", name: "Mandarin Chinese" },
  { code: "yue", name: "Cantonese" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "sw", name: "Swahili" },
  { code: "az", name: "Azerbaijani" },
  { code: "ca", name: "Catalan" },
  { code: "ht", name: "Haitian Creole" },
  { code: "la", name: "Latin" },
  { code: "lt", name: "Lithuanian" },
  { code: "unknown", name: "Unspecified" },
];
