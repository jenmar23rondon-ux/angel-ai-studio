# Deployment

Recommended AWS targets:

- Web: S3 and CloudFront, or containerized Vite build behind CloudFront.
- API: ECS Fargate or App Runner.
- Worker: ECS Fargate service.
- Database: RDS PostgreSQL.
- Queue/cache: ElastiCache Redis or SQS depending on provider latency.
- Assets: private S3 bucket with server-generated signed URLs.
