import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'auth_provider.dart';

class AuthScreen extends ConsumerWidget {
  const AuthScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authController = ref.watch(authControllerProvider);

    return Scaffold(
      appBar: AppBar(title: const Text("Đăng nhập")),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ElevatedButton(
              onPressed: () async {
                try {
                  await authController.signInWithGoogle();
                } catch (e) {
                  if (context.mounted) {
                    ScaffoldMessenger.of(context)
                        .showSnackBar(SnackBar(content: Text("Đăng nhập lỗi: $e")));
                  }
                }
              },
              child: const Text("Đăng nhập với Google"),
            ),
            // TODO: thêm UI verify phone number (nhập số → nhập OTP) khi cần dùng thật,
            // dùng authController.verifyPhoneNumber + confirmPhoneCode.
          ],
        ),
      ),
    );
  }
}
