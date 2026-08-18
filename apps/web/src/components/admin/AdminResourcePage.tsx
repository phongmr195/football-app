"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, apiGetClient, apiMutateClient, type ApiListResponse } from "@/lib/api-client";
import { useAdminAuth } from "@/lib/admin-auth-context";
import { ResourceFormDialog, type FieldConfig } from "./ResourceFormDialog";
import { ResourceTable, type ResourceColumn } from "./ResourceTable";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 350;

export interface AdminResourcePageConfig<T extends { id: string }> {
  /** Tiêu đề trang, vd "Giải đấu". */
  title: string;
  /** Icon cạnh tiêu đề, vd `Trophy` — mỗi trang admin dùng 1 icon riêng cho dễ nhận diện. */
  icon: LucideIcon;
  /** Path REST của resource, vd "/competitions" — dùng cho cả GET list và POST/PATCH. */
  resourcePath: string;
  /** Query key riêng cho resource này (React Query cache) — không trùng giữa các trang. */
  queryKey: string;
  columns: ResourceColumn<T>[];
  fields: FieldConfig[];
  /** Giá trị mặc định khi bấm "Thêm mới". */
  emptyValues: Record<string, unknown>;
  /** Map 1 row có sẵn -> object giá trị form khi sửa (chỉ những field trong `fields`). */
  toFormValues: (row: T) => Record<string, unknown>;
  searchPlaceholder?: string;
}

/**
 * Khung CRUD chung cho các trang admin (Giải đấu/Đội bóng/Cầu thủ, ROADMAP Phase 4) — mỗi trang
 * cụ thể chỉ cần khai báo columns/fields/mapping, không viết lại fetch/pagination/dialog mỗi lần.
 * Không có nút xoá — Competition/Team/Player đều có quan hệ `onDelete: Cascade` sâu trong schema
 * (xoá 1 Team kéo theo matches/statistics/lineups/...), xoá tay qua Prisma Studio vẫn là escape
 * hatch có chủ đích (friction cao hơn = an toàn hơn cho hành động khó hoàn tác này).
 */
export function AdminResourcePage<T extends { id: string }>({
  title,
  icon: Icon,
  resourcePath,
  queryKey,
  columns,
  fields,
  emptyValues,
  toFormValues,
  searchPlaceholder,
}: AdminResourcePageConfig<T>) {
  const { token } = useAdminAuth();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<{ mode: "create" | "edit"; row?: T } | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounce giống SearchBox.tsx — setState chỉ trong callback của setTimeout, không đồng bộ
  // trong thân effect (react-hooks/set-state-in-effect).
  useEffect(() => {
    const timeout = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const listQuery = useQuery({
    queryKey: [queryKey, page, search],
    queryFn: () =>
      apiGetClient<ApiListResponse<T>>(
        resourcePath,
        { page, pageSize: PAGE_SIZE, search: search || undefined },
        { idToken: token },
      ),
    enabled: !!token,
  });

  const rows = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function openCreate() {
    setValues(emptyValues);
    setError(null);
    setDialog({ mode: "create" });
  }

  function openEdit(row: T) {
    setValues(toFormValues(row));
    setError(null);
    setDialog({ mode: "edit", row });
  }

  async function handleSubmit() {
    if (!dialog) return;
    setSubmitting(true);
    setError(null);
    try {
      // select field dùng sentinel riêng cho "chưa chọn gì" (shadcn Select cấm value="" trên
      // SelectItem) — đổi lại thành "" trước khi gửi, để backend coi là "xoá giá trị" giống mọi
      // field text khác (xem FieldConfig's `noneValue` doc comment).
      const payload = { ...values };
      for (const field of fields) {
        if (field.type === "select" && field.noneValue && payload[field.key] === field.noneValue) {
          payload[field.key] = "";
        }
      }

      if (dialog.mode === "create") {
        await apiMutateClient(resourcePath, "POST", payload, { idToken: token });
      } else if (dialog.row) {
        await apiMutateClient(`${resourcePath}/${dialog.row.id}`, "PATCH", payload, { idToken: token });
      }
      await queryClient.invalidateQueries({ queryKey: [queryKey] });
      setDialog(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Có lỗi xảy ra, thử lại sau.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          <Icon className="h-6 w-6" aria-hidden="true" />
          {title}
        </h1>
        <Button onClick={openCreate}>+ Thêm mới</Button>
      </div>

      <Input
        placeholder={searchPlaceholder ?? "Tìm kiếm..."}
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        className="max-w-xs"
      />

      {listQuery.isLoading ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Đang tải...</p>
      ) : (
        <>
          <ResourceTable columns={columns} rows={rows} onRowClick={openEdit} />
          <div className="flex items-center justify-center gap-4 text-sm">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              ← Trang trước
            </Button>
            <span className="text-zinc-500 dark:text-zinc-400">
              {page} / {totalPages} ({total.toLocaleString("vi-VN")})
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Trang sau →
            </Button>
          </div>
        </>
      )}

      {dialog ? (
        <ResourceFormDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          title={dialog.mode === "create" ? `Thêm ${title.toLowerCase()}` : `Sửa ${title.toLowerCase()}`}
          fields={fields}
          values={values}
          onValuesChange={setValues}
          onSubmit={() => void handleSubmit()}
          submitting={submitting}
          error={error}
        />
      ) : null}
    </div>
  );
}
