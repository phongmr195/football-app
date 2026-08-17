"use client";

import { useQuery } from "@tanstack/react-query";
import { AdminResourcePage } from "@/components/admin/AdminResourcePage";
import { apiGetClient, type ApiListResponse } from "@/lib/api-client";
import { useAdminAuth } from "@/lib/admin-auth-context";
import { playerPositionMeta } from "@/lib/format";
import type { Team } from "@/lib/types";

const NO_TEAM = "__none__";

// Shape thật của GET /players (apps/api/src/routes/players.ts) — bao gồm `team` rút gọn, khác
// PlayerDetail (lib/types.ts) vốn dùng cho trang public /players/[id] (team đầy đủ hơn).
interface AdminPlayerRow {
  id: string;
  name: string;
  dateOfBirth: string | null;
  nationality: string | null;
  position: string | null;
  heightCm: number | null;
  teamId: string | null;
  team: { id: string; name: string; logoUrl: string | null } | null;
}

export default function AdminPlayersPage() {
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
    <AdminResourcePage<AdminPlayerRow>
      title="Cầu thủ"
      resourcePath="/players"
      queryKey="admin-players"
      searchPlaceholder="Tìm theo tên cầu thủ..."
      columns={[
        { key: "name", label: "Tên" },
        { key: "team", label: "Đội bóng", render: (row) => row.team?.name ?? "—" },
        { key: "position", label: "Vị trí", render: (row) => playerPositionMeta(row.position).label },
        { key: "nationality", label: "Quốc tịch" },
      ]}
      fields={[
        { key: "name", label: "Tên", type: "text" },
        { key: "dateOfBirth", label: "Ngày sinh (YYYY-MM-DD)", type: "text" },
        { key: "nationality", label: "Quốc tịch", type: "text" },
        { key: "position", label: "Vị trí", type: "text" },
        { key: "heightCm", label: "Chiều cao (cm)", type: "number" },
        { key: "teamId", label: "Đội bóng", type: "select", options: teamOptions, noneValue: NO_TEAM },
      ]}
      emptyValues={{
        name: "",
        dateOfBirth: "",
        nationality: "",
        position: "",
        heightCm: null,
        teamId: NO_TEAM,
      }}
      toFormValues={(row) => ({
        name: row.name,
        dateOfBirth: row.dateOfBirth ? row.dateOfBirth.slice(0, 10) : "",
        nationality: row.nationality ?? "",
        position: row.position ?? "",
        heightCm: row.heightCm,
        teamId: row.teamId ?? NO_TEAM,
      })}
    />
  );
}
