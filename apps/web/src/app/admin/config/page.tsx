"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ResourceTable } from "@/components/admin/ResourceTable";
import { ApiError, apiGetClient, apiMutateClient } from "@/lib/api-client";
import { useAdminAuth } from "@/lib/admin-auth-context";

interface AppConfig {
  key: string;
  value: unknown;
  description: string | null;
  isEnabled: boolean;
  updatedAt: string;
}

// AppConfig.key là primary key thật (admin tự đặt lúc tạo, không phải cuid server sinh) — khác
// mọi resource khác trong admin (Competition/Team/Player/...) nên trang này KHÔNG dùng
// AdminResourcePage/ResourceFormDialog chung (những component đó giả định `id` bất biến, server
// sinh) mà tự viết riêng. ResourceTable vẫn tái dùng được (chỉ cần row có field "id").
export default function AdminConfigPage() {
  const { token } = useAdminAuth();
  const queryClient = useQueryClient();

  const [dialog, setDialog] = useState<{ mode: "create" | "edit"; row?: AppConfig } | null>(null);
  const [key, setKey] = useState("");
  const [valueText, setValueText] = useState("");
  const [description, setDescription] = useState("");
  const [isEnabled, setIsEnabled] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ["admin-config"],
    queryFn: () => apiGetClient<{ items: AppConfig[] }>("/config", undefined, { idToken: token }),
    enabled: !!token,
  });
  const rows = (listQuery.data?.items ?? []).map((row) => ({ ...row, id: row.key }));

  function openCreate() {
    setKey("");
    setValueText("{}");
    setDescription("");
    setIsEnabled(true);
    setError(null);
    setDialog({ mode: "create" });
  }

  function openEdit(row: AppConfig & { id: string }) {
    setKey(row.key);
    setValueText(JSON.stringify(row.value, null, 2));
    setDescription(row.description ?? "");
    setIsEnabled(row.isEnabled);
    setError(null);
    setDialog({ mode: "edit", row });
  }

  async function handleSubmit() {
    if (!dialog) return;
    let value: unknown;
    try {
      value = JSON.parse(valueText);
    } catch {
      setError("Value không phải JSON hợp lệ.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      if (dialog.mode === "create") {
        await apiMutateClient(
          "/config",
          "POST",
          { key, value, description, isEnabled },
          { idToken: token },
        );
      } else {
        await apiMutateClient(
          `/config/${dialog.row!.key}`,
          "PATCH",
          { value, description, isEnabled },
          { idToken: token },
        );
      }
      await queryClient.invalidateQueries({ queryKey: ["admin-config"] });
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
          <Settings className="h-6 w-6" aria-hidden="true" />
          Settings (Feature flags)
        </h1>
        <Button onClick={openCreate}>+ Thêm mới</Button>
      </div>

      {listQuery.isLoading ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Đang tải...</p>
      ) : (
        <ResourceTable
          columns={[
            { key: "key", label: "Key" },
            { key: "description", label: "Mô tả", render: (row) => row.description ?? "—" },
            { key: "isEnabled", label: "Bật?", render: (row) => (row.isEnabled ? "✓" : "—") },
            {
              key: "value",
              label: "Value",
              render: (row) => (
                <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                  {JSON.stringify(row.value)}
                </span>
              ),
            },
          ]}
          rows={rows}
          onRowClick={openEdit}
          emptyMessage="Chưa có config nào."
        />
      )}

      {dialog ? (
        <Dialog open onOpenChange={(open) => !open && setDialog(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{dialog.mode === "create" ? "Thêm config" : `Sửa config: ${key}`}</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void handleSubmit();
              }}
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="config-key">Key</Label>
                <Input
                  id="config-key"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  disabled={dialog.mode === "edit"}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="config-value">Value or JSON</Label>
                <Textarea
                  id="config-value"
                  value={valueText}
                  onChange={(e) => setValueText(e.target.value)}
                  className="font-mono text-xs"
                  rows={6}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="config-description">Mô tả</Label>
                <Input
                  id="config-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="config-enabled"
                  type="checkbox"
                  checked={isEnabled}
                  onChange={(e) => setIsEnabled(e.target.checked)}
                  className="h-4 w-4"
                />
                <Label htmlFor="config-enabled">Bật</Label>
              </div>
              {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialog(null)}>
                  Huỷ
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Đang lưu..." : "Lưu"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
