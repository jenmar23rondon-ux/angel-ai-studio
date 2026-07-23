# Consent And Safety

The platform assumes real faces and private images are sensitive data.

Required controls:

- Explicit consent confirmation before upload or generation.
- Prompt moderation before a job is queued.
- Private S3 objects exposed only through signed URLs.
- Audit logs for uploads, generations, deletes and API key usage.
- Temporary file expiration for intermediate assets.
- Visible or metadata-based AI-generated content marking.
- Provider adapters that can enforce policy before external API calls.
