import { m } from '@/paraglide/messages';

const linkClassName =
  'inline-flex min-h-11 items-center rounded-sm px-1 underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring';

export function InstanceFooter() {
  return (
    <footer className="flex shrink-0 flex-wrap items-center justify-center gap-x-3 text-xs text-muted-foreground">
      <a href="/privacidade/" className={linkClassName}>
        {m.footer_privacy()}
      </a>
      <span aria-hidden="true">·</span>
      <a
        href="https://github.com/GustaTheCreator/openathlete/tree/tourmalet-2026.11.16.1"
        className={linkClassName}
      >
        {m.footer_source()}
      </a>
    </footer>
  );
}
