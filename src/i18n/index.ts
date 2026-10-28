/**
 * Dependency-free, fully typed i18n. The selected locale lives in a zustand
 * store (persisted in localStorage) so that every component calling `useT()`
 * re-renders when it changes.
 */
import { create } from "zustand";

import { ar } from "./locales/ar";
import { bn } from "./locales/bn";
import { en, type Messages } from "./locales/en";
import { es } from "./locales/es";
import { fr } from "./locales/fr";
import { hi } from "./locales/hi";
import { pt } from "./locales/pt";
import { ru } from "./locales/ru";
import { ur } from "./locales/ur";
import { zh } from "./locales/zh";
import { ERROR_CODES, type ErrorCode, type ErrorParams, type Plural } from "./types";

export type { Messages } from "./locales/en";
export type { ErrorCode, ErrorParams, Plural } from "./types";

/** The 10 most spoken languages (total speakers, Ethnologue), each named in its own language. */
export const LOCALES = [
  { code: "en", tag: "en", name: "English", dir: "ltr" },
  { code: "zh", tag: "zh-CN", name: "中文", dir: "ltr" },
  { code: "hi", tag: "hi", name: "हिन्दी", dir: "ltr" },
  { code: "es", tag: "es", name: "Español", dir: "ltr" },
  { code: "ar", tag: "ar", name: "العربية", dir: "rtl" },
  { code: "fr", tag: "fr", name: "Français", dir: "ltr" },
  { code: "bn", tag: "bn", name: "বাংলা", dir: "ltr" },
  { code: "pt", tag: "pt", name: "Português", dir: "ltr" },
  { code: "ru", tag: "ru", name: "Русский", dir: "ltr" },
  { code: "ur", tag: "ur", name: "اردو", dir: "rtl" },
] as const;

export type Locale = (typeof LOCALES)[number]["code"];
type LocaleInfo = (typeof LOCALES)[number];

const MESSAGES: Record<Locale, Messages> = { en, zh, hi, es, ar, fr, bn, pt, ru, ur };

const STORAGE_KEY = "web-analyser.locale";

function isLocale(value: unknown): value is Locale {
  return LOCALES.some((l) => l.code === value);
}

function readStoredLocale(): Locale | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isLocale(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** First of the system languages we support (`pt-BR` → `pt`), else English. */
function detectLocale(): Locale {
  for (const language of navigator.languages) {
    const base = language.toLowerCase().split("-")[0];
    if (isLocale(base)) return base;
  }
  return "en";
}

export function localeInfo(locale: Locale): LocaleInfo {
  return LOCALES.find((l) => l.code === locale) ?? LOCALES[0];
}

function applyToDocument(locale: Locale): void {
  const info = localeInfo(locale);
  document.documentElement.lang = info.tag;
  document.documentElement.dir = info.dir;
}

interface LocaleStore {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useLocaleStore = create<LocaleStore>((set) => ({
  locale: readStoredLocale() ?? detectLocale(),
  setLocale: (locale) => {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // Storage unavailable: the choice only lasts for this session.
    }
    applyToDocument(locale);
    set({ locale });
  },
}));

applyToDocument(useLocaleStore.getState().locale);

/** BCP 47 tag of the current locale, for `Intl` formatters. */
export function currentTag(): string {
  return localeInfo(useLocaleStore.getState().locale).tag;
}

/** Messages of the current locale, outside React (stores, callbacks). Not reactive. */
export function messages(): Messages {
  return MESSAGES[useLocaleStore.getState().locale];
}

/** Messages of the current locale; the calling component re-renders on language change. */
export function useT(): Messages {
  return MESSAGES[useLocaleStore((s) => s.locale)];
}

const pluralRules = new Map<string, Intl.PluralRules>();

/** Picks the plural form of `count` for the current locale and fills in `{count}`. */
export function plural(forms: Plural, count: number): string {
  const tag = currentTag();
  let rules = pluralRules.get(tag);
  if (!rules) {
    rules = new Intl.PluralRules(tag);
    pluralRules.set(tag, rules);
  }
  const template = forms[rules.select(count)] ?? forms.other;
  return template.replace("{count}", new Intl.NumberFormat(tag).format(count));
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value);
}

export function translateError(code: ErrorCode, params: ErrorParams): string {
  // Missing parameters render as empty strings rather than "undefined".
  const safe = new Proxy(params, { get: (target, key) => (typeof key === "string" ? (target[key] ?? "") : "") });
  return messages().errors[code](safe);
}
