import { useEffect, useRef } from "react";
import clsx from "clsx";

interface CommitMessageProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

const WARN_AT = 50;
const ERROR_AT = 72;

export function CommitMessage({ value, onChange, placeholder }: CommitMessageProps) {
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
            ? "border-red-400 dark:border-red-500 focus-within:ring-2 focus-within:ring-red-300"
            : isWarning
            ? "border-amber-400 dark:border-amber-500 focus-within:ring-2 focus-within:ring-amber-300"
            : "border-gray-200 dark:border-gray-700 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500"
        )}
      >
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? "Summary (required)"}
          className="flex-1 text-sm bg-transparent text-gray-800 dark:text-gray-100 placeholder-gray-400 outline-none"
        />
        <span
          className={clsx(
            "ml-2 text-xs tabular-nums shrink-0",
            isError
              ? "text-red-500"
              : isWarning
              ? "text-amber-500"
              : "text-gray-400"
          )}
        >
          {count}/{ERROR_AT}
        </span>
      </div>
      {isError && (
        <p className="text-xs text-red-500">
          Subject line exceeds {ERROR_AT} characters — consider shortening it.
        </p>
      )}
    </div>
  );
}
