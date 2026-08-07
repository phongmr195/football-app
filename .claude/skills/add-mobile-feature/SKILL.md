---
name: add-mobile-feature
description: Scaffold a new Flutter feature folder trong apps/mobile/lib/features/ (Riverpod provider gọi API qua Dio + screen) theo đúng convention của football-app, và wire route vào GoRouter. NOTE — apps/mobile đang tạm pause (pivot Web 2026-08-07); chỉ dùng skill này khi user yêu cầu rõ ràng làm mobile, mặc định feature mới nên dùng add-web-page.
---

# Add Mobile Feature

> **apps/mobile tạm pause** (xem CLAUDE.md/ROADMAP.md) — chỉ chạy skill này khi user yêu cầu rõ ràng resume/sửa mobile.

Scaffold 1 feature mới cho `apps/mobile`, theo mẫu `lib/features/health/` — provider tách riêng khỏi UI, gọi API qua `dioProvider` chung.

## Bước thực hiện

1. **Xác nhận với user (nếu chưa rõ)**: tên feature (ví dụ `teams`), endpoint API cần gọi, route path (ví dụ `/teams`).

2. **Tạo `lib/features/<feature>/<feature>_provider.dart`**:
   ```dart
   import 'package:flutter_riverpod/flutter_riverpod.dart';
   import '../../core/network/dio_client.dart';

   final teamsProvider = FutureProvider<List<dynamic>>((ref) async {
     final dio = ref.watch(dioProvider);
     final response = await dio.get("/teams");
     return response.data['items'] as List<dynamic>;
   });
   ```
   Đổi kiểu trả về sang model cụ thể nếu đã có class model cho entity đó; nếu chưa có, tạo `lib/features/<feature>/<feature>_model.dart` với constructor `fromJson` tối giản (không cần code-gen/freezed trừ khi model phức tạp).

3. **Tạo `lib/features/<feature>/<feature>_screen.dart`**:
   - `ConsumerWidget`, dùng `ref.watch(<feature>Provider)` + `.when(data:, loading:, error:)` giống `HealthScreen`.

4. **Wire route vào `lib/core/router/app_router.dart`**: thêm `GoRoute(path: "/<feature>", builder: ...)`. Nếu cần điều hướng tới đây từ screen khác, dùng `context.go("/<feature>")` (GoRouter), không dùng `Navigator.push`.

5. **Verify thật** (đừng skip):
   - `flutter analyze` — phải sạch, không chỉ "ít lỗi hơn trước".
   - `flutter test` — nếu feature có test riêng, nhớ override provider trong `ProviderScope` để không gọi network thật trong test (xem `test/widget_test.dart`).
   - Nếu API backend cho feature này chưa tồn tại, dùng skill `add-api-module` trước hoặc chạy song song với subagent `backend-dev`.
   - Khuyến khích chạy thử thật trên simulator/device (`flutter run`) và chụp screenshot verify UI trước khi báo hoàn thành, không chỉ dừng ở analyze/test pass.
