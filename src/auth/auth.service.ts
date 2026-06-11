import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  InternalServerErrorException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

const BCRYPT_ROUNDS = 12;
const RESET_TOKEN_EXPIRY_MINUTES = 30;

@Injectable()
export class AuthService {
  private readonly supabase: SupabaseClient;
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.supabase = createClient(
      this.configService.getOrThrow<string>('SUPABASE_URL'),
      this.configService.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
    );
  }

  // ─────────────────────────────────────────────
  //  Register
  // ─────────────────────────────────────────────

  async register(dto: RegisterDto) {
    const { data: existing } = await this.supabase
      .from('users')
      .select('id')
      .eq('email', dto.email)
      .maybeSingle();

    if (existing) {
      throw new ConflictException('An account with this email already exists.');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const slug = this.slugify(dto.workspaceName);
    const { data: workspace, error: wsError } = await this.supabase
      .from('workspaces')
      .insert({
        name: dto.workspaceName,
        slug: await this.uniqueSlug(slug),
        plan: 'free',
      })
      .select('id, name, slug')
      .single();

    if (wsError) {
      this.logger.error('Failed to create workspace', wsError);
      throw new InternalServerErrorException('Could not create workspace.');
    }

    const { data: user, error: userError } = await this.supabase
      .from('users')
      .insert({
        workspace_id: workspace.id,
        email: dto.email,
        password_hash: passwordHash,
        role: 'owner',
      })
      .select('id, email, role, workspace_id')
      .single();

    if (userError) {
      await this.supabase.from('workspaces').delete().eq('id', workspace.id);
      this.logger.error('Failed to create user', userError);
      throw new InternalServerErrorException('Could not create user.');
    }

    const token = this.signToken(user.id, user.email, workspace.id, user.role);

    return {
      access_token: token,
      user: { id: user.id, email: user.email, role: user.role },
      workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug },
    };
  }

  // ─────────────────────────────────────────────
  //  Login
  // ─────────────────────────────────────────────

  async login(dto: LoginDto) {
    const { data: user, error } = await this.supabase
      .from('users')
      .select('id, email, role, workspace_id, password_hash')
      .eq('email', dto.email)
      .maybeSingle();

    if (error || !user) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.password_hash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const { data: workspace } = await this.supabase
      .from('workspaces')
      .select('id, name, slug')
      .eq('id', user.workspace_id)
      .single();

    const token = this.signToken(user.id, user.email, user.workspace_id, user.role);

    return {
      access_token: token,
      user: { id: user.id, email: user.email, role: user.role },
      workspace,
    };
  }

  // ─────────────────────────────────────────────
  //  Forgot Password
  //  Stores a hashed reset token in users.reset_token + reset_token_expires_at
  //  (no schema change — uses existing columns; add them if missing — see note)
  // ─────────────────────────────────────────────

  async forgotPassword(dto: ForgotPasswordDto) {
    const { data: user } = await this.supabase
      .from('users')
      .select('id, email')
      .eq('email', dto.email)
      .maybeSingle();

    // Always return the same response to avoid email enumeration
    const genericResponse = {
      message: 'If that email exists, a reset link has been sent.',
    };

    if (!user) return genericResponse;

    // Generate a secure raw token (sent to user) and its hash (stored in DB)
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(
      Date.now() + RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000,
    ).toISOString();

    const { error } = await this.supabase
      .from('users')
      .update({
        reset_token: tokenHash,
        reset_token_expires_at: expiresAt,
      })
      .eq('id', user.id);

    if (error) {
      this.logger.error('Failed to store reset token', error);
      throw new InternalServerErrorException('Could not process request.');
    }

    // In production: send rawToken via email (e.g. SendGrid / Resend).
    // For now, log it so you can test without an email provider.
    this.logger.log(
      `[DEV ONLY] Password reset token for ${user.email}: ${rawToken}`,
    );

    return genericResponse;
  }

  // ─────────────────────────────────────────────
  //  Reset Password
  // ─────────────────────────────────────────────

  async resetPassword(dto: ResetPasswordDto) {
    const tokenHash = crypto
      .createHash('sha256')
      .update(dto.token)
      .digest('hex');

    const { data: user } = await this.supabase
      .from('users')
      .select('id, reset_token, reset_token_expires_at')
      .eq('reset_token', tokenHash)
      .maybeSingle();

    if (!user) {
      throw new BadRequestException('Invalid or expired reset token.');
    }

    if (new Date(user.reset_token_expires_at) < new Date()) {
      throw new BadRequestException('Reset token has expired.');
    }

    const passwordHash = await bcrypt.hash(dto.new_password, BCRYPT_ROUNDS);

    const { error } = await this.supabase
      .from('users')
      .update({
        password_hash: passwordHash,
        reset_token: null,
        reset_token_expires_at: null,
      })
      .eq('id', user.id);

    if (error) {
      this.logger.error('Failed to update password', error);
      throw new InternalServerErrorException('Could not reset password.');
    }

    return { message: 'Password updated successfully.' };
  }

  // ─────────────────────────────────────────────
  //  Helpers
  // ─────────────────────────────────────────────

  private signToken(
    userId: string,
    email: string,
    workspaceId: string,
    role: string,
  ): string {
    return this.jwtService.sign({ sub: userId, email, workspaceId, role });
  }

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  private async uniqueSlug(base: string): Promise<string> {
    let slug = base;
    let attempt = 0;

    while (true) {
      const { data } = await this.supabase
        .from('workspaces')
        .select('id')
        .eq('slug', slug)
        .maybeSingle();

      if (!data) return slug;

      attempt++;
      slug = `${base}-${attempt}`;
    }
  }
}