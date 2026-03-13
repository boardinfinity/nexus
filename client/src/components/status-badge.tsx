import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

const statusStyles: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  running: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  complete: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  cancelled: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
  partial: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  success: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  rate_limited: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  no_data: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  inactive: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
  processing: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  dead_letter: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

export function StatusBadge({ status }: { status: string }) {
  const style = statusStyles[status] || "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400";
  return (
    <Badge variant="outline" className={`${style} border-0 font-medium text-[11px] gap-1`}>
      {status === "running" || status === "processing" ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : null}
      {status.replace(/_/g, " ")}
    </Badge>
  );
}
