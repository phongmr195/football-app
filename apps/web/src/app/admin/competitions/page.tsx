"use client";

import { AdminResourcePage } from "@/components/admin/AdminResourcePage";
import { competitionTypeMeta } from "@/lib/format";
import type { Competition } from "@/lib/types";

const TYPE_OPTIONS = [
  { value: "LEAGUE", label: "Giải vô địch" },
  { value: "CUP", label: "Cúp" },
  { value: "INTERNATIONAL", label: "Quốc tế" },
];

export default function AdminCompetitionsPage() {
  return (
    <AdminResourcePage<Competition>
      title="Giải đấu"
      resourcePath="/competitions"
      queryKey="admin-competitions"
      searchPlaceholder="Tìm theo tên giải đấu..."
      columns={[
        { key: "name", label: "Tên" },
        { key: "type", label: "Loại", render: (row) => competitionTypeMeta(row.type).label },
        { key: "countryCode", label: "Quốc gia" },
      ]}
      fields={[
        { key: "name", label: "Tên", type: "text" },
        { key: "type", label: "Loại", type: "select", options: TYPE_OPTIONS },
        { key: "countryCode", label: "Mã quốc gia", type: "text" },
        { key: "logoUrl", label: "Logo URL", type: "text" },
      ]}
      emptyValues={{ name: "", type: "LEAGUE", countryCode: "", logoUrl: "" }}
      toFormValues={(row) => ({
        name: row.name,
        type: row.type,
        countryCode: row.countryCode ?? "",
        logoUrl: row.logoUrl ?? "",
      })}
    />
  );
}
