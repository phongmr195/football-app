"use client";

import { useQuery } from "@tanstack/react-query";
import { AdminResourcePage } from "@/components/admin/AdminResourcePage";
import { apiGetClient, type ApiListResponse } from "@/lib/api-client";
import { useAdminAuth } from "@/lib/admin-auth-context";
import type { Stadium, Team } from "@/lib/types";

const NO_STADIUM = "__none__";

export default function AdminTeamsPage() {
  const { token } = useAdminAuth();

  // Danh sách sân vận động cho dropdown — chưa có trang CRUD Stadium riêng (piece kế tiếp của
  // ROADMAP Phase 4), pageSize lớn ở đây là tạm đủ (số sân vận động đã sync không nhiều).
  const stadiumsQuery = useQuery({
    queryKey: ["admin-stadiums-options"],
    queryFn: () => apiGetClient<ApiListResponse<Stadium>>("/stadiums", { pageSize: 200 }, { idToken: token }),
    enabled: !!token,
  });
  const stadiumOptions = [
    { value: NO_STADIUM, label: "— Không có —" },
    ...(stadiumsQuery.data?.items ?? []).map((s) => ({ value: s.id, label: s.name })),
  ];

  return (
    <AdminResourcePage<Team>
      title="Đội bóng"
      resourcePath="/teams"
      queryKey="admin-teams"
      searchPlaceholder="Tìm theo tên đội bóng..."
      columns={[
        { key: "name", label: "Tên" },
        { key: "shortName", label: "Viết tắt" },
        { key: "countryCode", label: "Quốc gia" },
        { key: "founded", label: "Thành lập" },
      ]}
      fields={[
        { key: "name", label: "Tên", type: "text" },
        { key: "shortName", label: "Viết tắt", type: "text" },
        { key: "logoUrl", label: "Logo URL", type: "text" },
        { key: "countryCode", label: "Mã quốc gia", type: "text" },
        { key: "founded", label: "Năm thành lập", type: "number" },
        {
          key: "stadiumId",
          label: "Sân vận động",
          type: "select",
          options: stadiumOptions,
          noneValue: NO_STADIUM,
        },
      ]}
      emptyValues={{
        name: "",
        shortName: "",
        logoUrl: "",
        countryCode: "",
        founded: null,
        stadiumId: NO_STADIUM,
      }}
      toFormValues={(row) => ({
        name: row.name,
        shortName: row.shortName ?? "",
        logoUrl: row.logoUrl ?? "",
        countryCode: row.countryCode ?? "",
        founded: row.founded,
        stadiumId: row.stadiumId ?? NO_STADIUM,
      })}
    />
  );
}
