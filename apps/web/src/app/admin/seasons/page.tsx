"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarRange } from "lucide-react";
import { AdminResourcePage } from "@/components/admin/AdminResourcePage";
import { apiGetClient, type ApiListResponse } from "@/lib/api-client";
import { useAdminAuth } from "@/lib/admin-auth-context";
import type { Competition } from "@/lib/types";

interface AdminSeasonRow {
  id: string;
  competitionId: string;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  competition: { id: string; name: string };
}

export default function AdminSeasonsPage() {
  const { token } = useAdminAuth();

  // competitionId là field bắt buộc (không nullable trong schema.prisma) — khác stadiumId/teamId
  // ở các trang khác, field select này KHÔNG có noneValue "— Không có —": admin luôn phải chọn 1
  // giải đấu thật, để trống sẽ bị backend từ chối (competitionId required ở seasons.ts).
  const competitionsQuery = useQuery({
    queryKey: ["admin-competitions-options"],
    queryFn: () =>
      apiGetClient<ApiListResponse<Competition>>("/competitions", { pageSize: 200 }, { idToken: token }),
    enabled: !!token,
  });
  const competitionOptions = (competitionsQuery.data?.items ?? []).map((c) => ({
    value: c.id,
    label: c.name,
  }));

  return (
    <AdminResourcePage<AdminSeasonRow>
      title="Mùa giải"
      icon={CalendarRange}
      resourcePath="/seasons"
      queryKey="admin-seasons"
      searchPlaceholder="Tìm theo tên mùa giải (vd 2025/2026)..."
      columns={[
        { key: "name", label: "Tên" },
        { key: "competition", label: "Giải đấu", render: (row) => row.competition.name },
        { key: "startDate", label: "Bắt đầu", render: (row) => row.startDate.slice(0, 10) },
        { key: "endDate", label: "Kết thúc", render: (row) => row.endDate.slice(0, 10) },
        { key: "isCurrent", label: "Hiện tại", render: (row) => (row.isCurrent ? "✓" : "") },
      ]}
      fields={[
        { key: "competitionId", label: "Giải đấu", type: "select", options: competitionOptions },
        { key: "name", label: "Tên (vd 2025/2026)", type: "text" },
        { key: "startDate", label: "Bắt đầu (YYYY-MM-DD)", type: "text" },
        { key: "endDate", label: "Kết thúc (YYYY-MM-DD)", type: "text" },
        { key: "isCurrent", label: "Là mùa giải hiện tại", type: "checkbox" },
      ]}
      emptyValues={{
        competitionId: competitionOptions[0]?.value,
        name: "",
        startDate: "",
        endDate: "",
        isCurrent: false,
      }}
      toFormValues={(row) => ({
        competitionId: row.competitionId,
        name: row.name,
        startDate: row.startDate.slice(0, 10),
        endDate: row.endDate.slice(0, 10),
        isCurrent: row.isCurrent,
      })}
    />
  );
}
