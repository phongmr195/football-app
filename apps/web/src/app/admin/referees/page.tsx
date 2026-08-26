"use client";

import { Flag } from "lucide-react";
import { AdminResourcePage } from "@/components/admin/AdminResourcePage";

interface AdminRefereeRow {
  id: string;
  name: string;
  nationality: string | null;
}

export default function AdminRefereesPage() {
  return (
    <AdminResourcePage<AdminRefereeRow>
      title="Trọng tài"
      icon={Flag}
      resourcePath="/referees"
      queryKey="admin-referees"
      searchPlaceholder="Tìm theo tên trọng tài..."
      columns={[
        { key: "name", label: "Tên" },
        { key: "nationality", label: "Quốc tịch" },
      ]}
      fields={[
        { key: "name", label: "Tên", type: "text" },
        { key: "nationality", label: "Quốc tịch", type: "text" },
      ]}
      emptyValues={{ name: "", nationality: "" }}
      toFormValues={(row) => ({
        name: row.name,
        nationality: row.nationality ?? "",
      })}
    />
  );
}
