#!/bin/sh
# Chặn commit các file config/credential đã biết là không nên track trong git
# (kể cả khi bị `git add -f` ép add qua .gitignore). Không dựa vào nội dung —
# một số file này (ví dụ Firebase client config) không chứa "secret" theo nghĩa
# truyền thống nhưng vẫn không nên commit (project dùng chung, tránh noise
# secret scanner). Xem CLAUDE.md § Secrets & credentials.
echo "🚫 File sau khớp pattern credential/generated-config đã biết KHÔNG nên commit:"
printf '  %s\n' "$@"
echo ""
echo "Nếu đây là file .example/.sample thật (không chứa giá trị thật), đổi tên rõ hơn hoặc"
echo "thêm exception trong .lintstagedrc.json. Nếu chắc chắn cần commit, dùng"
echo "'git commit --no-verify' (KHÔNG khuyến khích — hỏi lại trước khi làm vậy)."
exit 1
