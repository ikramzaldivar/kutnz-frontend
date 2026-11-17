# kutnz-frontend

Interfaz web de **kut.nz**: una SPA en JavaScript sin framework (`app.js`, `kut.css`, `pages.js`, íconos y manifest). Se publica en S3 y CloudFront la sirve en `/static/*`. Es parte del proyecto final de *Infraestructura para el Desarrollo Continuo* (ITESO, 2026).

| Ambiente | URL | Despliegue |
| --- | --- | --- |
| Dev | https://dev.kut.nz | Automático con cada merge a `main` |
| Prod | https://kut.nz | Después de Dev, con aprobación del environment `prod` |

`index.html` lo sirve el backend ([kutnz-backend](https://github.com/ikramzaldivar/kutnz-backend)). Los cambios de interfaz que publica este repo están en `app.js` (textos y comportamiento), `kut.css` (estilos) y `pages.js` (páginas de vista previa y error).

## Validar localmente

```bash
node scripts/validate.mjs
```

Revisa la sintaxis de cada JS, las llaves de `kut.css`, el `manifest.json` y que cada `/static/...` de `index.html` exista.

## Pipeline (`.github/workflows/pipeline.yml`)

1. **Build:** validación y artefacto `static`.
2. **Deploy Dev:** `aws s3 sync` al bucket de Dev, invalidación de `/static/*` en CloudFront y smoke test que compara el SHA-256 de lo publicado.
3. **Aprobación:** environment `prod`.
4. **Deploy Prod:** el mismo artefacto, a Prod.

La distribución de CloudFront se encuentra por su dominio y el bucket por su origen `static`, así que el pipeline sigue funcionando aunque el stack se vuelva a crear.

## Ramas

GitHub Flow: `feature/<issue>-<descripcion>` → PR a `main` (CI en verde y una aprobación) → Dev → aprobación → Prod.
