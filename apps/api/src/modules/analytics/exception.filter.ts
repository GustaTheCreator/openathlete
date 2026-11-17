import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

import { ArgumentsHost, Catch, HttpException, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

import { AnalyticsService } from './analytics.service';

/** Reports what the API did not mean to answer, then answers as Nest would. */
@Catch()
export class ExceptionReportingFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(ExceptionReportingFilter.name);

  constructor(private readonly analytics: AnalyticsService) {
    super();
  }

  override catch(exception: unknown, host: ArgumentsHost) {
    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    if (status >= 500 && host.getType() === 'http') {
      const request = host.switchToHttp().getRequest<Request>();
      const errorId = randomUUID();
      const response = host.switchToHttp().getResponse<Response>();
      if (!response.headersSent) {
        response.setHeader('x-openathlete-error-id', errorId);
      }
      const code =
        typeof exception === 'object' &&
        exception !== null &&
        'code' in exception &&
        typeof exception.code === 'string' &&
        /^P\d{4}$/.test(exception.code)
          ? exception.code
          : undefined;
      // Correlate failures without logging messages, bodies, query strings or identities.
      this.logger.error(
        JSON.stringify({
          event: 'http_server_error',
          errorId,
          status,
          method: request.method,
          route: (request.route as { path?: string } | undefined)?.path,
          code,
        }),
      );
      this.analytics.captureException(exception, {
        // The route, not the URL: paths hold ids and query strings hold codes
        route: (request.route as { path?: string } | undefined)?.path,
        method: request.method,
        status,
        errorId,
      });
    }
    super.catch(exception, host);
  }
}
