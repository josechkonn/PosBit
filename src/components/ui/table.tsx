"use client";

import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

export type HeaderConfig =
  | string
  | {
      key?: string;
      label: string;
      sortable?: boolean;
    };

interface TableProps {
  headers: HeaderConfig[];
  children: React.ReactNode;
  sortKey?: string;
  sortOrder?: "asc" | "desc";
  onSort?: (key: string) => void;
}

export function Table({ headers, children, sortKey, sortOrder, onSort }: TableProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {headers.map((h, i) => {
                const isObj = typeof h === "object";
                const label = isObj ? h.label : h;
                const key = isObj ? h.key : undefined;
                const sortable = isObj ? h.sortable && !!key && !!onSort : false;
                const isActive = sortable && sortKey === key;

                return (
                  <th
                    key={key || (typeof h === "string" ? h : i)}
                    onClick={() => sortable && key && onSort?.(key)}
                    className={cn(
                      "whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground select-none",
                      sortable && "cursor-pointer hover:bg-muted/60 hover:text-foreground transition-colors",
                      isActive && "text-primary font-bold"
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <span>{label}</span>
                      {sortable && (
                        <span className="text-muted-foreground/70">
                          {isActive ? (
                            sortOrder === "asc" ? (
                              <ArrowUp size={12} className="text-primary" />
                            ) : (
                              <ArrowDown size={12} className="text-primary" />
                            )
                          ) : (
                            <ArrowUpDown size={11} className="opacity-40" />
                          )}
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">{children}</tbody>
        </table>
      </div>
    </div>
  );
}

export function Tr({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn("transition-colors hover:bg-muted/20 even:bg-muted/10", className)} {...props} />
  );
}

export function Td({
  mono,
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { mono?: boolean }) {
  return (
    <td
      className={cn(
        "whitespace-nowrap px-4 py-2.5 text-foreground",
        mono && "font-mono text-xs",
        className
      )}
      {...props}
    />
  );
}
