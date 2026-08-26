import { Card } from "@/components/ui/card";

/** Placeholder for nav sections not built yet (see ROADMAP.md Phase 4's piece breakdown) — real
 * routes on purpose (not href="#") so AdminNav never links to a dead 404. */
export function StubPage({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{title}</h1>
      <Card className="px-4 py-4 text-sm text-zinc-500 dark:text-zinc-400">
        Chưa triển khai — xem ROADMAP.md Phase 4 (Admin Panel) cho các piece kế tiếp.
      </Card>
    </div>
  );
}
