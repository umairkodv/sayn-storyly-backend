import { IsString, IsIn } from 'class-validator';

export class UpdateShapeDto {
  @IsString()
  @IsIn(['circle', 'rounded', 'square', 'portrait'])
  card_shape: string;
}