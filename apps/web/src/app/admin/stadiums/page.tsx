"use client";

import { Landmark } from "lucide-react";
import { AdminResourcePage } from "@/components/admin/AdminResourcePage";
import type { Stadium } from "@/lib/types";

export default function AdminStadiumsPage() {
  return (
    <AdminResourcePage<Stadium>
      title="Sân vận động"
      icon={Landmark}
      resourcePath="/stadiums"
      queryKey="admin-stadiums"
      searchPlaceholder="Tìm theo tên sân vận động..."
      columns={[
        { key: "name", label: "Tên" },
        { key: "city", label: "Thành phố" },
        { key: "countryCode", label: "Quốc gia" },
        { key: "capacity", label: "Sức chứa" },
      ]}
      fields={[
        { key: "name", label: "Tên", type: "text" },
        { key: "city", label: "Thành phố", type: "text" },
        { key: "countryCode", label: "Mã quốc gia", type: "text" },
        { key: "capacity", label: "Sức chứa", type: "number" },
      ]}
      emptyValues={{ name: "", city: "", countryCode: "", capacity: null }}
      toFormValues={(row) => ({
        name: row.name,
        city: row.city ?? "",
        countryCode: row.countryCode ?? "",
        capacity: row.capacity,
      })}
    />
  );
}
