# Privacy and security notes

- Passwords are hashed by the backend. API access tokens are short lived; refresh tokens are stored as hashes and rotated on refresh.
- Keep `.env` out of version control. Use strong secrets and HTTPS outside local development.
- Never put OpenAI credentials in browser or mobile bundles.
- User-owned records must be accessed through the authenticated API; the MCP gateway forwards the user's identity and does not connect to the database.
- The AI tool gateway proposes writes for approval. Consequential actions should not be automated without an explicit user review.
- Memory content matching sensitive patterns is not saved unless the user explicitly opts in. Users can search, edit, and delete memories.
- Financial summaries do not convert currencies. They separate actual, estimated, and projected records.
- Health data is sensitive personal information. Device integrations require explicit native permissions and actual-device checks.
- Browser access and refresh tokens currently use local storage. A production deployment should assess XSS risk and consider a same-site secure cookie or a backend-for-frontend session design.
- Configure backups, retention, access monitoring, incident response, and data export/deletion workflows before serving real users.
