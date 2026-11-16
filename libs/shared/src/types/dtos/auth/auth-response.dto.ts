import { z } from 'zod';

export const authResponseDtoSchema = z.object({
  accessToken: z.string(),
  // Browser refresh credentials are issued only in an HttpOnly cookie.
  refreshToken: z.string().optional(),
});

export type AuthResponseDto = z.infer<typeof authResponseDtoSchema>;
