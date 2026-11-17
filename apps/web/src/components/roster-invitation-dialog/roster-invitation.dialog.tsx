import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { m } from '@/paraglide/messages';
import { FormEvent, useState } from 'react';

type Props = {
  open: boolean;
  operation: 'SHARE' | 'TRANSFER';
  athleteNames: string[];
  isLoading: boolean;
  onClose: () => void;
  onInvite: (email: string) => void;
};

export function RosterInvitationDialog({
  open,
  operation,
  athleteNames,
  isLoading,
  onClose,
  onInvite,
}: Props) {
  const [email, setEmail] = useState('');

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onInvite(email.trim());
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setEmail('');
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {operation === 'SHARE'
              ? m.invitation_operation_share()
              : m.invitation_operation_transfer()}
          </DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <p className="text-sm text-muted-foreground">
            {operation === 'SHARE'
              ? m.roster_share_description()
              : m.roster_transfer_description()}
          </p>
          <ul className="max-h-40 list-inside list-disc overflow-y-auto text-sm">
            {athleteNames.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
          <div className="space-y-2">
            <Label htmlFor="roster-invite-email">{m.invitee_email()}</Label>
            <Input
              id="roster-invite-email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEmail('');
                onClose();
              }}
              disabled={isLoading}
            >
              {m.cancel()}
            </Button>
            <Button type="submit" disabled={isLoading} isLoading={isLoading}>
              {m.send_invitation()}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
