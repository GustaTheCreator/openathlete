import { m } from '@/paraglide/messages';

const linkClassName =
  'inline-flex min-h-11 items-center rounded-sm px-1 underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring';

const DEFAULT_SOURCE_CODE_URL =
  'https://github.com/GustaTheCreator/openathlete/tree/tourmalet';
const SOURCE_CODE_URL_PLACEHOLDER = '__OPENATHLETE_SOURCE_CODE_URL__';

export function InstanceFooter() {
  const metaSourceUrl = document.querySelector<HTMLMetaElement>(
    'meta[name="openathlete-source-code-url"]',
  )?.content;
  const sourceCodeUrl =
    (metaSourceUrl &&
    metaSourceUrl !== SOURCE_CODE_URL_PLACEHOLDER &&
    metaSourceUrl !== '%VITE_SOURCE_CODE_URL%'
      ? metaSourceUrl
      : undefined) ||
    import.meta.env.VITE_SOURCE_CODE_URL ||
    DEFAULT_SOURCE_CODE_URL;

  return (
    <footer className="flex shrink-0 flex-wrap items-center justify-center gap-x-3 text-xs text-muted-foreground">
      <a href="/privacidade/" className={linkClassName}>
        {m.footer_privacy()}
      </a>
      <span aria-hidden="true">·</span>
      <a href={sourceCodeUrl} className={linkClassName}>
        {m.footer_source()}
      </a>
    </footer>
  );
}
