-- When someone changes their sign-in email, the old address is told.
ALTER TYPE "EmailTemplate" ADD VALUE 'EMAIL_CHANGED';
