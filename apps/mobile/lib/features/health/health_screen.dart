import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'health_provider.dart';

class HealthScreen extends ConsumerWidget {
  const HealthScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final health = ref.watch(healthCheckProvider);

    return Scaffold(
      appBar: AppBar(title: const Text("Football App")),
      body: Center(
        child: health.when(
          data: (data) => Text("API status: ${data['status']}"),
          loading: () => const CircularProgressIndicator(),
          error: (err, _) => Text("Không kết nối được API: $err"),
        ),
      ),
    );
  }
}
