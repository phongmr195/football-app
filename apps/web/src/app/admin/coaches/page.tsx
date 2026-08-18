"use client";

import { useQuery } from "@tanstack/react-query";
import { AdminResourcePage } from "@/components/admin/AdminResourcePage";
import { apiGetClient, type ApiListResponse } from "@/lib/api-client";
import { useAdminAuth } from "@/lib/admin-auth-context";
import type { Team } from "@/lib/types";

const NO_TEAM = "__none__";

interface AdminCoachRow {
  id: string;
  name: string;
  nationality: string | null;
  birthDate: string | null;
  teamId: string | null;
  team: { id: string; name: string } | null;
}

export default function AdminCoachesPage() {
  const { token } = useAdminAuth();

  const teamsQuery = useQuery({
    queryKey: ["admin-teams-options"],
    queryFn: () => apiGetClient<ApiListResponse<Team>>("/teams", { pageSize: 200 }, { idToken: token }),
    enabled: !!token,
  });
  const teamOptions = [
    { value: NO_TEAM, label: "— Không có —" },
    ...(teamsQuery.data?.items ?? []).map((t) => ({ value: t.id, label: t.name })),
  ];

  return (
    <AdminResourcePage<AdminCoachRow>
      title="HLV"
      resourcePath="/coaches"
      queryKey="admin-coaches"
      searchPlaceholder="Tìm theo tên HLV..."
      columns={[
        { key: "name", label: "Tên" },
        { key: "team", label: "Đội bóng", render: (row) => row.team?.name ?? "—" },
        { key: "nationality", label: "Quốc tịch" },
      ]}
      fields={[
        { key: "name", label: "Tên", type: "text" },
        { key: "nationality", label: "Quốc tịch", type: "text" },
        { key: "birthDate", label: "Ngày sinh (YYYY-MM-DD)", type: "text" },
        { key: "teamId", label: "Đội bóng", type: "select", options: teamOptions, noneValue: NO_TEAM },
      ]}
      emptyValues={{ name: "", nationality: "", birthDate: "", teamId: NO_TEAM }}
      toFormValues={(row) => ({
        name: row.name,
        nationality: row.nationality ?? "",
        birthDate: row.birthDate ? row.birthDate.slice(0, 10) : "",
        teamId: row.teamId ?? NO_TEAM,
      })}
    />
  );
}
