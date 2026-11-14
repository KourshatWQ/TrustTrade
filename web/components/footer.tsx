"use client";
import { HtmlLang, useT } from "@/lib/i18n";

export function Footer() {
  const { t } = useT();
  return (
    <footer className="border-t border-line py-4 text-center text-xs text-muted">
      <HtmlLang />
      {t("footer")}
    </footer>
  );
}
