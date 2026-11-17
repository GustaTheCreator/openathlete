import { m } from '@/paraglide/messages';

export type InvitationPurpose = 'PERSONAL' | 'COLLEAGUE' | 'SHARE' | 'TRANSFER';

export function invitationPurposeLabel(purpose?: InvitationPurpose | null) {
  switch (purpose) {
    case 'PERSONAL':
      return m.invitation_purpose_personal();
    case 'COLLEAGUE':
      return m.invitation_purpose_colleague();
    case 'SHARE':
      return m.invitation_operation_share();
    case 'TRANSFER':
      return m.invitation_operation_transfer();
    default:
      return '';
  }
}

export function openInvitationLabel() {
  return m.open_invitation();
}
