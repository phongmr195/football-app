# syntax=docker/dockerfile:1
# Firebase Auth Emulator cho local dev — dùng project id "demo-*" nên chạy hoàn toàn
# offline, không cần Firebase project thật/credentials (không đụng tới jankara-e2e-test).
FROM node:20-alpine
RUN npm install -g firebase-tools
WORKDIR /emulator
COPY firebase.json .
EXPOSE 9099 4000
CMD ["firebase", "emulators:start", "--only", "auth", "--project", "demo-football-app"]
