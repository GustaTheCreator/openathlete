import { useInviteCoachMutation } from '@/api/athlete';
import { InvitationLinkPanel } from '@/components/invite-link-dialog/invite-link.dialog';
import { m } from '@/paraglide/messages';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

interface P {
  open: boolean;
  onClose: () => void;
  purpose: 'PERSONAL' | 'COLLEAGUE';
}

export function InviteCoachDialog({ open, onClose, purpose }: P) {
  const [email, setEmail] = useState<string>('');
  const inviteCoachMutation = useInviteCoachMutation({
    onSuccess: () => {
      setEmail('');
      onClose();
    },
    onError: () => {
      toast.error(m.failed_to_invite_coach());
    },
  });

  return (
    <Dialog onOpenChange={(o) => !o && onClose()} open={open}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{m.invite_a_coach()}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            inviteCoachMutation.mutate({ email: email.trim(), purpose });
          }}
        >
          <p className="text-sm text-muted-foreground">
            {purpose === 'PERSONAL'
              ? m.invitation_purpose_personal_description()
              : m.invitation_purpose_colleague_description()}
          </p>
          <Label htmlFor="coach-invite-email">{m.email()}</Label>
          <Input
            id="coach-invite-email"
            type="email"
            required
            className="w-full"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {open && <InvitationLinkPanel kind="COACH" purpose={purpose} />}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={onClose}
              disabled={inviteCoachMutation.isPending}
            >
              {m.cancel()}
            </Button>
            <Button
              size="sm"
              type="submit"
              disabled={!email.trim() || inviteCoachMutation.isPending}
              isLoading={inviteCoachMutation.isPending}
            >
              {m.invite()}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
