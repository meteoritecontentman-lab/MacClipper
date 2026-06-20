# MacClipper AI Instructions

## Dev Server
- Website dev server: `cd website && npm start` (serves on port 3000, auto-reloads)
- If it doesn't restart, kill the old process first: `pkill -f "react-scripts start"` or `lsof -ti :3000 | xargs kill`

## Deploy
- Build functions: `cd functions && npm run build`
- Deploy all: `cd .. && firebase deploy --only functions,hosting`
- Deploy functions only: `firebase deploy --only functions`
- Deploy hosting only: `firebase deploy --only hosting`

## Supabase
- SQL migrations: run in Supabase dashboard SQL editor
- Dashboard: https://supabase.com/dashboard/project/ccnuqjmqmylergzatpua/sql/new
- Anon key: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNjbnVxam1xbXlsZXJnemF0cHVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNzMwMzQsImV4cCI6MjA5MTg0OTAzNH0.T5F8_yYwcEJ2gtxrB0jGXJ-14f6ro0yuUJFG_QMfzZk`
- Service role key: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNjbnVxam1xbXlsZXJnemF0cHVhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjI3MzAzNCwiZXhwIjoyMDkxODQ5MDM0fQ.TBceoIpYk_R-ElERsZwoIVYbMRReFa1Le-Ve8ZgNvJM`

## Environment
- Bot shared secret: `Passkey@Owner2002026`
- SMTP: SendGrid via functions/.env
