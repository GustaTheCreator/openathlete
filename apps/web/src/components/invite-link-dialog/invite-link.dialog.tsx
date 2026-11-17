import { AthleteAPI } from '@/api/athlete';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { m } from '@/paraglide/messages';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

type Props = {
  kind: 'ATHLETE' | 'COACH';
  purpose?: 'PERSONAL' | 'COLLEAGUE';
};

/** Renders inside the existing email invitation dialog, issuing one link per open. */
export function InvitationLinkPanel({ kind, purpose }: Props) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const createLink = useMutation({
    mutationFn: () => AthleteAPI.createInvitationLink({ kind, purpose }),
  });
  const { mutate } = createLink;

  useEffect(() => {
    mutate();
  }, [mutate]);

  const copyLink = async () => {
    if (!createLink.data?.url) return;
    try {
      await navigator.clipboard.writeText(createLink.data.url);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  };

  return (
    <section
      className="space-y-3 border-t pt-4"
      aria-label={m.create_invitation_link()}
    >
      <div className="space-y-1">
        <Label htmlFor="invitation-link-url">
          {m.create_invitation_link()}
        </Label>
        <p className="text-sm text-muted-foreground">
          {m.open_invitation_link_description()}
        </p>
      </div>
      {createLink.isPending ? (
        <p role="status">{m.creating_invitation_link()}</p>
      ) : createLink.isError ? (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive">
            {m.invitation_link_failed()}
          </p>
          <Button type="button" variant="outline" onClick={() => mutate()}>
            {m.retry()}
          </Button>
        </div>
      ) : createLink.data ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              id="invitation-link-url"
              type="url"
              value={createLink.data.url}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
              aria-describedby="invitation-link-expires"
            />
            <Button type="button" variant="outline" onClick={copyLink}>
              {m.copy_link()}
            </Button>
          </div>
          <p
            id="invitation-link-expires"
            className="text-sm text-muted-foreground"
          >
            {m.invitation_link_expires({
              date: new Date(createLink.data.expiresAt).toLocaleString(),
            })}
          </p>
          {copied && (
            <p role="status" className="text-sm">
              {m.link_copied()}
            </p>
          )}
          {copyFailed && (
            <p role="alert" className="text-sm text-destructive">
              {m.link_copy_failed()}
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
