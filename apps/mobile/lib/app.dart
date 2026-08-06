import 'package:flutter/material.dart';
import 'core/router/app_router.dart';

class FootballApp extends StatelessWidget {
  const FootballApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: "Football App",
      routerConfig: appRouter,
    );
  }
}
