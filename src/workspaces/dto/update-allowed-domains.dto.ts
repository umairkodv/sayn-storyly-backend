import { IsArray, IsString, Matches } from 'class-validator';

// Valid hostname: "example.com" or "app.example.com"
// Rejects: protocols (https://), paths (/foo), trailing slashes
const HOSTNAME_REGEX =
  /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

export class UpdateAllowedDomainsDto {
  @IsArray()
  @IsString({ each: true })
  @Matches(HOSTNAME_REGEX, {
    each: true,
    message:
      'Each domain must be a valid hostname without protocol or path ' +
      '(e.g. "example.com" or "app.example.com")',
  })
  domains!: string[];
}