import { ArgumentsHost, BadRequestException, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

import { AnalyticsService } from './analytics.service';
import { ExceptionReportingFilter } from './exception.filter';

describe('server failure correlation', () => {
  afterEach(() => jest.restoreAllMocks());

  it('links response and safe logs while excluding request data and error messages', () => {
    jest
      .spyOn(BaseExceptionFilter.prototype, 'catch')
      .mockImplementation(() => undefined);
    const logged = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const captureException = jest.fn();
    const analytics = { captureException } as unknown as AnalyticsService;
    const response = { setHeader: jest.fn(), headersSent: false };
    const request = {
      method: 'POST',
      route: { path: '/user' },
      url: '/user?secret=private',
      body: { email: 'private-identity', password: 'private-password' },
    };
    const host = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;
    const error = Object.assign(new Error('private-error-message'), {
      code: 'P2028',
    });
    new ExceptionReportingFilter(analytics).catch(error, host);
    const event = JSON.parse(logged.mock.calls[0][0] as string) as {
      errorId: string;
      code: string;
    };
    expect(event.code).toBe('P2028');
    expect(event.errorId).toMatch(/^[a-f0-9-]{36}$/);
    expect(response.setHeader).toHaveBeenCalledWith(
      'x-openathlete-error-id',
      event.errorId,
    );
    expect(logged.mock.calls[0][0]).not.toContain('private');
    expect(captureException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ errorId: event.errorId, route: '/user' }),
    );
    response.setHeader.mockClear();
    new ExceptionReportingFilter(analytics).catch(
      new BadRequestException(),
      host,
    );
    expect(response.setHeader).not.toHaveBeenCalled();
    response.headersSent = true;
    new ExceptionReportingFilter(analytics).catch(error, host);
    expect(response.setHeader).not.toHaveBeenCalled();
  });
});
