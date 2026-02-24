import { useState } from "react";
import clsx from "clsx";
import type { GitHubAccount } from "@/types";

interface AccountAvatarProps {
  account: GitHubAccount;
  size?: "xs" | "sm" | "md" | "lg";
  isActive?: boolean;
  className?: string;
}

const sizeMap = {
  xs: "w-4 h-4 text-[9px]",
  sm: "w-6 h-6 text-xs",
  md: "w-8 h-8 text-sm",
  lg: "w-12 h-12 text-base",
};

export function AccountAvatar({
  account,
  size = "md",
  isActive = false,
  className,
}: AccountAvatarProps) {
  const [imgError, setImgError] = useState(false);
  const fallbackLetter = (account.username || "?").charAt(0).toUpperCase();
  const showImg = account.avatarUrl && !imgError;

  return (
    <div
      className={clsx(
        "relative inline-flex shrink-0 items-center justify-center rounded-full overflow-hidden",
        sizeMap[size],
        isActive && "ring-2 ring-primary ring-offset-1",
        className
      )}
    >
      {showImg ? (
        <img
          src={account.avatarUrl}
          alt={account.username}
          className="w-full h-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-primary/10 text-primary font-medium">
          {fallbackLetter}
        </div>
      )}
    </div>
  );
}
