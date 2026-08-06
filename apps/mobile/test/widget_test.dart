import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:mobile/app.dart';
import 'package:mobile/features/health/health_provider.dart';

void main() {
  testWidgets('App khởi động và hiển thị AppBar', (WidgetTester tester) async {
    await tester.pumpWidget(
      ProviderScope(
        // tránh gọi network thật trong widget test
        overrides: [
          healthCheckProvider.overrideWith((ref) async => {"status": "ok"}),
        ],
        child: const FootballApp(),
      ),
    );

    expect(find.text('Football App'), findsWidgets);
  });
}
