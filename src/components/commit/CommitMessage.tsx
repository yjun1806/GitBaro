import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";

interface CommitMessageProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

const WARN_AT = 50;
const ERROR_AT = 72;

export function CommitMessage({ value, onChange, placeholder }: CommitMessageProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const count = value.length;
  const isWarning = count >= WARN_AT && count < ERROR_AT;
  const isError = count >= ERROR_AT;

  return (
    <div className="flex flex-col gap-1">
      <div
        className={clsx(
          "flex items-center border rounded-lg px-3 py-2 transition-colors",
          isError
            ? "border-destructive focus-within:ring-2 focus-within:ring-destructive/30"
            : isWarning
            ? "border-warning focus-within:ring-2 focus-within:ring-warning/30"
            : "border-border focus-within:ring-2 focus-within:ring-ring focus-within:border-primary"
        )}
      >
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? t("commit.summary")}
          className="flex-1 text-sm bg-transparent text-foreground placeholder:text-muted-foreground outline-none"
        />
        <span
          className={clsx(
            "ml-2 text-xs tabular-nums shrink-0",
            isError
              ? "text-destructive"
              : isWarning
              ? "text-amber-500"
              : "text-muted-foreground"
          )}
        >
          {count}/{ERROR_AT}
        </span>
      </div>
      {isError && (
        <p className="text-xs text-destructive">
          {t("commit.subjectTooLong", { max: ERROR_AT })}
        </p>
      )}
    </div>
  );
}
