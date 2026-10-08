"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  noun?: string;
  onPageChange?: (page: number) => void;
  className?: string;
}

export function Pagination({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  noun = "registros",
  onPageChange,
  className,
}: PaginationProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (totalPages <= 1) return null;

  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  const pages = getVisiblePages(currentPage, totalPages);

  const buildHref = (page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (page === 1) {
      params.delete("page");
    } else {
      params.set("page", String(page));
    }
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  const handlePage = (page: number) => {
    if (onPageChange) {
      onPageChange(page);
    }
  };

  const PageLink = ({ page, children }: { page: number; children: React.ReactNode }) => {
    if (onPageChange) {
      return (
        <button
          type="button"
          onClick={() => handlePage(page)}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded text-xs font-medium transition-colors",
            page === currentPage
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted"
          )}
        >
          {children}
        </button>
      );
    }
    return (
      <Link
        href={buildHref(page)}
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded text-xs font-medium transition-colors",
          page === currentPage
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-muted"
        )}
      >
        {children}
      </Link>
    );
  };

  const NavButton = ({
    onClick,
    href,
    disabled,
    children,
    label,
  }: {
    onClick?: () => void;
    href?: string;
    disabled: boolean;
    children: React.ReactNode;
    label: string;
  }) => {
    if (onPageChange) {
      return (
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
          aria-label={label}
        >
          {children}
        </button>
      );
    }
    return (
      <Link
        href={href || "#"}
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted",
          disabled && "pointer-events-none opacity-30"
        )}
        aria-label={label}
        tabIndex={disabled ? -1 : undefined}
      >
        {children}
      </Link>
    );
  };

  return (
    <div className={cn("mt-4 flex items-center justify-between", className)}>
      <span className="text-xs text-muted-foreground">
        Mostrando {startItem}–{endItem} de {totalItems} {noun}
      </span>

      <div className="flex items-center gap-1">
        <NavButton
          onClick={() => handlePage(1)}
          href={buildHref(1)}
          disabled={currentPage === 1}
          label="Primera página"
        >
          <ChevronsLeft size={14} />
        </NavButton>

        <NavButton
          onClick={() => handlePage(currentPage - 1)}
          href={buildHref(currentPage - 1)}
          disabled={currentPage === 1}
          label="Página anterior"
        >
          <ChevronLeft size={14} />
        </NavButton>

        {pages.map((p, i) =>
          p === "..." ? (
            <span key={`ellipsis-${i}`} className="px-1 text-xs text-muted-foreground">
              …
            </span>
          ) : (
            <PageLink key={p} page={p}>
              {p}
            </PageLink>
          )
        )}

        <NavButton
          onClick={() => handlePage(currentPage + 1)}
          href={buildHref(currentPage + 1)}
          disabled={currentPage === totalPages}
          label="Página siguiente"
        >
          <ChevronRight size={14} />
        </NavButton>

        <NavButton
          onClick={() => handlePage(totalPages)}
          href={buildHref(totalPages)}
          disabled={currentPage === totalPages}
          label="Última página"
        >
          <ChevronsRight size={14} />
        </NavButton>
      </div>
    </div>
  );
}

function getVisiblePages(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  if (current <= 3) return [1, 2, 3, 4, "...", total];
  if (current >= total - 2) return [1, "...", total - 3, total - 2, total - 1, total];
  return [1, "...", current - 1, current, current + 1, "...", total];
}
