import type { ReactNode } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export interface ResourceColumn<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
}

export interface ResourceTableProps<T> {
  columns: ResourceColumn<T>[];
  rows: T[];
  onRowClick: (row: T) => void;
  emptyMessage?: string;
}

/** Generic paginated-list table for admin CRUD pages (AdminResourcePage.tsx) — column config
 * decides what to render per row, click anywhere on a row opens the edit dialog. */
export function ResourceTable<T extends { id: string }>({
  columns,
  rows,
  onRowClick,
  emptyMessage = "Không có dữ liệu.",
}: ResourceTableProps<T>) {
  if (rows.length === 0) {
    return <p className="px-1 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">{emptyMessage}</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((col) => (
            <TableHead key={col.key}>{col.label}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={row.id}
            onClick={() => onRowClick(row)}
            className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            {columns.map((col) => (
              <TableCell key={col.key}>
                {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? "—")}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
