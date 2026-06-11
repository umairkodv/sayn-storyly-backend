import { IsIn } from 'class-validator';

export class ChangePlanDto {
  @IsIn(['pro', 'business'])
  plan!: 'pro' | 'business';
}