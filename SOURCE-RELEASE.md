OpenAthlete Tourmalet web footer release, 2026-11-16.
Base source: a11ee107209ca289cd1f2db3f1958bd100d755f1
API unchanged. Web changes: localized text footer on auth pages and profile privacy settings.
Pinned Dockerfiles are included under apps/api and apps/web.
Build web: docker build -f apps/web/Dockerfile -t openathlete-web:footer-20261116 .
Web image: sha256:ccc21a4b1badbea4d814506801396b7410fe9acb8022b6d58917e4e16b9ef238
Changed source SHA256:
{
  "apps/web/src/components/instance-footer.tsx": "6fe800cb2c6a18288c17fdd6e8b413bbb8e227446ec2bce2de91496870f5cb1e",
  "apps/web/src/components/layouts/auth.layout.tsx": "a7fa14b2aa20af9d26bec3e2df3e1070aaca13409aecd990d8ec2493020cdf3f",
  "apps/web/src/views/dashboard/settings-view/privacy-section.tsx": "aba0ea272c6beb7b4e366ff08f640f420ff76092ba93bb586966fa95e58241c8",
  "apps/web/messages/en.json": "0af0ce01c91a5fa9d05f99cb5b77d69dd7946bf26c86229f06f9192bd77b8ab3",
  "apps/web/messages/fr.json": "cad9d63bde8f8b0a1132f9d7bf8ff7e12e952fd1bcb7fc94cbcd27e170327209",
  "apps/web/messages/it.json": "08e8a9216d46523c71de963671ba7b4b1aefe02c3d9f8f2521ed7d50f739904d",
  "apps/web/messages/es.json": "8ef431a570d0739c271928167f4968aa6ca9703cd8844a9099da3c33dda0fbe3",
  "apps/web/messages/pt-BR.json": "f3dde3fe6574587818bae0edbf860240f46f01d01a7cca705cf0e33b172e2583"
}
