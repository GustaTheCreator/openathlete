import type { CoachInvitationPurpose } from '@openathlete/database';
import type { EmailLanguage } from '@openathlete/shared';

const descriptions: Record<
  EmailLanguage,
  Record<CoachInvitationPurpose, (name: string, count: number) => string>
> = {
  EN: {
    PERSONAL: (name) =>
      `${name} invites you to coach only their personal athlete profile. Accepting gives access to its training history and editing. It does not share the athletes they coach.`,
    COLLEAGUE: (name) =>
      `${name} invites you to join as a fellow coach, with your own training and coaching areas. Accepting does not link any athlete or share their athletes.`,
    SHARE: (name, count) =>
      `${name} invites you to share ${count} athlete${count === 1 ? '' : 's'}. Accepting gives you their training history and editing access; the sender keeps their access. Review the selected athletes before accepting.`,
    TRANSFER: (name, count) =>
      `${name} invites you to take over ${count} athlete${count === 1 ? '' : 's'}. Accepting gives you their training history and editing access; the sender loses only these coaching associations after yours are created. Review the selection before accepting.`,
  },
  FR: {
    PERSONAL: (name) =>
      `${name} vous invite à coacher uniquement son profil personnel d'athlète. Accepter donne accès à son historique et à la modification de ses entraînements, sans partager les athlètes que cette personne accompagne.`,
    COLLEAGUE: (name) =>
      `${name} vous invite comme collègue coach, avec vos espaces personnel et entraîneur. Accepter ne crée aucune association avec un athlète et ne partage pas ses athlètes.`,
    SHARE: (name, count) =>
      `${name} vous propose de partager ${count} athlète${count === 1 ? '' : 's'}. Accepter donne accès à leur historique et à la modification des entraînements ; l'expéditeur conserve son accès. Vérifiez la sélection avant d'accepter.`,
    TRANSFER: (name, count) =>
      `${name} vous propose le transfert de ${count} athlète${count === 1 ? '' : 's'}. Accepter donne accès à leur historique et à la modification des entraînements ; seules ces associations sont retirées à l'expéditeur après la création des vôtres. Vérifiez la sélection avant d'accepter.`,
  },
  ES: {
    PERSONAL: (name) =>
      `${name} te invita a entrenar únicamente su perfil personal de atleta. Aceptar permite consultar su historial y editar sus entrenamientos, sin compartir los atletas a los que entrena.`,
    COLLEAGUE: (name) =>
      `${name} te invita como colega entrenador, con tus áreas personal y de entrenador. Aceptar no vincula ningún atleta ni comparte sus atletas.`,
    SHARE: (name, count) =>
      `${name} propone compartir ${count} atleta${count === 1 ? '' : 's'}. Aceptar permite consultar su historial y editar sus entrenamientos; quien invita conserva su acceso. Revisa la selección antes de aceptar.`,
    TRANSFER: (name, count) =>
      `${name} propone transferir ${count} atleta${count === 1 ? '' : 's'}. Aceptar permite consultar su historial y editar sus entrenamientos; solo se retiran esas asociaciones al remitente después de crear las tuyas. Revisa la selección antes de aceptar.`,
  },
  IT: {
    PERSONAL: (name) =>
      `${name} ti invita ad allenare solo il suo profilo personale di atleta. Accettando puoi consultare lo storico e modificare i suoi allenamenti, senza condividere gli atleti che segue.`,
    COLLEAGUE: (name) =>
      `${name} ti invita come collega coach, con le tue aree personale e allenatore. Accettare non collega alcun atleta e non condivide i suoi atleti.`,
    SHARE: (name, count) =>
      `${name} propone di condividere ${count} atlet${count === 1 ? 'a' : 'i'}. Accettando puoi consultarne lo storico e modificare gli allenamenti; il mittente mantiene il suo accesso. Controlla la selezione prima di accettare.`,
    TRANSFER: (name, count) =>
      `${name} propone di trasferirti ${count} atlet${count === 1 ? 'a' : 'i'}. Accettando puoi consultarne lo storico e modificare gli allenamenti; solo questi collegamenti vengono rimossi al mittente dopo aver creato i tuoi. Controlla la selezione prima di accettare.`,
  },
  PT_BR: {
    PERSONAL: (name) =>
      `${name} convida-te a acompanhar apenas o seu perfil pessoal de atleta. Aceitar dá acesso ao histórico e à edição dos seus treinos, sem partilhar os atletas que acompanha.`,
    COLLEAGUE: (name) =>
      `${name} convida-te como colega treinador, com as tuas áreas pessoal e de treinador. Aceitar não associa nenhum atleta nem partilha os atletas de quem te convida.`,
    SHARE: (name, count) =>
      `${name} propõe partilhar ${count} atleta${count === 1 ? '' : 's'}. Aceitar dá acesso ao histórico e à edição dos treinos; quem convida mantém o seu acesso. Revê os atletas selecionados antes de aceitar.`,
    TRANSFER: (name, count) =>
      `${name} propõe transferir ${count} atleta${count === 1 ? '' : 's'}. Aceitar dá acesso ao histórico e à edição dos treinos; quem convida perde apenas essas associações depois de criadas as tuas. Revê a seleção antes de aceitar.`,
  },
};

export function describeCoachInvitation(
  language: EmailLanguage,
  purpose: CoachInvitationPurpose,
  athleteName: string,
  athleteCount = 0,
) {
  return descriptions[language][purpose](athleteName, athleteCount);
}
