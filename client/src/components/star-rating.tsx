import { useState } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface StarRatingProps {
  value: number;
  onChange: (value: number) => void;
  max?: number;
  size?: "sm" | "md";
  disabled?: boolean;
}

export function StarRating({ value, onChange, max = 5, size = "md", disabled = false }: StarRatingProps) {
  const [hovered, setHovered] = useState(0);

  const starSize = size === "sm" ? "h-4 w-4" : "h-5 w-5";

  return (
    <div className="flex gap-0.5" onMouseLeave={() => setHovered(0)}>
      {Array.from({ length: max }, (_, i) => {
        const starValue = i + 1;
        const filled = hovered ? starValue <= hovered : starValue <= value;
        return (
          <button
            key={i}
            type="button"
            disabled={disabled}
            className={cn(
              "transition-colors duration-100 focus:outline-none",
              disabled ? "cursor-default" : "cursor-pointer hover:scale-110 transition-transform"
            )}
            onMouseEnter={() => !disabled && setHovered(starValue)}
            onClick={() => !disabled && onChange(starValue)}
          >
            <Star
              className={cn(
                starSize,
                filled
                  ? "fill-amber-400 text-amber-400"
                  : "fill-transparent text-muted-foreground/40"
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
