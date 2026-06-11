import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

/**
 * Guards admin-only routes.
 * Must be used after JwtAuthGuard so req.user is already populated.
 *
 * Usage:
 *   @UseGuards(JwtAuthGuard, AdminGuard)
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      user?: { role?: string };
    }>();

    if (request.user?.role !== 'admin') {
      throw new ForbiddenException('Admin access required.');
    }

    return true;
  }
}
