import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';

/**
 * Used on widget endpoints (POST /widget/events, GET /widget/stories).
 * Reads the raw API key from the x-api-key header, validates it,
 * enforces the domain whitelist, and attaches workspace context to the request.
 *
 * Domain enforcement rules:
 *   - allowed_domains is empty  → allow all origins (backward compatible /
 *     workspace has not configured any domains yet)
 *   - allowed_domains non-empty → Origin header must be present and match
 *     at least one entry in the list.
 *
 * Matching is normalised:
 *   - Protocol is stripped   (https://example.com → example.com)
 *   - Port is stripped        (example.com:443   → example.com)
 *   - www. prefix is ignored for comparison so that adding "example.com"
 *     also allows requests from "www.example.com" and vice versa.
 *
 * Usage: @UseGuards(ApiKeyGuard) on any widget controller or route.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(private readonly apiKeysService: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const rawKey: string | undefined = request.headers['x-api-key'];

    if (!rawKey) {
      throw new UnauthorizedException('Missing x-api-key header.');
    }

    const result = await this.apiKeysService.validate(rawKey);

    if (!result) {
      throw new UnauthorizedException('Invalid or inactive API key.');
    }

    const { workspaceId, allowedDomains } = result;

    // ── Domain whitelist enforcement ─────────────────────────────────────────
    if (allowedDomains.length > 0) {
      const originHeader: string | undefined = request.headers['origin'];

      if (!originHeader) {
        this.logger.warn(
          `Blocked request for workspace ${workspaceId}: ` +
          'no Origin header but domain whitelist is active',
        );
        throw new ForbiddenException('Origin header is required for this API key.');
      }

      const originHostname = this.extractHostname(originHeader);

      // Normalise origin: strip www. for comparison
      const originNormalised = this.stripWww(originHostname);

      // Check if the origin matches any allowed domain
      // Matching is www-agnostic: stored "example.com" matches origin
      // "www.example.com", and stored "www.example.com" also matches
      // origin "example.com".
      const isAllowed = allowedDomains.some((stored) => {
        const storedNormalised = this.stripWww(stored);
        return (
          storedNormalised === originNormalised ||
          stored === originHostname
        );
      });

      if (!isAllowed) {
        this.logger.warn(
          `Blocked request for workspace ${workspaceId}: ` +
          `origin "${originHostname}" not in whitelist [${allowedDomains.join(', ')}]`,
        );
        throw new ForbiddenException('Origin not allowed for this API key.');
      }
    }

    // Attach workspace context — includes origin so widget controller can set
    // the exact CORS header without re-reading the request headers
    request.workspace = {
      workspaceId,
      allowedDomains,
      origin: (request.headers['origin'] as string) ?? null,
    };

    return true;
  }

  /**
   * Extracts the hostname from an Origin header value.
   * "https://app.example.com" → "app.example.com"
   * "http://localhost:3000"   → "localhost:3000"
   */
  private extractHostname(origin: string): string {
    try {
      // URL.host includes port; URL.hostname strips it.
      // We want hostname only (no port) for matching.
      return new URL(origin).hostname;
    } catch {
      // Fallback if URL parsing fails (malformed origin)
      return origin
        .replace(/^https?:\/\//, '')
        .replace(/:\d+$/, '')
        .replace(/\/$/, '');
    }
  }

  /**
   * Strips the www. prefix for normalised comparison.
   * "www.example.com" → "example.com"
   * "example.com"     → "example.com"
   */
  private stripWww(hostname: string): string {
    return hostname.startsWith('www.') ? hostname.slice(4) : hostname;
  }
}