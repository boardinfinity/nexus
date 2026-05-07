// Small reusable tooltip trigger using shadcn's Tooltip primitive (Radix).
// TooltipProvider is already mounted at the app root in client/src/App.tsx.
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface InfoTooltipProps {
  /** Text or React content shown inside the tooltip. */
  children: React.ReactNode;
  /** Optional class for the trigger icon wrapper. */
  className?: string;
  /** Override max-width (in rem-friendly tailwind units). Default: 280px. */
  contentClassName?: string;
  /** Accessible label fallback for screen readers. */
  label?: string;
}

export function InfoTooltip({ children, className, contentClassName, label }: InfoTooltipProps) {
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger
        type="button"
        aria-label={label || "More info"}
        className={cn(
          "inline-flex h-3.5 w-3.5 items-center justify-center text-muted-foreground hover:text-foreground transition-colors",
          className,
        )}
      >
        <Info className="h-3.5 w-3.5" />
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className={cn("max-w-[280px] text-xs leading-relaxed", contentClassName)}
      >
        {children}
      </TooltipContent>
    </Tooltip>
  );
}
