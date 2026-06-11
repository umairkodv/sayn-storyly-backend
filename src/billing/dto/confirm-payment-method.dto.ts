import { IsString, IsNotEmpty } from 'class-validator';

export class ConfirmPaymentMethodDto {
  @IsString()
  @IsNotEmpty()
  payment_method_id!: string;
}