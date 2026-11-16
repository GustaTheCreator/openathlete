# Corresponding source

Application source commit: a11ee107209ca289cd1f2db3f1958bd100d755f1 (OpenAthlete v1.6.0 plus Wahoo).
Personal project notes and private deployment data are excluded.

Use Node 22.23.4 and pnpm 9.15.9. Run pnpm install --frozen-lockfile, pnpm database run db:generate, pnpm shared build, pnpm api build and pnpm web build. Dockerfiles and the lockfile are included. See LICENSE.

The optional selfhost files reproduce the source-download link in the deployed web image. Mount the entrypoint script and this archive as shown in selfhost/docker-compose.source.yml. Never include real environment values or provider credentials.

To reproduce the optional source link, place this archive at public-source/openathlete-wahoo-a11ee107209c.tar.gz and merge selfhost/docker-compose.source.yml with the base Compose file; paths are relative to the extraction root.
