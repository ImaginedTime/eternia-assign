# Deployment Guide

This guide covers deploying the Order Execution Engine to various platforms.

## Prerequisites

- Docker and Docker Compose (for local deployment)
- PostgreSQL database (managed or self-hosted)
- Redis instance (managed or self-hosted)
- Node.js 20+ (if deploying without Docker)

## Local Deployment with Docker Compose

1. **Clone the repository**
   ```bash
   git clone <repo-url>
   cd eternia-assign
   ```

2. **Create `.env` file**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Start all services**
   ```bash
   docker-compose up -d
   ```

4. **Check logs**
   ```bash
   docker-compose logs -f app
   ```

5. **Verify health**
   ```bash
   curl http://localhost:3000/health
   ```

## Deployment to Render

### Option 1: Docker Deployment

1. **Create a new Web Service on Render**
   - Connect your GitHub repository
   - Set build command: `docker build -t order-engine .`
   - Set start command: `docker-compose up`

2. **Add PostgreSQL Database**
   - Create a new PostgreSQL database on Render
   - Copy the internal database URL

3. **Add Redis Instance**
   - Create a new Redis instance on Render
   - Copy the internal Redis URL

4. **Configure Environment Variables**
   - `DATABASE_URL`: PostgreSQL connection string from Render
   - `REDIS_URL`: Redis connection string from Render
   - `PORT`: 10000 (Render default)
   - `NODE_ENV`: production

### Option 2: Native Node.js Deployment

1. **Create a new Web Service**
   - Build command: `pnpm install && pnpm run build`
   - Start command: `pnpm run migrate && pnpm start`

2. **Add PostgreSQL and Redis** (same as above)

3. **Configure environment variables**

## Deployment to Fly.io

1. **Install Fly CLI**
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

2. **Login to Fly**
   ```bash
   fly auth login
   ```

3. **Create Fly app**
   ```bash
   fly launch
   ```

4. **Create PostgreSQL database**
   ```bash
   fly postgres create --name order-engine-db
   fly postgres attach order-engine-db
   ```

5. **Create Redis instance**
   ```bash
   fly redis create
   ```

6. **Set secrets**
   ```bash
   fly secrets set DATABASE_URL=<postgres-url>
   fly secrets set REDIS_URL=<redis-url>
   fly secrets set NODE_ENV=production
   ```

7. **Deploy**
   ```bash
   fly deploy
   ```

## Deployment to Heroku

1. **Install Heroku CLI**
   ```bash
   # See https://devcenter.heroku.com/articles/heroku-cli
   ```

2. **Create Heroku app**
   ```bash
   heroku create order-execution-engine
   ```

3. **Add PostgreSQL addon**
   ```bash
   heroku addons:create heroku-postgresql:mini
   ```

4. **Add Redis addon**
   ```bash
   heroku addons:create heroku-redis:mini
   ```

5. **Set environment variables**
   ```bash
   heroku config:set NODE_ENV=production
   heroku config:set PORT=$PORT
   ```

6. **Create Procfile**
   ```
   release: pnpm run migrate
   web: pnpm start
   ```

7. **Deploy**
   ```bash
   git push heroku main
   ```

## Environment Variables for Production

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://user:pass@host:5432/dbname
REDIS_URL=redis://host:6379
BULL_CONCURRENCY=10
ORDER_PROCESSOR_RATE=100
MAX_RETRIES=3
BACKOFF_BASE_MS=500
LOG_LEVEL=info
USE_REAL_DEVNET=false
```

## Health Checks

All platforms should use:
- Health endpoint: `GET /health`
- Expected response: `{"status":"ok","timestamp":"..."}`

## Monitoring

- **Metrics endpoint**: `GET /metrics`
- **Logs**: Use platform-specific logging (Render logs, Fly logs, Heroku logs)
- **Database**: Monitor connection pool and query performance
- **Redis**: Monitor memory usage and connection count

## Scaling Considerations

- **Horizontal scaling**: Run multiple app instances behind a load balancer
- **Queue workers**: Can run separately from web server
- **Database**: Use connection pooling (default: max 20 connections)
- **Redis**: Ensure sufficient memory for queue jobs

## Troubleshooting

1. **Database connection issues**
   - Verify `DATABASE_URL` is correct
   - Check database is accessible from deployment platform
   - Ensure database has sufficient connections

2. **Redis connection issues**
   - Verify `REDIS_URL` is correct
   - Check Redis is accessible
   - Monitor Redis memory usage

3. **Queue not processing**
   - Check worker is running
   - Verify Redis connection
   - Check logs for errors

4. **WebSocket issues**
   - Ensure platform supports WebSocket upgrades
   - Check load balancer WebSocket configuration
   - Verify Redis pub/sub is working

