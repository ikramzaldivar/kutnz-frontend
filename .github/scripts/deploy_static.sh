#!/usr/bin/env bash
# Publica static/ en el bucket S3 que sirve /static/* del ambiente y limpia la caché de CloudFront.
# La distribución se encuentra por su dominio (alias) y el bucket por el origen "static" de esa
# distribución, así el pipeline sigue funcionando aunque el stack se destruya y se vuelva a crear.
# Variables: PUBLIC_HOST (kut.nz o dev.kut.nz).
set -euo pipefail
: "${PUBLIC_HOST:?}"

DIST_ID=$(aws cloudfront list-distributions --output text \
  --query "DistributionList.Items[?Aliases.Items && contains(Aliases.Items, '$PUBLIC_HOST')].Id | [0]")
[[ -n "$DIST_ID" && "$DIST_ID" != "None" ]] || { echo "No hay distribución de CloudFront para $PUBLIC_HOST"; exit 1; }
BUCKET=$(aws cloudfront get-distribution-config --id "$DIST_ID" --output text \
  --query "DistributionConfig.Origins.Items[?Id=='static'].DomainName | [0]" | sed 's/\.s3\..*//')
echo "CloudFront $DIST_ID → s3://$BUCKET/static/"

aws s3 sync static/ "s3://$BUCKET/static/" --cache-control "public, max-age=60" --no-progress
INV=$(aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/static/*" --query Invalidation.Id --output text)
echo "Invalidación $INV"
aws cloudfront wait invalidation-completed --distribution-id "$DIST_ID" --id "$INV"

# Smoke test: lo que entrega CloudFront es exactamente lo que se acaba de publicar.
for f in app.js kut.css; do
  esperado=$(sha256sum "static/$f" | cut -d' ' -f1)
  publicado=$(curl -fsS "https://$PUBLIC_HOST/static/$f?smoke=$GITHUB_RUN_ID" | sha256sum | cut -d' ' -f1)
  [[ "$esperado" == "$publicado" ]] && echo "✓ $f publicado" || { echo "✗ $f no coincide"; exit 1; }
done
