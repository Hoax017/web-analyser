import { Languages } from "lucide-react";

import { Select } from "@/components/ui/input";
import { LOCALES, useLocaleStore, useT, type Locale } from "@/i18n";

function isLocale(value: string): value is Locale {
  return LOCALES.some((l) => l.code === value);
}

/** UI language picker; each language is listed under its own name. */
export function LanguageSelect() {
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  return (
    <label className="flex items-center gap-1.5 text-muted-foreground" title={t.common.language}>
      <Languages className="size-4" />
      <span className="sr-only">{t.common.language}</span>
      <Select
        value={locale}
        onChange={(e) => {
          const next = e.target.value;
          if (isLocale(next)) setLocale(next);
        }}
        className="text-foreground"
      >
        {LOCALES.map((l) => (
          <option key={l.code} value={l.code} lang={l.tag} dir={l.dir}>
            {l.name}
          </option>
        ))}
      </Select>
    </label>
  );
}
