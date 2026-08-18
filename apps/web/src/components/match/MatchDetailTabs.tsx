"use client";

import type { ReactNode } from "react";
import { Card } from "@football-app/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface MatchDetailTabsProps {
  eventsSlot: ReactNode;
  lineupsSlot: ReactNode;
  statisticsSlot: ReactNode;
}

// CHỈ phần chuyển tab cần "use client" — 3 slot là Server Component render sẵn ở page.tsx (Server
// Component cha), truyền xuống làm children/props theo đúng pattern Next.js "Server Component lồng
// trong Client Component qua props/children". Không cần client hook/loading state cho data tĩnh.
export function MatchDetailTabs({ eventsSlot, lineupsSlot, statisticsSlot }: MatchDetailTabsProps) {
  return (
    <Card className="mt-6 p-0">
      <Tabs defaultValue="events" className="p-4">
        <TabsList>
          <TabsTrigger value="events">Diễn biến</TabsTrigger>
          <TabsTrigger value="lineups">Đội hình</TabsTrigger>
          <TabsTrigger value="statistics">Thống kê</TabsTrigger>
        </TabsList>
        <TabsContent value="events" className="pt-4">
          {eventsSlot}
        </TabsContent>
        <TabsContent value="lineups" className="pt-4">
          {lineupsSlot}
        </TabsContent>
        <TabsContent value="statistics" className="pt-4">
          {statisticsSlot}
        </TabsContent>
      </Tabs>
    </Card>
  );
}
