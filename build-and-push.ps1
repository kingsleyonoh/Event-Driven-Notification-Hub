$IMAGE = "ghcr.io/kingsleyonoh/notification-hub:latest"
Write-Host "Building $IMAGE..."
docker build -t $IMAGE .
Write-Host "Pushing $IMAGE..."
docker push $IMAGE
Write-Host "Done. Watchtower will pick up in ~5 min, or manually: ssh deploy@104.248.137.96 'cd /apps/notification-hub && docker compose pull && docker compose up -d'"
