import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Extracts the workspace attached by ApiKeyGuard.
 *
 * Usage (widget controllers only):
 *   @UseGuards(ApiKeyGuard)
 *   @Get('stories')
 *   getStories(@CurrentWorkspace() workspace: WorkspaceContext) { ... }
 */
export interface WorkspaceContext {
  workspaceId: string;
}

export const CurrentWorkspace = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): WorkspaceContext => {
    const request = ctx.switchToHttp().getRequest();
    return request.workspace;
  },
);