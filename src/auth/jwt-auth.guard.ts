import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JsonWebTokenError, TokenExpiredError } from '@nestjs/jwt';

/**
 * Usage: @UseGuards(JwtAuthGuard) on any controller or route.
 *
 * Returns 401 with distinct messages for:
 *   - missing token
 *   - expired token  → frontend should redirect to /login or refresh
 *   - invalid token
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(err: any, user: any, info: any, _context: ExecutionContext) {
    if (info instanceof TokenExpiredError) {
      throw new UnauthorizedException('Token expired. Please log in again.');
    }

    if (info instanceof JsonWebTokenError) {
      throw new UnauthorizedException('Invalid token.');
    }

    if (err || !user) {
      throw new UnauthorizedException('Authentication required.');
    }

    return user;
  }
}