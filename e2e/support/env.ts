/** Ports of docker-compose.yml; override to test another deployment. */
export const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:18080';
export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:13000';
