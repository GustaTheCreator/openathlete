import client, { routes } from '@/utils/axios';

import {
  AdminCoachAthletesResponseDto,
  AdminCreateCoachAthleteDto,
  AdminCreateInvitationDto,
  AdminInvitationDto,
  AdminInvitationsResponseDto,
  AdminUpdateUserRolesDto,
  AdminUserDto,
  AdminUsersResponseDto,
} from '@openathlete/shared';

export const AdminAPI = {
  async getUsers(
    search: string,
    offset: number,
  ): Promise<AdminUsersResponseDto> {
    const response = await client.get<AdminUsersResponseDto>(
      routes.admin.users,
      {
        params: { search, limit: 100, offset },
      },
    );
    return response.data;
  },
  async updateUserRoles(
    userId: number,
    body: AdminUpdateUserRolesDto,
  ): Promise<AdminUserDto> {
    const response = await client.patch<AdminUserDto>(
      routes.admin.userRoles(userId),
      body,
    );
    return response.data;
  },
  async getCoachAthletes(): Promise<AdminCoachAthletesResponseDto> {
    const response = await client.get<AdminCoachAthletesResponseDto>(
      routes.admin.coachAthletes,
    );
    return response.data;
  },
  async createCoachAthlete(
    body: AdminCreateCoachAthleteDto,
  ): Promise<AdminCoachAthletesResponseDto> {
    const response = await client.post<AdminCoachAthletesResponseDto>(
      routes.admin.coachAthletes,
      body,
    );
    return response.data;
  },
  async deleteCoachAthlete(id: number): Promise<AdminCoachAthletesResponseDto> {
    const response = await client.delete<AdminCoachAthletesResponseDto>(
      routes.admin.coachAthlete(id),
    );
    return response.data;
  },
  async getInvitations(): Promise<AdminInvitationsResponseDto> {
    const response = await client.get<AdminInvitationsResponseDto>(
      routes.admin.invitations,
    );
    return response.data;
  },
  async createInvitation(
    body: AdminCreateInvitationDto,
  ): Promise<AdminInvitationsResponseDto> {
    const response = await client.post<AdminInvitationsResponseDto>(
      routes.admin.invitations,
      body,
    );
    return response.data;
  },
  async deleteInvitation(
    invitation: Pick<AdminInvitationDto, 'kind' | 'invitationId'>,
  ): Promise<AdminInvitationsResponseDto> {
    const response = await client.delete<AdminInvitationsResponseDto>(
      routes.admin.invitation(invitation.kind, invitation.invitationId),
    );
    return response.data;
  },
};
