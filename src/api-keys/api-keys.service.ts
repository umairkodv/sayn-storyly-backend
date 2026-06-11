import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  InternalServerErrorException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

const BCRYPT_ROUNDS = 10; // Lower than passwords — keys are long random strings
const KEY_PREFIX    = 'swp_live_';

// Key identity (bcrypt match) is cached for 5 minutes — this is fine since
// keys don't change. Domain list is intentionally NOT cached at all — it is
// re-fetched from Supabase on every bcrypt-validated request so that domain
// changes take effect immediately without any cache invalidation dance.
const KEY_CACHE_TTL_MS = 300_000; // 5 minutes — for key hash only

interface CacheEntry {
  workspaceId: string;
  keyId: string;       // stored so we can fire last_used_at update
  expiresAt: number;
}

export interface ValidateResult {
  workspaceId: string;
  allowedDomains: string[];
}

@Injectable()
export class ApiKeysService {
  private readonly supabase: SupabaseClient;
  private readonly logger = new Logger(ApiKeysService.name);

  /**
   * In-memory cache: rawKey → { workspaceId, keyId, expiresAt }
   *
   * NOTE: We cache the KEY IDENTITY only (bcrypt result), NOT the
   * allowed_domains list. Domains are always fetched live from Supabase
   * so that settings changes take effect on the very next widget request.
   */
  private readonly keyCache = new Map<string, CacheEntry>();

  constructor(private readonly configService: ConfigService) {
    this.supabase = createClient(
      this.configService.getOrThrow<string>('SUPABASE_URL'),
      this.configService.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
    );
  }

  // ─────────────────────────────────────────────
  //  Create
  // ─────────────────────────────────────────────

  async create(workspaceId: string, dto: CreateApiKeyDto) {
    // Enforce single-key limit — rotate instead of accumulating
    const { count, error: countError } = await this.supabase
      .from('api_keys')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId);

    if (!countError && (count ?? 0) >= 1) {
      throw new BadRequestException(
        'Your workspace already has an API key. Use "Rotate key" to replace it.',
      );
    }

    const rawKey    = KEY_PREFIX + crypto.randomBytes(32).toString('hex');
    const keyPrefix = rawKey.substring(0, 12);
    const keyHash   = await bcrypt.hash(rawKey, BCRYPT_ROUNDS);

    const { data, error } = await this.supabase
      .from('api_keys')
      .insert({
        workspace_id: workspaceId,
        name:         dto.name,
        key_hash:     keyHash,
        key_prefix:   keyPrefix,
        is_active:    true,
      })
      .select('id, name, key_prefix, is_active, created_at')
      .single();

    if (error) {
      this.logger.error('Failed to create API key', error);
      throw new InternalServerErrorException('Could not create API key.');
    }

    // Return raw key ONCE — never stored, never retrievable again
    return {
      ...data,
      key:     rawKey,
      message: 'Store this key safely. It will not be shown again.',
    };
  }

  // ─────────────────────────────────────────────
  //  Rotate
  // ─────────────────────────────────────────────

  async rotate(workspaceId: string, dto: CreateApiKeyDto): Promise<{
    id: string;
    name: string;
    key_prefix: string;
    is_active: boolean;
    created_at: string;
    key: string;
  }> {
    // 1. Generate new key material (same as create)
    const rawKey    = KEY_PREFIX + crypto.randomBytes(32).toString('hex');
    const keyPrefix = rawKey.substring(0, 12);
    const keyHash   = await bcrypt.hash(rawKey, BCRYPT_ROUNDS);

    // 2. Delete ALL existing keys for this workspace
    const { error: deleteError } = await this.supabase
      .from('api_keys')
      .delete()
      .eq('workspace_id', workspaceId);

    if (deleteError) {
      this.logger.error('rotate: failed to delete old keys', deleteError);
      throw new InternalServerErrorException('Could not rotate API key.');
    }

    // 3. Clear key cache entries for this workspace
    //    Iterate cache and remove any entries for this workspaceId
    for (const [k, v] of this.keyCache.entries()) {
      if (v.workspaceId === workspaceId) this.keyCache.delete(k);
    }

    // 4. Insert new key
    const { data, error } = await this.supabase
      .from('api_keys')
      .insert({
        workspace_id: workspaceId,
        name:         dto.name,
        key_hash:     keyHash,
        key_prefix:   keyPrefix,
        is_active:    true,
      })
      .select('id, name, key_prefix, is_active, created_at')
      .single();

    if (error || !data) {
      this.logger.error('rotate: failed to insert new key', error);
      throw new InternalServerErrorException('Could not create new API key.');
    }

    // 5. Return new key with full raw key (shown once)
    return {
      ...(data as { id: string; name: string; key_prefix: string; is_active: boolean; created_at: string }),
      key: rawKey,
    };
  }

  // ─────────────────────────────────────────────
  //  List
  // ─────────────────────────────────────────────

  async findAll(workspaceId: string) {
    const { data, error } = await this.supabase
      .from('api_keys')
      .select('id, name, key_prefix, is_active, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error('Failed to list API keys', error);
      throw new InternalServerErrorException('Could not retrieve API keys.');
    }

    return data;
  }

  // ─────────────────────────────────────────────
  //  Delete
  // ─────────────────────────────────────────────

  async remove(workspaceId: string, keyId: string) {
    const { data: existing, error: fetchError } = await this.supabase
      .from('api_keys')
      .select('id, workspace_id')
      .eq('id', keyId)
      .maybeSingle();

    if (fetchError) {
      this.logger.error('Failed to fetch API key for deletion', fetchError);
      throw new InternalServerErrorException('Could not process request.');
    }

    if (!existing) {
      throw new NotFoundException('API key not found.');
    }

    if (existing.workspace_id !== workspaceId) {
      throw new ForbiddenException('You do not have access to this API key.');
    }

    const { error: deleteError } = await this.supabase
      .from('api_keys')
      .delete()
      .eq('id', keyId);

    if (deleteError) {
      this.logger.error('Failed to delete API key', deleteError);
      throw new InternalServerErrorException('Could not delete API key.');
    }

    // Evict from cache so deleted key stops working immediately
    for (const [rawKey, entry] of this.keyCache.entries()) {
      if (entry.workspaceId === workspaceId) {
        this.keyCache.delete(rawKey);
      }
    }

    return { message: 'API key deleted successfully.' };
  }

  // ─────────────────────────────────────────────
  //  Validate (used by ApiKeyGuard)
  //
  //  Two-step process:
  //  1. Check keyCache for identity (bcrypt result) — cached 5 min
  //  2. Always fetch allowed_domains LIVE from Supabase — never cached
  //     This ensures domain changes take effect immediately.
  // ─────────────────────────────────────────────

  async validate(rawKey: string): Promise<ValidateResult | null> {
    if (!rawKey?.startsWith(KEY_PREFIX)) return null;

    // ── Step 1: Resolve key identity ─────────────────────────────
    // Returns a strongly-typed object so TypeScript knows both fields
    // are definitely strings by the time Step 2 runs — no ! needed.
    const identity = await this.resolveKeyIdentity(rawKey);
    if (!identity) return null;

    const { workspaceId, keyId } = identity;

    // ── Step 2: Always fetch allowed_domains LIVE ─────────────────
    // Never cached — domain changes take effect on the very next request.
    const { data: workspace, error: wsError } = await this.supabase
      .from('workspaces')
      .select('allowed_domains')
      .eq('id', workspaceId)
      .single();

    if (wsError) {
      this.logger.error(
        `Failed to fetch allowed_domains for workspace ${workspaceId}`,
        wsError,
      );
      // Fail open on a transient DB error — the key identity was already
      // verified so we trust the workspace. Do not punish the customer
      // for a momentary Supabase read failure.
      return { workspaceId, allowedDomains: [] };
    }

    const allowedDomains: string[] = (workspace?.allowed_domains as string[]) ?? [];

    // Fire-and-forget: update last_used_at
    this.supabase
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', keyId)
      .then(() => {});

    return { workspaceId, allowedDomains };
  }

  // ─────────────────────────────────────────────
  //  Private: resolve key identity via cache or bcrypt
  // ─────────────────────────────────────────────

  private async resolveKeyIdentity(
    rawKey: string,
  ): Promise<{ workspaceId: string; keyId: string } | null> {
    // Cache hit path
    const cached = this.keyCache.get(rawKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { workspaceId: cached.workspaceId, keyId: cached.keyId };
    }

    // Evict expired entry if present
    if (cached) this.keyCache.delete(rawKey);

    // Cache miss — bcrypt path
    const keyPrefix = rawKey.substring(0, 12);

    const { data: candidates, error: keyError } = await this.supabase
      .from('api_keys')
      .select('id, workspace_id, key_hash')
      .eq('key_prefix', keyPrefix)
      .eq('is_active', true);

    if (keyError) {
      this.logger.error('Failed to fetch API key candidates during validation', keyError);
      return null;
    }

    if (!candidates?.length) return null;

    for (const candidate of candidates) {
      const match = await bcrypt.compare(rawKey, candidate.key_hash);
      if (match) {
        const result = {
          workspaceId: candidate.workspace_id as string,
          keyId:       candidate.id           as string,
        };

        // Cache key identity only — no domain data
        this.keyCache.set(rawKey, {
          ...result,
          expiresAt: Date.now() + KEY_CACHE_TTL_MS,
        });

        return result;
      }
    }

    return null;
  }
}