import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

// TODO: chuyển sang biến môi trường (--dart-define) khi có base URL thật cho từng environment
const _baseUrl = "http://localhost:3000";

final dioProvider = Provider<Dio>((ref) {
  return Dio(BaseOptions(baseUrl: _baseUrl));
});
