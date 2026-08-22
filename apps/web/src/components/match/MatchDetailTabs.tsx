"use client";

import type { ReactNode } from "react";
import { Activity, BarChart3, Percent, Star, Users } from "lucide-react";
import { Card } from "@football-app/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface MatchDetailTabsProps {
  eventsSlot: ReactNode;
  lineupsSlot: ReactNode;
  ratingsSlot: ReactNode;
  statisticsSlot: ReactNode;
  // Optional — chỉ truyền khi match đang SCHEDULED/LIVE VÀ có odds thật (xem
  // matches/[id]/page.tsx) — odds hết ý nghĩa khi FINISHED, khác 4 slot còn lại (luôn hiện dù
  // rỗng, tự render empty-state). Không truyền = không hiện tab này luôn, không phải tab-rỗng.
  oddsSlot?: ReactNode;
}

// CHỈ phần chuyển tab cần "use client" — các slot là Server Component render sẵn ở page.tsx
// (Server Component cha), truyền xuống làm children/props theo đúng pattern Next.js "Server
// Component lồng trong Client Component qua props/children". Không cần client hook/loading state
// cho data tĩnh.
export function MatchDetailTabs({ eventsSlot, lineupsSlot, ratingsSlot, statisticsSlot, oddsSlot }: MatchDetailTabsProps) {
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
          {oddsSlot ? (
            <TabsTrigger value="odds" className="gap-1.5">
              <Percent className="h-4 w-4" aria-hidden="true" />
              Tỉ lệ cược
            </TabsTrigger>
          ) : null}
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
        {oddsSlot ? (
          <TabsContent value="odds" className="pt-4">
            {oddsSlot}
          </TabsContent>
        ) : null}
      </Tabs>
    </Card>
  );
}
