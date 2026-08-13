-- Rename users.cognitoSub -> users.firebaseUid (auth provider switched from AWS Cognito to Firebase Auth;
-- table was empty at migration time, verified via `SELECT count(*) FROM users` = 0).
ALTER TABLE "users" RENAME COLUMN "cognitoSub" TO "firebaseUid";
ALTER INDEX "users_cognitoSub_key" RENAME TO "users_firebaseUid_key";

-- email is now optional: Firebase phone-auth users have no email claim.
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;
