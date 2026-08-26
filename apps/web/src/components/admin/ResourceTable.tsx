import type { ReactNode } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export interface ResourceColumn<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
  /** Áp cho cả TableHead + TableCell của cột này — dùng khi cần độ rộng cố định (vd "w-56") cho
   * cột dễ chứa nội dung dài (kết hợp render() tự truncate/expand nội dung bên trong, xem
   * admin/scraper/page.tsx's TruncatedListCell). Không set = giữ auto-layout hiện có (mặc định). */
  className?: string;
}

export interface ResourceTableProps<T> {
  columns: ResourceColumn<T>[];
  rows: T[];
  /** Bỏ qua cho bảng chỉ-xem (vd NotificationLog viewer) — không có action nào khi click row. */
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  /** table-layout: fixed — CHỈ set khi cột đã khai báo `className` width cố định (vd "w-56"), nếu
   * không cột sẽ co bằng nhau bất kể nội dung. Mặc định false/undefined giữ đúng auto-layout hiện
   * có cho mọi trang admin khác (Competition/Season/Team/...) — không đổi hành vi ngoài ý muốn. */
  fixedLayout?: boolean;
}

/** Generic paginated-list table for admin pages (AdminResourcePage.tsx + read-only viewers) —
 * column config decides what to render per row, click anywhere on a row opens the edit dialog
 * when `onRowClick` is provided. */
export function ResourceTable<T extends { id: string }>({
  columns,
  rows,
  onRowClick,
  emptyMessage = "Không có dữ liệu.",
  fixedLayout,
}: ResourceTableProps<T>) {
  if (rows.length === 0) {
    return <p className="px-1 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">{emptyMessage}</p>;
  }

  return (
    <Table className={fixedLayout ? "table-fixed" : undefined}>
      <TableHeader>
        <TableRow>
          {columns.map((col) => (
            <TableHead key={col.key} className={col.className}>
              {col.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={row.id}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={onRowClick ? "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900" : undefined}
          >
            {columns.map((col) => (
              <TableCell key={col.key} className={col.className}>
                {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? "—")}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
