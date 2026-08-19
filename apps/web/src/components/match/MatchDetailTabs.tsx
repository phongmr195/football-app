"use client";

import type { ReactNode } from "react";
import { Activity, BarChart3, Star, Users } from "lucide-react";
import { Card } from "@football-app/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface MatchDetailTabsProps {
  eventsSlot: ReactNode;
  lineupsSlot: ReactNode;
  ratingsSlot: ReactNode;
  statisticsSlot: ReactNode;
}

// CHỈ phần chuyển tab cần "use client" — 4 slot là Server Component render sẵn ở page.tsx (Server
// Component cha), truyền xuống làm children/props theo đúng pattern Next.js "Server Component lồng
// trong Client Component qua props/children". Không cần client hook/loading state cho data tĩnh.
export function MatchDetailTabs({ eventsSlot, lineupsSlot, ratingsSlot, statisticsSlot }: MatchDetailTabsProps) {
  return (
    <Card className="mt-6 p-0">
      <Tabs defaultValue="events" className="p-4">
        <TabsList>
          <TabsTrigger value="events" className="gap-1.5">
            <Activity className="h-4 w-4" aria-hidden="true" />
            Diễn biến
          </TabsTrigger>
          <TabsTrigger value="lineups" className="gap-1.5">
            <Users className="h-4 w-4" aria-hidden="true" />
            Đội hình
          </TabsTrigger>
          <TabsTrigger value="ratings" className="gap-1.5">
            <Star className="h-4 w-4" aria-hidden="true" />
            Rating
          </TabsTrigger>
          <TabsTrigger value="statistics" className="gap-1.5">
            <BarChart3 className="h-4 w-4" aria-hidden="true" />
            Thống kê
          </TabsTrigger>
        </TabsList>
        <TabsContent value="events" className="pt-4">
          {eventsSlot}
        </TabsContent>
        <TabsContent value="lineups" className="pt-4">
          {lineupsSlot}
        </TabsContent>
        <TabsContent value="ratings" className="pt-4">
          {ratingsSlot}
        </TabsContent>
        <TabsContent value="statistics" className="pt-4">
          {statisticsSlot}
        </TabsContent>
      </Tabs>
    </Card>
  );
}
