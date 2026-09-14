"use client";

import { useState, useTransition } from "react";
import { updateUserColorAction } from "@/server/actions/team";
import { vendorColor, VENDOR_COLOR_PALETTE } from "@/lib/vendor-color";

export function ColorPicker({ userId, currentColor }: { userId: string; currentColor: string | null }) {
  const [isPending, startTransition] = useTransition();
  const [color, setColor] = useState(vendorColor(userId, currentColor));

  function pick(next: string) {
    setColor(next);
    startTransition(async () => {
      await updateUserColorAction(userId, next);
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {VENDOR_COLOR_PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          disabled={isPending}
          onClick={() => pick(c)}
          title={c}
          className={`h-8 w-8 shrink-0 rounded-full transition-transform hover:scale-110 disabled:opacity-50 ${
            color === c ? "ring-2 ring-offset-2 ring-offset-surface ring-border-strong" : ""
          }`}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );
}
