import { IsIn } from 'class-validator';

export class CreateCheckoutSessionDto {
  @IsIn(['pro', 'business'])
  plan: 'pro' | 'business';
}
