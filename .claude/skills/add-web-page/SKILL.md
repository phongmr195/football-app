---
name: add-web-page
description: Scaffold a new page/feature trong apps/web (Next.js) — page route + gọi API qua apps/api + wire vào navigation, theo convention của football-app. Dùng khi cần thêm trang/tính năng mới cho web app (client chính hiện tại).
---

# Add Web Page

Scaffold 1 trang/feature mới cho `apps/web`. Nếu `apps/web` chưa tồn tại, **scaffold trước** (xem bước 0) rồi mới thêm trang.

## Bước 0 — Nếu `apps/web` chưa tồn tại

1. `pnpm create next-app@latest apps/web --typescript --app --tailwind --eslint` (App Router, không dùng Pages Router)
2. Thêm `@football-app/web` vào `pnpm-workspace.yaml` nếu glob `apps/*` chưa cover tự động (thường đã cover sẵn)
3. Thêm script `build`/`dev`/`lint`/`typecheck` vào `apps/web/package.json` khớp pattern các app khác (xem `apps/api/package.json` làm mẫu), thêm vào `turbo.json` nếu cần task riêng
4. Tạo `apps/web/lib/api-client.ts` — hàm gọi `apps/api` dùng chung (base URL qua `NEXT_PUBLIC_API_URL` env var), tương tự `dioProvider` bên mobile
5. Nếu trang cần auth: setup Firebase JS SDK (`lib/firebase.ts`) — **phải đăng ký Web app riêng trong Firebase Console** (project hiện dùng: `jankara-e2e-test`) trước, lấy config riêng cho web, KHÔNG dùng lại config app iOS/Android

## Bước thực hiện (thêm 1 trang mới)

1. **Xác nhận với user (nếu chưa rõ)**: route path (ví dụ `/teams`), trang cần SSR/ISR (public, SEO quan trọng) hay Client Component (cần state/interactivity nhiều), endpoint API cần gọi.

2. **Trang public (list/detail giải đấu, team, match...)** → Server Component + `fetch` trực tiếp trong component (Next.js tự cache), dùng `revalidate` cho ISR nếu data không cần real-time:
   ```tsx
   // app/teams/page.tsx
   export const revalidate = 60; // ISR — điều chỉnh theo độ "nóng" của data

   async function getTeams() {
     const res = await fetch(`${process.env.API_URL}/teams`);
     if (!res.ok) throw new Error("Failed to fetch teams");
     return res.json();
   }

   export default async function TeamsPage() {
     const { items } = await getTeams();
     return (
       <ul>
         {items.map((team: { id: string; name: string }) => (
           <li key={team.id}>{team.name}</li>
         ))}
       </ul>
     );
   }
   ```

3. **Trang cần interactivity nhiều (form, real-time, filter phía client)** → Client Component (`"use client"`), gọi qua `lib/api-client.ts`, dùng React Query (hoặc tương đương) cho client-side cache/refetch nếu data cần cập nhật liên tục.

4. **(2026-08-15) Component UI → dùng shadcn/ui, đây là design system chính từ giờ trở đi**, KHÔNG tự viết tay từ đầu và KHÔNG import `Button`/`Card`/`Badge`/`Container`/`Pagination` từ `packages/ui` cho code mới nữa (package đó đang được migrate dần sang shadcn, giữ lại chỉ để không phá chỗ đang dùng cũ):
   ```bash
   cd apps/web && npx shadcn@latest add <component>
   ```
   Lưu ý bắt buộc: `aliases.utils` trong `components.json` trỏ `@football-app/ui` (dùng chung hàm `cn` cũ), nhưng lệnh `add` tự lỗi vì `packages/ui/package.json` thiếu `exports` field — phải tạm sửa `aliases.utils` về `"@/lib/utils"` trước khi chạy `add`, chạy xong trả lại `"@football-app/ui"` rồi tự sửa tay import `cn` trong file vừa sinh ra (từ `@/lib/utils` → `@football-app/ui`). Icon dùng `lucide-react` (đã cài sẵn), không dùng emoji/SVG tay. Nếu `add`/`init` tự thêm dòng `@custom-variant dark (&:is(.dark *));` vào `globals.css` — XOÁ ngay, app chưa có `next-themes`/toggle `.dark`, dòng đó sẽ tắt im lặng toàn bộ dark mode hiện có (dùng theo system preference).
   - Nếu trang đang sửa sẵn dùng component `packages/ui` cũ và việc đổi sang shadcn không tốn nhiều effort ngoài scope → đổi luôn. Nếu tốn nhiều effort → để nguyên, không ép migrate trong task không liên quan.

5. **Wire navigation**: thêm link vào layout/nav chung (`app/layout.tsx` hoặc component nav riêng) nếu trang cần xuất hiện trong menu chính.

6. **Verify thật** (đừng skip):
   - `pnpm --filter @football-app/web lint` và `typecheck` — phải sạch
   - `pnpm --filter @football-app/web build` — Next.js build sẽ bắt lỗi SSR/type nhiều thứ mà dev server không bắt được
   - Chạy `pnpm --filter @football-app/web dev`, mở trang thật (browser hoặc WebFetch) verify render đúng — không chỉ dừng ở build pass
   - Nếu API backend cho trang này chưa tồn tại, dùng skill `add-api-module` trước hoặc chạy song song với subagent `backend-dev`
