import type { ReactNode } from "react";
import { AdminGate } from "@/components/admin/AdminGate";
import { AdminAuthProvider } from "@/lib/admin-auth-context";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminAuthProvider>
      <AdminGate>{children}</AdminGate>
    </AdminAuthProvider>
  );
}
